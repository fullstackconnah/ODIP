using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Audit;

public class AuditInterceptorTests
{
    private static OdipDbContext CreateDb(Guid? userId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var accessor = new Mock<IHttpContextAccessor>();
        if (userId is null)
        {
            // Simulates a background/unauthenticated context (e.g. seeding, hosted services) —
            // the interceptor must not throw and must leave ChangedById/ChangedByName null.
            accessor.Setup(a => a.HttpContext).Returns((HttpContext?)null);
        }
        else
        {
            var identity = new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.Value.ToString()),
                    new Claim("fullName", "Jane Coordinator")
                ],
                "Test");
            var context = new DefaultHttpContext { User = new ClaimsPrincipal(identity) };
            accessor.Setup(a => a.HttpContext).Returns(context);
        }

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static Participant NewParticipant() => new()
    {
        Id = Guid.NewGuid(),
        TenantId = Guid.NewGuid(),
        FirstName = "Alex",
        LastName = "Rivera"
    };

    [Fact]
    public async Task SaveChanges_AddedAuditedEntity_WritesCreatedAuditLog()
    {
        using var db = CreateDb(userId: Guid.NewGuid());
        var participant = NewParticipant();

        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.ToList());
        Assert.Equal(nameof(Participant), log.EntityType);
        Assert.Equal(participant.Id, log.EntityId);
        Assert.Equal(AuditAction.Created, log.Action);
        Assert.Equal("Jane Coordinator", log.ChangedByName);
        Assert.NotEqual("[]", log.Changes);
    }

    [Fact]
    public async Task SaveChanges_ModifiedAuditedEntity_WritesUpdatedAuditLogWithChanges()
    {
        using var db = CreateDb(userId: Guid.NewGuid());
        var participant = NewParticipant();
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        participant.FirstName = "Alexis";
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs.Single(a => a.Action == AuditAction.Updated);
        Assert.Equal(nameof(Participant), updateLog.EntityType);
        Assert.Equal(participant.Id, updateLog.EntityId);
        Assert.Contains("FirstName", updateLog.Changes);
        Assert.Contains("Alexis", updateLog.Changes);
    }

    [Fact]
    public async Task SaveChanges_NoAuthenticatedUser_WritesAuditLogWithNullChangedBy()
    {
        using var db = CreateDb(userId: null);
        var participant = NewParticipant();

        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.ToList());
        Assert.Null(log.ChangedById);
        Assert.Null(log.ChangedByName);
    }

    [Fact]
    public async Task SavingAsAnonymousWithAuditActorItem_AttributesRowToActor()
    {
        var http = new DefaultHttpContext();
        http.Items[AuditInterceptor.ActorItemKey] = "caregiver:Jane Smith";
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(http);

        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;
        using var db = new OdipDbContext(options, tenant.Object);

        db.CaregiverProfileSubmissions.Add(new CaregiverProfileSubmission
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ParticipantId = Guid.NewGuid(),
            TokenHash = new string('a', 64), CreatedByUserId = Guid.NewGuid(),
            ExpiresAt = DateTime.UtcNow.AddDays(14),
        });
        await db.SaveChangesAsync();

        var row = Assert.Single(db.AuditLogs.ToList());
        Assert.Null(row.ChangedById);
        Assert.Equal("caregiver:Jane Smith", row.ChangedByName);
    }

    [Fact]
    public async Task SaveChanges_UnauditedEntity_WritesNoAuditLog()
    {
        using var db = CreateDb(userId: Guid.NewGuid());

        // PublicHoliday is deliberately not in AuditedEntities.Types (it's bulk-upserted by
        // HolidaySyncBackgroundService and would otherwise generate high-churn audit noise).
        db.PublicHolidays.Add(new PublicHoliday
        {
            Id = Guid.NewGuid(),
            Date = new DateOnly(2026, 1, 1),
            Name = "New Year's Day"
        });
        await db.SaveChangesAsync();

        Assert.Empty(db.AuditLogs.ToList());
    }
}
