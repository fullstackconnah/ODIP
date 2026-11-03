using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Billing;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Generates draft "Kind == Shift" <see cref="TripClaim"/>s from Completed, unclaimed
/// <see cref="Shift"/>s for one participant over a date range (shift-completion design spec
/// §2/§3, delivery PR 3). Deliberately a separate file from <see cref="ClaimGenerationService"/>
/// — the trip path carries <c>ClaimPreviewRequestDto</c> overrides for departure/return/
/// active-hours that have no shift equivalent, and mixing the two would force every trip call
/// site to reason about shift-only parameters.
///
/// Billing is against ROSTERED hours (<see cref="Shift.DurationHours"/>) minus the breaks the worker took on their own
/// (owner, 2026-11-03, W9; <see cref="ShiftBreakRules.UnclaimedSpans"/>), never <c>ShiftCompletion</c>'s clocked times — the
/// office already accepted any variance at Approve time, so re-deriving hours here would silently relitigate that decision.
/// Breaks with the participant are still claimed.
///
/// TripClaim/ClaimLineItem are NOT ITenantEntity (standing ruling) — every query here is scoped
/// through the tenant-filtered Participants/Shifts sets, never queried directly by a caller-
/// supplied id alone.
/// </summary>
public partial class ShiftClaimGenerationService
{
    private readonly OdipDbContext _db;
    private readonly BudgetLedgerService? _ledger;
    private readonly ICurrentTenant? _tenant;
    private readonly ILogger<ShiftClaimGenerationService>? _log;

    /// <param name="ledger">When given, a preview says what the claim does to the participant's budget (a warning only: nothing here is ever blocked by it).</param>
    public ShiftClaimGenerationService(OdipDbContext db, BudgetLedgerService? ledger = null, ICurrentTenant? tenant = null, ILogger<ShiftClaimGenerationService>? log = null)
    {
        _log = log;
        _db = db;
        _ledger = ledger;
        _tenant = tenant;
    }

    /// <summary>The caller's own tenant, and only when the participant belongs to it — see <see cref="ClaimGenerationService"/>.</summary>
    private Guid? MoneyTenantIdFor(Guid recordTenantId) =>
        _tenant?.TenantId is { } tenantId && tenantId == recordTenantId ? tenantId : null;

    public async Task<ShiftClaimPreviewResponseDto> PreviewAsync(
        Guid participantId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        var (lineItems, leftOut, participant) = await CalculateAsync(participantId, from, to, ct);
        return await PreviewOfAsync(lineItems, leftOut, participant, ct);
    }

    /// <summary>The preview of priced lines: shared by the date-range preview and the cancellation preview, so both say the same things about the budget and the lines.</summary>
    private async Task<ShiftClaimPreviewResponseDto> PreviewOfAsync(List<ShiftLineCalc> lineItems, List<ShiftClaimLeftOutDto> leftOut, Participant participant, CancellationToken ct)
    {
        // The budget effect is worked out from the same lines the claim would have: each is the shift it replaces in the participant's "pending" (a completed shift nobody has claimed is already counted).
        // Under the CALLER's tenant, never the participant's own: a SuperAdmin with no organisation chosen resolves other organisations'
        // participants, and the participant's own id would hand out their whole funding position (budget security audit F-1).
        var moneyTenantId = MoneyTenantIdFor(participant.TenantId);
        var budget = _ledger == null || moneyTenantId is not { } forMoney
            ? null
            : await _ledger.EffectOfLinesAsync(
                forMoney,
                lineItems.Select(l => new ClaimEffectLine(participant.Id, l.Date, PaceCategories.Of(l.CatalogueItem), participant.PlanType, l.TotalAmount, ShiftId: l.Shift.Id, BookingId: null)).ToList(),
                ct);

        return new ShiftClaimPreviewResponseDto
        {
            Budget = budget,
            TotalAmount = lineItems.Sum(l => l.TotalAmount),
            LineItems = lineItems.Select(l => new ShiftClaimPreviewLineItemDto
            {
                ShiftId = l.Shift.Id,
                ServiceDate = l.Date,
                DayTypeLabel = DayTypeLabelOf(l),
                DayType = l.DayType,
                SupportItemCode = l.CatalogueItem.ItemNumber,
                ClaimType = l.ClaimType,
                Unit = l.CatalogueItem.Unit,
                Hours = l.Hours,
                UnitPrice = l.UnitPrice,
                TotalAmount = l.TotalAmount,
                Note = l.Caveat
            }).ToList(),
            // Never dropped silently: a completed shift this claim cannot price stays completed and unclaimed, and the preview says which and why.
            LeftOut = leftOut.ToList()
        };
    }

