using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// A free-form one-off claim (<see cref="ClaimKind.Manual"/>): one participant, any price guide item and an amount, with no shift or booking behind it. The preview and the make share one planner, so the
/// make recomputes everything and takes nothing from a preview. The caller's organisation is passed in and checked on the participant; nothing here reads a tenant filter alone.
/// </summary>
public class ManualClaimService
{
    public const decimal MaxQuantity = 1000m;
    public const int MaxHoursPerLine = 24;
    public const decimal MaxUnitPrice = 100_000m;
    public const decimal MaxTotal = 100_000m;
    public const int MaxNotesLength = 500;
    public const string ParticipantNotFound = "Participant not found.";

    private readonly OdipDbContext _db;
    private readonly BudgetLedgerService? _ledger;
    private readonly TimeProvider _clock;

    public ManualClaimService(OdipDbContext db, BudgetLedgerService? ledger = null, TimeProvider? clock = null)
    {
        _db = db;
        _ledger = ledger;
        _clock = clock ?? TimeProvider.System;
    }

    private sealed record Planned(
        Participant Participant, SupportCatalogueItem Item, string State, ManualClaimLineRequestDto Line, decimal Hours, decimal Total, DateOnly Today, ClaimDayType DayType,
        FundingPlanSpan? Plan, decimal? Limit, List<string> Warnings, string? Notes);

    private sealed record FundingPlanSpan(DateOnly Start, DateOnly End);

    public async Task<ManualClaimPreviewDto> PreviewAsync(Guid tenantId, ManualClaimRequestDto request, CancellationToken ct = default)
    {
        var p = await PlanManualAsync(tenantId, request, ct);
        // A straight addition to the budget: no shift or booking is replaced.
        var budget = _ledger == null
            ? null
            : await _ledger.EffectOfLinesAsync(tenantId, [new ClaimEffectLine(p.Participant.Id, p.Line.ServiceDate, PaceCategories.Of(p.Item), p.Participant.PlanType, p.Total, ShiftId: null, BookingId: null)], ct);
        return new ManualClaimPreviewDto
        {
            ParticipantName = p.Participant.FullName,
            Lines =
            [
                new ManualClaimPreviewLineDto
                {
                    Code = p.Item.ItemNumber, Name = p.Item.Description, Unit = p.Item.Unit, Date = p.Line.ServiceDate, DayType = p.DayType,
                    Quantity = p.Hours, UnitPrice = p.Line.UnitPrice, Total = p.Total, Limit = p.Limit, State = p.State,
                },
            ],
            Total = p.Total,
            Plan = p.Plan is null ? null : new ManualClaimPlanDto { Start = p.Plan.Start, End = p.Plan.End },
            Budget = budget,
            Warnings = p.Warnings,
        };
    }

    /// <summary>The draft claim, saved in one SaveChanges: a throw before it leaves nothing behind. No lock is taken, since there is no shift or booking to race on.</summary>
    public async Task<ShiftClaimGenerated> MakeAsync(Guid tenantId, ManualClaimRequestDto request, CancellationToken ct = default)
    {
        var p = await PlanManualAsync(tenantId, request, ct);

        var claimId = Guid.NewGuid();
        var claim = new TripClaim
        {
            Id = claimId,
            TenantId = p.Participant.TenantId,
            Kind = ClaimKind.Manual,
            ParticipantId = p.Participant.Id,
            PeriodFrom = p.Line.ServiceDate,
            PeriodTo = p.Line.ServiceDate,
            Status = TripClaimStatus.Draft,
            Notes = p.Notes,
            ClaimReference = ShiftClaimGenerationService.BuildClaimReference(p.Participant, claimId),
            TotalAmount = p.Total,
            CreatedAt = DateTime.UtcNow,
        };
        var line = new ClaimLineItem
        {
            Id = Guid.NewGuid(),
            TripClaimId = claimId,
            TenantId = claim.TenantId,
            ShiftId = null,
            ParticipantBookingId = null,
            ShiftPart = 0,
            SupportItemCode = p.Item.ItemNumber,
            DayType = p.DayType,
            SupportsDeliveredFrom = p.Line.ServiceDate,
            SupportsDeliveredTo = p.Line.ServiceDate,
            Hours = p.Hours,
            UnitPrice = p.Line.UnitPrice,
            TotalAmount = p.Total,
            // shortcut: no per-item GST flag, so P2 as the shift claims do; add a catalogue GST flag if a taxable support appears
            GSTCode = GSTCode.P2,
            ClaimType = ClaimType.Standard,
            Status = ClaimLineItemStatus.Draft,
        };
        _db.TripClaims.Add(claim);
        _db.ClaimLineItems.Add(line);
        await _db.SaveChangesAsync(ct);
        return new ShiftClaimGenerated(claim, [], [], 1, p.Item.Unit == "H" ? p.Hours : 0m, 0);
    }

    // shortcut: one line per claim (owner, 2026-11-02); the request carries a list so several lines need no API change.
    // shortcut: the price cap is by the participant's state, as the send gate's PriceLimit is (no remote or very remote columns), until a participant region exists.
    // shortcut: a possible double claim is a warning only, and the trip and shift cross-guards read only shift and booking lines, so they do not see manual lines; the send gate's AlreadyAccepted is the backstop.
    // shortcut: the bounds below (24 h, $100,000 a unit and in total) hold at create only; the line PATCH is unchanged and the send gate's PriceLimit block is the backstop for price.
    private async Task<Planned> PlanManualAsync(Guid tenantId, ManualClaimRequestDto request, CancellationToken ct)
    {
        if (request.Lines.Count != 1) throw new InvalidOperationException("A one-off claim has exactly one line.");
        var line = request.Lines[0];

        var participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == request.ParticipantId && x.TenantId == tenantId, ct)
            ?? throw new KeyNotFoundException(ParticipantNotFound);

