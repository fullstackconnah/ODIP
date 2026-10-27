using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Funding;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>A term's first day, last day and total, as the review screen shows it.</summary>
public sealed record TermFigures(DateOnly Start, DateOnly End, decimal Total);

/// <summary>One participant's answer: Created (a draft revision was saved), Skipped (nothing to do, nothing saved), Failed, or Busy (the time budget ran out before this one).</summary>
public sealed record BulkItem(Guid ParticipantId, string Name, string Outcome, string? Reason, Guid? SourceDraftId, Guid? NewDraftId, TermFigures? Before, TermFigures? After, bool HasIssues);

/// <summary>
/// Agreements PR B: renew, reprice or extend many agreements. Each item runs on its own, in series, and only ever saves a Draft revision through the one save path (<see cref="ServiceAgreementDraftService.SaveAsync"/>
/// or the renewal's); nothing is approved. A participant with a waiting draft is skipped before any save, because the save removes older revisions that have done nothing. The service takes no save permit: the
/// controller holds one for the whole request.
/// </summary>
public sealed class AgreementBulkService
{
    /// <summary>Wall time the items of one request may use before the rest are answered Busy (the proxies keep their 60 s default).</summary>
    public static readonly TimeSpan Budget = TimeSpan.FromSeconds(40);

    public const string BudgetWords = "We ran out of time before reaching this one. Try it again.";
    public const string WaitingWords = "A draft is waiting. Open it to finish or discard it.";
    public const string ConflictWords = "Someone else changed this agreement. Open it and try again.";
    public const string FailedWords = "This one could not be saved. Try again.";

    private readonly OdipDbContext _db;
    private readonly ServiceAgreementDraftService _drafts;
    private readonly PlanPricingService _pricing;
    private readonly AgreementRenewalService _renewal;
    private readonly TimeProvider _clock;
    private readonly ILogger<AgreementBulkService>? _log;

    public AgreementBulkService(OdipDbContext db, ServiceAgreementDraftService? drafts = null, PlanPricingService? pricing = null, AgreementRenewalService? renewal = null, TimeProvider? clock = null, ILogger<AgreementBulkService>? log = null)
    {
        _db = db;
        _pricing = pricing ?? new PlanPricingService(db);
        _drafts = drafts ?? new ServiceAgreementDraftService(db, _pricing);
        _renewal = renewal ?? new AgreementRenewalService(db, _drafts, _pricing);
        _clock = clock ?? TimeProvider.System;
        _log = log;
    }

    public async Task<List<BulkItem>> RunAsync(Guid tenantId, string action, IReadOnlyList<Guid> participantIds, DateOnly? endDate, PriceListRef? priceList, ApprovalCaller caller, string actor, CancellationToken ct)
    {
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        var ids = participantIds.ToList();
        var names = await _db.Participants.AsNoTracking().Where(p => p.TenantId == tenantId && p.IsActive && ids.Contains(p.Id))
            .Select(p => new Participant { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, PreferredName = p.PreferredName })
            .ToDictionaryAsync(p => p.Id, p => p.FullName, ct);
        var revisions = await AgreementRevisions.LatestAsync(_db, tenantId, ids, ct);
        var lists = action == "reprice" ? await AgreementPriceLists.ListAsync(_db, ct) : [];

        var results = new List<BulkItem>();
        var deadline = _clock.GetUtcNow() + Budget;
        foreach (var pid in ids)
        {
            var name = names.GetValueOrDefault(pid, "");
            BulkItem Item(string outcome, string? reason = null, Guid? source = null, Guid? created = null, TermFigures? before = null, TermFigures? after = null, bool issues = false) =>
                new(pid, name, outcome, reason, source, created, before, after, issues);
            try
            {
                if (_clock.GetUtcNow() >= deadline) results.Add(Item("Busy", BudgetWords));
                else if (!names.ContainsKey(pid)) results.Add(Item("Failed", "Not found"));
                else if (!revisions.TryGetValue(pid, out var set) || set.Current is not { } current) results.Add(Item("Skipped", "Not approved yet"));
                else if (set.Waiting is not null) results.Add(Item("Skipped", WaitingWords, current.DraftId));
                else results.Add(await OneAsync(tenantId, pid, action, set, current, endDate, priceList, lists, today, caller, actor, Item, ct));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log?.LogError(ex, "Agreement {Action} for participant {ParticipantId} failed", action, pid);
                results.Add(Item("Failed", FailedWords));
            }
            finally
            {
                // A failed save can leave a tracked entity that would poison the next item's SaveChanges.
                _db.ChangeTracker.Clear();
            }
        }
        return results;
    }

    private delegate BulkItem MakeItem(string outcome, string? reason = null, Guid? source = null, Guid? created = null, TermFigures? before = null, TermFigures? after = null, bool issues = false);

