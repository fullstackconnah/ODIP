using System.Globalization;
using System.Text.RegularExpressions;
using Odip.Domain.Billing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Services;

/// <summary>One thing wrong (block) or worth a look (warn) about a claim line. Rule is the stable id; Message is what a person reads.</summary>
public sealed record LineProblem(string Rule, string Severity, string Message);

/// <summary>An NDIA-accepted line, kept so the same participant, item and dates are not sent twice.</summary>
public sealed record AcceptedLine(string NdisNumber, string SupportNumber, DateOnly From, DateOnly To, string FileName);

/// <summary>
/// What the checks need beyond the row itself, read once. The same context serves a build (blocks refuse it) and the hub list (problems shown inline), so the two never disagree.
/// </summary>
public sealed class BatchContext
{
    public DateOnly Today { get; init; }
    /// <summary>The lines going into this file (empty on the hub, where no file exists yet).</summary>
    public IReadOnlyList<BprRow> BuildRows { get; init; } = [];
    /// <summary>Line id to the file it is Pending in, from other batches.</summary>
    public IReadOnlyDictionary<Guid, string> PendingFiles { get; init; } = new Dictionary<Guid, string>();
    public IReadOnlyList<AcceptedLine> Accepted { get; init; } = [];
    /// <summary>Claim id to the other-funded refusal text, when it has one.</summary>
    public IReadOnlyDictionary<Guid, string> OtherFunded { get; init; } = new Dictionary<Guid, string>();
    /// <summary>Claim id to the reference of the other claim that holds the same shift.</summary>
    public IReadOnlyDictionary<Guid, string> HeldBy { get; init; } = new Dictionary<Guid, string>();
    /// <summary>Line id to the code of its last rejection, for a resubmit.</summary>
    public IReadOnlyDictionary<Guid, string> LastRejectCode { get; init; } = new Dictionary<Guid, string>();
    public IReadOnlySet<Guid> ConfirmedLineIds { get; init; } = new HashSet<Guid>();
    /// <summary>Participant id to the dates of their funding plans.</summary>
    public IReadOnlyDictionary<Guid, IReadOnlyList<(DateOnly Start, DateOnly End)>> Plans { get; init; } = new Dictionary<Guid, IReadOnlyList<(DateOnly, DateOnly)>>();
}

public static partial class ClaimBatchChecks
{
    public const string Block = "block";
    public const string Warn = "warn";
    private static readonly string[] CancellationReasons = ["NSDH", "NSDF", "NSDT", "NSDO"];
    private static readonly ClaimLineItemStatus[] SentStatuses =
        [ClaimLineItemStatus.Submitted, ClaimLineItemStatus.Approved, ClaimLineItemStatus.Paid, ClaimLineItemStatus.PartiallyPaid];

    [GeneratedRegex(@"^43\d{7}$")] private static partial Regex NdisPattern();
    [GeneratedRegex(@"^\d+$")] private static partial Regex Digits();

    private static string Money(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);

    /// <summary>The registration number problem, once: it is the organisation's, not a line's.</summary>
    public static string? RegistrationProblem(ProviderSettings? settings) =>
        string.IsNullOrWhiteSpace(settings?.RegistrationNumber) || !Digits().IsMatch(settings.RegistrationNumber.Trim())
            ? "Add your NDIS registration number in Settings first. It must be digits only."
            : null;

    /// <summary>The age band as its own field, so the screen never works it out again: none, amber (60 days), red (80), over90.</summary>
    public static string AgeBand(int ageDays) => ageDays > 90 ? "over90" : ageDays >= 80 ? "red" : ageDays >= 60 ? "amber" : "none";

    public static int AgeDays(DateOnly today, DateOnly from) => today.DayNumber - from.DayNumber;

