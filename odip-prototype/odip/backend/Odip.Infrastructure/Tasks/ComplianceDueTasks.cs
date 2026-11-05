using System.Globalization;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Tasks;

/// <summary>
/// The one rule for a compliance date's Admin task, shared by the controller (so a save shows its task at once) and the nightly scan. One task per item per date, raised from <see cref="LeadDays"/> before the date,
/// retitled in three bands (90 to 31 days, 30 to 0, passed) by <see cref="ObligationTaskService"/>'s refresh of an open task, due on the date itself.
/// </summary>
public static class ComplianceDueTasks
{
    public const int LeadDays = 90;
    public const int SoonDays = 30;
    public const string LinkTo = "/settings?tab=compliance";
    public const string KeyPrefix = "compliance:";

    public static string SourceKey(Guid id, DateOnly on) => $"{KeyPrefix}{id}:{on:yyyy-MM-dd}";

    public static int DaysLeft(DateOnly expiresOn, DateOnly today) => expiresOn.DayNumber - today.DayNumber;

    /// <summary>"14 Feb 2027", whatever the server's culture.</summary>
    private static string Date(DateOnly d) => d.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

    public static string Title(ComplianceKind kind, string label, DateOnly expiresOn, int daysLeft)
    {
        var audit = kind is ComplianceKind.Audit or ComplianceKind.MidTermAudit;
        var on = Date(expiresOn);
        return daysLeft < 0 ? (audit ? $"{label} was due on {on}" : $"{label} expired on {on}")
            : daysLeft <= SoonDays ? (audit ? $"{label} is due within 30 days, on {on}" : $"{label} expires within 30 days, on {on}")
            : audit ? $"{label} is due on {on}" : $"{label} expires on {on}";
    }

    /// <summary>The task this item should have today, or null while it is still more than <see cref="LeadDays"/> away.</summary>
    public static ObligationTaskSpec? Spec(ComplianceItem item, DateOnly today, Guid tenantId)
    {
        var left = DaysLeft(item.ExpiresOn, today);
        return left > LeadDays ? null
            : new ObligationTaskSpec(SourceKey(item.Id, item.ExpiresOn), TaskType.ComplianceDue, Title(item.Kind, item.Label, item.ExpiresOn, left), item.ExpiresOn, LinkTo, TenantId: tenantId);
    }
}
