using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Reflection scan: no endpoint open to a support worker, a read-only user or an anonymous caller returns a participant
/// ID number, other than ParticipantsController.GetById, which masks it for those roles (ParticipantIdMaskTests).
/// </summary>
public class ParticipantIdMaskEndpointScanTests
{
    private static readonly Regex IdField = new("Ndis.*Number|Medicare|PensionCard|CompanionCard|TaxiCard|HealthMembership", RegexOptions.IgnoreCase);

    private static IEnumerable<MethodInfo> CountedActions() =>
        typeof(ParticipantsController).Assembly.GetTypes()
            .Where(t => t.IsClass && !t.IsAbstract && typeof(ControllerBase).IsAssignableFrom(t))
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            .Where(m => m.GetCustomAttributes().Any(a => a is IActionHttpMethodProvider))
            .Where(OpenToSupportWorkerOrReadOnly);

    // ASP.NET requires every [Authorize] on the class chain AND the method, so the roles intersect: the action counts when
    // each role-bearing attribute lets SupportWorker or ReadOnly in. [AllowAnonymous] counts whatever the roles say.
    private static bool OpenToSupportWorkerOrReadOnly(MethodInfo m)
    {
        var owner = m.DeclaringType!;
        if (m.IsDefined(typeof(AllowAnonymousAttribute), true) || owner.IsDefined(typeof(AllowAnonymousAttribute), true)) return true;
        return owner.GetCustomAttributes<AuthorizeAttribute>(true).Concat(m.GetCustomAttributes<AuthorizeAttribute>(true))
            .Where(a => !string.IsNullOrWhiteSpace(a.Roles))
            .All(a => a.Roles!.Split(',', StringSplitOptions.TrimEntries).Any(r => r is "SupportWorker" or "ReadOnly"));
    }

    // Task<>, ValueTask<>, ActionResult<>, ApiResponse<>, PagedResult<>, arrays and IEnumerable<> all unwrap to their payload.
    private static Type Unwrap(Type t)
    {
        while (true)
        {
            if (t.IsArray) { t = t.GetElementType()!; continue; }
            if (!t.IsGenericType) return t;
            var def = t.GetGenericTypeDefinition();
            var wrapper = def == typeof(Task<>) || def == typeof(ValueTask<>) || def == typeof(ActionResult<>)
                || def == typeof(ApiResponse<>) || def == typeof(PagedResult<>)
                || t.GetInterfaces().Append(t).Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IEnumerable<>)) && def != typeof(Dictionary<,>);
            if (!wrapper) return t;
            t = t.GetGenericArguments()[0];
        }
    }

    private static bool IsUntyped(Type t) =>
        t == typeof(object) || t == typeof(IActionResult) || t == typeof(ActionResult) || typeof(FileResult).IsAssignableFrom(t)
        || typeof(JsonNode).IsAssignableFrom(t) || t == typeof(JsonElement);

    private static bool LeaksIdField(Type t, HashSet<Type> seen)
    {
        t = Unwrap(t);
        if (t.Namespace?.StartsWith("Odip.", StringComparison.Ordinal) != true || !seen.Add(t)) return false;
        return t.GetProperties().Any(p => p.Name != "MaskedNdisNumber" && IdField.IsMatch(p.Name) || LeaksIdField(p.PropertyType, seen));
    }

    private static string Name(MethodInfo m) => $"{m.DeclaringType!.Name}.{m.Name}";

    [Fact]
    public void NoOtherEndpointLeaksIdNumbersToSupportWorkerOrReadOnly()
    {
        var actions = CountedActions().ToList();
        Assert.True(actions.Count > 20, "the scan found suspiciously few actions");

        // Assert 1: typed payloads. GetById masks. The caregiver link route is anonymous and token-gated: it serves the
        // participant's family, not a staff role, and is out of scope here (plan G3, board card 248).
        var flagged = actions.Where(m => LeaksIdField(m.ReturnType, new())).Select(Name).OrderBy(n => n).ToList();
        Assert.Equal(new[] { "CaregiverController.Get", "ParticipantsController.GetById" }, flagged);

        // Assert 2: untyped payloads can't be walked, so each one is named here with the reason it is safe. A new one fails the test.
        var untyped = actions.Where(m => IsUntyped(Unwrap(m.ReturnType))).Select(Name).OrderBy(n => n).ToList();
        Assert.Equal(UntypedAllowList.Keys.OrderBy(n => n).ToList(), untyped);
    }

    private static readonly Dictionary<string, string> UntypedAllowList = new()
    {
        ["AuthController.DevUsers"] = "no participant ID fields in this controller (grep-checked 2026-10-25)",
        ["AuthController.DevWhoAmi"] = "dev-only identity echo; no participant ID fields in this controller (grep-checked 2026-10-25)",
        ["AuthController.Logout"] = "no participant ID fields in this controller (grep-checked 2026-10-25)",
        ["CaregiverController.SaveDraft"] = "no participant ID fields in this controller (grep-checked 2026-10-25)",
        ["CaregiverController.Submit"] = "no participant ID fields in this controller (grep-checked 2026-10-25)",
        ["EarlyAccessController.Submit"] = "no participant ID fields in this controller (grep-checked 2026-10-25)",
        ["MicrosoftAuthController.Callback"] = "Microsoft sign-in: redirects, session and account state; no participant ID fields in this controller (grep-checked 2026-10-26)",
        ["MicrosoftAuthController.Config"] = "Microsoft sign-in: redirects, session and account state; no participant ID fields in this controller (grep-checked 2026-10-26)",
        ["MicrosoftAuthController.DeleteAccount"] = "Microsoft sign-in: redirects, session and account state; no participant ID fields in this controller (grep-checked 2026-10-26)",
        ["MicrosoftAuthController.GetAccount"] = "Microsoft sign-in: redirects, session and account state; no participant ID fields in this controller (grep-checked 2026-10-26)",
        ["MicrosoftAuthController.Refresh"] = "Microsoft sign-in: redirects, session and account state; no participant ID fields in this controller (grep-checked 2026-10-26)",
        ["MicrosoftAuthController.Start"] = "Microsoft sign-in: redirects, session and account state; no participant ID fields in this controller (grep-checked 2026-10-26)",
        ["NotificationsController.MarkAllInboxRead"] = "no participant ID fields in this controller (grep-checked 2026-10-25)",
        ["NotificationsController.MarkInboxRead"] = "no participant ID fields in this controller (grep-checked 2026-10-25)",
        ["ParticipantsController.DownloadClientOverviewPdf"] = "masks ID numbers for support workers and read-only users in this PR",
        ["ParticipantsController.DownloadIntakeFormPdf"] = "masks ID numbers for support workers and read-only users in this PR",
        ["ParticipantsController.DownloadIntakeSnapshotPdf"] = "masks ID numbers for support workers and read-only users in this PR (re-rendered copy, no SHA-256)",
        ["ParticipantsController.DownloadParticipantProfilePdf"] = "masks ID numbers for support workers and read-only users in this PR",
        ["PortalPayslipsController.Pdf"] = "the staff member's own payslip; no participant ID fields in this controller (grep-checked 2026-10-25)",
    };
}
