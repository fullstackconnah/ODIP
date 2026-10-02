using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.DemoData;

/// <summary>The actors the demo top-up's audit rows name.</summary>
public static class DemoAuditActors
{
    /// <summary>
    /// Who the history says made a change nobody scripted a person for. The audit interceptor leaves the actor empty when there is no signed-in
    /// user (a hosted service has none), which reads as a bug in the history panels; a named system actor reads as what it is.
    /// </summary>
    public const string SystemName = "Demo data (automatic)";
}

/// <summary>
/// What the audit stamper needs to know about the tick it is part of (plan 4.4, review finding L6): the tick's "now", which no audit row may
/// be stamped after, and the stamps a pack asked for. A stamp is for ONE save and is used up by it: an entity that is created and later
/// changed needs a stamp for each, and the history of a row never borrows another row's time.
/// </summary>
public sealed class DemoAuditStamps
{
    private readonly Dictionary<Guid, DemoAuditStamp> _stamps = new();

    /// <summary>The tick's "now" (UTC). The maintainer sets it as soon as the clock is read; before that, the real clock.</summary>
    public DateTime NowUtc { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// The next audit row written for <paramref name="entityId"/> will say it was written at <paramref name="whenUtc"/> by the given user
    /// (a scripted demo user, for a decision or a status move a person would have made) or, with no user, by the system actor.
    /// </summary>
    public void Set(Guid entityId, DateTime whenUtc, Guid? actorId = null, string? actorName = null) =>
        _stamps[entityId] = new DemoAuditStamp(whenUtc, actorId, actorName);

    internal bool TryTake(Guid entityId, out DemoAuditStamp stamp)
    {
        if (!_stamps.TryGetValue(entityId, out stamp!)) return false;
        _stamps.Remove(entityId);
        return true;
    }
}

internal sealed record DemoAuditStamp(DateTime WhenUtc, Guid? ActorId, string? ActorName);

/// <summary>
/// Rewrites the audit rows the app's <c>AuditInterceptor</c> has just added to the change tracker, before they are written. That interceptor
/// stamps every row with the real "now" and the signed-in user, so a shift the top-up rostered "a fortnight ago" would show a "Created" entry
/// at the minute of the tick, by nobody. Here each row is given the time the row it describes has (an entity's own CreatedAt for a "Created"
/// row, its UpdatedAt for an "Updated" one) or a time and a person a pack asked for, never later than the tick's now, and the system actor
/// unless a person was named. The rows' "Changes" JSON is the audit interceptor's, untouched, so the history panels read exactly as they do
/// for a real edit; and because the rewrite happens before the first insert, no audit row is ever updated, which keeps the guard's rule that
/// audit history is append-only.
///
/// It must be attached AFTER the audit interceptor (which adds the rows) and BEFORE the guard (which checks them).
/// </summary>
public sealed class DemoAuditStampInterceptor : SaveChangesInterceptor
{
    private readonly DemoAuditStamps _stamps;

    public DemoAuditStampInterceptor(DemoAuditStamps stamps) => _stamps = stamps;

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Stamp(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Stamp(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private void Stamp(DbContext? context)
    {
        if (context is null) return;

        var logs = context.ChangeTracker.Entries<AuditLog>().Where(e => e.State == EntityState.Added).ToList();
        if (logs.Count == 0) return;

        // The rows of this save that history may describe, by type name and id: a log finds the row it is about here.
        var subjects = new Dictionary<(string Type, Guid Id), EntityEntry>();
        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.Entity is AuditLog) continue;
            var id = IdOf(entry);
            if (id != Guid.Empty) subjects[(entry.Entity.GetType().Name, id)] = entry;
        }

        foreach (var logEntry in logs)
        {
            var log = logEntry.Entity;
            if (_stamps.TryTake(log.EntityId, out var stamp))
            {
                Apply(log, stamp.WhenUtc, stamp.ActorId, stamp.ActorName ?? (stamp.ActorId is null ? DemoAuditActors.SystemName : null));
                continue;
            }

            var when = subjects.TryGetValue((log.EntityType, log.EntityId), out var subject)
                ? LogicalTime(subject, log.Action)
                : null;
            Apply(log, when ?? _stamps.NowUtc, actorId: null, actorName: DemoAuditActors.SystemName);
        }
    }

    /// <summary>The time the row itself says it was made (or last changed), when it has one.</summary>
    private static DateTime? LogicalTime(EntityEntry subject, AuditAction action)
    {
        var column = action == AuditAction.Created ? "CreatedAt" : "UpdatedAt";
        var property = subject.Metadata.FindProperty(column);
        if (property is null || property.ClrType != typeof(DateTime)) return null;
        return subject.Property(column).CurrentValue is DateTime value && value != default ? value : null;
    }

    private void Apply(AuditLog log, DateTime whenUtc, Guid? actorId, string? actorName)
    {
        var utc = DateTime.SpecifyKind(whenUtc, DateTimeKind.Utc);
        var now = DateTime.SpecifyKind(_stamps.NowUtc, DateTimeKind.Utc);
        log.ChangedAt = new DateTimeOffset(utc > now ? now : utc);
        log.ChangedById = actorId;
        log.ChangedByName = actorName;
    }

    private static Guid IdOf(EntityEntry entry)
    {
        var property = entry.Properties.FirstOrDefault(p => p.Metadata.Name == "Id");
        if (property?.CurrentValue is Guid current) return current;
        return property?.OriginalValue is Guid original ? original : Guid.Empty;
    }
}
