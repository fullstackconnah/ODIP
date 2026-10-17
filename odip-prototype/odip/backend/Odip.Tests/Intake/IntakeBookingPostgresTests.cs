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
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
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
    private (Odip.Infrastructure.Data.OdipDbContext Db, IntakeBookingsController Controller) SuperAdminViewing(Guid tenantId, Guid userId, TimeSpan? lockWait = null, INotificationChannel? channel = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(t => t.TenantId).Returns(tenantId);
        tenant.SetupGet(t => t.IsSuperAdmin).Returns(true);
        var db = PostgresFixture.NewContext(_pg.ConnectionString, tenant.Object);
        var sender = new IntakeInviteSender([channel ?? new IntakeBookingsControllerTests.RecordingChannel(ChannelSendOutcome.Skipped)], NullLogger<IntakeInviteSender>.Instance);
        var controller = new IntakeBookingsController(db, tenant.Object, sender, new NotificationRaiser(db), new IntakeBookingsControllerTests.FixedClock(IntakeBookingsControllerTests.Now), lockWait)
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
        var body = new SetIntakeBookingDto { StartsAt = IntakeBookingsControllerTests.Start, DurationMinutes = 90, Location = "Home", StaffUserId = kimB.Id, ExpectedUpdatedAt = await VersionAsync(db, noah.Id) };

        var refused = await controller.Set(noah.Id, body, CancellationToken.None);
        var booked = await controller.Set(noah.Id, body with { StaffUserId = samA.Id }, CancellationToken.None);

        Assert.Equal(new[] { "Choose who's going." }, IntakeBookingsControllerTests.Problems(refused.Result!)["staffUserId"]);
        Assert.IsType<OkObjectResult>(booked.Result);
        db.ChangeTracker.Clear();
        Assert.Equal(samA.Id, (await db.ParticipantInquiries.SingleAsync(x => x.Id == noah.Id)).IntakeStaffUserId);
        Assert.Single(await db.NotificationOutbox.Where(o => o.RecipientUserId == samA.Id).ToListAsync());
    }

    [SkippableFact]
    public async Task The_clash_queries_translate_and_keep_to_the_viewed_organisation_as_a_SuperAdmin_viewing_A()
    {
        RequirePostgres();
        var (dbA, a) = await _pg.NewTenantContextAsync();
        var (dbB, b) = await _pg.NewTenantContextAsync();
        await using var _a = dbA;
        await using var _b = dbB;
        var samA = Staff(a);
        var admin = Staff(a, UserRole.Admin, firstName: "Ada");
        dbA.Users.AddRange(samA, admin);
        var pA = new Participant { Id = Guid.NewGuid(), TenantId = a, FirstName = "Pat", LastName = "Ng" };
        dbA.Participants.Add(pA);
        // Back to back on both sides: a shift that ends as the visit starts, and another visit that starts as it ends.
        dbA.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = a, ParticipantId = pA.Id, UserId = samA.Id, ServiceDate = new DateOnly(2026, 10, 16), StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(10, 0), Status = ShiftStatus.Published });
        var ivy = Booked(a, samA.Id, IntakeBookingsControllerTests.Start.AddMinutes(90));
        var noah = Booked(a, samA.Id, IntakeBookingsControllerTests.Start);
        noah.IntakeStartsAt = null; noah.IntakeStaffUserId = null; noah.IntakeUid = null;
        var nia = Booked(a, samA.Id, IntakeBookingsControllerTests.Start);
        nia.FirstName = "Nia"; nia.IntakeStartsAt = null; nia.IntakeStaffUserId = null; nia.IntakeUid = null;
        dbA.ParticipantInquiries.AddRange(ivy, noah, nia);
        await dbA.SaveChangesAsync();
        // Organisation B books Sam's id at the same time: it overlaps, but it is another organisation's.
        // It starts first, so a query that leaked it would name 9:30 – 11:00 am instead.
        dbB.ParticipantInquiries.Add(Booked(b, samA.Id, IntakeBookingsControllerTests.Start.AddMinutes(-30)));
        await dbB.SaveChangesAsync();

        var (db, controller) = SuperAdminViewing(a, admin.Id);
        await using var _ = db;
        SetIntakeBookingDto Body(DateTime startsAt, DateTime version) => new() { StartsAt = startsAt, DurationMinutes = 90, Location = "12 Smith St", StaffUserId = samA.Id, ExpectedUpdatedAt = version };

        Assert.IsType<OkObjectResult>((await controller.Set(noah.Id, Body(IntakeBookingsControllerTests.Start, await VersionAsync(db, noah.Id)), CancellationToken.None)).Result);
        var refused = Assert.IsType<ConflictObjectResult>((await controller.Set(nia.Id, Body(IntakeBookingsControllerTests.Start.AddMinutes(30), await VersionAsync(db, nia.Id)), CancellationToken.None)).Result);
        Assert.Equal(["Sam Lee has another intake visit 10:00 – 11:30 am on Fri 16 Oct."], Assert.IsType<ValidationProblemDetails>(refused.Value).Errors["staffUserId"]);
    }

    // ── Two bookings at once for one staff member ───────────────────────────

    private static ParticipantInquiry Unbooked(Guid tenantId)
    {
        var x = Booked(tenantId, Guid.Empty, IntakeBookingsControllerTests.Start);
        x.IntakeStartsAt = null; x.IntakeDurationMinutes = null; x.IntakeLocation = null; x.IntakeStaffUserId = null; x.IntakeUid = null;
        return x;
    }

    private static SetIntakeBookingDto Body(User staff, DateTime startsAt, DateTime version) =>
        new() { StartsAt = startsAt, DurationMinutes = 90, Location = "12 Smith St", StaffUserId = staff.Id, ExpectedUpdatedAt = version };

    /// <summary>The version a panel that has just loaded the enquiry holds: read back from the database, which keeps microseconds.</summary>
    private static Task<DateTime> VersionAsync(OdipDbContext db, Guid inquiryId) =>
        db.ParticipantInquiries.IgnoreQueryFilters().AsNoTracking().Where(i => i.Id == inquiryId).Select(i => i.UpdatedAt).SingleAsync();

    // One organisation, Sam, an admin to book as, and two enquiries nobody has booked yet.
    private async Task<(Guid Tenant, User Sam, User Admin, ParticipantInquiry X, ParticipantInquiry Y)> BookableAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var sam = Staff(tenantId);
        var admin = Staff(tenantId, UserRole.Admin, firstName: "Ada");
        var (x, y) = (Unbooked(tenantId), Unbooked(tenantId));
        db.Users.AddRange(sam, admin);
        db.ParticipantInquiries.AddRange(x, y);
        await db.SaveChangesAsync();
        return (tenantId, sam, admin, x, y);
    }

    private async Task<NpgsqlConnection> OpenAsync()
    {
        var connection = new NpgsqlConnection(_pg.ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    private static async Task<object?> ScalarAsync(NpgsqlConnection connection, string sql, Guid id)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("id", id);
        return await command.ExecuteScalarAsync();
    }

    private const string BookedToStaff = "SELECT COUNT(*) FROM \"ParticipantInquiries\" WHERE \"IntakeStaffUserId\" = @id";
    // The key RosterGenerationLock builds for scope "intake-staff": hashtext(scope || ':' || staffId).
    private const string HoldKey = "SELECT pg_advisory_lock(hashtext('intake-staff:' || @id::text))";
    private const string ReleaseKey = "SELECT pg_advisory_unlock(hashtext('intake-staff:' || @id::text))";

    [SkippableFact]
    public async Task TwoOverlappingBookings_ForOneStaffMember_AtTheSameMoment_OnlyOneSaves()
    {
        RequirePostgres();
        await using var raw = await OpenAsync();
        for (var round = 0; round < 8; round++)
        {
            var (tenantId, sam, admin, x, y) = await BookableAsync();
            var (dbA, a) = SuperAdminViewing(tenantId, admin.Id);
            var (dbB, b) = SuperAdminViewing(tenantId, admin.Id);
            await using var _a = dbA;
            await using var _b = dbB;
            var (xv, yv) = (await VersionAsync(dbA, x.Id), await VersionAsync(dbB, y.Id));
            var start = new TaskCompletionSource();
            var first = Task.Run(async () => { await start.Task; return await a.Set(x.Id, Body(sam, IntakeBookingsControllerTests.Start, xv), CancellationToken.None); });
            var second = Task.Run(async () => { await start.Task; return await b.Set(y.Id, Body(sam, IntakeBookingsControllerTests.Start.AddMinutes(30), yv), CancellationToken.None); });
            start.SetResult();
            var results = (await Task.WhenAll(first, second)).Select(r => r.Result).ToList();

            Assert.Equal(1, results.OfType<OkObjectResult>().Count());
            var refused = Assert.Single(results.OfType<ConflictObjectResult>());
            Assert.Equal(IntakeBookingsController.StaffBusyCode, Assert.IsType<ValidationProblemDetails>(refused.Value).Extensions["code"]);
            Assert.Equal(1L, await ScalarAsync(raw, BookedToStaff, sam.Id));
        }
    }

    [SkippableFact]
    public async Task TheClashCheck_RunsUnderTheLock()
    {
        RequirePostgres();
        var (tenantId, sam, admin, x, y) = await BookableAsync();
        var (db, controller) = SuperAdminViewing(tenantId, admin.Id);
        await using var _ = db;
        await using var raw = await OpenAsync();
        await ScalarAsync(raw, HoldKey, sam.Id);

        var version = await VersionAsync(db, x.Id);
        var waiting = Task.Run(() => controller.Set(x.Id, Body(sam, IntakeBookingsControllerTests.Start, version), CancellationToken.None));
        await Task.Delay(500);
        Assert.False(waiting.IsCompleted);
        // While it waits, an overlapping visit lands: the check has to run after the lock, or it would not see this one.
        var (other, _o) = SuperAdminViewing(tenantId, admin.Id);
        await using var _other = other;
        var landed = await other.ParticipantInquiries.SingleAsync(i => i.Id == y.Id);
        landed.IntakeStartsAt = IntakeBookingsControllerTests.Start.AddMinutes(30); landed.IntakeDurationMinutes = 90; landed.IntakeLocation = "12 Smith St";
        landed.IntakeStaffUserId = sam.Id; landed.IntakeUid = "y@odip";
        await other.SaveChangesAsync();
        await ScalarAsync(raw, ReleaseKey, sam.Id);

        var refused = Assert.IsType<ConflictObjectResult>((await waiting.WaitAsync(TimeSpan.FromSeconds(15))).Result);
        Assert.Equal(IntakeBookingsController.StaffBusyCode, Assert.IsType<ValidationProblemDetails>(refused.Value).Extensions["code"]);
        Assert.Equal(1L, await ScalarAsync(raw, BookedToStaff, sam.Id));
    }

    [SkippableFact]
    public async Task ALockHeldPastTheWait_AnswersBusy()
    {
        RequirePostgres();
        var (tenantId, sam, admin, x, _) = await BookableAsync();
        var (db, controller) = SuperAdminViewing(tenantId, admin.Id, lockWait: TimeSpan.FromMilliseconds(200));
        await using var _db = db;
        await using var raw = await OpenAsync();
        await ScalarAsync(raw, HoldKey, sam.Id);

        var result = await controller.Set(x.Id, Body(sam, IntakeBookingsControllerTests.Start, await VersionAsync(db, x.Id)), CancellationToken.None);
        await ScalarAsync(raw, ReleaseKey, sam.Id);

        var busy = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(["Another booking for Sam is still being saved. Wait a moment, then try again."], Assert.IsType<ApiResponse<ParticipantInquiryDto>>(busy.Value).Errors);
        Assert.Equal(0L, await ScalarAsync(raw, BookedToStaff, sam.Id));
    }

    // D4: notes and a new place still save while another booking holds the staff member's lock, because they take no lock at all.
    [SkippableFact]
    public async Task ANotesOnlyOrLocationOnlySave_DoesNotWaitForTheLock()
    {
        RequirePostgres();
        var (tenantId, sam, admin, x, _) = await BookableAsync();
        var (db, controller) = SuperAdminViewing(tenantId, admin.Id, lockWait: TimeSpan.FromMilliseconds(200));
        await using var _db = db;
        var booked = Body(sam, IntakeBookingsControllerTests.Start, await VersionAsync(db, x.Id));
        Assert.IsType<OkObjectResult>((await controller.Set(x.Id, booked, CancellationToken.None)).Result);
        await using var raw = await OpenAsync();
        await ScalarAsync(raw, HoldKey, sam.Id);

        var notes = await controller.Set(x.Id, booked with { Notes = "Bring the forms", ExpectedUpdatedAt = await VersionAsync(db, x.Id) }, CancellationToken.None);
        var place = await controller.Set(x.Id, booked with { Location = "3 Jones Rd", ExpectedUpdatedAt = await VersionAsync(db, x.Id) }, CancellationToken.None);
        await ScalarAsync(raw, ReleaseKey, sam.Id);

        Assert.IsType<OkObjectResult>(notes.Result);
        Assert.IsType<OkObjectResult>(place.Result);
    }

    // The invite goes out with the lock already let go: a second booking made while the first one is being emailed is not kept waiting.
    [SkippableFact]
    public async Task TheLock_IsReleasedBeforeTheInviteIsSent()
    {
        RequirePostgres();
        var (tenantId, sam, admin, x, y) = await BookableAsync();
        IActionResult? during = null;
        var (dbB, b) = SuperAdminViewing(tenantId, admin.Id, lockWait: TimeSpan.FromMilliseconds(200));
        await using var _b = dbB;
        var (xv, yv) = (await VersionAsync(dbB, x.Id), await VersionAsync(dbB, y.Id));
        var channel = new SendingChannel(async () => during = (await b.Set(y.Id, Body(sam, IntakeBookingsControllerTests.Start.AddHours(3), yv), CancellationToken.None)).Result);
        var (dbA, a) = SuperAdminViewing(tenantId, admin.Id, channel: channel);
        await using var _a = dbA;

        Assert.IsType<OkObjectResult>((await a.Set(x.Id, Body(sam, IntakeBookingsControllerTests.Start, xv), CancellationToken.None)).Result);

        Assert.NotNull(during);
        Assert.IsType<OkObjectResult>(during);
    }

    private sealed class SendingChannel(Func<Task> whileSending) : INotificationChannel
    {
        public NotificationChannelKind Kind => NotificationChannelKind.Email;
        public async Task<ChannelSendResult> SendAsync(NotificationMessage message, CancellationToken ct)
        {
            await whileSending();
            return new ChannelSendResult(ChannelSendOutcome.Skipped, null, "SMTP is not configured");
        }
    }
}
