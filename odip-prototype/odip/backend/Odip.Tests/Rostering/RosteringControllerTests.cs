using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Controller-level coverage for the Rostering API slice (RosteringController), on top of the
/// domain-level RosterConflictService/ShiftPatternExpander coverage elsewhere in
/// Odip.Tests/Rostering. Uses the same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as
/// BillingControllerTests/AdminUsersControllerTests.
/// </summary>
public class RosteringControllerTests
{
    // A Monday, so WeekStart(ServiceDate) == ServiceDate for every test below.
    private static readonly DateOnly ServiceDate = new(2026, 8, 24);

    // Mirrors the JSON configuration controller output actually gets: the explicit options
    // from Program.cs's builder.Services.AddControllers().AddJsonOptions(...) call
    // (JsonStringEnumConverter + DefaultIgnoreCondition.WhenWritingNull), PLUS
    // PropertyNamingPolicy.CamelCase, which ASP.NET Core's JsonOptions defaults to and which
    // Program.cs never overrides — a plain JsonSerializerOptions defaults to the untouched
    // PascalCase property names instead, so omitting this would test a casing behaviour the
    // API doesn't actually have.
    private static readonly JsonSerializerOptions ApiJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() }
    };

    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    // expiredScreeningDate distinguishes the two non-valid cases WSC_EXPIRED/WSC_MISSING test for:
    // null (the default when workerScreeningValid is false) means no screening recorded at all
    // (WSC_MISSING, Warning); a date before ServiceDate means a genuinely lapsed screening
    // (WSC_EXPIRED, Blocking) — callers that need the Blocking finding must pass one explicitly.
    private static User SeedStaff(OdipDbContext db, bool workerScreeningValid = true, DateOnly? expiredScreeningDate = null, string firstName = "Ben", string lastName = "Turner")
    {
        var staff = new User
        {
            Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName,
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
            WorkerScreeningNumber = workerScreeningValid ? "WSC-1" : null,
            WorkerScreeningExpiryDate = workerScreeningValid ? new DateOnly(2030, 1, 1) : expiredScreeningDate
        };
        db.Users.Add(staff);
        db.SaveChanges();
        return staff;
    }

    private static Participant SeedParticipant(OdipDbContext db, string firstName = "Amy", string lastName = "Ng")
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static CreateShiftDto CleanCreateDto(Guid participantId, Guid? staffId, string? overrideReason = null, List<string>? codes = null) => new()
    {
        ParticipantId = participantId, StaffId = staffId, ServiceDate = ServiceDate,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        OverrideReason = overrideReason, AcknowledgedFindingCodes = codes
    };

    // ── INTAKE-08: draft participants are excluded from every roster surface ────────────

    [Fact]
    public async Task CreateShift_DraftParticipant_ReturnsBadRequest_ParticipantNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.Add(draft);
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));
        var dto = CleanCreateDto(draft.Id, staff.Id);

        var result = await controller.CreateShift(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(badRequest.Value);
        Assert.Contains("not found", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task GetBoard_ParticipantMode_ExcludesDraftParticipants()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var activeParticipant = SeedParticipant(db, "Amy", "Ng");
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.Add(draft);
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));
        var result = await controller.GetBoard(ServiceDate, "participant", CancellationToken.None);

        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Contains(body.Data!.ParticipantRows, r => r.ParticipantId == activeParticipant.Id);
        Assert.DoesNotContain(body.Data.ParticipantRows, r => r.ParticipantId == draft.Id);
    }

    // ── Blocking finding gate ────────────────────────────────────────────

    [Fact]
    public async Task CreateShift_BlockingFinding_RejectedEvenWithOverrideReason()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db, workerScreeningValid: false, expiredScreeningDate: new DateOnly(2020, 1, 1)); // genuinely expired -> WSC_EXPIRED, Blocking
        var participant = SeedParticipant(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        var dto = CleanCreateDto(participant.Id, staff.Id, overrideReason: "I really need this covered today");

        var result = await controller.CreateShift(dto, CancellationToken.None);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(unprocessable.Value);
        Assert.False(body.Success);
        Assert.Contains(body.Data!, f => f.Code == RosterConflictService.WscExpired && f.Severity == RosterFindingSeverity.Blocking);

        // Never saved — a Blocking finding is never savable, override reason or not.
        Assert.Empty(await db.Shifts.ToListAsync());
    }

    // ── Warning findings gate ────────────────────────────────────────────

    [Fact]
    public async Task CreateShift_WarningFindingsWithoutOverrideReason_Rejected422()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), UserId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Excluded
        });
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));
        var dto = CleanCreateDto(participant.Id, staff.Id); // no overrideReason

        var result = await controller.CreateShift(dto, CancellationToken.None);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(unprocessable.Value);
        Assert.False(body.Success);
        Assert.Contains(body.Data!, f => f.Code == RosterConflictService.CompatibilityExcluded && f.Severity == RosterFindingSeverity.Warning);

        Assert.Empty(await db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task CreateShift_WarningFindingsWithOverrideReason_SavedWithReasonAndAcknowledgedCodes()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), UserId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Excluded
        });
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));
        var dto = CleanCreateDto(participant.Id, staff.Id,
            overrideReason: "Coordinator approved despite the exclusion flag",
            codes: new List<string> { RosterConflictService.CompatibilityExcluded });

        var result = await controller.CreateShift(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Coordinator approved despite the exclusion flag", body.Data!.OverrideReason);
        Assert.Contains(body.Data.Findings, f => f.Code == RosterConflictService.CompatibilityExcluded);

        var saved = await db.Shifts.SingleAsync();
        Assert.Equal("Coordinator approved despite the exclusion flag", saved.OverrideReason);
        Assert.Equal(RosterConflictService.CompatibilityExcluded, saved.AcknowledgedFindingCodes);
    }

    // ── Clean create ─────────────────────────────────────────────────────

    [Fact]
    public async Task CreateShift_NoFindings_SavedDirectly()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        var dto = CleanCreateDto(participant.Id, staff.Id);

        var result = await controller.CreateShift(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Empty(body.Data!.Findings);
        Assert.Null(body.Data.OverrideReason);

        var saved = await db.Shifts.SingleAsync();
        Assert.Equal(ShiftStatus.Draft, saved.Status);
        Assert.Null(saved.OverrideReason);
        Assert.Null(saved.AcknowledgedFindingCodes);
    }

    // ── Pattern generation idempotency ──────────────────────────────────

    [Fact]
    public async Task GeneratePattern_RunTwiceOverSameRange_SecondRunSkipsEverything()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
            EffectiveFrom = new DateOnly(2026, 8, 1), EffectiveTo = new DateOnly(2026, 8, 31), IsActive = true
        };
        db.ShiftPatterns.Add(pattern);
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));
        var from = new DateOnly(2026, 8, 1);
        var to = new DateOnly(2026, 8, 31);

        var first = await controller.GeneratePattern(pattern.Id, from, to, CancellationToken.None);
        var firstBody = Assert.IsType<ApiResponse<GeneratePatternResultDto>>(Assert.IsType<OkObjectResult>(first.Result).Value);
        Assert.True(firstBody.Data!.Created > 0); // August 2026 has multiple Mondays
        Assert.Equal(0, firstBody.Data.Skipped);

        var totalAfterFirst = await db.Shifts.CountAsync();
        Assert.Equal(firstBody.Data.Created, totalAfterFirst);

        var second = await controller.GeneratePattern(pattern.Id, from, to, CancellationToken.None);
        var secondBody = Assert.IsType<ApiResponse<GeneratePatternResultDto>>(Assert.IsType<OkObjectResult>(second.Result).Value);
        Assert.Equal(0, secondBody.Data!.Created);
        Assert.Equal(firstBody.Data.Created, secondBody.Data.Skipped);

        // Idempotent: re-running the same range creates nothing new.
        var totalAfterSecond = await db.Shifts.CountAsync();
        Assert.Equal(totalAfterFirst, totalAfterSecond);
    }

    // ── Board ────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetBoard_StaffMode_SeparatesUnfilledShiftsFromStaffRows()
    {
        // Regression guard: staff mode (pass 1's shape) must keep working exactly as before,
        // now behind an explicit groupBy=staff rather than being the default.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var filledParticipant = SeedParticipant(db, "Amy", "Ng");
        var unfilledParticipant = SeedParticipant(db, "Cam", "Diaz");

        var filledShift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = filledParticipant.Id, UserId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };
        var unfilledShift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = unfilledParticipant.Id, UserId = null, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(13, 0), EndTime = new TimeOnly(15, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };
        db.Shifts.AddRange(filledShift, unfilledShift);
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        Assert.True(body.Success);
        var board = body.Data!;

        Assert.Equal(RosterBoardGroupBy.Staff, board.GroupBy);
        Assert.Null(board.ParticipantRows);

        var unfilledDto = Assert.Single(board.Unfilled!);
        Assert.Equal(unfilledShift.Id, unfilledDto.Id);

        var staffRow = Assert.Single(board.StaffRows!, r => r.StaffId == staff.Id);
        var rowShift = Assert.Single(staffRow.Shifts);
        Assert.Equal(filledShift.Id, rowShift.Id);
        Assert.DoesNotContain(staffRow.Shifts, s => s.Id == unfilledShift.Id);
    }

    [Fact]
    public async Task GetBoard_StaffMode_IncludesEveryActiveRole_NoRoleFilter()
    {
        // Design spec §4.2: the board shows every active tenant user, of any role — the old
        // "approximates Staff-only listing" role filter (excluding SuperAdmin/ReadOnly) is gone.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var supportWorker = SeedStaff(db, firstName: "Support", lastName: "Worker");

        User MakeActiveUser(UserRole role, string firstName) => new()
        {
            Id = Guid.NewGuid(), FirstName = firstName, LastName = "Person",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = role, IsActive = true,
        };

        var coordinator = MakeActiveUser(UserRole.Coordinator, "Coord");
        var admin = MakeActiveUser(UserRole.Admin, "Adm");
        var readOnly = MakeActiveUser(UserRole.ReadOnly, "Read");
        var superAdmin = MakeActiveUser(UserRole.SuperAdmin, "Super");
        var inactive = MakeActiveUser(UserRole.SupportWorker, "Inactive");
        inactive.IsActive = false;
        db.Users.AddRange(coordinator, admin, readOnly, superAdmin, inactive);
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var staffIds = body.Data!.StaffRows!.Select(r => r.StaffId).ToList();

        Assert.Contains(supportWorker.Id, staffIds);
        Assert.Contains(coordinator.Id, staffIds);
        Assert.Contains(admin.Id, staffIds);
        Assert.Contains(readOnly.Id, staffIds);
        Assert.Contains(superAdmin.Id, staffIds);
        // Only IsActive is filtered — role is not.
        Assert.DoesNotContain(inactive.Id, staffIds);
    }

    [Fact]
    public async Task GetBoard_DefaultsToParticipantMode()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        // groupBy omitted entirely — the spec's default is participant, not staff.
        var result = await controller.GetBoard(ServiceDate, null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var board = body.Data!;

        Assert.Equal(RosterBoardGroupBy.Participant, board.GroupBy);
        Assert.NotNull(board.ParticipantRows);
        Assert.Null(board.StaffRows);
        Assert.Null(board.Unfilled);
    }

    [Fact]
    public async Task GetBoard_ParticipantMode_ActiveParticipantWithNoShifts_StillGetsARow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, "Amy", "Ng");
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        var result = await controller.GetBoard(ServiceDate, "participant", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var board = body.Data!;

        var row = Assert.Single(board.ParticipantRows!, r => r.ParticipantId == participant.Id);
        Assert.Empty(row.Shifts);
        Assert.Equal(0m, row.ScheduledHours);
        Assert.Equal(7, row.DaysWithoutCover);
    }

    [Fact]
    public async Task GetBoard_ParticipantMode_UnfilledShiftAppearsOnParticipantRow_NoSeparateUnfilledLane()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, "Cam", "Diaz");
        var unfilledShift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = null, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(13, 0), EndTime = new TimeOnly(15, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };
        db.Shifts.Add(unfilledShift);
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));
        var result = await controller.GetBoard(ServiceDate, "participant", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var board = body.Data!;

        Assert.Null(board.Unfilled); // no separate unfilled lane in participant mode

        var row = Assert.Single(board.ParticipantRows!, r => r.ParticipantId == participant.Id);
        var rowShift = Assert.Single(row.Shifts);
        Assert.Equal(unfilledShift.Id, rowShift.Id);
        Assert.Null(rowShift.StaffId);
    }

    [Fact]
    public async Task GetBoard_ParticipantMode_DaysWithoutCover_CountsDaysWithNoShiftOrTrip()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, "Amy", "Ng");

        // ServiceDate (2026-08-24) is the week's Monday; shift the Monday shift's staff off
        // so this test only exercises coverage, not conflict findings.
        db.Shifts.AddRange(
            new Shift
            {
                Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = null, ServiceDate = ServiceDate,
                StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
                NightType = SleepoverType.None, Status = ShiftStatus.Draft
            },
            new Shift
            {
                Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = null, ServiceDate = ServiceDate.AddDays(1),
                StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
                NightType = SleepoverType.None, Status = ShiftStatus.Draft
            });
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));
        var result = await controller.GetBoard(ServiceDate, "participant", CancellationToken.None);

        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var row = Assert.Single(board.ParticipantRows!, r => r.ParticipantId == participant.Id);

        // 2 of the 7 days (Mon, Tue) are covered by a shift -> 5 days without cover.
        Assert.Equal(5, row.DaysWithoutCover);
    }

    [Fact]
    public async Task GetBoard_ParticipantMode_TripCoversTheWeek_ProducesTripBarAndReducesDaysWithoutCover()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, "Amy", "Ng");

        // Wed-Fri of the ServiceDate week (Mon 2026-08-24): 3 days, no shifts at all.
        var trip = new TripInstance
        {
            Id = Guid.NewGuid(), TripName = "Beach Trip", StartDate = ServiceDate.AddDays(2), DurationDays = 3
        };
        db.TripInstances.Add(trip);
        db.ParticipantBookings.Add(new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id,
            BookingStatus = BookingStatus.Confirmed, BookingDate = ServiceDate
        });
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));
        var result = await controller.GetBoard(ServiceDate, "participant", CancellationToken.None);

        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var row = Assert.Single(board.ParticipantRows!, r => r.ParticipantId == participant.Id);

        var tripBar = Assert.Single(row.TripBars);
        Assert.Equal(trip.Id, tripBar.TripInstanceId);
        Assert.Empty(row.Shifts);

        // 3 trip days out of 7 are covered -> only the remaining 4 count as without cover.
        Assert.Equal(4, row.DaysWithoutCover);
    }

    [Fact]
    public async Task GetBoard_UnrecognisedGroupBy_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        var result = await controller.GetBoard(ServiceDate, "bogus", CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(badRequest.Value);
        Assert.False(body.Success);
    }

    // ── 422 envelope actually serialises the way the frontend expects ─────

    [Fact]
    public async Task CreateShift_BlockingFinding_SerialisedEnvelope_HasSuccessMessageAndFindingsArray()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db, workerScreeningValid: false, expiredScreeningDate: new DateOnly(2020, 1, 1)); // genuinely expired -> WSC_EXPIRED, Blocking
        var participant = SeedParticipant(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        var dto = CleanCreateDto(participant.Id, staff.Id, overrideReason: "I really need this covered today");

        var result = await controller.CreateShift(dto, CancellationToken.None);
        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);

        // Serialise with the SAME options the API actually applies to controller output
        // (see ApiJsonOptions), then read the JSON back — proving what actually goes over
        // the wire, not just what the C# object graph looks like.
        var json = JsonSerializer.Serialize(unprocessable.Value, ApiJsonOptions);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.False(root.GetProperty("success").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("message").GetString()));

        var data = root.GetProperty("data");
        Assert.Equal(JsonValueKind.Array, data.ValueKind);
        Assert.True(data.GetArrayLength() > 0);

        var firstFinding = data[0];
        Assert.Equal(RosterConflictService.WscExpired, firstFinding.GetProperty("code").GetString());

        // The property the API actually contract this against — must be the STRING
        // "Blocking", not the underlying enum's numeric value, since the frontend types
        // severity as the string literal "Blocking" | "Warning".
        var severity = firstFinding.GetProperty("severity");
        Assert.Equal(JsonValueKind.String, severity.ValueKind);
        Assert.Equal("Blocking", severity.GetString());
    }

    // ── ShiftDto enum-typed properties serialise as strings ────────────────

    [Fact]
    public void ShiftDto_EnumTypedProperties_SerialiseAsStrings()
    {
        var shift = new ShiftDto
        {
            Id = Guid.NewGuid(), ParticipantId = Guid.NewGuid(), ParticipantName = "Amy Ng",
            StaffId = Guid.NewGuid(), StaffName = "Ben Turner",
            ServiceDate = ServiceDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
            DurationHours = 8m, Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };

        var json = JsonSerializer.Serialize(shift, ApiJsonOptions);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal(JsonValueKind.String, root.GetProperty("status").ValueKind);
        Assert.Equal(nameof(ShiftStatus.Draft), root.GetProperty("status").GetString());

        Assert.Equal(JsonValueKind.String, root.GetProperty("ratio").ValueKind);
        Assert.Equal(nameof(SupportRatio.OneToOne), root.GetProperty("ratio").GetString());

        Assert.Equal(JsonValueKind.String, root.GetProperty("nightType").ValueKind);
        Assert.Equal(nameof(SleepoverType.None), root.GetProperty("nightType").GetString());
    }

    // ── Authorisation posture ───────────────────────────────────────────────

    [Fact]
    public void RosteringController_AuthorizeAttribute_RestrictsToCoordinatorAndAbove()
    {
        // No authorization-test-host idiom exists elsewhere in Odip.Tests (checked:
        // Billing/AdminUsers/FieldRegistry controller tests carry no such pattern), so this
        // asserts the attribute's declared Roles directly via reflection rather than
        // inventing a new test-host/authentication-driven idiom for just this one check.
        var authorizeAttribute = typeof(RosteringController)
            .GetCustomAttribute<AuthorizeAttribute>();

        Assert.NotNull(authorizeAttribute);
        var roles = authorizeAttribute!.Roles?.Split(',', StringSplitOptions.TrimEntries) ?? Array.Empty<string>();

        Assert.Contains("SuperAdmin", roles);
        Assert.Contains("Admin", roles);
        Assert.Contains("Coordinator", roles);

        // The defect this closes: a bare [Authorize] (no Roles) let a SupportWorker principal
        // through to every action, including writes. A SupportWorker must NOT be a member of
        // the roster-authorised set.
        Assert.DoesNotContain("SupportWorker", roles);
    }

    // ── Task 6d: compatibility matrix -> participant preferred-staff linkage ──

    [Fact]
    public async Task UpsertCompatibility_MarkPreferred_EmptyParticipantPreferredStaffId_IsPopulated()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        var result = await controller.UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Preferred },
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var reloaded = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.Equal(staff.Id, reloaded.PreferredUserId);
    }

    [Fact]
    public async Task UpsertCompatibility_MarkPreferred_ParticipantAlreadyHasADifferentPreferredStaff_IsNotOverwritten()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var existingPreferred = SeedStaff(db, firstName: "Existing", lastName: "Preferred");
        var newlyMarked = SeedStaff(db, firstName: "Newly", lastName: "Marked");
        var participant = SeedParticipant(db);
        participant.PreferredUserId = existingPreferred.Id;
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        var result = await controller.UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = newlyMarked.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Preferred },
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var reloaded = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.Equal(existingPreferred.Id, reloaded.PreferredUserId);
    }

    [Fact]
    public async Task UpsertCompatibility_MoveMatchingPairOffPreferred_ClearsParticipantsPreferredStaffId()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        participant.PreferredUserId = staff.Id;
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), UserId = staff.Id, ParticipantId = participant.Id,
            Level = CompatibilityLevel.Preferred, AutoLinked = false, UpdatedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        var result = await controller.UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Excluded, Reason = "New concern" },
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var reloaded = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.Null(reloaded.PreferredUserId);
    }

    [Fact]
    public async Task UpsertCompatibility_AlwaysStampsAutoLinkedFalse_TakingOwnershipFromTheParticipantLink()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        // Simulate a row the participant-preferred-staff auto-link created.
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), UserId = staff.Id, ParticipantId = participant.Id,
            Level = CompatibilityLevel.Preferred, AutoLinked = true, UpdatedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));

        // A human edits the same cell via the matrix endpoint.
        await controller.UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Preferred, Reason = "Confirmed by coordinator" },
            CancellationToken.None);

        var row = await db.StaffParticipantCompatibilities.SingleAsync(c => c.UserId == staff.Id && c.ParticipantId == participant.Id);
        Assert.False(row.AutoLinked);
        Assert.Equal("Confirmed by coordinator", row.Reason);
    }
}