    private async Task<BulkItem> OneAsync(Guid tenantId, Guid pid, string action, AgreementRevisionSet set, AgreementRevisionRefDto current, DateOnly? endDate, PriceListRef? priceList,
        List<PriceListRef> lists, DateOnly today, ApprovalCaller caller, string actor, MakeItem item, CancellationToken ct)
    {
        var before = new TermFigures(current.AgreementStartDate, current.AgreementEndDate, current.Total);
        if (action == "renew")
        {
            var renewed = await _renewal.RenewAsync(tenantId, pid, current.DraftId, caller, actor, ct);
            return Answer(renewed.Draft, renewed.Errors, renewed.NotFound, renewed.ConflictVersion, current, before, item);
        }

        // Named by organisation and participant: a SuperAdmin's context has no query filter.
        var source = await _db.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks).FirstOrDefaultAsync(d => d.TenantId == tenantId && d.ParticipantId == pid && d.Id == current.DraftId, ct);
        if (source is null) return item("Failed", "Not found");

        DateOnly start, end, planStart, planEnd;
        if (action == "extend")
        {
            if (endDate is not { } target || target <= current.AgreementEndDate)
                return item("Failed", string.Create(CultureInfo.InvariantCulture, $"Choose a date after {current.AgreementEndDate:d MMM yyyy}."), current.DraftId);
            (start, end) = (current.AgreementEndDate.AddDays(1), target);
            if (end.DayNumber - start.DayNumber + 1 > PlanPricingEngine.MaxPeriodDays) return item("Failed", $"An agreement can run at most {PlanPricingEngine.MaxPeriodDays} days.", current.DraftId);
            var (plan, error) = await PlanCoverAsync(tenantId, pid, start, end, ct);
            if (plan is null) return item("Failed", error, current.DraftId);
            (planStart, planEnd) = (plan.PlanStart, plan.PlanEnd);
        }
        else
        {
            if (priceList is null) return item("Failed", "Choose a price list.", current.DraftId);
            if (current.AgreementEndDate < today) return item("Skipped", "The agreement has ended", current.DraftId);
            if (priceList.Start > current.AgreementEndDate) return item("Skipped", "Ends before this price list", current.DraftId);
            var currentList = lists.FirstOrDefault(l => l.Version == set.CurrentList);
            if (currentList is null) return item("Skipped", "Not on a price list", current.DraftId);
            if (currentList.Start >= priceList.Start) return item("Skipped", "Already on this price list or a newer one", current.DraftId);
            start = priceList.Start > current.AgreementStartDate ? priceList.Start : current.AgreementStartDate;
            end = current.AgreementEndDate;
            (planStart, planEnd) = (source.PlanStartDate, source.PlanEndDate);
            var (plan, error) = await PlanCoverAsync(tenantId, pid, start, end, ct);
            if (plan is null) return item("Failed", error, current.DraftId);
        }

        var blocks = AgreementRenewalService.ReadBlocks(source);
        if (blocks is null) return item("Failed", AgreementRenewalService.UnreadableBlocksWords, current.DraftId);

        if (action == "reprice")
        {
            // shortcut: Before counts priced lines only, as a pattern change does; when the old list lacks an item Before is low and the new draft says it needs review.
            var quote = await _pricing.QuoteAsync(tenantId, blocks.Select(b => b.Block).ToList(), start, end, ct, pinnedVersion: set.CurrentList);
            before = new TermFigures(start, end, AgreementPriceLists.PricedTotal(quote));
        }
        var saved = await _drafts.SaveAsync(tenantId, pid, AgreementRenewalService.CopyOf(source, blocks, start, end, planStart, planEnd), actor, ct);
        return Answer(saved.Draft, saved.Errors, saved.NotFound, saved.ConflictVersion, current, before, item);
    }

    private static BulkItem Answer(ServiceAgreementDraft? draft, IReadOnlyList<string> errors, bool notFound, int? conflictVersion, AgreementRevisionRefDto current, TermFigures before, MakeItem item)
    {
        if (draft is not null)
        {
            var after = new TermFigures(draft.AgreementStartDate, draft.AgreementEndDate, draft.Lines.Sum(l => AgreementPriceLists.LineTotal(l)));
            return item("Created", null, current.DraftId, draft.Id, before, after, DraftJson.ReadQuote(draft.PricingJson)?.NeedsReview ?? false);
        }
        if (notFound) return item("Failed", "Not found", current.DraftId);
        if (conflictVersion is not null) return item("Failed", ConflictWords, current.DraftId);
        return item("Failed", errors.Count > 0 ? string.Join(" ", errors) : FailedWords, current.DraftId);
    }

    /// <summary>The participant's plan covering the whole new term, or the reason none does (the plan that ends too soon, or no plan at all).</summary>
    private async Task<(FundingPlan? Plan, string? Error)> PlanCoverAsync(Guid tenantId, Guid pid, DateOnly start, DateOnly end, CancellationToken ct)
    {
        var plans = await _db.FundingPlans.AsNoTracking().Where(p => p.TenantId == tenantId && p.ParticipantId == pid && p.PlanStart <= start).ToListAsync(ct);
        var covering = plans.Where(p => p.PlanEnd >= end).OrderBy(p => p.PlanStart).FirstOrDefault();
        if (covering is not null) return (covering, null);
        return plans.Count > 0
            ? (null, string.Create(CultureInfo.InvariantCulture, $"The plan ends {plans.Max(p => p.PlanEnd):d MMM yyyy}. Record the new plan first."))
            : (null, string.Create(CultureInfo.InvariantCulture, $"No plan covers {start:d MMM yyyy}. Record the new plan first."));
    }
}