    public async Task<TripClaim> GenerateDraftClaimAsync(
        Guid participantId, DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await GenerateAsync(participantId, from, to, ct)).Claim;

    /// <summary>The draft claim for the shifts in the range that can be priced, and the shifts it left out and why (they stay completed and unclaimed).</summary>
    public virtual async Task<ShiftClaimGenerated> GenerateAsync(
        Guid participantId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        // Two requests at the same moment would both find the same shifts unclaimed and claim them twice, so the second waits here, then reads what the first saved.
        await using var held = await RosterGenerationLock.AcquireAsync(_db, participantId, ct, scope: "claim-generate");

        var (lineItems, leftOut, participant) = await CalculateAsync(participantId, from, to, ct);
        return await SaveClaimAsync(held, participant, lineItems, leftOut, from, to, cancellationReason: null, ct);
    }

    /// <summary>The claim and its lines for priced shifts, saved under the participant lock the caller holds. <paramref name="cancellationReason"/> is set on every line of a cancellation claim, null for a standard one.</summary>
    private async Task<ShiftClaimGenerated> SaveClaimAsync(
        RosterGenerationLock held, Participant participant, List<ShiftLineCalc> lineItems, List<ShiftClaimLeftOutDto> leftOut, DateOnly from, DateOnly to, string? cancellationReason, CancellationToken ct, string? notes = null)
    {
        var settings = ProviderSettingsGuard.Require(await _db.ProviderSettings.FirstOrDefaultAsync(s => s.TenantId == participant.TenantId, ct));

        // shortcut: no per-item GST flag; P1 only via legacy lines; add a catalogue GST flag if a taxable support appears
        var gstCode = GSTCode.P2;

        var claimId = Guid.NewGuid();
        var claim = new TripClaim
        {
            Id = claimId,
            TenantId = participant.TenantId,
            Kind = ClaimKind.Shift,
            ParticipantId = participant.Id,
            PeriodFrom = from,
            // The header covers every line: a night part after midnight on the last day is dated the day after it.
            PeriodTo = lineItems.Max(l => l.Date) is var lastLine && lastLine > to ? lastLine : to,
            Status = TripClaimStatus.Draft,
            Notes = notes,
            ClaimReference = BuildClaimReference(participant, claimId),
            CreatedAt = DateTime.UtcNow
        };
        _db.TripClaims.Add(claim);

        var claimLineItems = lineItems.Select(l => new ClaimLineItem
        {
            Id = Guid.NewGuid(),
            TripClaimId = claim.Id,
            TenantId = claim.TenantId,
            ShiftId = l.Shift.Id,
            ParticipantBookingId = null,
            SupportItemCode = l.CatalogueItem.ItemNumber,
            DayType = l.DayType,
            ShiftPart = l.Part,
            SupportsDeliveredFrom = l.Date,
            SupportsDeliveredTo = l.Date,
            Hours = l.Hours,
            UnitPrice = l.UnitPrice,
            TotalAmount = l.TotalAmount,
            GSTCode = gstCode,
            ClaimType = l.ClaimType,
            CancellationReason = l.CancellationReason ?? cancellationReason,
            Status = ClaimLineItemStatus.Draft
        }).ToList();

        _db.ClaimLineItems.AddRange(claimLineItems);
        claim.TotalAmount = claimLineItems.Sum(l => l.TotalAmount);

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException e) when (ClaimSubmission.IsShiftIndexViolation(e))
        {
            // Another claim run took one of these shifts between the read above and this save (the unique index on ShiftId is the lock).
            throw new InvalidOperationException(ShiftTakenMessage);
        }
        await held.CommitAsync(ct);
        // A caveat (the estimator sets none today) is shown on the preview line, but a claim line has no column to keep it in, so once the claim exists
        // nothing on it would say so. The response echoes the flagged shifts for the screen that generated it; a lasting flag on the line is a column and a migration, left to the L3-03 follow-up.
        var flagged = lineItems
            .Where(l => l.Caveat is not null)
            .Select(l => new ShiftClaimFlaggedDto { ShiftId = l.Shift.Id, ServiceDate = l.Shift.ServiceDate, Description = Describe(l.Shift), Caveat = l.Caveat! })
            .ToList();
        return new ShiftClaimGenerated(claim, leftOut, flagged, claimLineItems.Count, HourlyHours(lineItems), lineItems.Select(l => l.Shift.Id).Distinct().Count());
    }

    // ─── Shared calculation ──────────────────────────────────────────────

    private async Task<(List<ShiftLineCalc> LineItems, List<ShiftClaimLeftOutDto> LeftOut, Participant Participant)> CalculateAsync(
        Guid participantId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        // Participants is ITenantEntity-filtered — a participantId that doesn't resolve under
        // the caller's tenant (including one that belongs to a different tenant entirely)
        // surfaces identically to "no such participant", never a different code path.
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId, ct)
            ?? throw new InvalidOperationException("Participant not found.");

        // Shifts is ITenantEntity-filtered too, so this is inherently tenant-scoped. Completed +
        // not yet claimed (no ClaimLineItem references this ShiftId), mirroring TripInstance's
        // "no active claim already exists" check in ClaimGenerationService.GenerateDraftClaimAsync
        // but at the line-item level, since a date range spans many independent shifts.
        var shifts = await _db.Shifts
            .Where(s => s.ParticipantId == participantId
                && s.Status == ShiftStatus.Completed
                && s.ServiceDate >= from && s.ServiceDate <= to
                && !_db.ClaimLineItems.Where(BudgetLedgerService.ClaimLineStillCounts).Any(l => l.ShiftId == s.Id))
            .OrderBy(s => s.ServiceDate)
            .ToListAsync(ct);

        if (shifts.Count == 0)
            throw new InvalidOperationException("No completed, unclaimed shifts found in this date range.");

        return await PriceShiftsAsync(participant, shifts, from, to, cancelToday: null, ct);
    }

    /// <summary>
    /// Prices the shifts (all one participant's) into claim lines, leaving out those that cannot be claimed, with the reason. A non-null <paramref name="cancelToday"/> is a short-notice cancellation claim:
    /// the shifts are cancelled ones, each must have been cancelled less than 7 days ahead (calendar days in the organisation's zone) and be over, its item must allow cancellation, and every line is a Cancellation line with no provider travel.
    /// </summary>
    private async Task<(List<ShiftLineCalc> LineItems, List<ShiftClaimLeftOutDto> LeftOut, Participant Participant)> PriceShiftsAsync(
        Participant participant, List<Shift> shifts, DateOnly from, DateOnly to, DateOnly? cancelToday, CancellationToken ct, Guid? replacing = null)
    {
        var participantId = participant.Id;

        // A claim marked Rejected (or Cancelled) by hand keeps its lines Submitted, so these shifts look unclaimed but the unique index on the shift still holds them (a line that is not Rejected). They are listed,
        // here beside the query so a preview and a run agree, and say how to free them.
        var heldIds = shifts.Select(s => s.Id).ToList();
        var heldBy = (await _db.ClaimLineItems.AsNoTracking()
                .Where(l => l.ShiftId != null && heldIds.Contains(l.ShiftId.Value) && l.Status != ClaimLineItemStatus.Rejected && (l.TripClaim.Status == TripClaimStatus.Rejected || l.TripClaim.Status == TripClaimStatus.Cancelled)
                    && (replacing == null || l.TripClaimId != replacing.Value))
                .Select(l => new { ShiftId = l.ShiftId!.Value, l.TripClaimId, l.TripClaim.ClaimReference, ClaimStatus = l.TripClaim.Status }).ToListAsync(ct))
            .GroupBy(l => l.ShiftId).ToDictionary(g => g.Key, g => (g.First().TripClaimId, g.First().ClaimReference, g.First().ClaimStatus));

        // A day is claimed once: a shift on a date the participant is on a live trip claim (the same rule as the ledger, so a Rejected or Cancelled claim frees the day) is left out and names that claim.
        // shortcut: this reads once per run and does not lock against ClaimGenerationService, so a trip claim made at the same moment can still land; upgrade is the per-participant RosterGenerationLock taken in that engine too.
        var tripClaimByDay = new Dictionary<DateOnly, string>();
        foreach (var l in await _db.ClaimLineItems.AsNoTracking()
                     .Where(BudgetLedgerService.ClaimLineStillCounts)
                     .Where(l => l.ParticipantBooking != null && l.ParticipantBooking.ParticipantId == participantId && l.SupportsDeliveredFrom <= to.AddDays(1) && l.SupportsDeliveredTo >= from)
                     .Select(l => new { l.SupportsDeliveredFrom, l.SupportsDeliveredTo, l.TripClaim.ClaimReference }).ToListAsync(ct))
            for (var day = l.SupportsDeliveredFrom; day <= l.SupportsDeliveredTo; day = day.AddDays(1))
                tripClaimByDay.TryAdd(day, l.ClaimReference);

        // Participant.AddressState with a fallback to ProviderSettings.State — the only
        // geographic signal that exists on the tenant today (Region is free-text prose).
        // ShiftPriceEstimator.StateFor normalises the case, so "Nsw" prices in NSW's column
        // and finds NSW's holidays here exactly as the budget ledger's estimate does
        // (one rule for both, so the claim and the estimate cannot drift apart).
        var providerState = string.IsNullOrWhiteSpace(participant.AddressState) ? (await _db.ProviderSettings.FirstOrDefaultAsync(s => s.TenantId == participant.TenantId, ct))?.State : null;
        var state = ShiftPriceEstimator.StateFor(participant.AddressState, providerState);

        // The shared holiday loader: the synced feed AND the maintained whole-day override rows (the feed misses days such as Boxing Day 2026), every state read and the state matched in any
        // case in memory, so the holiday rows match however they are written ("NSW", "nsw", or with spaces around them). The quote, the trip claim, the budget ledger and the roster read
        // through it too, so a day is a holiday in all of them or in none.
        // One day past the range: a shift on its last day runs past midnight into the next, which can be a holiday.
        var publicHolidays = PublicHolidayLoader.WholeDayCalendarOf(await PublicHolidayLoader.LoadAsync(_db, from, to.AddDays(1), includePartDay: false, ct)).For(state);
        // The organisation's zone (the shifts are its own and the clocks change there), not the participant's state.
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(_db, participant.TenantId, ct)).Zone;

        // Only the community access group is priced from here. It is the only group that existed when this engine picked "the first active item for the
        // day type", and the catalogue now also holds personal care, sleepover, STA, travel and every other family: an item of those must never be
        // "the first Weekday item" (ClaimGenerationService is already scoped to one group). GRP_COMMUNITY_ACCESS holds exactly the RG 0125 standard
        // and ICBS items, one valid row per day type and intensity on any date.
        // Every row of the group is loaded, history included, because each shift is priced by the row valid on ITS service date: an import that
        // end-dates a row (a December price set) must not reprice a shift that happened before it and has not been claimed yet.
        // A shift with a support type is priced from that group's rows, a shift without one from community access (the rows each shift is priced from are its own group's, hourly only).
        var groupCodes = shifts.Select(s => s.SupportGroupCode ?? CatalogueGroups.CommunityAccessGroupCode).Distinct().ToList();
        // A group with no night row of its own prices its night hours from personal care's, and a sleepover is the flat item of the sleepover group (hourly rows are Unit H, sleepover rows Unit E).
        var wantedCodes = groupCodes.Append(CatalogueGroups.PersonalCareGroupCode).Append(CatalogueGroups.SleepoverGroupCode).Distinct().ToList();
        var loaded = await _db.SupportCatalogueItems
            .Where(i => wantedCodes.Contains(i.ActivityGroup.GroupCode) && (i.Unit == "H" || i.Unit == "E"))
            .Select(i => new { i.ActivityGroup.GroupCode, Item = i }).ToListAsync(ct);
        var catalogueByGroup = loaded.Where(r => r.Item.Unit == "H").GroupBy(r => r.GroupCode).ToDictionary(g => g.Key, g => g.Select(r => r.Item).ToList());
        var sleepoverRows = loaded.Where(r => r.GroupCode == CatalogueGroups.SleepoverGroupCode && r.Item.Unit == "E").Select(r => r.Item).ToList();
        var personalCareRows = catalogueByGroup.GetValueOrDefault(CatalogueGroups.PersonalCareGroupCode) ?? new List<SupportCatalogueItem>();
        List<SupportCatalogueItem> RowsOf(Shift s) => catalogueByGroup.GetValueOrDefault(s.SupportGroupCode ?? CatalogueGroups.CommunityAccessGroupCode) ?? new List<SupportCatalogueItem>();

        // The "_CA" twins (the NDIA's own cancellation items), read once: an item without the flag is still allowed when its twin is in the price guide, and the send check reads the same twin.
        var twinCodes = cancelToday is null ? new List<string>() : loaded.Select(r => r.Item.ItemNumber + BprCsvService.CancellationSuffix).Distinct().ToList();
        var twins = twinCodes.Count == 0 ? new List<SupportCatalogueItem>() : await _db.SupportCatalogueItems.AsNoTracking().Where(i => twinCodes.Contains(i.ItemNumber)).ToListAsync(ct);

        // The travel of every shift, read once inside the same lock as the shifts (the staff edit of the travel legs takes the same lock): the worker's submitted legs, else the agreement's forecast.
        var travelPolicy = await ShiftTravelSource.PolicyAsync(_db, participant.TenantId, ct);
        var travelInputs = await ShiftTravelSource.ForShiftsAsync(_db, participant.TenantId, travelPolicy, shifts.Select(s => new ShiftRef(s.Id, s.ShiftPatternId, participant.MmLevel)).ToList(), ct);
        var travelOf = shifts.Select((s, i) => (s.Id, Input: travelInputs[i])).ToDictionary(t => t.Id, t => t.Input);

        // The breaks taken alone, read once for preview, run and claim again alike. A cancellation passes none: a cancelled shift was never worked, so it has no completion and no breaks.
        var aloneBreaks = cancelToday is null ? await ShiftAloneBreaks.LoadAsync(_db, shifts.Select(s => s.Id).ToList(), ct) : new();

        var lineItems = new List<ShiftLineCalc>();
        var leftOut = new List<ShiftClaimLeftOutDto>();
        // No line for an NDIS-funded participant without an NDIS number: services can begin before the profile is complete, so this is reachable. The
        // shifts are left out with the reason, never dropped silently. A participant funded another way is never claimed, even with an NDIS number still on file.
        var noNdisNumber = ClaimFunding.IsOtherFunded(participant)
            ? $"{participant.FullName}: {ClaimFunding.OtherFundedNotClaimed}"
            : string.IsNullOrWhiteSpace(participant.NdisNumber)
                ? $"{participant.FullName}: NDIS number missing. Add it to the participant's profile, then generate the claim again."
                : null;
        foreach (var shift in shifts)
        {
            if (noNdisNumber is not null)
            {
                leftOut.Add(new ShiftClaimLeftOutDto { ShiftId = shift.Id, ServiceDate = shift.ServiceDate, Description = Describe(shift), Reason = noNdisNumber });
                continue;
            }
            if (heldBy.TryGetValue(shift.Id, out var heldClaim))
            {
                leftOut.Add(new ShiftClaimLeftOutDto { ShiftId = shift.Id, ServiceDate = shift.ServiceDate, Description = Describe(shift), Reason = $"{participant.FullName}: it is on {(heldClaim.ClaimStatus == TripClaimStatus.Cancelled ? "cancelled" : "rejected")} claim {heldClaim.ClaimReference}. Open that claim and choose Claim again.", HeldByClaimId = heldClaim.TripClaimId, HeldByClaimReference = heldClaim.ClaimReference });
                continue;
            }
            if (cancelToday is { } today && NotClaimableCancellation(shift, today, zone) is { } notYet)
            {
                leftOut.Add(new ShiftClaimLeftOutDto { ShiftId = shift.Id, ServiceDate = shift.ServiceDate, Description = Describe(shift), Reason = notYet });
                continue;
            }
            var catalogueItems = RowsOf(shift);
            // The one pricing rule, shared with the budget ledger so an estimate is exactly what this claim will say.
            var outcome = ShiftPriceEstimator.Price(
                new ShiftRateRows(catalogueItems, personalCareRows, sleepoverRows), shift.SupportGroupCode, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.Ratio, shift.NightType,
                participant.IsIntensiveSupport, state, publicHolidays, zone,
                ShiftAloneBreaks.SpansOf(aloneBreaks, shift.Id, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.NightType, zone));
            if (!outcome.IsPriced)
            {
                // A shift that cannot be priced is not claimed, and it is not dropped silently either: it is listed with the reason, and it stays completed and unclaimed.
                leftOut.Add(new ShiftClaimLeftOutDto
                {
                    ShiftId = shift.Id, ServiceDate = shift.ServiceDate, Description = Describe(shift), Reason = outcome.NotPricedSentence!,
                });
                continue;
            }

            // The item must allow a short-notice cancellation: the whole shift is left out when any of its lines does not.
            if (cancelToday is not null && outcome.Lines.FirstOrDefault(l => !ShortNoticeCancellationRule.Allows(l.CatalogueItem, BprCsvService.CancellationTwin(twins, l.CatalogueItem.ItemNumber, l.Date))) is { } notAllowed)
            {
                leftOut.Add(new ShiftClaimLeftOutDto { ShiftId = shift.Id, ServiceDate = shift.ServiceDate, Description = Describe(shift), Reason = ShortNoticeCancellationRule.NotAllowedSentence(notAllowed.CatalogueItem.ItemNumber) });
                continue;
            }

            // Checked on the priced line dates, the ones the trip engine reads: an overnight shift's after-midnight part is dated the next day, which can be a trip-claim day.
            var clash = outcome.Lines.FirstOrDefault(l => tripClaimByDay.ContainsKey(l.Date));
            if (clash is not null)
            {
                leftOut.Add(new ShiftClaimLeftOutDto { ShiftId = shift.Id, ServiceDate = shift.ServiceDate, Description = Describe(shift), Reason = FormattableString.Invariant($"{clash.Date:dd/MM/yyyy} is already on trip claim {tripClaimByDay[clash.Date]}. Reject or cancel that claim to claim this shift.") });
                continue;
            }

            // Money backstop: a support type whose rows overlap on a day it is priced for is never priced by picking one (saving such a type is refused; an import can make an old one ambiguous later).
            // Each hourly line is checked on its own date and day type, against the rows it was priced from.
            var ambiguous = shift.SupportGroupCode is null ? null : outcome.Lines.FirstOrDefault(l => l.CatalogueItem.Unit == "H"
                && SupportTypeCheck.IsAmbiguousForDay(catalogueItems.Contains(l.CatalogueItem) ? catalogueItems : personalCareRows, l.DayType, participant.IsIntensiveSupport, l.Date));
            if (ambiguous is not null)
            {
                leftOut.Add(new ShiftClaimLeftOutDto { ShiftId = shift.Id, ServiceDate = shift.ServiceDate, Description = Describe(shift), Reason = FormattableString.Invariant($"{participant.FullName}: more than one rate matches this support type on {ambiguous.Date:d MMM yyyy}.") });
                continue;
            }

            // Provider travel: one time line and one kilometre line, after the band lines, so they take the next parts of the shift.
            if (cancelToday is null) outcome = ShiftTravelPricer.Apply(outcome, travelOf[shift.Id], shift.ServiceDate, state, travelPolicy.KmRate, catalogueItems.Concat(personalCareRows).ToList(), travelPolicy.TravelRows);

            lineItems.AddRange(outcome.Lines.Select((price, part) => new ShiftLineCalc
            {
                Shift = shift,
                CatalogueItem = price.CatalogueItem,
                // shortcut: the line keeps the standard row's unit price; a "_CA" row priced differently would differ from the stored total, so revisit when "_CA" rows exist.
                ClaimType = cancelToday is null ? price.ClaimType : ClaimType.Cancellation,
                DayType = price.DayType,
                Date = price.Date,
                Part = part,
                Hours = price.Hours,
                UnitPrice = price.UnitPrice,
                TotalAmount = price.TotalAmount,
                Caveat = outcome.Caveat
            }));
        }

        if (lineItems.Count == 0)
        {
            // A cancellation is one shift (or a participant's few): its own reason is the refusal, not the date-range wording.
            if (cancelToday is not null) throw new NothingClaimableException(leftOut.Count == 1 ? leftOut[0].Reason : NothingClaimable(leftOut), leftOut);
            // Nothing priced because no row of the group is valid on any of these dates (the catalogue starts after them): say so, the same way the trip engine does.
            if (leftOut.All(l => l.Reason == NoCatalogueRateSentence) && !shifts.Any(s => RowsOf(s).Any(i => EffectiveCatalogueResolver.IsValidOn(i, s.ServiceDate))))
                throw new InvalidOperationException(FormattableString.Invariant(
                    $"No catalogue row covers these shifts' dates ({shifts[0].ServiceDate:dd/MM/yyyy} to {shifts[^1].ServiceDate:dd/MM/yyyy}). Import the catalogue for that period first."));
            // There ARE completed, unclaimed shifts here: none of them could be priced, so the refusal says they were left out, and why.
            throw new NothingClaimableException(NothingClaimable(leftOut), leftOut);
        }

        return (lineItems, leftOut, participant);
    }

    /// <summary>Why a cancelled shift is not (yet) claimable as a short-notice cancellation, or null when it is. Notice is whole calendar days in the organisation's zone.</summary>
    private static string? NotClaimableCancellation(Shift shift, DateOnly today, TimeZoneInfo zone)
    {
        if (shift.CancelledAt is not { } cancelledAt) return "It wasn't published when it was cancelled, or it was cancelled before Bunya Support kept cancel times, so it can't be claimed.";
        var cancelledOn = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(cancelledAt, DateTimeKind.Utc), zone));
        var noticeDays = shift.ServiceDate.DayNumber - cancelledOn.DayNumber;
        if (!PlanCancellation.IsShortNotice(noticeDays))
            return FormattableString.Invariant($"Cancelled {noticeDays} days ahead. Only a cancellation less than {PlanCancellation.ShortNoticeDays} days before the shift can be claimed.");
        if (shift.ServiceDate >= today) return FormattableString.Invariant($"You can claim this from {shift.ServiceDate.AddDays(1):d MMM yyyy}.");
        return null;
    }

    /// <summary>The refusal when the unique index on a claim line's shift caught a concurrent claim. A claim run shows it as Skipped, not as a failure.</summary>
    public const string ShiftTakenMessage = "Another claim took one of these shifts first. Run the claim again.";

    private static readonly string NoCatalogueRateSentence = ShiftPriceOutcome.Unpriced(ShiftPriceEstimator.NoCatalogueRateBecause).NotPricedSentence!;

    /// <summary>The shift as the budget ledger describes it ("Shift 22:00–06:00 · 8 h"), so the same shift reads the same on every screen.</summary>
    private static string Describe(Shift shift) =>
        string.Create(System.Globalization.CultureInfo.InvariantCulture, $"Shift {shift.StartTime:HH:mm}–{shift.EndTime:HH:mm} · {shift.DurationHours:0.##} h");

    /// <summary>
    /// The refusal when shifts were found but none could be claimed: how many were left out and why, grouped by reason. "No completed, unclaimed shifts found" would be untrue here
    /// (they are there, and are still waiting), so it says they were left out instead.
    /// </summary>
    private static string NothingClaimable(IReadOnlyList<ShiftClaimLeftOutDto> leftOut)
    {
        var count = leftOut.Count;
        var why = string.Join(" ", leftOut.GroupBy(l => l.Reason).Select(g => count > 1 ? $"{g.Key.TrimEnd('.')} ({g.Count()} {(g.Count() == 1 ? "shift" : "shifts")})." : g.Key));
        return $"Nothing in this date range could be claimed: {count} completed, unclaimed {(count == 1 ? "shift was" : "shifts were")} left out. {why}";
    }

    // ─── Helpers ─

    internal static string BuildClaimReference(Participant participant, Guid claimId) =>
        TripClaim.ReferenceFor(!string.IsNullOrWhiteSpace(participant.NdisNumber) ? participant.NdisNumber : participant.Id.ToString("N")[..8].ToUpper(), claimId);

    /// <summary>The label a shift claim line reads as ("Weekday Evening", not "WeekdayEvening"); a sleepover is its own line.</summary>
    private static string DayTypeLabelOf(ShiftLineCalc l) => l.ClaimType == ClaimType.ProviderTravel ? "Provider travel"
        : l.CatalogueItem.ItemNumber.Contains(ShiftTravelPricer.KmItemMarker, StringComparison.Ordinal) ? "Provider travel costs"
        : l.CatalogueItem.Unit == "E" ? "Sleepover" : l.DayType switch
    {
        ClaimDayType.Weekday => "Weekday",
        ClaimDayType.Saturday => "Saturday",
        ClaimDayType.Sunday => "Sunday",
        ClaimDayType.PublicHoliday => "Public Holiday",
        ClaimDayType.WeekdayEvening => "Weekday Evening",
        ClaimDayType.WeekdayNight => "Weekday Night",
        _ => l.DayType.ToString(),
    };

    /// <summary>The hours of the hourly lines; a sleepover line's quantity of 1 is a night, not an hour.</summary>
    private static decimal HourlyHours(IEnumerable<ShiftLineCalc> lines) => lines.Where(l => l.CatalogueItem.Unit == "H" && l.ClaimType == ClaimType.Standard).Sum(l => l.Hours);   // travel time is not a support hour (F-5)

    private class ShiftLineCalc
    {
        public Shift Shift { get; set; } = null!;
        public SupportCatalogueItem CatalogueItem { get; set; } = null!;
        public ClaimType ClaimType { get; set; }
        public ClaimDayType DayType { get; set; }
        /// <summary>The date the line is delivered: the shift's, or the next day for a stretch after midnight.</summary>
        public DateOnly Date { get; set; }
        /// <summary>The line's place in the shift's claim, 0 first (unique with the shift among the lines that count).</summary>
        public int Part { get; set; }
        public decimal Hours { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal TotalAmount { get; set; }
        /// <summary>A reason this line carries by itself (a line flipped to Cancellation by hand, claimed again); null takes the claim's.</summary>
        public string? CancellationReason { get; set; }
        /// <summary>Something worth saying about the line (the estimator's caveat), or null.</summary>
        public string? Caveat { get; set; }
    }
}

/// <summary>The claim made from shifts, the completed shifts in the range it left out and why, and the shifts in it that were priced with a caveat.</summary>
public sealed record ShiftClaimGenerated(TripClaim Claim, IReadOnlyList<ShiftClaimLeftOutDto> LeftOut, IReadOnlyList<ShiftClaimFlaggedDto> Flagged, int LineCount, decimal Hours, int ShiftCount);

/// <summary>Completed, unclaimed shifts were found but none could be priced; <see cref="LeftOut"/> says which and why. The per-participant endpoints answer it as the same 400 as any other refusal.</summary>
public sealed class NothingClaimableException(string message, IReadOnlyList<ShiftClaimLeftOutDto> leftOut) : InvalidOperationException(message)
{
    public IReadOnlyList<ShiftClaimLeftOutDto> LeftOut { get; } = leftOut;
}
