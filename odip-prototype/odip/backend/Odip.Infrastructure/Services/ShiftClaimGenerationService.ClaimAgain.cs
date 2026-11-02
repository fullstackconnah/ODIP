using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;

namespace Odip.Infrastructure.Services;

/// <summary>
/// "Claim again": a Rejected (or Cancelled) shift claim is deleted and its shifts are priced into one new draft claim, in one transaction under the participant's claim lock and the claim's edit lock.
/// It reuses the date-range claim's pricing and save (<c>PriceShiftsAsync</c>, <c>SaveClaimAsync</c>) and the Delete button's checks (<see cref="ClaimDeletion"/>); the new claim is priced BEFORE anything is deleted,
/// so every refusal leaves the old claim exactly as it was.
/// </summary>
public partial class ShiftClaimGenerationService
{
    private const string ClaimNotFound = "Claim not found.";
    private const string ClaimAlreadyGone = "This claim has already been claimed again or deleted. Refresh to see the new claim.";
    private const string MixedHandFlip = "This claim has a line changed to a cancellation by hand. Change it back on the claim, then claim again.";
    private const string ClaimAgainShiftOnly = "Only a shift claim can be claimed again.";
    private const string ClaimAgainRejectedOnly = "Only a rejected claim can be claimed again.";
    private const string ClaimAgainPaid = "Part of this claim has been paid, so it can't be claimed again.";

    /// <summary>What claiming this claim again would make, without deleting or saving anything. Refuses with the same sentences as <see cref="ClaimAgainAsync"/>.</summary>
    public async Task<ShiftClaimPreviewResponseDto> PreviewClaimAgainAsync(Guid claimId, Guid tenantId, DateOnly today, CancellationToken ct = default)
    {
        await ParticipantOfAsync(claimId, tenantId, gone: false, ct);
        var plan = await PlanClaimAgainAsync(claimId, tenantId, today, locked: false, ct);
        return await PreviewOfAsync(plan.Lines, plan.LeftOut, plan.Participant, ct);
    }

    /// <summary>Deletes the rejected claim and makes one new draft claim for its shifts. A shift that cannot be claimed now is left out with why; when none can, nothing is deleted.</summary>
    public async Task<ShiftClaimGenerated> ClaimAgainAsync(Guid claimId, Guid tenantId, DateOnly today, CancellationToken ct = default)
    {
        var participantId = await ParticipantOfAsync(claimId, tenantId, gone: true, ct);
        // The participant's lock first (a claim run for them waits), then the claim's own (an edit or delete of it waits); the second joins the transaction the first began.
        await using var held = await RosterGenerationLock.AcquireAsync(_db, participantId, ct, scope: "claim-generate");
        await using var editing = await RosterGenerationLock.AcquireAsync(_db, claimId, ct, scope: "claim-edit");

        var plan = await PlanClaimAgainAsync(claimId, tenantId, today, locked: true, ct);
        await ClaimDeletion.RemoveAsync(_db, plan.Claim, ct);
        await _db.SaveChangesAsync(ct);

        var from = plan.Lines.Min(l => l.Shift.ServiceDate);
        var to = plan.Lines.Max(l => l.Shift.ServiceDate);
        return await SaveClaimAsync(held, plan.Participant, plan.Lines, plan.LeftOut, from, to, cancellationReason: null, ct, notes: $"Claimed again from {plan.Claim.ClaimReference}.");
    }

    /// <summary>The participant of the shift claim, read before the locks; 404 when the claim is not this organisation's (the make answers the same 409 as a claim that has gone), and the kind check needs no lock.</summary>
    private async Task<Guid> ParticipantOfAsync(Guid claimId, Guid tenantId, bool gone, CancellationToken ct)
    {
        var head = await _db.TripClaims.AsNoTracking().Where(c => c.Id == claimId && c.TenantId == tenantId).Select(c => new { c.Kind, c.ParticipantId }).FirstOrDefaultAsync(ct)
            ?? (gone ? throw new ClaimAgainRefusedException(ClaimAlreadyGone, conflict: true) : throw new ClaimAgainRefusedException(ClaimNotFound, notFound: true));
        return head is { Kind: ClaimKind.Shift, ParticipantId: { } participantId } ? participantId : throw new ClaimAgainRefusedException(ClaimAgainShiftOnly);
    }

