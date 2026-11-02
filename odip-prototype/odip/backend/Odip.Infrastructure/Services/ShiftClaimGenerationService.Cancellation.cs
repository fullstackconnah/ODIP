using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The short-notice cancellation claim: a shift the organisation cancelled less than 7 calendar days (in its zone) before it started, claimed at the price of the hours it was rostered for.
/// It shares the pricing, the budget preview and the save with the date-range claim; only the shift query and the rules in <c>PriceShiftsAsync</c> differ.
/// </summary>
public partial class ShiftClaimGenerationService
{
    /// <summary>How far back the Claims screen looks for a cancelled shift to offer (the NDIA's own claim window is longer; the chooser stays short).</summary>
    private const int CancellationLookBackDays = 90;

    private const string CancellationReasonSentence = "Choose why the participant cancelled: health, family, transport or other.";

    /// <summary>The organisation's cancelled shifts that can be claimed now, and the recent ones that cannot, with why. Newest service date first.</summary>
    public async Task<CancellationCandidatesDto> CancellationCandidatesAsync(Guid tenantId, DateOnly today, CancellationToken ct = default)
    {
        // The tenant filter already scopes Shifts and Participants to the caller; the id only keeps a SuperAdmin with an organisation chosen on that organisation.
        var shifts = await _db.Shifts
            .Where(s => s.TenantId == tenantId && s.Status == ShiftStatus.Cancelled
                && s.ServiceDate >= today.AddDays(-CancellationLookBackDays) && s.ServiceDate <= today.AddDays(7)
                && !_db.ClaimLineItems.Where(BudgetLedgerService.ClaimLineStillCounts).Any(l => l.ShiftId == s.Id))
            .OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime)
            .ToListAsync(ct);

        var offered = new List<CancellationCandidateDto>();
        var notOffered = new List<CancellationLeftOutDto>();
        // shortcut: this prices per participant on each open of the chooser; fine for a few cancellations in 90 days, cache or store the price once a busy organisation has hundreds.
        foreach (var group in shifts.GroupBy(s => s.ParticipantId))
        {
            var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == group.Key, ct);
            if (participant is null) continue;
            var list = group.ToList();
            List<ShiftLineCalc> lines = new();
            IReadOnlyList<ShiftClaimLeftOutDto> leftOut;
            try
            {
                var priced = await PriceShiftsAsync(participant, list, list[0].ServiceDate, list[^1].ServiceDate, today, ct);
                (lines, leftOut) = (priced.LineItems, priced.LeftOut);
            }
            catch (NothingClaimableException none) { leftOut = none.LeftOut; }

            foreach (var shift in list)
            {
                var own = lines.Where(l => l.Shift.Id == shift.Id).ToList();
                if (own.Count > 0)
                    offered.Add(new CancellationCandidateDto
                    {
                        ShiftId = shift.Id, ParticipantId = participant.Id, ParticipantName = participant.FullName, ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime,
                        EndsNextDay = shift.EndsNextDay, CancelledAt = DateTime.SpecifyKind(shift.CancelledAt!.Value, DateTimeKind.Utc), TotalAmount = own.Sum(l => l.TotalAmount),
                    });
            }
            notOffered.AddRange(leftOut.Select(l => new CancellationLeftOutDto { ShiftId = l.ShiftId, ServiceDate = l.ServiceDate, Description = l.Description, Reason = l.Reason, ParticipantName = participant.FullName }));
        }

        return new CancellationCandidatesDto
        {
            Shifts = offered.OrderByDescending(c => c.ServiceDate).ThenBy(c => c.ParticipantName).ToList(),
            LeftOut = notOffered.OrderByDescending(l => l.ServiceDate).ThenBy(l => l.ParticipantName).ToList(),
        };
    }

    /// <summary>What the claim for this cancelled shift would be, without saving it. Refuses with the reason when the shift cannot be claimed.</summary>
    public async Task<ShiftClaimPreviewResponseDto> PreviewCancellationAsync(Guid shiftId, DateOnly today, CancellationToken ct = default)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == shiftId, ct) ?? throw new InvalidOperationException("Shift not found.");
        await RequireClaimableCancelledShiftAsync(shift, ct);
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == shift.ParticipantId, ct) ?? throw new InvalidOperationException("Participant not found.");
        var (lineItems, leftOut, _) = await PriceShiftsAsync(participant, new List<Shift> { shift }, shift.ServiceDate, shift.ServiceDate, today, ct);
        return await PreviewOfAsync(lineItems, leftOut, participant, ct);
    }

    public const string ShiftChangedMessage = "This shift changed while the claim was being made. Try again.";

    /// <summary>The draft cancellation claim for one cancelled shift, with the reason the participant gave on every line (the NDIA's four codes, any case).</summary>
    public async Task<ShiftClaimGenerated> GenerateCancellationAsync(Guid shiftId, string reason, DateOnly today, CancellationToken ct = default)
    {
        var code = (reason ?? string.Empty).Trim().ToUpperInvariant();
        if (!ClaimBatchChecks.CancellationReasons.Contains(code)) throw new InvalidOperationException(CancellationReasonSentence);

        var participantId = await _db.Shifts.Where(s => s.Id == shiftId).Select(s => (Guid?)s.ParticipantId).FirstOrDefaultAsync(ct)
            ?? throw new InvalidOperationException("Shift not found.");
        // The same per-participant lock the date-range claim takes, so two claims never read the shift as free at once, and reopening or moving it waits for this claim to save.
        await using var held = await RosterGenerationLock.AcquireAsync(_db, participantId, ct, scope: "claim-generate");

        var shift = await _db.Shifts.FirstAsync(s => s.Id == shiftId, ct);
        // The lock is on the participant read above; a move to another participant while this waited would bill the wrong plan.
        if (shift.ParticipantId != participantId) throw new InvalidOperationException(ShiftChangedMessage);
        await RequireClaimableCancelledShiftAsync(shift, ct);
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId, ct) ?? throw new InvalidOperationException("Participant not found.");
        var (lineItems, leftOut, _) = await PriceShiftsAsync(participant, new List<Shift> { shift }, shift.ServiceDate, shift.ServiceDate, today, ct);
        return await SaveClaimAsync(held, participant, lineItems, leftOut, shift.ServiceDate, shift.ServiceDate, code, ct);
    }

    private async Task RequireClaimableCancelledShiftAsync(Shift shift, CancellationToken ct)
    {
        if (shift.Status != ShiftStatus.Cancelled) throw new InvalidOperationException("This shift isn't cancelled.");
        var onClaim = await _db.ClaimLineItems.Where(BudgetLedgerService.ClaimLineStillCounts).Where(l => l.ShiftId == shift.Id).Select(l => l.TripClaim.ClaimReference).FirstOrDefaultAsync(ct);
        if (onClaim is not null) throw new InvalidOperationException($"This shift is already on claim {onClaim}.");
    }
}
