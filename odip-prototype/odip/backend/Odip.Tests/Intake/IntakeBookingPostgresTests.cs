using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
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
}
