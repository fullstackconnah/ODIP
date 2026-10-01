using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// <c>DELETE rostering/shifts/{id}</c> and the handover acknowledgements (review 2 finding m3). A worker acknowledges the previous handover on
/// a Published shift, so a shift they then lose (a sick call, a re-roster by delete) carries an acknowledgement, and the foreign key from the
/// acknowledgement to the shift is Restrict: the delete used to fail with a 500. The shift's own acknowledgements now go with it, in the same
/// save, audited. (EF InMemory does not enforce foreign keys, so these tests assert the rows are gone; the real foreign key is exercised on
/// PostgreSQL in ShiftPackagePostgresTests.)
/// </summary>
public class RosteringDeleteShiftTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();

    private static Mock<ICurrentTenant> TenantOf(Guid? id)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(id);
        tenant.Setup(t => t.IsSuperAdmin).Returns(id is null);
        tenant.Setup(t => t.ViewAsUserId).Returns((Guid?)null);
        return tenant;
    }

    /// <summary>One in-memory database, opened as a super admin (to seed any tenant) and as a tenant's coordinator (to act).</summary>
    private sealed class World
    {
        public required DbContextOptions<OdipDbContext> Options { get; init; }
        public OdipDbContext Seed => new(Options, TenantOf(null).Object);
        public OdipDbContext As(Guid tenantId, bool withAuditing = false)
        {
            if (!withAuditing) return new OdipDbContext(Options, TenantOf(tenantId).Object);
            var accessor = new Mock<IHttpContextAccessor>();
            accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext());
            var options = new DbContextOptionsBuilder<OdipDbContext>(Options).AddInterceptors(new AuditInterceptor(accessor.Object)).Options;
            return new OdipDbContext(options, TenantOf(tenantId).Object);
        }
    }

    private static World NewWorld() => new()
    {
        Options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options,
    };

    private sealed record Rows(Guid UserId, Guid PreviousCompletionId, Guid PublishedShiftId, Guid AcknowledgementId, Guid OtherShiftId, Guid OtherAcknowledgementId);

    /// <summary>
    /// A previous shift with a submitted completion (the handover), the worker's Published shift that acknowledged it (the shift to delete), and
    /// a second Published shift of the same worker that acknowledged the same handover too (which must be left alone).
    /// </summary>
    private static Rows SeedAcknowledgedShifts(World world, Guid tenantId)
    {
        using var db = world.Seed;
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Amy", LastName = "Ng", IsActive = true };
        var worker = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Turner", Username = Guid.NewGuid().ToString(),
            Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true,
        };
        Shift NewShift(DateOnly date, ShiftStatus status) => new()
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, UserId = worker.Id, ServiceDate = date,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
        };
        var previous = NewShift(new DateOnly(2026, 9, 7), ShiftStatus.PendingReview);
        var published = NewShift(new DateOnly(2026, 9, 9), ShiftStatus.Published);
        var other = NewShift(new DateOnly(2026, 9, 10), ShiftStatus.Published);
        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ShiftId = previous.Id, ActualStart = new DateTime(2026, 9, 6, 23, 0, 0, DateTimeKind.Utc),
            ActualEnd = new DateTime(2026, 9, 7, 7, 0, 0, DateTimeKind.Utc), TimeZoneId = "Australia/Sydney", SubmittedByUserId = worker.Id,
            StartedAt = new DateTime(2026, 9, 6, 23, 0, 0, DateTimeKind.Utc), SubmittedAt = new DateTime(2026, 9, 7, 7, 0, 0, DateTimeKind.Utc),
            IsActive = true, HandoverText = "Quiet day.",
        };
        HandoverAcknowledgement Ack(Shift shift, Guid reader) => new()
        {
            Id = Guid.NewGuid(), TenantId = tenantId, SourceCompletionId = completion.Id, ShiftId = shift.Id, UserId = reader,
            AcknowledgedAt = new DateTime(2026, 9, 8, 22, 0, 0, DateTimeKind.Utc),
        };
        var reader2 = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Cara", LastName = "Lee", Username = Guid.NewGuid().ToString(),
            Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true,
        };
        var ack = Ack(published, worker.Id);
        var otherAck = Ack(other, reader2.Id);   // another reader, another shift: unique (completion, reader) holds
        db.AddRange(participant, worker, reader2, previous, published, other, completion, ack, otherAck);
        db.SaveChanges();
        return new Rows(worker.Id, completion.Id, published.Id, ack.Id, other.Id, otherAck.Id);
    }

    private static RosteringController Controller(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test")),
                },
            },
        };

    [Fact]
    public async Task DeletingAShiftWhoseWorkerAcknowledgedAHandover_RemovesTheShift_AndItsOwnAcknowledgement()
    {
        var world = NewWorld();
        var rows = SeedAcknowledgedShifts(world, TenantA);
        using var db = world.As(TenantA);

        var result = await Controller(db).DeleteShift(rows.PublishedShiftId, default);

        var body = Assert.IsType<ApiResponse<bool>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data);
        using var verify = world.Seed;
        Assert.False(await verify.Shifts.AnyAsync(s => s.Id == rows.PublishedShiftId));
        Assert.False(await verify.HandoverAcknowledgements.AnyAsync(a => a.Id == rows.AcknowledgementId));   // gone with the shift, not orphaned
    }

    [Fact]
    public async Task OnlyTheDeletedShiftsOwnAcknowledgementsGo_TheHandoverItselfAndOtherShiftsAcknowledgementsStay()
    {
        var world = NewWorld();
        var rows = SeedAcknowledgedShifts(world, TenantA);
        using var db = world.As(TenantA);

        await Controller(db).DeleteShift(rows.PublishedShiftId, default);

        using var verify = world.Seed;
        Assert.True(await verify.ShiftCompletions.AnyAsync(c => c.Id == rows.PreviousCompletionId));            // the handover that was read is untouched
        Assert.True(await verify.HandoverAcknowledgements.AnyAsync(a => a.Id == rows.OtherAcknowledgementId));   // another shift's acknowledgement is untouched
        Assert.True(await verify.Shifts.AnyAsync(s => s.Id == rows.OtherShiftId));
    }

    [Fact]
    public async Task DeletingAShiftWithNoAcknowledgement_StillWorks()
    {
        var world = NewWorld();
        var rows = SeedAcknowledgedShifts(world, TenantA);
        using var db = world.As(TenantA);

        // The other shift's only acknowledgement is another reader's, so this shift is the unacknowledged-by-its-own-worker case.
        var result = await Controller(db).DeleteShift(rows.OtherShiftId, default);

        Assert.IsType<OkObjectResult>(result.Result);
        using var verify = world.Seed;
        Assert.False(await verify.Shifts.AnyAsync(s => s.Id == rows.OtherShiftId));
        Assert.True(await verify.HandoverAcknowledgements.AnyAsync(a => a.Id == rows.AcknowledgementId));   // the first shift's acknowledgement is untouched
    }

    [Fact]
    public async Task TheRemovalOfTheAcknowledgement_IsAudited()
    {
        var world = NewWorld();
        var rows = SeedAcknowledgedShifts(world, TenantA);
        using var db = world.As(TenantA, withAuditing: true);

        await Controller(db).DeleteShift(rows.PublishedShiftId, default);

        using var verify = world.Seed;
        var actions = await verify.AuditLogs
            .Where(a => a.EntityType == nameof(HandoverAcknowledgement) && a.EntityId == rows.AcknowledgementId)
            .Select(a => a.Action).ToListAsync();
        Assert.Contains(AuditAction.Deleted, actions);
        Assert.Contains(typeof(HandoverAcknowledgement), AuditedEntities.Types);
    }

    [Fact]
    public async Task AnotherTenantsShift_IsA404_AndItsAcknowledgementsAreKept_ToACoordinatorOfAnotherTenant()
    {
        // Seam test (repo CLAUDE.md): the shift and its acknowledgement belong to tenant B; a coordinator of tenant A must not be able to delete them.
        var world = NewWorld();
        var rows = SeedAcknowledgedShifts(world, TenantB);
        using var db = world.As(TenantA);

        var result = await Controller(db).DeleteShift(rows.PublishedShiftId, default);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        using var verify = world.Seed;
        Assert.True(await verify.Shifts.AnyAsync(s => s.Id == rows.PublishedShiftId));
        Assert.True(await verify.HandoverAcknowledgements.AnyAsync(a => a.Id == rows.AcknowledgementId));
    }
}
