using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;

namespace Odip.Infrastructure.Services;

/// <summary>What a pattern change came to: the answer, or every reason it was refused. <see cref="NotFound"/>: not the caller's revision or pattern. <see cref="ConflictVersion"/>: a newer revision exists.</summary>
public sealed record PatternChangeOutcome(PatternChangeResultDto? Result, IReadOnlyList<string> Errors, bool NotFound = false, int? ConflictVersion = null)
{
    public static PatternChangeOutcome Refused(params string[] errors) => new(null, errors);
}

/// <summary>
/// A change to the day, times, ratio or night type of a roster pattern an approved agreement made, saved as that agreement's next revision (agreement PR 1). The revision is the source revision's
/// blocks with the change made (<see cref="AgreementBlockChange"/>), dated from the change's first day to the old end, and saved through <see cref="ServiceAgreementDraftService.SaveAsync"/>, the one
/// pricing path, so it is priced from the catalogue as it is now. It is a Draft: nothing on the roster changes until it is approved. The answer says what the changed period costs before and after:
/// the source's blocks and the new ones priced over the same dates by the same engine, so the difference is the change alone (stored lines are sums over a whole revision and cannot be cut to a part).
/// </summary>
public sealed class AgreementPatternChangeService
{
    private readonly OdipDbContext _db;
    private readonly ServiceAgreementDraftService _drafts;
    private readonly PlanPricingService _pricing;
    private readonly TimeProvider _clock;

    public AgreementPatternChangeService(OdipDbContext db, ServiceAgreementDraftService? drafts = null, PlanPricingService? pricing = null, TimeProvider? clock = null)
    {
        _db = db;
        _pricing = pricing ?? new PlanPricingService(db);
        _clock = clock ?? TimeProvider.System;
        _drafts = drafts ?? new ServiceAgreementDraftService(db, _pricing, _clock);
    }

    public async Task<PatternChangeOutcome> ChangeAsync(Guid tenantId, Guid participantId, Guid draftId, AgreementPatternChangeDto request, string actor, CancellationToken ct)
    {
        // Named by organisation, participant and revision: a SuperAdmin's context has no query filter, and another organisation's revision or pattern is simply not there.
        var source = await _db.ServiceAgreementDrafts.AsNoTracking().Include(x => x.Blocks)
            .FirstOrDefaultAsync(x => x.Id == draftId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        var pattern = source is null ? null : await _db.ShiftPatterns.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.PatternId && p.SourceDraftId == source.Id && p.TenantId == tenantId, ct);
        if (source is null || pattern is null) return new PatternChangeOutcome(null, new[] { "Pattern not found." }, NotFound: true);

        // Only the newest revision is changed: a newer one waiting for approval would be deleted by the save (it has done nothing yet), and an approved one that starts later would be skipped.
        var newest = await _db.ServiceAgreementDrafts.Where(x => x.TenantId == tenantId && x.ParticipantId == participantId).MaxAsync(x => x.Version, ct);
        if (newest != source.Version)
            return new PatternChangeOutcome(null, new[] { string.Create(CultureInfo.InvariantCulture, $"This agreement has a newer revision, v{newest}. Open the agreement and make the change there.") }, ConflictVersion: newest);


        // The provider's today for this organisation, never the first settings row. The default is tomorrow, or the start when it is later.
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        var tomorrow = today.AddDays(1);
        var from = request.FromDate ?? (tomorrow > source.AgreementStartDate ? tomorrow : source.AgreementStartDate);
        var end = source.AgreementEndDate;
        if (from < today) return PatternChangeOutcome.Refused(string.Create(CultureInfo.InvariantCulture, $"A change cannot start before today ({today:yyyy-MM-dd})."));
        if (from < source.AgreementStartDate) return PatternChangeOutcome.Refused(string.Create(CultureInfo.InvariantCulture, $"A change cannot start before the agreement does ({source.AgreementStartDate:yyyy-MM-dd})."));
        if (from > end) return PatternChangeOutcome.Refused(string.Create(CultureInfo.InvariantCulture, $"A change cannot start after the agreement ends ({end:yyyy-MM-dd})."));

        var blocks = source.Blocks.OrderBy(b => b.Position).Select(DraftJson.ToDto).ToList();
        if (blocks.Count == 0 || blocks.Any(b => b.Unreadable))
            return PatternChangeOutcome.Refused("This agreement's supports cannot be read here. Open the agreement and save it again.");
        var (changed, error) = AgreementBlockChange.Apply(blocks, pattern, request);
        if (changed is null) return PatternChangeOutcome.Refused(error!);

        var oldTotal = AgreementPriceLists.PricedTotal(await _pricing.QuoteAsync(tenantId, blocks.Select(b => b.Block).ToList(), from, end, ct));
        if (request.Preview)
        {
            // The blocks, dates and engine a save prices with, and the same refusals: what Create revision would save, with nothing written.
            var quote = await _pricing.QuoteAsync(tenantId, changed.Select(b => b.Block).ToList(), from, end, ct);
            var refusals = quote.Issues.Where(i => ServiceAgreementDraftService.SaveRefusals.Contains(i.Reason)).Select(i => i.Message).Distinct().ToArray();
            if (refusals.Length > 0) return PatternChangeOutcome.Refused(refusals);
            return Answer(null, source.Version + 1, from, end, oldTotal, AgreementPriceLists.PricedTotal(quote), quote.NeedsReview);
        }

        var saved = await _drafts.SaveAsync(tenantId, participantId, new CreateServiceAgreementDraftDto
        {
            PlanStartDate = source.PlanStartDate, PlanEndDate = source.PlanEndDate, AgreementStartDate = from, AgreementEndDate = end, State = source.State,
            Representative = source.Representative, Blocks = changed, BaseVersion = source.Version,
        }, actor, ct);
        if (saved.Draft is not { } draft) return new PatternChangeOutcome(null, saved.Errors, saved.NotFound, saved.ConflictVersion);
        return Answer(draft.Id, draft.Version, from, end, oldTotal, draft.Lines.Sum(l => l.Total ?? 0m), DraftJson.ReadQuote(draft.PricingJson)?.NeedsReview ?? false);
    }

    private static PatternChangeOutcome Answer(Guid? draftId, int version, DateOnly from, DateOnly to, decimal oldTotal, decimal newTotal, bool needsReview) => new(new PatternChangeResultDto
    {
        DraftId = draftId, Version = version, AgreementStartDate = from, AgreementEndDate = to, OldTotal = oldTotal, NewTotal = newTotal, Difference = newTotal - oldTotal, NeedsReview = needsReview,
    }, Array.Empty<string>());
}
