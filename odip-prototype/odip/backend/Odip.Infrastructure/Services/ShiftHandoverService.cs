using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public enum HandoverAckOutcome
{
    /// <summary>Recorded, or already recorded for this reader (idempotent).</summary>
    Ok,

    /// <summary>There is no handover for this participant to acknowledge.</summary>
    NothingToAcknowledge,

    /// <summary>The caller named a handover that is no longer the latest.</summary>
    Changed,
}

public sealed record HandoverView(PortalHandoverDto? Latest, IReadOnlyList<PortalHandoverTrailEntryDto> Trail);

/// <summary>
/// The handover baton pass (D4). A handover is text a worker leaves on their completion at Finish; the LATEST handover
/// for a participant is the most recent submitted-or-approved completion's, from any of the participant's OTHER shifts
/// (an active completion with a SubmittedAt: Finish sets it, a Return clears IsActive). The next worker marks it read
/// (<see cref="AcknowledgeAsync"/>) - never silently assumed read. A short custody trail lists the last
/// <see cref="TrailLength"/> holders (name and shift date only, never the text).
///
/// The rule is literal on purpose: the latest completion's handover IS the latest handover, even when that worker left
/// it blank or said "nothing to hand over" - an older handover is never resurrected as if it were current.
/// </summary>
public sealed class ShiftHandoverService
{
    public const int TrailLength = 3;

    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public ShiftHandoverService(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>The latest handover (with the reader's own read state) and the custody trail for <paramref name="shift"/>'s participant.</summary>
    public async Task<HandoverView> GetAsync(Shift shift, Guid readerUserId, CancellationToken ct)
    {
        var rows = await (
                from c in _db.ShiftCompletions
                join s in _db.Shifts on c.ShiftId equals s.Id
                where s.ParticipantId == shift.ParticipantId && s.Id != shift.Id && c.IsActive && c.SubmittedAt != null
                orderby c.SubmittedAt descending, c.Id
                select new
                {
                    CompletionId = c.Id, SubmittedAt = c.SubmittedAt!.Value, c.HandoverText, c.NothingToHandOver,
                    c.SubmittedByUserId, s.ServiceDate,
                })
            .Take(TrailLength)
            .ToListAsync(ct);
        if (rows.Count == 0) return new HandoverView(null, Array.Empty<PortalHandoverTrailEntryDto>());

        var userIds = rows.Select(r => r.SubmittedByUserId).Distinct().ToList();
        var names = (await _db.Users.Where(u => userIds.Contains(u.Id))
                .Select(u => new { u.Id, u.FirstName, u.LastName }).ToListAsync(ct))
            .ToDictionary(u => u.Id, u => $"{u.FirstName} {u.LastName}");
        string NameOf(Guid id) => names.TryGetValue(id, out var n) ? n : string.Empty;

        var trail = rows.Select(r => new PortalHandoverTrailEntryDto(r.CompletionId, NameOf(r.SubmittedByUserId), r.ServiceDate)).ToList();

        var latest = rows[0];
        var ack = await _db.HandoverAcknowledgements
            .Where(a => a.SourceCompletionId == latest.CompletionId && a.UserId == readerUserId)
            .Select(a => (DateTime?)a.AcknowledgedAt)
            .FirstOrDefaultAsync(ct);
        var text = string.IsNullOrWhiteSpace(latest.HandoverText) ? null : latest.HandoverText;

        var dto = new PortalHandoverDto(
            latest.CompletionId, text, latest.NothingToHandOver, latest.SubmittedByUserId, NameOf(latest.SubmittedByUserId),
            latest.ServiceDate, latest.SubmittedAt, RequiresAcknowledgement: text != null, IsRead: ack.HasValue, ReadAt: ack);
        return new HandoverView(dto, trail);
    }

    /// <summary>
    /// Records that <paramref name="readerUserId"/> has read the latest handover for the shift's participant. Idempotent:
    /// a second acknowledgement of the same handover by the same reader changes nothing. When
    /// <paramref name="expectedCompletionId"/> is given and is no longer the latest, nothing is recorded
    /// (<see cref="HandoverAckOutcome.Changed"/>) - the worker must see the newer handover first.
    /// </summary>
    public async Task<HandoverAckOutcome> AcknowledgeAsync(
        Shift shift, Guid readerUserId, Guid? expectedCompletionId, CancellationToken ct)
    {
        var view = await GetAsync(shift, readerUserId, ct);
        if (view.Latest is null) return HandoverAckOutcome.NothingToAcknowledge;
        if (expectedCompletionId.HasValue && expectedCompletionId.Value != view.Latest.CompletionId) return HandoverAckOutcome.Changed;
        if (view.Latest.IsRead) return HandoverAckOutcome.Ok;

        var now = _clock.GetUtcNow().UtcDateTime;
        var ack = new HandoverAcknowledgement
        {
            Id = Guid.NewGuid(), SourceCompletionId = view.Latest.CompletionId, ShiftId = shift.Id, UserId = readerUserId,
            AcknowledgedAt = now, CreatedAt = now, UpdatedAt = now,
        };
        _db.HandoverAcknowledgements.Add(ack);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException pg && pg.ConstraintName == HandoverAcknowledgement.UniqueReaderIndexName)
        {
            // A racing double tap already recorded it - the outcome the caller wanted.
            _db.Entry(ack).State = EntityState.Detached;
        }
        return HandoverAckOutcome.Ok;
    }
}
