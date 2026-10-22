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
    private static OdipDbContext CreateDb(Guid? userId = null, IInterceptor? afterAudit = null)
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

        var builder = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object));
        if (afterAudit is not null) builder.AddInterceptors(afterAudit);
        var options = builder.Options;

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

        // EarlyAccessRequest is deliberately not in AuditedEntities.Types: a sign-up from the public landing page has no
        // signed-in actor to attribute and nothing worth recovering. (PublicHoliday used to stand in here; it is audited now,
        // see the two tests below.)
        var now = DateTime.UtcNow;
        db.EarlyAccessRequests.Add(new EarlyAccessRequest
        {
            Id = Guid.NewGuid(),
            Name = "Jo Visitor",
            Organisation = "Example Care",
            Email = "jo@example.com",
            CreatedAtUtc = now,
            LastRequestedAtUtc = now,
            RequestCount = 1
        });
        await db.SaveChangesAsync();

        Assert.Empty(db.AuditLogs.ToList());
    }

    [Fact]
    public async Task SaveChanges_EarlyAccessLaterSubmission_IsNotAudited_ItHoldsAPersonsDetails()
    {
        Assert.DoesNotContain(typeof(EarlyAccessRequest), AuditedEntities.Types);
        Assert.DoesNotContain(typeof(EarlyAccessLaterSubmission), AuditedEntities.Types);

        using var db = CreateDb(userId: Guid.NewGuid());
        var now = DateTime.UtcNow;
        var parent = new EarlyAccessRequest
        {
            Id = Guid.NewGuid(), Name = "Jo Visitor", Organisation = "Example Care", Email = "jo@example.com",
            CreatedAtUtc = now, LastRequestedAtUtc = now, RequestCount = 2,
        };
        db.EarlyAccessRequests.Add(parent);
        db.EarlyAccessLaterSubmissions.Add(new EarlyAccessLaterSubmission
        {
            Id = Guid.NewGuid(), EarlyAccessRequestId = parent.Id, ReceivedAtUtc = now, Name = "Jo Visitor", Organisation = "Example Care",
            Phone = "0491 570 156", Message = "Please remove my details",
        });
        await db.SaveChangesAsync();

        Assert.Empty(db.AuditLogs.ToList());
    }

    [Fact]
    public async Task SaveChanges_PublicHoliday_IsAudited_BecauseTheRowsDecideWhichDaysArePricedAtTheHolidayRate()
    {
        // Review M6 (plan builder phase B): the table is global and a row moves every tenant's quotes (+122% on a weekday),
        // so who added, renamed or removed one, and when, must be recoverable. The yearly sync writes 150 or so rows on a
        // fresh database and after that only the rows the feed adds or renames, so the audit volume is small.
        Assert.Contains(typeof(PublicHoliday), AuditedEntities.Types);

        using var db = CreateDb(userId: Guid.NewGuid());
        var holiday = new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 10, 5), Name = "Labour Day", State = "NSW" };
        db.PublicHolidays.Add(holiday);
        await db.SaveChangesAsync();
        holiday.Name = "Labour Day (renamed)";
        await db.SaveChangesAsync();
        db.PublicHolidays.Remove(holiday);
        await db.SaveChangesAsync();

        var logs = db.AuditLogs.ToList();
        Assert.Equal(new[] { AuditAction.Created, AuditAction.Updated, AuditAction.Deleted }.OrderBy(a => a), logs.Select(l => l.Action).OrderBy(a => a));
        Assert.All(logs, l => Assert.Equal(("PublicHoliday", holiday.Id), (l.EntityType, l.EntityId)));
        Assert.Contains("Labour Day (renamed)", Assert.Single(logs, l => l.Action == AuditAction.Updated).Changes);
    }

    [Fact]
    public async Task SaveChanges_PublicHolidayFromTheBackgroundSync_IsAuditedWithNoActorAndDoesNotThrow()
    {
        using var db = CreateDb(userId: null);   // HolidaySyncBackgroundService runs with no request and no user

        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 12, 25), Name = "Christmas Day", State = null });
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.ToList());
        Assert.Equal("PublicHoliday", log.EntityType);
        Assert.Equal(AuditAction.Created, log.Action);
        Assert.Null(log.ChangedById);
        Assert.Null(log.ChangedByName);
    }

    /// <summary>Fails the first save that reaches it (after the AuditInterceptor has run), like a lost concurrency race, then lets saves through.</summary>
    private sealed class FailFirstSaveInterceptor : SaveChangesInterceptor
    {
        private bool _failed;

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (_failed) return base.SavingChangesAsync(eventData, result, cancellationToken);
            _failed = true;
            throw new DbUpdateConcurrencyException("lost the race");
        }
    }

    [Fact]
    public async Task SaveChanges_RetriedAfterAFailedAttempt_WritesOneAuditRowPerChangedEntity()
    {
        using var db = CreateDb(userId: Guid.NewGuid(), afterAudit: new FailFirstSaveInterceptor());
        db.Participants.Add(NewParticipant());

        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => db.SaveChangesAsync());
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.ToList());
        Assert.Equal(AuditAction.Created, log.Action);
    }

    [Fact]
    public async Task SaveChanges_RetriedAfterAFailedAttempt_KeepsACallerAddedAuditRowOnce()
    {
        using var db = CreateDb(userId: Guid.NewGuid(), afterAudit: new FailFirstSaveInterceptor());
        db.Participants.Add(NewParticipant());
        db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = "Setting", EntityId = Guid.NewGuid(), Action = AuditAction.Updated, ChangedAt = DateTimeOffset.UtcNow, Changes = "[]" });

        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => db.SaveChangesAsync());
        await db.SaveChangesAsync();

        var logs = db.AuditLogs.ToList();
        Assert.Equal(2, logs.Count);
        Assert.Single(logs, l => l.EntityType == "Setting");
        Assert.Single(logs, l => l.EntityType == nameof(Participant));
    }
}
