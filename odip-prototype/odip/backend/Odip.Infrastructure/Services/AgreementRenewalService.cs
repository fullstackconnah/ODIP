using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>What a renewal came to: the saved revision, or every reason it was refused, and which kind of refusal it is (the controller answers each with its own status).</summary>
public sealed record RenewalOutcome(ServiceAgreementDraft? Draft, IReadOnlyList<string> Errors, bool NotFound = false, int? ConflictVersion = null, bool NotAnApprover = false, bool PlanNeeded = false)
{
    public static RenewalOutcome Refused(params string[] errors) => new(null, errors);
}

/// <summary>
/// Renew agreement (agreement PR 2, spec Part B): the newest approved revision's blocks as the participant's next revision, from the day after it ends, for its term's length (D2), stopping at the end
/// of the participant's plan that covers that day (D7) and at the engine's longest period. Saved through <see cref="ServiceAgreementDraftService.SaveAsync"/>, the one pricing path, so it is priced
/// from the catalogue as it is now and an old price is never copied. It is a Draft, approved through the existing approval.
/// </summary>
public sealed class AgreementRenewalService
{
    private readonly OdipDbContext _db;
    private readonly ServiceAgreementDraftService _drafts;
    private readonly PlanPricingService _pricing;

    public AgreementRenewalService(OdipDbContext db, ServiceAgreementDraftService? drafts = null, PlanPricingService? pricing = null)
    {
        _db = db;
        _pricing = pricing ?? new PlanPricingService(db);
        _drafts = drafts ?? new ServiceAgreementDraftService(db, _pricing);
    }


    public async Task<RenewalOutcome> RenewAsync(Guid tenantId, Guid participantId, Guid draftId, ApprovalCaller caller, string actor, CancellationToken ct)
    {
        // The roles that may approve may renew (spec): the approval's own check, before anything is read.
        if (!await ServiceAgreementApprovalService.MayApproveAsync(_pricing, tenantId, caller, ct))
            return new RenewalOutcome(null, new[] { "Your role cannot renew agreements in your organisation. An Admin can change who may approve in Settings, Plan pricing." }, NotAnApprover: true);

        // Named by organisation, participant and revision: a SuperAdmin's context has no query filter, and another organisation's revision is simply not there.
        var source = await _db.ServiceAgreementDrafts.AsNoTracking().Include(x => x.Blocks)
            .FirstOrDefaultAsync(x => x.Id == draftId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        if (source is null) return new RenewalOutcome(null, new[] { "Agreement not found." }, NotFound: true);

        var revisions = await _db.ServiceAgreementDrafts.AsNoTracking().Where(x => x.TenantId == tenantId && x.ParticipantId == participantId)
            .Select(x => new { x.Version, x.AgreementStartDate, x.AgreementEndDate, Approved = _db.ServiceAgreementDraftApprovals.Any(a => a.DraftId == x.Id) })
            .ToListAsync(ct);
        var approved = revisions.Where(r => r.Approved).MaxBy(r => r.Version);
        if (approved?.Version != source.Version)
            return RenewalOutcome.Refused(approved is null
                ? "This agreement is not approved for rostering yet, so there is nothing to renew."
                : string.Create(CultureInfo.InvariantCulture, $"Renew the agreement from its newest approved revision, v{approved.Version}."));


        // A newer revision waiting (a renewal already started, or a change) would be deleted by the save (D3): it is loaded first, and approved or changed from there.
        var newest = revisions.Max(r => r.Version);
        if (newest != source.Version)
            return new RenewalOutcome(null, new[] { string.Create(CultureInfo.InvariantCulture, $"This agreement has a newer revision, v{newest}. Load it first: a renewal would replace it.") }, ConflictVersion: newest);

        // The term (D2): a change saved as a revision covers only its last weeks and keeps the end, so the term starts at the earliest approved revision ending on that day.
        var termStartOf = revisions.Where(r => r.Approved).GroupBy(r => r.AgreementEndDate).ToDictionary(g => g.Key, g => g.Min(r => r.AgreementStartDate));
        // A renewal of a renewal runs for the first term's length, walking back while an approved term ends the day before: a renewal the plan cut short does not shorten every later one (fix round 1, deep S4).
        var (termStart, termEnd) = (termStartOf[source.AgreementEndDate], source.AgreementEndDate);
        while (termStartOf.TryGetValue(termStart.AddDays(-1), out var earlier)) (termStart, termEnd) = (earlier, termStart.AddDays(-1));
        var start = source.AgreementEndDate.AddDays(1);

        // The participant's plan covering the first day (D7). Plans never overlap; the order only makes the answer certain.
        var plan = await _db.FundingPlans.AsNoTracking()
            .Where(p => p.TenantId == tenantId && p.ParticipantId == participantId && p.PlanStart <= start && p.PlanEnd >= start)
            .OrderBy(p => p.PlanStart).FirstOrDefaultAsync(ct);
        if (plan is null)
            return new RenewalOutcome(null, new[] { string.Create(CultureInfo.InvariantCulture, $"Record the new plan first: no plan of the participant's covers {start:yyyy-MM-dd}, the day the renewal starts.") }, PlanNeeded: true);
        var end = new[] { SameLengthEnd(termStart, termEnd, start), plan.PlanEnd, start.AddDays(PlanPricingEngine.MaxPeriodDays - 1) }.Min();

        var blocks = source.Blocks.OrderBy(b => b.Position).Select(DraftJson.ToDto).ToList();
        if (blocks.Count == 0 || blocks.Any(b => b.Unreadable))
            return RenewalOutcome.Refused("This agreement's supports cannot be read here. Open the agreement and save it again.");

        var saved = await _drafts.SaveAsync(tenantId, participantId, new CreateServiceAgreementDraftDto
        {
            PlanStartDate = plan.PlanStart, PlanEndDate = plan.PlanEnd, AgreementStartDate = start, AgreementEndDate = end, State = source.State,
            Representative = source.Representative, Blocks = blocks, BaseVersion = source.Version,
        }, actor, ct);
        return new RenewalOutcome(saved.Draft, saved.Errors, saved.NotFound, saved.ConflictVersion);
    }

    /// <summary>
    /// The last day of a term as long as termStart to termEnd, starting on <paramref name="start"/>. A term of whole calendar months (a year, say) runs for the same months, so a year stays a year
    /// across 29 February; any other term runs for the same number of days (fix round 1, deep S1).
    /// </summary>
    public static DateOnly SameLengthEnd(DateOnly termStart, DateOnly termEnd, DateOnly start)
    {
        var next = termEnd.AddDays(1);
        var months = (next.Year - termStart.Year) * 12 + next.Month - termStart.Month;
        return months > 0 && termStart.AddMonths(months) == next ? start.AddMonths(months).AddDays(-1) : start.AddDays(termEnd.DayNumber - termStart.DayNumber);
    }
}