    /// <summary>
    /// The refusals and the pricing, shared by the preview and the make. <paramref name="locked"/> is true under the locks, where a claim that has gone is "already claimed again" (409), not unknown.
    /// Each shift is priced as it is NOW: a shift that is no longer completed (or cancelled, for a cancellation line) or that moved to someone else is left out, and so is one another live claim took.
    /// </summary>
    private async Task<(TripClaim Claim, List<ShiftLineCalc> Lines, List<ShiftClaimLeftOutDto> LeftOut, Participant Participant)> PlanClaimAgainAsync(
        Guid claimId, Guid tenantId, DateOnly today, bool locked, CancellationToken ct)
    {
        var claim = await _db.TripClaims.Include(c => c.LineItems).FirstOrDefaultAsync(c => c.Id == claimId && c.TenantId == tenantId, ct)
            ?? (locked ? throw new ClaimAgainRefusedException(ClaimAlreadyGone, conflict: true) : throw new ClaimAgainRefusedException(ClaimNotFound, notFound: true));
        if (claim.Kind != ClaimKind.Shift) throw new ClaimAgainRefusedException(ClaimAgainShiftOnly);
        if (claim.Status is not (TripClaimStatus.Rejected or TripClaimStatus.Cancelled)) throw new ClaimAgainRefusedException(ClaimAgainRejectedOnly);
        // A line the NDIA paid (or part paid) would be paid twice by a new claim; deleting it would also make the paid support claimable again.
        if (claim.LineItems.Any(l => l.Status is ClaimLineItemStatus.Paid or ClaimLineItemStatus.PartiallyPaid || l.PaidAmount > 0)) throw new ClaimAgainRefusedException(ClaimAgainPaid);
        if (await ClaimDeletion.RefusalAsync(_db, claim, ct) is { } refusal) throw new ClaimAgainRefusedException(refusal.Message, conflict: refusal.Conflict);

        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == claim.ParticipantId, ct) ?? throw new ClaimAgainRefusedException("Participant not found.", notFound: true);
        var shiftIds = claim.LineItems.Where(l => l.ShiftId != null).Select(l => l.ShiftId!.Value).Distinct().ToList();
        var shifts = await _db.Shifts.Where(s => shiftIds.Contains(s.Id)).OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime).ToListAsync(ct);
        var takenBy = (await _db.ClaimLineItems.AsNoTracking().Where(BudgetLedgerService.ClaimLineStillCounts)
                .Where(l => l.ShiftId != null && shiftIds.Contains(l.ShiftId.Value) && l.TripClaimId != claimId)
                .Select(l => new { ShiftId = l.ShiftId!.Value, l.TripClaim.ClaimReference }).ToListAsync(ct))
            .GroupBy(l => l.ShiftId).ToDictionary(g => g.Key, g => g.First().ClaimReference);

        // Lines flipped to Cancellation (by hand, or a cancellation claim) come back as Cancellation with their own reason; S5 reuse: a flipped line has the same price either way.
        var cancelLines = claim.LineItems.Where(l => l.ShiftId != null && l.ClaimType == ClaimType.Cancellation).GroupBy(l => l.ShiftId!.Value).ToDictionary(g => g.Key, g => g.First().CancellationReason);
        // A hand flip is per line: a Completed shift with some lines flipped and some not cannot come back as one thing, so it is refused (before anything is deleted).
        var mixed = claim.LineItems.Where(l => l.ShiftId != null).GroupBy(l => l.ShiftId!.Value)
            .Where(g => g.Any(l => l.ClaimType == ClaimType.Cancellation) && g.Any(l => l.ClaimType != ClaimType.Cancellation)).Select(g => g.Key).ToHashSet();
        var leftOut = new List<ShiftClaimLeftOutDto>();
        var completed = new List<Shift>();
        var cancelled = new List<Shift>();
        foreach (var shift in shifts)
        {
            string? why = shift.ParticipantId != participant.Id ? $"{participant.FullName}: this shift moved to another participant, so it can't be claimed again."
                : takenBy.TryGetValue(shift.Id, out var other) ? $"{participant.FullName}: it is now on claim {other}."
                : shift.Status == ShiftStatus.Completed ? null
                : shift.Status == ShiftStatus.Cancelled && cancelLines.ContainsKey(shift.Id) ? null
                : $"{participant.FullName}: this shift changed since it was claimed ({shift.Status.ToString().ToLowerInvariant()} now), so it can't be claimed again.";
            if (why is null && shift.Status == ShiftStatus.Completed && mixed.Contains(shift.Id)) throw new ClaimAgainRefusedException(MixedHandFlip);
            if (why is not null) leftOut.Add(new ShiftClaimLeftOutDto { ShiftId = shift.Id, ServiceDate = shift.ServiceDate, Description = Describe(shift), Reason = why });
            else (shift.Status == ShiftStatus.Cancelled ? cancelled : completed).Add(shift);
        }

        var lines = new List<ShiftLineCalc>();
        foreach (var (group, cancelToday) in new[] { (completed, (DateOnly?)null), (cancelled, today) })
        {
            if (group.Count == 0) continue;
            try
            {
                var priced = await PriceShiftsAsync(participant, group, group[0].ServiceDate, group[^1].ServiceDate, cancelToday, ct, replacing: claimId);
                lines.AddRange(priced.LineItems);
                leftOut.AddRange(priced.LeftOut);
            }
            catch (NothingClaimableException none) { leftOut.AddRange(none.LeftOut); }
        }
        if (lines.Count == 0)
            throw new ClaimAgainRefusedException($"Nothing on this claim can be claimed again. {string.Join(" ", leftOut.Select(l => l.Reason).Distinct())}");

        foreach (var line in lines.Where(l => cancelLines.ContainsKey(l.Shift.Id)))
        {
            if (line.ClaimType == ClaimType.Standard) line.ClaimType = ClaimType.Cancellation;
            if (line.ClaimType == ClaimType.Cancellation) line.CancellationReason = cancelLines[line.Shift.Id];
        }
        return (claim, lines, leftOut.OrderBy(l => l.ServiceDate).ToList(), participant);
    }
}

/// <summary>Claim again was refused with a sentence to show. <see cref="NotFound"/> is a 404, <see cref="Conflict"/> a 409 (state that can change), otherwise a 400.</summary>
public sealed class ClaimAgainRefusedException(string message, bool conflict = false, bool notFound = false) : InvalidOperationException(message)
{
    public bool Conflict { get; } = conflict;
    public bool NotFound { get; } = notFound;
}
