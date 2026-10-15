using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Notifications;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Intake;

/// <summary>The intake booking against a real PostgreSQL: the migration's columns round-trip, and the staff foreign key is enforced both ways.</summary>
public class IntakeBookingPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public IntakeBookingPostgresTests(PostgresFixture pg) => _pg = pg;
    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    internal static User Staff(Guid tenantId, UserRole role = UserRole.Coordinator, bool active = true, string firstName = "Sam")
    {
        var id = Guid.NewGuid();
        return new User { Id = id, TenantId = tenantId, Username = $"u{id:N}", Email = $"{id:N}@example.com", FirstName = firstName, LastName = "Lee", Role = role, IsActive = active };
    }

    internal static ParticipantInquiry Booked(Guid tenantId, Guid staffId, DateTime startsAtUtc) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Noah", LastName = "Fitzgerald", Source = "Phone", Email = "noah@example.com",
        IntakeStartsAt = startsAtUtc, IntakeDurationMinutes = 90, IntakeLocation = "12 Smith St", IntakeStaffUserId = staffId,
        IntakeUid = $"{Guid.NewGuid():N}@odip",
    };

    [SkippableFact]
    public async Task The_booking_columns_round_trip_at_their_full_lengths()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var staff = Staff(tenantId);
        db.Users.Add(staff);
        var inquiry = Booked(tenantId, staff.Id, new DateTime(2026, 10, 15, 23, 0, 0, DateTimeKind.Utc));
        inquiry.IntakeLocation = new string('x', 300);
        inquiry.IntakeNotes = new string('n', 1000);
        inquiry.IntakeInviteError = "NotConfigured";
        inquiry.IntakeIcsSequence = 3;
        inquiry.IntakeBookedByUserId = staff.Id;
        db.ParticipantInquiries.Add(inquiry);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var read = await db.ParticipantInquiries.SingleAsync(x => x.Id == inquiry.Id);

        Assert.Equal(new DateTime(2026, 10, 15, 23, 0, 0), read.IntakeStartsAt); // legacy timestamp mode: the same wall value back
        Assert.Equal(staff.Id, read.IntakeStaffUserId);
        Assert.Equal(staff.Id, read.IntakeBookedByUserId);
        Assert.Equal(300, read.IntakeLocation!.Length);
        Assert.Equal(1000, read.IntakeNotes!.Length);
        Assert.Equal(3, read.IntakeIcsSequence);
        Assert.Equal("NotConfigured", read.IntakeInviteError);
    }

    [SkippableFact]
    public async Task A_booking_that_names_a_user_who_does_not_exist_is_refused()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        db.ParticipantInquiries.Add(Booked(tenantId, Guid.NewGuid(), new DateTime(2026, 10, 15, 23, 0, 0, DateTimeKind.Utc)));

        var error = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());

        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, Assert.IsType<PostgresException>(error.InnerException).SqlState);
    }

    [SkippableFact]
    public async Task A_staff_member_booked_for_a_visit_cannot_be_deleted()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var staff = Staff(tenantId);
        db.Users.Add(staff);
        db.ParticipantInquiries.Add(Booked(tenantId, staff.Id, new DateTime(2026, 10, 15, 23, 0, 0, DateTimeKind.Utc)));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        db.Users.Remove(await db.Users.SingleAsync(u => u.Id == staff.Id));

        var error = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());

        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, Assert.IsType<PostgresException>(error.InnerException).SqlState);
    }

    // A SuperAdmin viewing organisation A: the context has NO tenant filter, so only the controller's own TenantId predicates keep B out.
    private (Odip.Infrastructure.Data.OdipDbContext Db, IntakeBookingsController Controller) SuperAdminViewing(Guid tenantId, Guid userId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(t => t.TenantId).Returns(tenantId);
        tenant.SetupGet(t => t.IsSuperAdmin).Returns(true);
        var db = PostgresFixture.NewContext(_pg.ConnectionString, tenant.Object);
        var sender = new IntakeInviteSender([new IntakeBookingsControllerTests.RecordingChannel(ChannelSendOutcome.Skipped)], NullLogger<IntakeInviteSender>.Instance);
        var controller = new IntakeBookingsController(db, tenant.Object, sender, new NotificationRaiser(db), new IntakeBookingsControllerTests.FixedClock(IntakeBookingsControllerTests.Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Role, "SuperAdmin")], "test")) } },
        };
        return (db, controller);
    }

    [SkippableFact]
    public async Task A_super_admin_sees_only_the_viewed_organisations_visits_and_the_query_translates()
    {
        RequirePostgres();
        var (dbA, a) = await _pg.NewTenantContextAsync();
        var (dbB, b) = await _pg.NewTenantContextAsync();
        await using var _a = dbA;
        await using var _b = dbB;
        var samA = Staff(a);
        var admin = Staff(a, UserRole.Admin, firstName: "Ada");
        dbA.Users.AddRange(samA, admin);
        dbA.ParticipantInquiries.Add(Booked(a, samA.Id, IntakeBookingsControllerTests.Start));
        await dbA.SaveChangesAsync();
        var kimB = Staff(b, firstName: "Kim");
        dbB.Users.Add(kimB);
        dbB.ParticipantInquiries.Add(Booked(b, kimB.Id, IntakeBookingsControllerTests.Start));
        await dbB.SaveChangesAsync();
        var (db, controller) = SuperAdminViewing(a, admin.Id);
        await using var _ = db;

        var result = await controller.Visits(new DateOnly(2026, 10, 16), new DateOnly(2026, 10, 16), null, CancellationToken.None);

        var visit = Assert.Single(IntakeBookingsControllerTests.Ok<List<IntakeVisitDto>>(result.Result!));
        Assert.Equal(samA.Id, visit.StaffUserId);
        Assert.Equal("Sam Lee", visit.StaffName);
    }

    [SkippableFact]
    public async Task A_super_admin_cannot_send_another_organisations_staff_member()
    {
        RequirePostgres();
        var (dbA, a) = await _pg.NewTenantContextAsync();
        var (dbB, b) = await _pg.NewTenantContextAsync();
        await using var _a = dbA;
        await using var _b = dbB;
        var kimB = Staff(b, firstName: "Kim");
        dbB.Users.Add(kimB);
        await dbB.SaveChangesAsync();
        var samA = Staff(a);
        var admin = Staff(a, UserRole.Admin, firstName: "Ada");
        var noah = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = a, FirstName = "Noah", LastName = "Fitzgerald", Source = "Phone", Email = "noah@example.com" };
        dbA.Users.AddRange(samA, admin);
        dbA.ParticipantInquiries.Add(noah);
        await dbA.SaveChangesAsync();
        var (db, controller) = SuperAdminViewing(a, admin.Id);
        await using var _ = db;
        var body = new SetIntakeBookingDto { StartsAt = IntakeBookingsControllerTests.Start, DurationMinutes = 90, Location = "Home", StaffUserId = kimB.Id };

        var refused = await controller.Set(noah.Id, body, CancellationToken.None);
        var booked = await controller.Set(noah.Id, body with { StaffUserId = samA.Id }, CancellationToken.None);

        Assert.Equal(new[] { "Choose who's going." }, IntakeBookingsControllerTests.Problems(refused.Result!)["staffUserId"]);
        Assert.IsType<OkObjectResult>(booked.Result);
        db.ChangeTracker.Clear();
        Assert.Equal(samA.Id, (await db.ParticipantInquiries.SingleAsync(x => x.Id == noah.Id)).IntakeStaffUserId);
        Assert.Single(await db.NotificationOutbox.Where(o => o.RecipientUserId == samA.Id).ToListAsync());
    }
}
