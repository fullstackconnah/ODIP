using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>
/// Confirms ShiftCompletion (design spec §1, joining AuditedEntities.Types "on day one" — same
/// justification as Shift.OverrideReason) actually produces an AuditLog row via
/// AuditInterceptor. Mirrors Odip.Tests/Rostering/RosteringAuditTests.cs's scaffold exactly.
/// </summary>
public class ShiftCompletionAuditTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateOnly ServiceDate = new(2026, 9, 8);

    private static OdipDbContext CreateDb(Guid actingUserId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, actingUserId.ToString()),
                new Claim("fullName", "Jane Coordinator")
            ],
            "Test");
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static Participant NewParticipant() => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Amy", LastName = "Ng"
    };

    private static User NewStaff() => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Ben", LastName = "Turner",
        Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
    };

    private static Shift NewShift(Participant participant, User staff) => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, UserId = staff.Id,
        ServiceDate = ServiceDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.InProgress,
    };

    [Fact]
    public async Task CreateShiftCompletion_WritesCreatedAuditLog()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var participant = NewParticipant();
        var staff = NewStaff();
        db.Participants.Add(participant);
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var shift = NewShift(participant, staff);
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();

        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ShiftId = shift.Id,
            ActualStart = DateTime.UtcNow, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow, IsActive = true,
        };
        db.ShiftCompletions.Add(completion);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.Where(a => a.EntityType == nameof(ShiftCompletion)).ToList());
        Assert.Equal(completion.Id, log.EntityId);
        Assert.Equal(AuditAction.Created, log.Action);
        Assert.Equal("Jane Coordinator", log.ChangedByName);
    }

    [Fact]
    public async Task ReturnShiftCompletion_WritesAuditLogWithTheReturnReason()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var participant = NewParticipant();
        var staff = NewStaff();
        db.Participants.Add(participant);
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var shift = NewShift(participant, staff);
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();

        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ShiftId = shift.Id,
            ActualStart = DateTime.UtcNow, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow, IsActive = true,
        };
        db.ShiftCompletions.Add(completion);
        await db.SaveChangesAsync();

        completion.ReviewOutcome = ReviewOutcome.Returned;
        completion.ReturnReason = "Actual times look implausible, please double check.";
        completion.IsActive = false;
        completion.ReviewedByUserId = actingUserId;
        completion.ReviewedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(ShiftCompletion) && a.EntityId == completion.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("ReturnReason", updateLog.Changes);
        Assert.Contains("Actual times look implausible, please double check.", updateLog.Changes);
    }

    [Fact]
    public void ShiftCompletion_IsRegisteredInAuditedEntitiesTypes()
    {
        Assert.Contains(typeof(ShiftCompletion), AuditedEntities.Types);
    }
}
