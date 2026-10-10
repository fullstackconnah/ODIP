using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Readiness;

/// <summary>
/// WARN is the default readiness mode for every organisation (no ProviderSettings row at all is
/// the common case, and every existing row gets Warn). In Warn the readiness gate must not stop
/// an ACTIVE, non-draft participant from being rostered, booked or activated: the gaps are shown
/// as warnings instead. These tests were written first, against the hard-closed gate that
/// shipped in production (ParticipantReadinessGate: UnapprovedDraft source, so no participant
/// could ever be "ready"), and every one of them failed there with a 400 or an empty result.
/// The fixture is the shape of the real production data: an active legacy participant with NO
/// onboarding row and NO signed agreement evidence.
/// </summary>
public class ReadinessWarnModeDefaultTests
{
    // A Monday, so WeekStart(ServiceDate) == ServiceDate.
    private static readonly DateOnly ServiceDate = new(2026, 10, 5);

    private static OdipDbContext CreateDb() => TestDb.Create();

    private static RosteringController Rostering(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    private static User SeedStaff(OdipDbContext db, string firstName = "Ben")
    {
        var staff = new User
        {
            Id = Guid.NewGuid(), FirstName = firstName, LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
            WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1)
        };
        db.Users.Add(staff);
        db.SaveChanges();
        return staff;
    }

