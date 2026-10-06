using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// One part of a claim, for working out what it does to a budget: the service date it counts on, the PACE category of the item it bills, how the money is managed, its amount, and the shift
/// or booking it replaces in the participant's "pending" or "booked ahead" (a completed shift nobody has claimed is already counted; the claim moves it).
/// </summary>
public sealed record ClaimEffectLine(Guid ParticipantId, DateOnly Date, int? PaceCategory, PlanType PlanType, decimal Amount, Guid? ShiftId, Guid? BookingId);

/// <summary>A participant's ledger as computed, with the items it was made from (kept so a claim's effect can be worked out without another query).</summary>
public sealed record ParticipantLedger(Guid ParticipantId, string Name, DateOnly Today, string TimeBasis, int ApproachingPercent, PlanLedger? Ledger, IReadOnlyList<LedgerItem> Items);

/// <summary>
/// The budget ledger (budget feature, phase 2a): per participant, per pool and per funding period of their current plan, what has been claimed, what is pending, what is booked ahead, and
/// whether that is on track, approaching, forecast over or over. Computed on every read from the claims, shifts and trip bookings; nothing is stored. The brief's rules are
/// <see cref="BudgetLedgerCalculator"/>'s; what is here is loading the records and pricing what is not claimed yet.
/// <list type="bullet">
/// <item><b>Batched.</b> The service takes many participants and runs a fixed set of queries whatever their number (participants, settings, plans, claim lines, shifts, bookings, trip days,
///   catalogue rows, holidays): the catalogue and the holidays are read once and every price is worked out in memory, never a query per participant or per shift.</item>
/// <item><b>Tenancy.</b> TripClaim and ClaimLineItem have no tenant filter, so nothing here is reached by a caller's id alone: the participants are read first, inside the tenant, and every
///   claim line, shift and booking is reached only through those participants' ids. An id from another organisation is simply absent from the answer.</item>
/// <item><b>Priced as ODIP will claim.</b> A shift is priced by <see cref="ShiftPriceEstimator"/> and a trip booking by <see cref="TripPriceEstimator"/>, the same code the claim engines
///   run, so an estimate and the claim made from it are the same figure. The shift engine claims community access only, so the ledger prices it only.</item>
/// <item><b>By service date.</b> A claim line counts in the period of its SupportsDeliveredFrom, a shift in the period of its ServiceDate, a trip booking in the period of the trip's
///   start. "Today" is the provider's calendar date, from the injected clock, so a test fixes it.</item>
/// <item><b>Windowed.</b> Items dated before the current plan started belong to an earlier plan and are not this ledger's; items after it ends are kept and shown as "Outside the plan dates".</item>
/// </list>
/// </summary>
public sealed class BudgetLedgerService
{
    /// <summary>How many rows a period hands out at once; the rest are asked for a page at a time.</summary>
    public const int RowsPerPeriod = 200;
    public const int MaxRowsPerPage = 500;

