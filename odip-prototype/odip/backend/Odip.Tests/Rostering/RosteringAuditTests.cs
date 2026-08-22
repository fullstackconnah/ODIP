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

namespace Odip.Tests.Rostering;

/// <summary>
/// Confirms the rostering entities added to <see cref="AuditedEntities"/> actually produce
/// useful <see cref="AuditLog"/> rows via <see cref="AuditInterceptor"/> — in particular that a
/// coordinator's <see cref="Shift.OverrideReason"/> is recoverable from the audit trail, not
/// just that "a change happened". Mirrors the EF InMemory + Moq&lt;ICurrentTenant&gt; +
/// AuditInterceptor wiring used in Odip.Tests/Audit/AuditInterceptorTests.cs.
/// </summary>
public class RosteringAuditTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateOnly ServiceDate = new(2026, 8, 24);

    private static OdipDbContext CreateDb(Guid userId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
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

    private static Staff NewStaff(string firstName = "Ben") => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, FirstName = firstName, LastName = "Turner",
        Role = StaffRole.SupportWorker, IsActive = true
    };

    private static Shift NewShift(Participant participant, Staff? staff = null) => new()
    {
        Id = Guid.NewGuid(),
        TenantId = TenantId,
        ParticipantId = participant.Id,
        StaffId = staff?.Id,
        ServiceDate = ServiceDate,
        StartTime = new TimeOnly(9, 0),
        EndTime = new TimeOnly(17, 0),
        Ratio = SupportRatio.OneToOne,
        NightType = SleepoverType.None,
    };

    // ── Shift: full lifecycle produces audit rows ──────────────────────────

    [Fact]
    public async Task CreateShift_WritesCreatedAuditLog()
    {
        using var db = CreateDb(Guid.NewGuid());
        var participant = NewParticipant();
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var shift = NewShift(participant);
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.Where(a => a.EntityType == nameof(Shift)).ToList());
        Assert.Equal(shift.Id, log.EntityId);
        Assert.Equal(AuditAction.Created, log.Action);
        Assert.Equal("Jane Coordinator", log.ChangedByName);
    }

    [Fact]
    public async Task UpdateShift_OverrideReason_WritesAuditLogReflectingTheChange()
    {
        using var db = CreateDb(Guid.NewGuid());
        var participant = NewParticipant();
        var staff = NewStaff();
        db.Participants.Add(participant);
        db.Staff.Add(staff);
        await db.SaveChangesAsync();

        var shift = NewShift(participant, staff);
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();

        // Coordinator rosters against a Warning finding and records why.
        shift.OverrideReason = "Preferred worker unavailable; backup screened and compliant.";
        shift.AcknowledgedFindingCodes = "COMPATIBILITY_EXCLUDED";
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(Shift) && a.EntityId == shift.Id && a.Action == AuditAction.Updated)
            .Single();

        // The whole point: the reason text itself, not just "OverrideReason changed", must be
        // recoverable from the audit row.
        Assert.Contains("OverrideReason", updateLog.Changes);
        Assert.Contains("Preferred worker unavailable; backup screened and compliant.", updateLog.Changes);
    }

    [Fact]
    public async Task AssignStaffToShift_WritesAuditLogWithStaffIdChange()
    {
        using var db = CreateDb(Guid.NewGuid());
        var participant = NewParticipant();
        var staff = NewStaff();
        db.Participants.Add(participant);
        db.Staff.Add(staff);
        await db.SaveChangesAsync();

        var shift = NewShift(participant); // unfilled
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();

        shift.StaffId = staff.Id;
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(Shift) && a.EntityId == shift.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("StaffId", updateLog.Changes);
        Assert.Contains(staff.Id.ToString(), updateLog.Changes);
    }

    [Fact]
    public async Task DeleteShift_WritesDeletedAuditLog()
    {
        using var db = CreateDb(Guid.NewGuid());
        var participant = NewParticipant();
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var shift = NewShift(participant);
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();

        db.Shifts.Remove(shift);
        await db.SaveChangesAsync();

        var deleteLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(Shift) && a.EntityId == shift.Id && a.Action == AuditAction.Deleted)
            .Single();
        Assert.NotEqual("[]", deleteLog.Changes);
    }

    // ── ShiftPattern and StaffParticipantCompatibility are audited too ─────

    [Fact]
    public async Task CreateShiftPattern_WritesCreatedAuditLog()
    {
        using var db = CreateDb(Guid.NewGuid());
        var participant = NewParticipant();
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(),
            TenantId = TenantId,
            ParticipantId = participant.Id,
            DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None,
            EffectiveFrom = ServiceDate,
        };
        db.ShiftPatterns.Add(pattern);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.Where(a => a.EntityType == nameof(ShiftPattern)).ToList());
        Assert.Equal(pattern.Id, log.EntityId);
        Assert.Equal(AuditAction.Created, log.Action);
    }

    [Fact]
    public async Task UpdateCompatibility_ToExcluded_WritesAuditLogWithLevelChange()
    {
        using var db = CreateDb(Guid.NewGuid());
        var participant = NewParticipant();
        var staff = NewStaff();
        db.Participants.Add(participant);
        db.Staff.Add(staff);
        await db.SaveChangesAsync();

        var compatibility = new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(),
            TenantId = TenantId,
            StaffId = staff.Id,
            ParticipantId = participant.Id,
            Level = CompatibilityLevel.Allowed,
        };
        db.StaffParticipantCompatibilities.Add(compatibility);
        await db.SaveChangesAsync();

        compatibility.Level = CompatibilityLevel.Excluded;
        compatibility.Reason = "Participant reported a safeguarding concern.";
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(StaffParticipantCompatibility)
                        && a.EntityId == compatibility.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("Excluded", updateLog.Changes);
        Assert.Contains("Participant reported a safeguarding concern.", updateLog.Changes);
    }
}