    /// <summary>Active, non-draft, intake completed, no onboarding row, no agreement evidence: what production holds today.</summary>
    private static Participant SeedLegacyParticipant(OdipDbContext db, string firstName = "Amy", string lastName = "Ng")
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName,
            IsActive = true, IsDraft = false, IntakeCompletedAt = DateTime.UtcNow.AddMonths(-6),
        };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static Shift SeedShift(OdipDbContext db, Guid participantId, Guid? staffId)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, UserId = staffId,
            ServiceDate = ServiceDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };
        db.Shifts.Add(shift);
        db.SaveChanges();
        return shift;
    }

    private static CreateShiftDto CreateDto(Guid participantId, Guid? staffId) => new()
    {
        ParticipantId = participantId, StaffId = staffId, ServiceDate = ServiceDate,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
    };

    private static ShiftPattern SeedPattern(OdipDbContext db, Guid participantId, Guid? staffId = null)
    {
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, DefaultUserId = staffId, DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
            EffectiveFrom = new DateOnly(2026, 10, 1), EffectiveTo = new DateOnly(2026, 10, 31), IsActive = true
        };
        db.ShiftPatterns.Add(pattern);
        db.SaveChanges();
        return pattern;
    }

    // ── Rostering writes ────────────────────────────────────────────────────────

    [Fact]
    public async Task AssignShift_ActiveLegacyParticipant_DefaultMode_ReturnsOkAndAssigns()
    {
        using var db = CreateDb();
        var participant = SeedLegacyParticipant(db);
        var staff = SeedStaff(db);
        var shift = SeedShift(db, participant.Id, null);

        var result = await Rostering(db).AssignShift(shift.Id, new AssignShiftDto { StaffId = staff.Id }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(staff.Id, (await db.Shifts.SingleAsync()).UserId);
    }

    [Fact]
    public async Task CreateShift_ActiveLegacyParticipant_DefaultMode_ReturnsOkAndSaves()
    {
        using var db = CreateDb();
        var participant = SeedLegacyParticipant(db);
        var staff = SeedStaff(db);

        var result = await Rostering(db).CreateShift(CreateDto(participant.Id, staff.Id), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Single(await db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task UpdateShift_ReassigningStaff_ActiveLegacyParticipant_DefaultMode_ReturnsOk()
    {
        using var db = CreateDb();
        var participant = SeedLegacyParticipant(db);
        var original = SeedStaff(db, "Ben");
        var replacement = SeedStaff(db, "Cara");
        var shift = SeedShift(db, participant.Id, original.Id);

        var dto = new UpdateShiftDto
        {
            ParticipantId = participant.Id, StaffId = replacement.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft,
        };
        var result = await Rostering(db).UpdateShift(shift.Id, dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(replacement.Id, (await db.Shifts.SingleAsync()).UserId);
    }

    [Fact]
    public async Task CheckShift_ActiveLegacyParticipant_DefaultMode_ReturnsOk()
    {
        using var db = CreateDb();
        var participant = SeedLegacyParticipant(db);
        var staff = SeedStaff(db);

        var result = await Rostering(db).CheckShift(new CheckShiftDto
        {
            ParticipantId = participant.Id, StaffId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreatePattern_ActiveLegacyParticipant_DefaultMode_ReturnsCreated()
    {
        using var db = CreateDb();
        var participant = SeedLegacyParticipant(db);

        var result = await Rostering(db).CreatePattern(new CreateShiftPatternDto
        {
            ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
            EffectiveFrom = new DateOnly(2026, 10, 1), EffectiveTo = new DateOnly(2026, 10, 31), IsActive = true,
        }, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Single(await db.ShiftPatterns.ToListAsync());
    }

    [Fact]
    public async Task UpdatePattern_ActiveLegacyParticipant_DefaultMode_ReturnsOk()
    {
        using var db = CreateDb();
        var participant = SeedLegacyParticipant(db);
        var pattern = SeedPattern(db, participant.Id);

        var result = await Rostering(db).UpdatePattern(pattern.Id, new UpdateShiftPatternDto
        {
            ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Tuesday,
            StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(16, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
            EffectiveFrom = new DateOnly(2026, 10, 1), EffectiveTo = new DateOnly(2026, 10, 31), IsActive = true,
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(DayOfWeek.Tuesday, (await db.ShiftPatterns.SingleAsync()).DayOfWeek);
    }

    [Fact]
    public async Task GeneratePattern_ActiveLegacyParticipant_DefaultMode_CreatesShifts()
    {
        using var db = CreateDb();
        var participant = SeedLegacyParticipant(db);
        var pattern = SeedPattern(db, participant.Id);

        var result = await Rostering(db).GeneratePattern(pattern.Id, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<GeneratePatternResultDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.Created > 0);
        Assert.NotEmpty(await db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task UpsertCompatibility_ActiveLegacyParticipant_DefaultMode_ReturnsOk()
    {
        using var db = CreateDb();
        var participant = SeedLegacyParticipant(db);
        var staff = SeedStaff(db);

        var result = await Rostering(db).UpsertCompatibility(new UpsertCompatibilityDto
        {
            StaffId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Preferred,
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Single(await db.StaffParticipantCompatibilities.ToListAsync());
    }

    // ── The board ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetBoard_DefaultMode_DoesNotRaiseNotReadyExceptionsForLegacyParticipantShifts()
    {
        using var db = CreateDb();
        var participant = SeedLegacyParticipant(db);
        var staff = SeedStaff(db);
        SeedShift(db, participant.Id, staff.Id);

        var result = await Rostering(db).GetBoard(ServiceDate, "participant", CancellationToken.None);

        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var row = Assert.Single(board.ParticipantRows!, r => r.ParticipantId == participant.Id);
        Assert.Single(row.Shifts);
        // The shift is listed, and the "not ready" gap is a quiet warning on the row, not an
        // exception on every shift that would bury the real findings in the exceptions drawer.
        Assert.DoesNotContain(board.Exceptions!, e => e.Finding.Code == "PARTICIPANT_NOT_READY");
    }

    // ── Trip bookings ───────────────────────────────────────────────────────────

    [Fact]
    public async Task CreateBooking_ActiveLegacyParticipant_DefaultMode_ReturnsCreated()
    {
        using var db = CreateDb();
        var participant = SeedLegacyParticipant(db);
        var trip = new TripInstance
        {
            Id = Guid.NewGuid(), TripName = "Gold Coast Beach Break", StartDate = new DateOnly(2026, 11, 1),
            DurationDays = 3, Status = TripStatus.Planning,
        };
        db.TripInstances.Add(trip);
        db.SaveChanges();

        var result = await new BookingsController(db).Create(
            new CreateBookingDto { TripInstanceId = trip.Id, ParticipantId = participant.Id }, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Single(await db.ParticipantBookings.ToListAsync());
    }

    // ── Participant activation and the register ─────────────────────────────────

    private static ParticipantsController Participants(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

    [Fact]
    public async Task Update_NonDraftParticipantWithCompletedIntake_DefaultMode_Activates()
    {
        using var db = CreateDb();
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Newly", LastName = "Onboarded",
            IsActive = false, IsDraft = false, IntakeCompletedAt = DateTime.UtcNow,
        };
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var result = await Participants(db).Update(participant.Id, new UpdateParticipantDto
        {
            FirstName = participant.FirstName, LastName = participant.LastName, PlanType = PlanType.SelfManaged,
            OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne,
            SupportRatio = SupportRatio.OneToOne, IsActive = false, IsDraft = false,
        }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.IsActive);
    }

    [Fact]
    public async Task GetAll_OperationalOnly_DefaultMode_ListsActivatedParticipantWithAnOnboardingRow()
    {
        using var db = CreateDb();
        var tenantId = Guid.NewGuid();
        var activated = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Active", LastName = "Onboarded", IsActive = true, IsDraft = false };
        db.AddRange(activated, new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = activated.Id });
        await db.SaveChangesAsync();

        var result = await Participants(db).GetAll(null, null, null, null, null, false, 1, 50, CancellationToken.None, operationalOnly: true);

        var items = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Items;
        Assert.Contains(items, p => p.Id == activated.Id);
    }
}