    private const string UnpricedShiftNote = "No catalogue rate covers this date, so it is counted as $0.";
    private const string NoNdisNumberNote = "This participant has no NDIS number, so the trip claim will not include this booking: it is counted as $0.";
    private const string UnpricedTripNote = "No catalogue rate covers the trip's days, so it is counted as $0.";

    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public BudgetLedgerService(OdipDbContext db, TimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    // ── The ledger of one participant ───────────────────────────────────────

    /// <summary>The ledger of a participant's current plan, with each period's first rows. Null when the participant is not in this tenant.</summary>
    public async Task<ParticipantLedgerDto?> GetLedgerAsync(Guid tenantId, Guid participantId, CancellationToken ct)
    {
        var all = await ComputeAsync(tenantId, new[] { participantId }, ct);
        return all.TryGetValue(participantId, out var ledger) ? LedgerDto(ledger) : null;
    }

    /// <summary>One more page of one period's rows. Null when the participant, pool or period is not found.</summary>
    public async Task<LedgerRowsPageDto?> GetRowsAsync(Guid tenantId, Guid participantId, Guid poolId, Guid periodId, int skip, int take, CancellationToken ct)
    {
        var all = await ComputeAsync(tenantId, new[] { participantId }, ct);
        if (!all.TryGetValue(participantId, out var ledger) || ledger.Ledger is null) return null;
        var period = ledger.Ledger.Pools.Where(p => p.Pool.Id == poolId).SelectMany(p => p.Periods).FirstOrDefault(p => p.Period.Id == periodId);
        if (period is null) return null;

        skip = Math.Max(0, skip);
        take = Math.Clamp(take, 1, MaxRowsPerPage);
        return new LedgerRowsPageDto { Total = period.Items.Count, Skip = skip, Rows = period.Items.Skip(skip).Take(take).Select(ToRow).ToList() };
    }

    // ── Many participants at once ───────────────────────────────────────────

    /// <summary>
    /// The ledger of every one of <paramref name="participantIds"/> that is a participant of <paramref name="tenantId"/>, in a fixed number of queries. A participant that is not in the tenant
    /// is absent from the answer; one with no plan that has started is present with a null <see cref="ParticipantLedger.Ledger"/> (no figure: never "all clear").
    /// </summary>
    public async Task<IReadOnlyDictionary<Guid, ParticipantLedger>> ComputeAsync(Guid tenantId, IReadOnlyCollection<Guid> participantIds, CancellationToken ct)
    {
        var result = new Dictionary<Guid, ParticipantLedger>();
        var ids = participantIds.Distinct().ToList();
        if (ids.Count == 0) return result;

        // The participants first, inside the tenant: everything below is reached through the ids found here and never through an id the caller supplied.
        var people = await _db.Participants.AsNoTracking()
            .Where(p => p.TenantId == tenantId && ids.Contains(p.Id))
            .Select(p => new PersonRow(p.Id, p.FirstName, p.LastName, p.PreferredName, p.PlanType, p.IsIntensiveSupport, p.AddressState, p.NdisNumber))
            .ToListAsync(ct);
        if (people.Count == 0) return result;
        var found = people.Select(p => p.Id).ToList();

        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        var providerState = await _db.ProviderSettings.AsNoTracking().Where(s => s.TenantId == tenantId).Select(s => s.State).FirstOrDefaultAsync(ct);
        var timeBasis = ProviderTimeZoneResolver.FromState(providerState).Id;
        var approaching = await _db.BudgetSettings.AsNoTracking().Where(s => s.TenantId == tenantId).Select(s => (int?)s.ApproachingPercent).FirstOrDefaultAsync(ct)
            ?? BudgetSettings.DefaultApproachingPercent;

        var plans = await _db.FundingPlans.AsNoTracking()
            .Include(p => p.Pools).ThenInclude(p => p.Periods)
            .AsSplitQuery()
            .Where(p => p.TenantId == tenantId && found.Contains(p.ParticipantId))
            .ToListAsync(ct);
        var currentPlans = plans.GroupBy(p => p.ParticipantId).ToDictionary(g => g.Key, g => BudgetLedgerCalculator.CurrentPlanOf(g, today));

        var withPlan = new List<PersonRow>();
        foreach (var person in people)
        {
            if (currentPlans.GetValueOrDefault(person.Id) is null) result[person.Id] = new ParticipantLedger(person.Id, person.Name, today, timeBasis, approaching, null, Array.Empty<LedgerItem>());
            else withPlan.Add(person);
        }
        if (withPlan.Count == 0) return result;

        // One window for the whole batch: from the earliest current plan's start (earlier belongs to an earlier plan) to a plan's longest possible length past the latest end, so that what is
        // booked past a plan's end is still seen. Each participant's own plan then cuts it down in memory.
        var from = withPlan.Min(p => currentPlans[p.Id]!.PlanStart);
        var to = withPlan.Max(p => currentPlans[p.Id]!.PlanEnd).AddDays(FundingPlan.MaxPlanDays);
        var planIds = withPlan.Select(p => p.Id).ToList();

        var lineRows = await LoadClaimLinesAsync(planIds, from, to, ct);
        var shiftRows = await LoadShiftsAsync(tenantId, planIds, from, to, ct);
        var bookingRows = await LoadBookingsAsync(tenantId, planIds, today, to, ct);
        var tripDays = await LoadTripDaysAsync(bookingRows, ct);
        var catalogue = await LoadCatalogueAsync(lineRows, bookingRows, ct);
        var holidays = await LoadHolidaysAsync(shiftRows.Count + bookingRows.Count == 0 ? null : (from, to), ct);

        var pricing = new Pricing(catalogue, holidays, providerState);
        var itemsByPerson = withPlan.ToDictionary(p => p.Id, _ => new List<LedgerItem>());
        var peopleById = withPlan.ToDictionary(p => p.Id);

        foreach (var line in lineRows) itemsByPerson[line.ParticipantId].Add(ClaimLineItemOf(line, peopleById[line.ParticipantId], pricing));
        foreach (var shift in shiftRows) itemsByPerson[shift.ParticipantId].Add(ShiftItemOf(shift, peopleById[shift.ParticipantId], today, pricing));
        AddBookingItems(bookingRows, tripDays, peopleById, pricing, itemsByPerson);

        foreach (var person in withPlan)
        {
            var plan = currentPlans[person.Id]!;
            // What happened before the plan began is the earlier plan's: it froze with it, and a claim keeps the period of its service date.
            var items = itemsByPerson[person.Id].Where(i => i.Date >= plan.PlanStart).ToList();
            result[person.Id] = new ParticipantLedger(person.Id, person.Name, today, timeBasis, approaching, BudgetLedgerCalculator.Compute(plan, today, approaching, items), items);
        }

        return result;
    }

    // ── What a claim does to a budget ───────────────────────────────────────

    /// <summary>
    /// What a claim that is not in the ledger yet (a preview) would do to each participant's budget: for each pool and period it touches, what was used without it, what it takes, and what is
    /// used and left with it. The shifts and bookings the lines come from are taken out of "pending" and "booked ahead" first (they are what the claim would turn into), so nothing is
    /// counted twice. Null when none of the participants has a plan that has started.
    /// </summary>
    public async Task<ClaimBudgetDto?> EffectOfLinesAsync(Guid tenantId, IReadOnlyList<ClaimEffectLine> lines, CancellationToken ct)
    {
        if (lines.Count == 0) return null;

        // Defence in depth (budget security audit F-1). <see cref="ComputeAsync"/> already reads participants inside the tenant, so a caller naming
        // only another organisation's participants resolves to nobody and the answer is null anyway. This closes the case that would still be
        // wrong: a caller handing over a tenant id that is not these participants' own. A tenant id is a decision about whose money may be
        // shown, and it may never be taken from an entity, so one foreign participant drops the whole call rather than returning a partial figure.
        var asked = lines.Select(l => l.ParticipantId).Distinct().ToList();
        var inTenant = (await _db.Participants.AsNoTracking().Where(p => p.TenantId == tenantId).Select(p => p.Id).ToListAsync(ct)).ToHashSet();
        if (asked.Any(id => !inTenant.Contains(id))) return null;

        var ledgers = await ComputeAsync(tenantId, asked, ct);

        var participants = new List<ClaimBudgetParticipantDto>();
        foreach (var group in lines.GroupBy(l => l.ParticipantId))
        {
            if (!ledgers.TryGetValue(group.Key, out var ledger) || ledger.Ledger is null) continue;

            var replacedShifts = group.Where(l => l.ShiftId is not null).Select(l => l.ShiftId!.Value).ToHashSet();
            var replacedBookings = group.Where(l => l.BookingId is not null).Select(l => l.BookingId!.Value).ToHashSet();
            var without = ledger.Items
                .Where(i => !(i.Kind == LedgerRowKind.CompletedShift && i.ShiftId is { } s && replacedShifts.Contains(s))
                    && !(i.Kind == LedgerRowKind.TripBooking && i.BookingId is { } b && replacedBookings.Contains(b)))
                .ToList();
            var claim = group.Select(l => new LedgerItem
            {
                Kind = LedgerRowKind.ClaimLine, Group = LedgerGroup.Pending, Date = l.Date, Amount = l.Amount, PaceCategory = l.PaceCategory, PlanType = l.PlanType,
            }).ToList();

            var rows = BudgetRows(ledger, without, claim);
            if (rows.Count > 0) participants.Add(new ClaimBudgetParticipantDto { ParticipantId = group.Key, ParticipantName = ledger.Name, Rows = rows });
        }

        return participants.Count == 0 ? null : new ClaimBudgetDto { Participants = participants };
    }

    /// <summary>What an existing claim does to the budgets of the participants it covers, as of now: its own lines come out to give "used before", and stay in for "used after". Null when it touches none.</summary>
    public async Task<ClaimBudgetDto?> ForClaimAsync(Guid tenantId, Guid claimId, CancellationToken ct)
    {
        var participantIds = await _db.ClaimLineItems.AsNoTracking()
            .Where(l => l.TripClaimId == claimId)
            .Select(l => l.Shift != null ? (Guid?)l.Shift.ParticipantId : l.ParticipantBooking != null ? (Guid?)l.ParticipantBooking.ParticipantId : null)
            .Distinct()
            .ToListAsync(ct);
        var ids = participantIds.Where(id => id is not null).Select(id => id!.Value).ToList();
        if (ids.Count == 0) return null;

        var ledgers = await ComputeAsync(tenantId, ids, ct);
        var participants = new List<ClaimBudgetParticipantDto>();
        foreach (var (participantId, ledger) in ledgers)
        {
            if (ledger.Ledger is null) continue;
            var claim = ledger.Items.Where(i => i.ClaimId == claimId).ToList();
            if (claim.Count == 0) continue;

            var rows = BudgetRows(ledger, ledger.Items.Where(i => i.ClaimId != claimId).ToList(), claim);
            if (rows.Count > 0) participants.Add(new ClaimBudgetParticipantDto { ParticipantId = participantId, ParticipantName = ledger.Name, Rows = rows });
        }

        return participants.Count == 0 ? null : new ClaimBudgetDto { Participants = participants.OrderBy(p => p.ParticipantName, StringComparer.Ordinal).ToList() };
    }

    /// <summary>The rows of a budget block: the ledger without the claim, the ledger with it, and one row for each pool and period (or bucket) the claim's items fall in.</summary>
    private static List<ClaimBudgetRowDto> BudgetRows(ParticipantLedger ledger, IReadOnlyList<LedgerItem> without, IReadOnlyList<LedgerItem> claim)
    {
        var plan = ledger.Ledger!.Plan;
        var before = BudgetLedgerCalculator.Compute(plan, ledger.Today, ledger.ApproachingPercent, without);
        var after = BudgetLedgerCalculator.Compute(plan, ledger.Today, ledger.ApproachingPercent, without.Concat(claim));

        var rows = new List<(ClaimBudgetRowDto Row, int PoolPosition)>();
        foreach (var group in claim.Select(i => (Item: i, Place: BudgetLedgerCalculator.Place(plan, i))).GroupBy(x => (x.Place.Placement, Period: x.Place.Period?.Id)))
        {
            var thisClaim = group.Sum(x => x.Item.Amount);
            var place = group.First().Place;
            if (place.Placement != LedgerPlacement.InPeriod)
            {
                var inNoPool = place.Placement == LedgerPlacement.NotInAPool;
                rows.Add((new ClaimBudgetRowDto
                {
                    Placement = inNoPool ? ClaimBudgetPlacement.NotInAPool : ClaimBudgetPlacement.OutsideThePlan, PoolName = inNoPool ? NotInAPoolName : OutsideThePlanName, ThisClaim = thisClaim,
                }, int.MaxValue));
                continue;
            }

            var periodBefore = before.Pools.First(p => p.Pool.Id == place.Pool!.Id).Periods.First(p => p.Period.Id == place.Period!.Id);
            var periodAfter = after.Pools.First(p => p.Pool.Id == place.Pool!.Id).Periods.First(p => p.Period.Id == place.Period!.Id);
            rows.Add((new ClaimBudgetRowDto
            {
                Placement = ClaimBudgetPlacement.Pool, PoolName = place.Pool!.Name, PeriodStart = place.Period!.PeriodStart, PeriodEnd = place.Period.PeriodEnd,
                Available = periodAfter.Available, UsedBefore = periodBefore.Used, ThisClaim = thisClaim, UsedAfter = periodAfter.Used, LeftAfter = periodAfter.Available - periodAfter.Used,
                StatusAfter = periodAfter.Status,
            }, place.Pool.Position));
        }

        // The plan's pools in their order, each by period; what is in no pool or outside the plan last.
        return rows.OrderBy(r => r.PoolPosition).ThenBy(r => r.Row.PeriodStart).Select(r => r.Row).ToList();
    }

    public const string NotInAPoolName = "Not in a recorded pool";
    public const string OutsideThePlanName = "Outside the plan dates";

    // ── Loading ─────────────────────────────────────────────────────────────

    private sealed record PersonRow(Guid Id, string FirstName, string LastName, string? PreferredName, PlanType PlanType, bool IsIntensive, string? AddressState, string? NdisNumber)
    {
        // The participant's own full name rule (preferred name, else first name, then last).
        public string Name => string.IsNullOrWhiteSpace(PreferredName) ? $"{FirstName} {LastName}" : $"{PreferredName} {LastName}";
    }

    /// <summary>A claim line that counts, with what the ledger needs of its claim and of the shift or booking it belongs to (see <see cref="ClaimLinesQuery"/>).</summary>
    public sealed record LineRow(
        Guid Id, Guid ClaimId, string ClaimReference, TripClaimStatus ClaimStatus, ClaimLineItemStatus Status, string ItemCode, DateOnly From, decimal Hours, decimal TotalAmount, decimal? PaidAmount,
        Guid? ShiftId, Guid? BookingId, Guid ParticipantId, PlanType? BookingPlanType);

    public sealed record ShiftRow(Guid Id, Guid ParticipantId, DateOnly ServiceDate, TimeOnly Start, TimeOnly End, bool EndsNextDay, ShiftStatus Status);

    public sealed record BookingRow(
        Guid Id, Guid ParticipantId, PlanType? PlanTypeOverride, Guid TripId, string TripName, DateOnly StartDate, int DurationDays, TimeOnly? DepartureTime, TimeOnly? ReturnTime,
        decimal ActiveHoursPerDay, Guid? ActivityGroupId);

    public sealed record TripDayRow(Guid TripId, DateOnly Date, bool IsPublicHoliday);

    public sealed record CatalogueRow(SupportCatalogueItem Item, string GroupCode);

    /// <summary>The lines that count, reached through the participants' shifts and bookings: lines of a claim that is not rejected or cancelled, and not themselves rejected.</summary>
    private async Task<List<LineRow>> LoadClaimLinesAsync(List<Guid> participantIds, DateOnly from, DateOnly to, CancellationToken ct) =>
        await ClaimLinesQuery(participantIds, from, to).ToListAsync(ct);

    /// <summary>The query behind the claim lines: a query of its own so that a test can show it translates to SQL (EF InMemory would evaluate any LINQ in memory).</summary>
    public IQueryable<LineRow> ClaimLinesQuery(IReadOnlyCollection<Guid> participantIds, DateOnly from, DateOnly to) =>
        _db.ClaimLineItems.AsNoTracking()
            .Where(l => l.SupportsDeliveredFrom >= from && l.SupportsDeliveredFrom <= to
                && l.Status != ClaimLineItemStatus.Rejected
                && l.TripClaim.Status != TripClaimStatus.Rejected && l.TripClaim.Status != TripClaimStatus.Cancelled
                && ((l.Shift != null && participantIds.Contains(l.Shift.ParticipantId)) || (l.ParticipantBooking != null && participantIds.Contains(l.ParticipantBooking.ParticipantId))))
            .Select(l => new LineRow(
                l.Id, l.TripClaimId, l.TripClaim.ClaimReference, l.TripClaim.Status, l.Status, l.SupportItemCode, l.SupportsDeliveredFrom, l.Hours, l.TotalAmount, l.PaidAmount,
                l.ShiftId, l.ParticipantBookingId,
                l.Shift != null ? l.Shift.ParticipantId : l.ParticipantBooking!.ParticipantId,
                l.ParticipantBooking != null ? l.ParticipantBooking.PlanTypeOverride : null));

    /// <summary>The shifts that can still cost something: not cancelled, and a completed one only while no claim line has taken it.</summary>
    private async Task<List<ShiftRow>> LoadShiftsAsync(Guid tenantId, List<Guid> participantIds, DateOnly from, DateOnly to, CancellationToken ct) =>
        await ShiftsQuery(tenantId, participantIds, from, to).ToListAsync(ct);

    public IQueryable<ShiftRow> ShiftsQuery(Guid tenantId, IReadOnlyCollection<Guid> participantIds, DateOnly from, DateOnly to) =>
        _db.Shifts.AsNoTracking()
            .Where(s => s.TenantId == tenantId && participantIds.Contains(s.ParticipantId) && s.ServiceDate >= from && s.ServiceDate <= to
                && (s.Status == ShiftStatus.Draft || s.Status == ShiftStatus.Published || s.Status == ShiftStatus.InProgress || s.Status == ShiftStatus.PendingReview
                    || (s.Status == ShiftStatus.Completed && !_db.ClaimLineItems.Any(l => l.ShiftId == s.Id))))
            .Select(s => new ShiftRow(s.Id, s.ParticipantId, s.ServiceDate, s.StartTime, s.EndTime, s.EndsNextDay, s.Status));

    /// <summary>Confirmed bookings of trips that start today or later and have not been cancelled, and that no claim line has already taken over.</summary>
    private async Task<List<BookingRow>> LoadBookingsAsync(Guid tenantId, List<Guid> participantIds, DateOnly today, DateOnly to, CancellationToken ct) =>
        await BookingsQuery(tenantId, participantIds, today, to).ToListAsync(ct);

    public IQueryable<BookingRow> BookingsQuery(Guid tenantId, IReadOnlyCollection<Guid> participantIds, DateOnly today, DateOnly to) =>
        _db.ParticipantBookings.AsNoTracking()
            .Where(b => participantIds.Contains(b.ParticipantId) && b.BookingStatus == BookingStatus.Confirmed
                && b.TripInstance.TenantId == tenantId && b.TripInstance.StartDate >= today && b.TripInstance.StartDate <= to && b.TripInstance.Status != TripStatus.Cancelled
                // A claim's lines TAKE THE BOOKING'S PLACE (ClaimGenerationService says so of every line: "the booking stops being
                // booked ahead and its lines take its place"), so a booking the ledger already counts through a claim line must not also
                // be counted as booked ahead - the same rule the shift query above follows for a completed shift that has a claim line.
                // "Already counted" is exactly ClaimLinesQuery's rule: the claim is neither rejected nor cancelled, and the line is not
                // itself rejected. A claim or line the ledger drops leaves the booking's own estimate standing.
                && !_db.ClaimLineItems.Any(l => l.ParticipantBookingId == b.Id
                    && l.Status != ClaimLineItemStatus.Rejected
                    && l.TripClaim.Status != TripClaimStatus.Rejected && l.TripClaim.Status != TripClaimStatus.Cancelled))
            .Select(b => new BookingRow(
                b.Id, b.ParticipantId, b.PlanTypeOverride, b.TripInstanceId, b.TripInstance.TripName, b.TripInstance.StartDate, b.TripInstance.DurationDays, b.TripInstance.DepartureTime,
                b.TripInstance.ReturnTime, b.TripInstance.ActiveHoursPerDay, b.TripInstance.DefaultActivityGroupId));

    private async Task<List<TripDayRow>> LoadTripDaysAsync(List<BookingRow> bookings, CancellationToken ct)
    {
        var tripIds = bookings.Select(b => b.TripId).Distinct().ToList();
        if (tripIds.Count == 0) return new List<TripDayRow>();
        // TripDay has no tenant column: the trips are the ones read through the tenant above.
        return await _db.TripDays.AsNoTracking().Where(d => tripIds.Contains(d.TripInstanceId)).Select(d => new TripDayRow(d.TripInstanceId, d.Date, d.IsPublicHoliday)).ToListAsync(ct);
    }

    /// <summary>The catalogue rows everything is priced from: the community access group (shifts, and trips with no group of their own), the groups trips name, and the rows of every code a claim line carries.</summary>
    private async Task<List<CatalogueRow>> LoadCatalogueAsync(List<LineRow> lines, List<BookingRow> bookings, CancellationToken ct)
    {
        var codes = lines.Select(l => l.ItemCode).Distinct().ToList();
        var groupIds = bookings.Where(b => b.ActivityGroupId is not null).Select(b => b.ActivityGroupId!.Value).Distinct().ToList();
        return await CatalogueQuery(groupIds, codes).ToListAsync(ct);
    }

    public IQueryable<CatalogueRow> CatalogueQuery(IReadOnlyCollection<Guid> groupIds, IReadOnlyCollection<string> codes) =>
        _db.SupportCatalogueItems.AsNoTracking()
            .Where(i => i.ActivityGroup.GroupCode == CatalogueGroups.CommunityAccessGroupCode || groupIds.Contains(i.ActivityGroupId) || codes.Contains(i.ItemNumber))
            .Select(i => new CatalogueRow(i, i.ActivityGroup.GroupCode));

    private async Task<HolidayCalendar> LoadHolidaysAsync((DateOnly From, DateOnly To)? window, CancellationToken ct)
    {
        if (window is not { } w) return new HolidayCalendar(Array.Empty<(DateOnly, string?)>());
        var rows = await _db.PublicHolidays.AsNoTracking().Where(h => h.Date >= w.From && h.Date <= w.To).Select(h => new { h.Date, h.State }).ToListAsync(ct);
        return new HolidayCalendar(rows.Select(h => (h.Date, h.State)));
    }

    // ── Turning records into ledger items ───────────────────────────────────

    /// <summary>What everything is priced from, held in memory: no price is a query.</summary>
    private sealed class Pricing
    {
        private readonly Dictionary<string, List<SupportCatalogueItem>> _byCode;
        private readonly Dictionary<Guid, List<SupportCatalogueItem>> _byGroup;

        public Pricing(List<CatalogueRow> catalogue, HolidayCalendar holidays, string? providerState)
        {
            Holidays = holidays;
            ProviderState = providerState;
            CommunityAccess = catalogue.Where(c => c.GroupCode == CatalogueGroups.CommunityAccessGroupCode).Select(c => c.Item).ToList();
            _byCode = catalogue.GroupBy(c => c.Item.ItemNumber, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.Select(c => c.Item).ToList(), StringComparer.Ordinal);
            _byGroup = catalogue.GroupBy(c => c.Item.ActivityGroupId).ToDictionary(g => g.Key, g => g.Select(c => c.Item).ToList());
            // The category an unpriced shift is counted under: the one the engine's group bills (every community access row is category 4 today).
            DefaultShiftCategory = CommunityAccess.OrderByDescending(i => i.EffectiveFrom).Select(PaceCategories.Of).FirstOrDefault(c => c is not null);
        }

        public HolidayCalendar Holidays { get; }
        public string? ProviderState { get; }
        public List<SupportCatalogueItem> CommunityAccess { get; }
        public int? DefaultShiftCategory { get; }

        /// <summary>The rows of a trip's activity group (the community access group when the trip names none).</summary>
        public IReadOnlyList<SupportCatalogueItem> GroupRows(Guid? groupId) =>
            groupId is { } id && _byGroup.TryGetValue(id, out var rows) ? rows : CommunityAccess;

        /// <summary>The PACE category of the catalogue row a claim line's item code names on its service date: the row valid that day (the newest version when two overlap), else none.</summary>
        public int? CategoryOf(string itemCode, DateOnly date)
        {
            if (!_byCode.TryGetValue(itemCode, out var rows)) return null;
            var row = rows.Where(r => EffectiveCatalogueResolver.IsValidOn(r, date))
                .OrderByDescending(r => r.EffectiveFrom).ThenByDescending(r => r.IsActive).ThenBy(r => r.Id).FirstOrDefault();
            return row is null ? null : PaceCategories.Of(row);
        }
    }

    private static LedgerItem ClaimLineItemOf(LineRow line, PersonRow person, Pricing pricing)
    {
        // Draft and ready claims have not gone to the NDIA: they are pending. Submitted, approved and paid ones are claimed, and a paid one is counted at what was paid when that is recorded.
        var pending = line.ClaimStatus is TripClaimStatus.Draft or TripClaimStatus.Ready;
        var paid = (line.ClaimStatus is TripClaimStatus.Paid or TripClaimStatus.PartiallyPaid) && line.PaidAmount is not null;
        return new LedgerItem
        {
            Kind = LedgerRowKind.ClaimLine, Group = pending ? LedgerGroup.Pending : LedgerGroup.Claimed, Date = line.From, Amount = paid ? line.PaidAmount!.Value : line.TotalAmount,
            PaceCategory = pricing.CategoryOf(line.ItemCode, line.From), PlanType = line.BookingPlanType ?? person.PlanType,
            Id = line.Id, ClaimId = line.ClaimId, ShiftId = line.ShiftId, BookingId = line.BookingId,
            Description = string.Create(CultureInfo.InvariantCulture, $"{line.ClaimReference} · {line.ItemCode} · {line.Hours:0.##} h"),
            Status = line.ClaimStatus.ToString(), Link = $"/claims/{line.ClaimId}",
        };
    }

    private static LedgerItem ShiftItemOf(ShiftRow shift, PersonRow person, DateOnly today, Pricing pricing)
    {
        var state = ShiftPriceEstimator.StateFor(person.AddressState, pricing.ProviderState);
        var hours = Shift.HoursBetween(shift.Start, shift.End, shift.EndsNextDay);
        var price = ShiftPriceEstimator.Price(pricing.CommunityAccess, shift.ServiceDate, hours, person.IsIntensive, state, pricing.Holidays.For(state));

        var completed = shift.Status == ShiftStatus.Completed;
        var past = !completed && shift.ServiceDate < today;
        return new LedgerItem
        {
            Kind = completed ? LedgerRowKind.CompletedShift : past ? LedgerRowKind.PastShift : LedgerRowKind.FutureShift,
            Group = completed || past ? LedgerGroup.Pending : LedgerGroup.BookedAhead,
            Date = shift.ServiceDate, Amount = price?.TotalAmount ?? 0m,
            PaceCategory = price is null ? pricing.DefaultShiftCategory : PaceCategories.Of(price.CatalogueItem), PlanType = person.PlanType,
            Id = shift.Id, ShiftId = shift.Id,
            Description = string.Create(CultureInfo.InvariantCulture, $"Shift {shift.Start:HH:mm}–{shift.End:HH:mm} · {hours:0.##} h"),
            Status = shift.Status.ToString(), Link = string.Create(CultureInfo.InvariantCulture, $"/rostering?date={shift.ServiceDate:yyyy-MM-dd}"),
            Note = price is null ? UnpricedShiftNote : null,
        };
    }

    /// <summary>One item for each booking and category: the booking's whole trip priced for the participant the way the trip claim will be, counted in the period the trip starts in.</summary>
    private static void AddBookingItems(
        List<BookingRow> bookings, List<TripDayRow> tripDays, Dictionary<Guid, PersonRow> people, Pricing pricing, Dictionary<Guid, List<LedgerItem>> itemsByPerson)
    {
        var daysByTrip = tripDays.GroupBy(d => d.TripId).ToDictionary(g => g.Key, g => g.Select(d => new TripPricingDay(d.Date, d.IsPublicHoliday)).ToList());
        var estimators = new Dictionary<Guid, TripPriceEstimator>();
        var state = pricing.ProviderState ?? "VIC";   // the trip claim engine prices in the organisation's state, as ClaimGenerationService does

        foreach (var booking in bookings)
        {
            var person = people[booking.ParticipantId];
            if (!estimators.TryGetValue(booking.TripId, out var estimator))
            {
                var input = new TripPricingInput(
                    booking.StartDate, booking.DurationDays, daysByTrip.GetValueOrDefault(booking.TripId) ?? new List<TripPricingDay>(), booking.DepartureTime ?? new TimeOnly(8, 0),
                    booking.ReturnTime ?? new TimeOnly(18, 0), booking.ActiveHoursPerDay);
                estimators[booking.TripId] = estimator = new TripPriceEstimator(input, pricing.GroupRows(booking.ActivityGroupId), pricing.Holidays.For(state), state);
            }

            // Only a booking whose participant has an NDIS number gets claim lines, so only such a booking has a price.
            var hasNumber = !string.IsNullOrWhiteSpace(person.NdisNumber);
            var lines = hasNumber ? estimator.Price(person.IsIntensive).Lines : Array.Empty<PricedTripLine>();
            var parts = lines.GroupBy(l => PaceCategories.Of(l.CatalogueItem)).Select(g => (Category: g.Key, Amount: g.Sum(l => l.TotalAmount))).ToList();
            if (parts.Count == 0) parts.Add((pricing.DefaultShiftCategory, 0m));   // nothing to price: the booking is still shown, as $0, with the reason

            var description = string.Create(CultureInfo.InvariantCulture, $"{booking.TripName} · {booking.DurationDays} {(booking.DurationDays == 1 ? "day" : "days")}");
            foreach (var part in parts)
            {
                itemsByPerson[booking.ParticipantId].Add(new LedgerItem
                {
                    Kind = LedgerRowKind.TripBooking, Group = LedgerGroup.BookedAhead, Date = booking.StartDate, Amount = part.Amount, PaceCategory = part.Category,
                    PlanType = booking.PlanTypeOverride ?? person.PlanType, Id = booking.Id, BookingId = booking.Id, Description = description,
                    Status = BookingStatus.Confirmed.ToString(), Link = $"/trips/{booking.TripId}",
                    Note = !hasNumber ? NoNdisNumberNote : lines.Count == 0 ? UnpricedTripNote : null,
                });
            }
        }
    }

    // ── The wire shape ──────────────────────────────────────────────────────

    private static ParticipantLedgerDto LedgerDto(ParticipantLedger ledger)
    {
        var plan = ledger.Ledger;
        if (plan is null) return new ParticipantLedgerDto { AsOf = ledger.Today, TimeBasis = ledger.TimeBasis, ApproachingPercent = ledger.ApproachingPercent };

        return new ParticipantLedgerDto
        {
            PlanId = plan.Plan.Id, PlanStart = plan.Plan.PlanStart, PlanEnd = plan.Plan.PlanEnd, PlanIsCurrent = plan.PlanIsCurrent, AsOf = plan.AsOf, TimeBasis = ledger.TimeBasis,
            ApproachingPercent = ledger.ApproachingPercent,
            Pools = plan.Pools.Select(PoolDto).ToList(),
            NotInARecordedPool = BucketDto(plan.NotInAPool), OutsideThePlanDates = BucketDto(plan.OutsideThePlan),
        };
    }

    private static LedgerPoolDto PoolDto(PoolLedger pool) => new()
    {
        Id = pool.Pool.Id, Name = pool.Pool.Name, Kind = pool.Pool.Kind, PaceCategory = pool.Pool.PaceCategory, ManagementType = pool.Pool.ManagementType, HasSetAside = pool.HasSetAside,
        Periods = pool.Periods.Select(PeriodDto).ToList(), PastUnresolvedCount = pool.Total.PastUnresolvedCount,
        PlanTotal = new LedgerFiguresDto
        {
            Limit = pool.Total.Limit, Carried = 0m, Available = pool.Total.Available, Claimed = pool.Total.Claimed, Pending = pool.Total.Pending, Used = pool.Total.Used,
            BookedAhead = pool.Total.BookedAhead, Forecast = pool.Total.Forecast, Remaining = pool.Total.Available - pool.Total.Used,
            ForecastRemaining = pool.Total.Available - pool.Total.Forecast, Status = pool.Total.Status,
        },
    };

    private static LedgerPeriodDto PeriodDto(PeriodLedger period) => new()
    {
        Id = period.Period.Id, Position = period.Period.Position, PeriodStart = period.Period.PeriodStart, PeriodEnd = period.Period.PeriodEnd, IsCurrent = period.IsCurrent,
        Limit = period.Limit, Carried = period.Carried, Available = period.Available, Claimed = period.Claimed, Pending = period.Pending, Used = period.Used, BookedAhead = period.BookedAhead,
        Forecast = period.Forecast, Remaining = period.Available - period.Used, ForecastRemaining = period.Available - period.Forecast, Status = period.Status,
        PastUnresolvedCount = period.PastUnresolvedCount, RowCount = period.Items.Count, Rows = period.Items.Take(RowsPerPeriod).Select(ToRow).ToList(),
    };

    private static LedgerBucketDto BucketDto(IReadOnlyList<LedgerItem> items) => new() { Count = items.Count, Amount = items.Sum(i => i.Amount), Rows = items.Take(RowsPerPeriod).Select(ToRow).ToList() };

    private static LedgerRowDto ToRow(LedgerItem item) => new()
    {
        Id = item.Id, Kind = item.Kind, Group = item.Group, Date = item.Date, Description = item.Description, Amount = item.Amount, Status = item.Status, Link = item.Link, Note = item.Note,
    };
}
