using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Portal;

/// <summary>
/// ShiftRoutineCheckService on its own: the swallowed unique violation (a racing double tap) must leave NOTHING tracked on the context (review 3
/// nit n3). The audit interceptor adds its rows to the context while SaveChanges runs, so after the violation the context still tracks the
/// "Created ShiftRoutineCheck" row for a tick this request did not insert; a later SaveChanges on the same context would write it.
/// </summary>
public class ShiftRoutineCheckServiceTests
{
    /// <summary>Adds a tracked row to the context the way the audit interceptor does, then fails like PostgreSQL does on a duplicate tick.</summary>
    private sealed class AuditThenViolationInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            eventData.Context!.Set<AuditLog>().Add(new AuditLog { Id = Guid.NewGuid(), EntityType = nameof(ShiftRoutineCheck), EntityId = Guid.NewGuid(), Action = AuditAction.Created });
            throw new DbUpdateException("duplicate key value violates unique constraint", new PostgresException(
                messageText: "duplicate key value violates unique constraint", severity: "ERROR", invariantSeverity: "ERROR",
                sqlState: "23505", constraintName: ShiftRoutineCheck.UniqueTimedIndexName));
        }
    }

    [Fact]
    public async Task ASwallowedUniqueViolation_LeavesNothingTrackedOnTheContext_SoALaterSaveWritesNoStrayAuditRow()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(new AuditThenViolationInterceptor()).Options;
        using var db = new OdipDbContext(options, tenant.Object);
        var routine = new ParticipantRoutine
        {
            Id = Guid.NewGuid(), ParticipantId = Guid.NewGuid(), Title = "Lunch", Description = "d", StartTime = new TimeOnly(12, 0), EndTime = new TimeOnly(13, 0),
        };
        var occurrence = new RoutineOccurrence(routine, new DateTime(2026, 7, 14, 12, 0, 0), false);
        var completion = new ShiftCompletion { Id = Guid.NewGuid(), ShiftId = Guid.NewGuid() };

        await new ShiftRoutineCheckService(db).CheckAsync(completion, occurrence, Guid.NewGuid(), default);   // does not throw: the tick is "already there"

        Assert.Empty(db.ChangeTracker.Entries());
    }
}
