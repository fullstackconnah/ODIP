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

    private static Staff SeedStaff(OdipDbContext db, bool workerScreeningValid = true, string firstName = "Ben", string lastName = "Turner")
    {
        var staff = new Staff
        {
            Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, Role = StaffRole.SupportWorker, IsActive = true,
            WorkerScreeningNumber = workerScreeningValid ? "WSC-1" : null,
            WorkerScreeningExpiryDate = workerScreeningValid ? new DateOnly(2030, 1, 1) : (DateOnly?)null
        };
        db.Staff.Add(staff);
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

    // ── Blocking finding gate ────────────────────────────────────────────

    [Fact]
    public async Task CreateShift_BlockingFinding_RejectedEvenWithOverrideReason()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db, workerScreeningValid: false); // no worker screening on file -> WSC_EXPIRED, Blocking
        var participant = SeedParticipant(db);
        var controller = new RosteringController(db);

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
            Id = Guid.NewGuid(), StaffId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Excluded
        });
        db.SaveChanges();

        var controller = new RosteringController(db);
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
            Id = Guid.NewGuid(), StaffId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Excluded
        });
        db.SaveChanges();

        var controller = new RosteringController(db);
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
        var controller = new RosteringController(db);

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

        var controller = new RosteringController(db);
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
    public async Task GetBoard_SeparatesUnfilledShiftsFromStaffRows()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var filledParticipant = SeedParticipant(db, "Amy", "Ng");
        var unfilledParticipant = SeedParticipant(db, "Cam", "Diaz");

        var filledShift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = filledParticipant.Id, StaffId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };
        var unfilledShift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = unfilledParticipant.Id, StaffId = null, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(13, 0), EndTime = new TimeOnly(15, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };
        db.Shifts.AddRange(filledShift, unfilledShift);
        db.SaveChanges();

        var controller = new RosteringController(db);

        var result = await controller.GetBoard(ServiceDate, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        Assert.True(body.Success);
        var board = body.Data!;

        var unfilledDto = Assert.Single(board.Unfilled);
        Assert.Equal(unfilledShift.Id, unfilledDto.Id);

        var staffRow = Assert.Single(board.Rows, r => r.StaffId == staff.Id);
        var rowShift = Assert.Single(staffRow.Shifts);
        Assert.Equal(filledShift.Id, rowShift.Id);
        Assert.DoesNotContain(staffRow.Shifts, s => s.Id == unfilledShift.Id);
    }

    // ── 422 envelope actually serialises the way the frontend expects ─────

    [Fact]
    public async Task CreateShift_BlockingFinding_SerialisedEnvelope_HasSuccessMessageAndFindingsArray()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db, workerScreeningValid: false); // no worker screening on file -> WSC_EXPIRED, Blocking
        var participant = SeedParticipant(db);
        var controller = new RosteringController(db);

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
}