    public static IReadOnlyList<LineProblem> For(BprRow row, BatchContext ctx)
    {
        var l = row.Line;
        var problems = new List<LineProblem>();
        void Add(string rule, string severity, string message) => problems.Add(new LineProblem(rule, severity, message));

        if (RegistrationProblem(row.Settings) is { } reg) Add("RegistrationNumber", Block, reg);
        var ndis = row.Participant?.NdisNumber?.Trim() ?? "";
        if (!NdisPattern().IsMatch(ndis)) Add("NdisNumber", Block, "This participant's NDIS number must be 9 digits starting with 43.");
        if (l.SupportsDeliveredFrom > l.SupportsDeliveredTo) Add("DateOrder", Block, "The start date is after the end date.");
        if (l.SupportsDeliveredTo > ctx.Today) Add("FutureDate", Block, "You can't claim for a day that hasn't happened yet.");
        if (row.Item is null)
            Add("CatalogueItem", Block, $"Support item {l.SupportItemCode} isn't in the price guide on {l.SupportsDeliveredFrom.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.");
        else if (row.Item.PriceNational != null && CatalogueStatePrice.For(row.Item, row.State) is var limit && limit > 0 && l.UnitPrice > limit)
            Add("PriceLimit", Block, $"The price ${Money(l.UnitPrice)} is over the {row.State} limit of ${Money(limit)}.");
        if (l.GSTCode is not (GSTCode.P1 or GSTCode.P2 or GSTCode.P5)) Add("GstCode", Block, "The GST code must be P1, P2 or P5.");
        if (l.ClaimType == ClaimType.Cancellation && !CancellationReasons.Contains((l.CancellationReason ?? "").Trim().ToUpperInvariant()))
            Add("CancellationReason", Block, "Choose why the participant cancelled: health, family, transport or other.");
        if (l.ClaimType is ClaimType.Variation or ClaimType.Adjustment)
            Add("ChangeType", Block, "Change a lodged claim by cancelling it in the portal and lodging a new one.");
        if (row.PlanType != PlanType.AgencyManaged)
            Add("NotAgency", Block, "This participant's plan isn't NDIA-managed, so this line isn't claimed from the NDIA.");
        if (ctx.OtherFunded.TryGetValue(l.TripClaimId, out var other)) Add("OtherFunded", Block, other);
        if (ctx.PendingFiles.TryGetValue(l.Id, out var pendingFile))
            Add("AlreadyPending", Block, $"This line is already in {pendingFile}. Discard that file, or wait for its results.");
        if (ctx.Accepted.FirstOrDefault(a => a.NdisNumber == ndis && a.SupportNumber == l.SupportItemCode && a.From == l.SupportsDeliveredFrom && a.To == l.SupportsDeliveredTo) is { } accepted)
            Add("AlreadyAccepted", Block, $"The NDIA already accepted this participant, item and dates in {accepted.FileName}.");
        if (SentStatuses.Contains(l.Status)) Add("AlreadySent", Block, "This line has already been sent.");
        // A claim that is already out is only lodged again line by line, for a line the NDIA rejected.
        if (row.Claim.Status is not (TripClaimStatus.Draft or TripClaimStatus.Ready) && l.Status != ClaimLineItemStatus.Rejected)
            Add("ClaimNotOpen", Block, "This claim has already been sent or closed, so its lines can't be sent in a new file.");
        if (ctx.HeldBy.TryGetValue(l.TripClaimId, out var holder)) Add("HeldByAnotherClaim", Block, $"Another claim already holds this shift ({holder}).");
        if (ctx.LastRejectCode.TryGetValue(l.Id, out var code) && NdiaRejectCodes.For(code) is { NeedsDecision: true } info && !ctx.ConfirmedLineIds.Contains(l.Id))
            Add("NeedsDecision", Block, $"The NDIA said: {info.Hint} Confirm you've checked this before sending it again.");

        var age = AgeDays(ctx.Today, l.SupportsDeliveredFrom);
        if (age > 90) Add("Age", Warn, "Over 90 days since the service. From 1 December 2026 the NDIA rejects claims this old.");
        else if (age >= 80) Add("Age", Warn, $"{age} days since the service. Send it soon.");
        else if (age >= 60) Add("Age", Warn, $"{age} days since the service.");

        if (row.Participant is { } p && ctx.Plans.TryGetValue(p.Id, out var plans) && plans.Count > 0
            && !plans.Any(pl => pl.Start <= l.SupportsDeliveredFrom && l.SupportsDeliveredTo <= pl.End))
            Add("OutsidePlan", Warn, "These dates are outside the participant's plan.");
        if (ctx.BuildRows.Any(o => o.Line.Id != l.Id && o.Participant?.NdisNumber?.Trim() == ndis && o.Line.SupportItemCode == l.SupportItemCode
                && o.Line.SupportsDeliveredFrom == l.SupportsDeliveredFrom && o.Line.SupportsDeliveredTo == l.SupportsDeliveredTo))
            Add("DuplicateInFile", Warn, "Another line in this file has the same participant, item and dates. The NDIA may reject one as a duplicate.");
        if ((row.Item?.Unit ?? "H") == "H" && l.Hours * 60 != decimal.Truncate(l.Hours * 60))
            Add("HoursNotWholeMinutes", Warn, $"{l.Hours.ToString("0.####", CultureInfo.InvariantCulture)} hours isn't a whole number of minutes. The file rounds it to {BprCsvService.FormatHours(l.Hours)}.");

        return problems;
    }
}
