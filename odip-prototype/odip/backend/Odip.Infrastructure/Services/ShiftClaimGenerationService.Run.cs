using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Odip.Application.DTOs;
using Odip.Domain.Billing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The claim run: one draft shift claim for every participant in the organisation with completed, unclaimed shifts in a date range. Each participant is claimed through <see cref="GenerateAsync"/>,
/// so the run takes the same per-participant lock and transaction as the single-participant endpoint, and a second run finds only what is still unclaimed. There is no transaction across the run:
/// the claims already made stay when one participant fails.
/// </summary>
public partial class ShiftClaimGenerationService
{
    public const string BusyReason = "Another claim for this participant was being made at the same moment. Nothing was saved for them. Run the claim run again in a minute.";
    public const string FailedReason = "This claim couldn't be made, so nothing was saved for this participant. Try Claim shifts again: it only picks up shifts that are still unclaimed.";

    public Task<ShiftClaimRunDto> PreviewRunAsync(Guid tenantId, DateOnly from, DateOnly to, CancellationToken ct = default) => RunCoreAsync(tenantId, from, to, make: false, ct);

    public Task<ShiftClaimRunDto> RunAsync(Guid tenantId, DateOnly from, DateOnly to, CancellationToken ct = default) => RunCoreAsync(tenantId, from, to, make: true, ct);

    private async Task<ShiftClaimRunDto> RunCoreAsync(Guid tenantId, DateOnly from, DateOnly to, bool make, CancellationToken ct)
    {
        // A missing profile is one refusal for the whole run, not a failed row per participant.
        ProviderSettingsGuard.Require(await _db.ProviderSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId, ct));

        // Driven from the shifts, active or not: a participant who left mid-fortnight still has delivered, completed shifts to bill. The predicate is CalculateAsync's.
        // The tenant is named explicitly on top of the global filter: a SuperAdmin viewing an organisation has no filter, and this writes money.
        var ids = await _db.Shifts
            .Where(s => s.TenantId == tenantId && s.Status == ShiftStatus.Completed && s.ServiceDate >= from && s.ServiceDate <= to
                && !_db.ClaimLineItems.Where(BudgetLedgerService.ClaimLineStillCounts).Any(l => l.ShiftId == s.Id))
            .Select(s => s.ParticipantId).Distinct().ToListAsync(ct);   // no OrderBy before Distinct: Npgsql drops it, so the order is set in memory
        var people = (await _db.Participants.AsNoTracking().Where(p => p.TenantId == tenantId && ids.Contains(p.Id)).ToListAsync(ct))
            .OrderBy(p => p.FullName, StringComparer.OrdinalIgnoreCase).ThenBy(p => p.Id)
            .Select(p => (p.Id, p.FullName, p.PlanType)).ToList();

        var rows = new List<ShiftClaimRunParticipantDto>();
        var leftOut = new List<ShiftClaimRunLeftOutDto>();
        var flagged = new List<ShiftClaimRunFlaggedDto>();
        var skipped = new List<ShiftClaimRunSkippedDto>();
        var effectLines = new List<ClaimEffectLine>();

        foreach (var (id, name, planType) in people)
        {
            ShiftClaimRunSkippedDto Skip(string reason, bool failed) => new() { ParticipantId = id, ParticipantName = name, Reason = reason, Failed = failed };
            try
            {
                if (make)
                {
                    var made = await GenerateAsync(id, from, to, ct);
                    rows.Add(new() { ParticipantId = id, ParticipantName = name, ShiftCount = made.LineCount, Hours = made.Hours, TotalAmount = made.Claim.TotalAmount, ClaimId = made.Claim.Id, ClaimReference = made.Claim.ClaimReference });
                    leftOut.AddRange(made.LeftOut.Select(l => LeftOutOf(l, id, name)));
                    flagged.AddRange(made.Flagged.Select(f => new ShiftClaimRunFlaggedDto { ShiftId = f.ShiftId, ServiceDate = f.ServiceDate, Description = f.Description, Caveat = f.Caveat, ParticipantId = id, ParticipantName = name }));
                }
                else
                {
                    var (lines, left, _) = await CalculateAsync(id, from, to, ct);
                    rows.Add(new() { ParticipantId = id, ParticipantName = name, ShiftCount = lines.Count, Hours = lines.Sum(l => l.Hours), TotalAmount = lines.Sum(l => l.TotalAmount) });
                    leftOut.AddRange(left.Select(l => LeftOutOf(l, id, name)));
                    flagged.AddRange(lines.Where(l => l.Caveat is not null).Select(l => new ShiftClaimRunFlaggedDto { ShiftId = l.Shift.Id, ServiceDate = l.Shift.ServiceDate, Description = Describe(l.Shift), Caveat = l.Caveat!, ParticipantId = id, ParticipantName = name }));
                    effectLines.AddRange(lines.Select(l => new ClaimEffectLine(id, l.Shift.ServiceDate, PaceCategories.Of(l.CatalogueItem), planType, l.TotalAmount, ShiftId: l.Shift.Id, BookingId: null)));
                }
            }
            catch (NothingClaimableException e)
            {
                leftOut.AddRange(e.LeftOut.Select(l => LeftOutOf(l, id, name)));   // shifts were found and none could be priced: left out with their reasons, not failed
            }
            catch (RosterBusyException)
            {
                skipped.Add(Skip(BusyReason, failed: true));
            }
            // The two refusals that mean "nothing to claim": another run got there first, or no catalogue row covers the dates. Their wording is CalculateAsync's.
            catch (InvalidOperationException e) when (e.Message.StartsWith("No completed, unclaimed shifts found", StringComparison.Ordinal) || e.Message.StartsWith("No catalogue row covers", StringComparison.Ordinal) || e.Message == ShiftTakenMessage)
            {
                skipped.Add(Skip(e.Message, failed: false));
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // Anything else may carry a technical message (EF, Npgsql): log it, and show the plain sentence.
                _log?.LogWarning(e, "Claim run: could not claim participant {ParticipantId}", id);
                skipped.Add(Skip(FailedReason, failed: true));
            }
            finally
            {
                // A failed GenerateAsync leaves its added claim and lines in the tracker; the next participant's SaveChanges would save them. Clearing after every participant also bounds memory.
                _db.ChangeTracker.Clear();
            }
        }

        ClaimBudgetDto? budget = null;
        if (!make && _ledger is not null && MoneyTenantIdFor(tenantId) is { } moneyTenantId && effectLines.Count > 0)
            budget = await _ledger.EffectOfLinesAsync(moneyTenantId, effectLines, ct);

        return new ShiftClaimRunDto
        {
            From = from, To = to,
            ClaimsMade = rows.Count(r => r.ClaimId is not null),
            ShiftCount = rows.Sum(r => r.ShiftCount), Hours = rows.Sum(r => r.Hours), TotalAmount = rows.Sum(r => r.TotalAmount),
            Participants = rows, LeftOut = leftOut, Flagged = flagged, Skipped = skipped, Budget = budget,
        };
    }

    private static ShiftClaimRunLeftOutDto LeftOutOf(ShiftClaimLeftOutDto l, Guid participantId, string participantName) =>
        new() { ShiftId = l.ShiftId, ServiceDate = l.ServiceDate, Description = l.Description, Reason = l.Reason, ParticipantId = participantId, ParticipantName = participantName };
}
