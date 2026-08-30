using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Keeps <see cref="Participant.PreferredUserId"/> (the single-pick field on the participant)
/// and the rostering <see cref="StaffParticipantCompatibility"/> matrix (many-cell
/// Preferred/Allowed/Excluded) in sync — task 6d (see task-6-brief.md sub-task 6d /
/// odip-domain-map.md §4-5 for why the two previously drifted independently).
///
/// Every method here only mutates the EF change tracker — it never calls
/// <c>SaveChangesAsync</c> itself — so the caller's own single <c>SaveChangesAsync</c> commits
/// the participant write and the compatibility-row write together, in one transaction. Tenant
/// scoping needs no special handling: every query here goes through <c>OdipDbContext</c>'s
/// existing <c>ITenantEntity</c> global query filters, and <c>SaveChangesAsync</c> auto-stamps
/// <c>TenantId</c> on any new row this service adds.
///
/// <b>Origin marker.</b> <see cref="StaffParticipantCompatibility.AutoLinked"/> distinguishes a
/// row this service created/still owns from one a human wrote directly in the compatibility
/// matrix. <c>RosteringController.UpsertCompatibility</c> — the matrix's only writer — always
/// stamps a row it touches <c>AutoLinked = false</c>, since every call to that endpoint is by
/// definition a human decision. This service never mutates or deletes a row where
/// <c>AutoLinked</c> is false: a human's explicit compatibility judgement, including
/// "Excluded" (a safety signal), is never silently overwritten just because someone later
/// picked that same staff member from the participant's preferred-staff dropdown, or moved a
/// participant's preference away from them.
/// </summary>
public class StaffCompatibilityLinkService
{
    private const string AutoLinkReason = "Auto-linked from the participant's preferred-staff selection.";

    private readonly OdipDbContext _db;
    public StaffCompatibilityLinkService(OdipDbContext db) => _db = db;

    /// <summary>
    /// Call whenever a participant's <see cref="Participant.PreferredUserId"/> is set (create)
    /// or changes (update) — pass the value from before the assignment as
    /// <paramref name="oldUserId"/> and the new value as <paramref name="newUserId"/>. Either
    /// may be null; equal values are a cheap no-op.
    /// </summary>
    public async Task SyncFromParticipantPreferredStaffAsync(Guid participantId, Guid? oldUserId, Guid? newUserId, CancellationToken ct)
    {
        if (oldUserId == newUserId) return;

        if (oldUserId.HasValue)
        {
            var oldRow = await _db.StaffParticipantCompatibilities
                .FirstOrDefaultAsync(c => c.UserId == oldUserId.Value && c.ParticipantId == participantId, ct);

            // Only remove a row this service created/owns. A human-managed row for the staff
            // member who was just displaced (even one that happens to already read Preferred)
            // is left exactly as they set it — clearing PreferredUserId is not, by itself,
            // evidence the compatibility judgement should change too.
            if (oldRow != null && oldRow.AutoLinked)
                _db.StaffParticipantCompatibilities.Remove(oldRow);
        }

        if (newUserId.HasValue)
        {
            var newRow = await _db.StaffParticipantCompatibilities
                .FirstOrDefaultAsync(c => c.UserId == newUserId.Value && c.ParticipantId == participantId, ct);

            if (newRow == null)
            {
                _db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
                {
                    Id = Guid.NewGuid(),
                    UserId = newUserId.Value,
                    ParticipantId = participantId,
                    Level = CompatibilityLevel.Preferred,
                    Reason = AutoLinkReason,
                    AutoLinked = true,
                    UpdatedAt = DateTime.UtcNow,
                });
            }
            else if (newRow.AutoLinked)
            {
                // Refresh a row this service still owns (e.g. the same staff member was picked
                // again after briefly being changed away).
                newRow.Level = CompatibilityLevel.Preferred;
                newRow.UpdatedAt = DateTime.UtcNow;
            }
            // else: a human already has an explicit opinion on this pair (Allowed or Excluded)
            // — leave it untouched rather than upgrading it to Preferred underneath them.
        }
    }

    /// <summary>
    /// Call from <c>RosteringController.UpsertCompatibility</c> after the row's new
    /// <see cref="StaffParticipantCompatibility.Level"/> is assigned but before
    /// <c>SaveChangesAsync</c>, passing the level the row held immediately before this write
    /// (<see cref="CompatibilityLevel.Allowed"/> for a brand-new row, matching the entity's
    /// documented sparse default).
    /// </summary>
    public async Task SyncFromCompatibilityUpsertAsync(StaffParticipantCompatibility row, CompatibilityLevel previousLevel, CancellationToken ct)
    {
        if (row.Level == previousLevel) return;

        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == row.ParticipantId, ct);
        if (participant == null) return;

        if (row.Level == CompatibilityLevel.Preferred && participant.PreferredUserId == null)
        {
            // Least-surprising direction: marking a pair Preferred fills an EMPTY preferred-staff
            // pick. It never overwrites an existing explicit choice — a participant can have
            // several staff at Preferred in the matrix but only one PreferredUserId, and
            // silently swapping it out from the matrix side would fight whatever the participant
            // form itself last saved.
            participant.PreferredUserId = row.UserId;
            participant.UpdatedAt = DateTime.UtcNow;
        }
        else if (previousLevel == CompatibilityLevel.Preferred && row.Level != CompatibilityLevel.Preferred
                 && participant.PreferredUserId == row.UserId)
        {
            // Symmetric safety: a human just moved this exact pair OFF Preferred (most pointedly
            // to Excluded). Leaving PreferredUserId pointing at them would be actively
            // misleading, so clear it rather than leave a stale, now-contradicted pick.
            participant.PreferredUserId = null;
            participant.UpdatedAt = DateTime.UtcNow;
        }
    }
}