        var notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
        if (notes is { Length: > MaxNotesLength }) throw new InvalidOperationException($"The note can be at most {MaxNotesLength} characters.");

        if (line.Quantity <= 0 || line.UnitPrice <= 0) throw new InvalidOperationException("Quantity and unit price must be more than 0.");
        if (decimal.Round(line.Quantity, 2) != line.Quantity || decimal.Round(line.UnitPrice, 2) != line.UnitPrice)
            throw new InvalidOperationException("Quantity and unit price can have at most 2 decimal places.");
        if (line.Quantity > MaxQuantity) throw new InvalidOperationException($"Quantity can be at most {MaxQuantity.ToString("0", CultureInfo.InvariantCulture)}.");
        if (line.UnitPrice > MaxUnitPrice) throw new InvalidOperationException($"The unit price can be at most ${MaxUnitPrice.ToString("N0", CultureInfo.InvariantCulture)}.");

        // The same "today" as the send gate's (ClaimBatchService.TodayFor): the organisation's zone from its stored setting, else its state's.
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        if (line.ServiceDate > today) throw new InvalidOperationException("You can't claim for a day that hasn't happened yet.");

        var rows = await _db.SupportCatalogueItems.AsNoTracking().Where(i => i.ItemNumber == line.SupportItemCode).ToListAsync(ct);
        var item = EffectiveCatalogueResolver.NewestVersion(rows.Where(r => EffectiveCatalogueResolver.IsValidOn(r, line.ServiceDate)).ToList()).FirstOrDefault()
            ?? throw new InvalidOperationException(ClaimBatchChecks.NotInPriceGuide(line.SupportItemCode, line.ServiceDate));

        if (item.Unit == "H" && line.Quantity > MaxHoursPerLine) throw new InvalidOperationException($"A line is one day, so at most {MaxHoursPerLine} hours.");

        // The send gate's own rule and state, so a line that passes here is not stopped by PriceLimit at send time.
        var providerState = (await _db.ProviderSettings.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId, ct))?.State;
        var state = ShiftPriceEstimator.StateFor(participant.AddressState, providerState);
        if (ClaimBatchChecks.OverPriceLimit(item, state, line.UnitPrice, out var limit))
            throw new InvalidOperationException(ClaimBatchChecks.PriceLimitSentence(line.UnitPrice, state, limit));

        var hours = ClaimPricing.LineHours(line.Quantity);
        var total = ClaimPricing.LineAmount(line.Quantity, line.UnitPrice);
        if (total > MaxTotal) throw new InvalidOperationException($"The total can be at most ${MaxTotal.ToString("N0", CultureInfo.InvariantCulture)}.");

        var warnings = new List<string>();

        var plans = await _db.FundingPlans.AsNoTracking().Where(x => x.TenantId == tenantId && x.ParticipantId == participant.Id)
            .Select(x => new FundingPlanSpan(x.PlanStart, x.PlanEnd)).ToListAsync(ct);
        FundingPlanSpan? plan = null;
        if (plans.Count == 0) warnings.Add("No plan on file, so the budget isn't checked.");
        else if (plans.FirstOrDefault(x => x.Start <= line.ServiceDate && line.ServiceDate <= x.End) is { } covering) plan = covering;
        else throw new InvalidOperationException($"{line.ServiceDate.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} is outside {participant.FullName}'s plan dates.");

        var noLimit = item.PriceNational == null || limit <= 0;
        if (noLimit) warnings.Add($"{item.ItemNumber} has no price guide limit, so the price isn't checked.");

        if (ClaimBatchChecks.AgeDays(today, line.ServiceDate) > 90)
            warnings.Add("Over 90 days since the service. From 1 December 2026 the NDIA rejects claims this old.");

        var pid = participant.Id;
        var dupes = await _db.ClaimLineItems.AsNoTracking()
            .Where(BudgetLedgerService.ClaimLineStillCounts)
            .Where(l => l.TenantId == tenantId && l.SupportItemCode == item.ItemNumber && l.SupportsDeliveredFrom == line.ServiceDate
                && ((l.Shift != null && l.Shift.ParticipantId == pid) || (l.ParticipantBooking != null && l.ParticipantBooking.ParticipantId == pid)
                    || (l.Shift == null && l.ParticipantBooking == null && l.TripClaim.ParticipantId == pid)))
            .Select(l => l.TripClaim.ClaimReference).Distinct().ToListAsync(ct);
        warnings.AddRange(dupes.Select(r => $"{r} already claims {item.ItemNumber} for {participant.FullName} on {line.ServiceDate.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}."));

        var holidays = PublicHolidayLoader.WholeDayCalendarOf(await PublicHolidayLoader.LoadAsync(_db, line.ServiceDate, line.ServiceDate, includePartDay: false, ct)).For(state);
        var dayType = DayTypeResolver.Resolve(line.ServiceDate, holidays);

        return new Planned(participant, item, state, line, hours, total, today, dayType, plan, noLimit ? null : limit, warnings, notes);
    }
}
