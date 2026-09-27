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
using Odip.Infrastructure.Rostering;
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

    private static Participant SeedParticipant(OdipDbContext db, string firstName = "Amy", string lastName = "Ng", bool ready = true)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true, IntakeCompletedAt = ready ? DateTime.UtcNow : null };
        db.Participants.Add(participant);
        if (ready)
        {
            var onboarding = new ParticipantOnboarding { Id = Guid.NewGuid(), ParticipantId = participant.Id, TenantId = participant.TenantId, ProfileComplete = true, ProfileCompletedAt = DateTime.UtcNow, ServiceTypeConfirmed = true, ServiceTypeConfirmedAt = DateTime.UtcNow };
            var draft = new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, Version = 1, State = "Approved", ParticipantNameSnapshot = participant.FullName, PlanStartDate = new(2026, 1, 1), PlanEndDate = new(2026, 12, 31), AgreementStartDate = new(2026, 1, 1), AgreementEndDate = new(2026, 12, 31) };
            var snapshot = new ElectronicSigningSnapshot { Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, DraftId = draft.Id, DraftVersion = 1, DocumentJson = "{\"immutable\":true}", DocumentHash = new string('a', 64) };
            var evidence = new ElectronicSigningEvidence { Id = Guid.NewGuid(), TenantId = participant.TenantId, SnapshotId = snapshot.Id, IdempotencyKey = Guid.NewGuid().ToString(), SignerName = "Fixture", SignerCapacity = "Representative", IsAuthorisedRepresentative = true, ConsentToElectronicMethod = true, IntendsToSign = true, DocumentWasDisplayed = true, EvidenceHash = new string('b', 64), PreviousEvidenceHash = "GENESIS", Status = "Verified" };
            db.AddRange(onboarding, draft, snapshot, evidence);
        }
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

    private static LeaveRequest SeedLeave(OdipDbContext db, Guid userId, LeaveStatus status, DateOnly? start = null, DateOnly? end = null)
    {
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = userId, LeaveType = LeaveType.Annual,
            StartDate = start ?? ServiceDate, EndDate = end ?? ServiceDate, Status = status,
            RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        db.SaveChanges();
        return leave;
    }

    // ── INTAKE-08: draft participants are excluded from every roster surface ────────────

    [Fact]
    public async Task CreateShift_DraftParticipant_ReturnsBadRequest_ParticipantNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.Add(draft);
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var dto = CleanCreateDto(draft.Id, staff.Id);

        var result = await controller.CreateShift(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(badRequest.Value);
        Assert.Contains("not ready", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Shifts.ToListAsync());
    }

    [Theory]
    [InlineData("profile")]
    [InlineData("service-type")]
    [InlineData("agreement")]
    public async Task CreateShift_IncompleteOnboarding_ReturnsBadRequest(string missing)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var onboarding = await db.ParticipantOnboardings.SingleAsync();
        if (missing == "profile") onboarding.ProfileComplete = false;
        if (missing == "service-type") onboarding.ServiceTypeConfirmed = false;
        if (missing == "agreement") (await db.ElectronicSigningEvidence.SingleAsync()).Status = "PendingVerification";
        await db.SaveChangesAsync();

        var result = await new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
            .CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Contains("not ready", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task GetBoard_KeepsLegacyShiftVisibleAndFlagsParticipant_WhenReadinessIsLost()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.Shifts.Add(new Shift { Id = Guid.NewGuid(), ParticipantId = participant.Id, ServiceDate = ServiceDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None });
        var onboarding = await db.ParticipantOnboardings.SingleAsync();
        onboarding.ProfileComplete = false;
        await db.SaveChangesAsync();

        var result = await new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db)).GetBoard(ServiceDate, "participant", CancellationToken.None);

        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var row = Assert.Single(board.ParticipantRows!, row => row.ParticipantId == participant.Id);
        var shift = Assert.Single(row.Shifts);
        Assert.Contains(board.Exceptions!, exception => exception.ShiftId == shift.Id
            && exception.Finding.Code == "PARTICIPANT_NOT_READY");

        // Read-only history remains accessible and a status-only cancellation must not be
        // mistaken for a new assignment after the participant's readiness is lost.
        var participantRostering = await new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
            .GetParticipantRostering(participant.Id, CancellationToken.None);
        Assert.IsType<OkObjectResult>(participantRostering.Result);

        var statusOnlyUpdate = new UpdateShiftDto
        {
            ParticipantId = participant.Id, StaffId = null, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Cancelled,
        };
        var update = await new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
            .UpdateShift(shift.Id, statusOnlyUpdate, CancellationToken.None);
        Assert.IsType<OkObjectResult>(update.Result);
    }

    [Fact]
    public async Task GetBoard_ParticipantMode_ExcludesDraftParticipants()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var activeParticipant = SeedParticipant(db, "Amy", "Ng");
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.Add(draft);
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
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
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

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

    // NOTE: this fixture was originally CompatibilityLevel.Excluded (COMPATIBILITY_EXCLUDED), which
    // was a valid "Warning without a reason -> 422" example under the OLD "any Warning present"
    // gate. Task 5 changes EvaluateFindings to gate on RosterFinding.RequiresReason instead — and
    // CompatibilityExcluded (RosterConflictService.CheckCompatibility) never sets RequiresReason,
    // so it no longer blocks without a reason. Approved leave (STAFF_ON_LEAVE) is the fixture that
    // actually exercises the RequiresReason=true path this test is meant to cover.
    [Fact]
    public async Task CreateShift_WarningFindingsWithoutOverrideReason_Rejected422()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        SeedLeave(db, staff.Id, LeaveStatus.Approved);

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var dto = CleanCreateDto(participant.Id, staff.Id); // no overrideReason

        var result = await controller.CreateShift(dto, CancellationToken.None);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(unprocessable.Value);
        Assert.False(body.Success);
        Assert.Contains(body.Data!, f => f.Code == RosterConflictService.StaffOnLeave && f.Severity == RosterFindingSeverity.Warning && f.RequiresReason);

        Assert.Empty(await db.Shifts.ToListAsync());
    }

    /// <summary>
    /// Spec §3 / RosterGate.ComputeOverride: a reason typed against a finding that does not
    /// RequiresReason (COMPATIBILITY_EXCLUDED is a plain Warning) is discarded rather than
    /// persisted — only the code is still recorded in AcknowledgedFindingCodes. Was
    /// CreateShift_NonRequiredWarningWithOverrideReason_PersistsReasonAndCodes before the B1
    /// ComputeOverride ruling; updated to the new rule rather than the old one it exercised.
    /// </summary>
    [Fact]
    public async Task CreateShift_NonRequiredWarningWithOverrideReason_ReasonDiscarded_CodeStillRecorded()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), UserId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Excluded
        });
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var dto = CleanCreateDto(participant.Id, staff.Id,
            overrideReason: "Coordinator approved despite the exclusion flag",
            codes: new List<string> { RosterConflictService.CompatibilityExcluded });

        var result = await controller.CreateShift(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Null(body.Data!.OverrideReason);
        Assert.Contains(body.Data.Findings, f => f.Code == RosterConflictService.CompatibilityExcluded);

        var saved = await db.Shifts.SingleAsync();
        Assert.Null(saved.OverrideReason);
        Assert.Equal(RosterConflictService.CompatibilityExcluded, saved.AcknowledgedFindingCodes);
    }

    // ── Clean create ─────────────────────────────────────────────────────

    [Fact]
    public async Task CreateShift_PreExistingVerifiedEvidenceFromUnapprovedSource_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var dto = CleanCreateDto(participant.Id, staff.Id);

        var result = await controller.CreateShift(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(badRequest.Value);
        Assert.Contains("not ready", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Shifts.ToListAsync());
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

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
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

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

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

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

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
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

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
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

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

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
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

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
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

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
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
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

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
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

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
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

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
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

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
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

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
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        // A human edits the same cell via the matrix endpoint.
        await controller.UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Preferred, Reason = "Confirmed by coordinator" },
            CancellationToken.None);

        var row = await db.StaffParticipantCompatibilities.SingleAsync(c => c.UserId == staff.Id && c.ParticipantId == participant.Id);
        Assert.False(row.AutoLinked);
        Assert.Equal("Confirmed by coordinator", row.Reason);
    }

    // ══════════════════════════════════════════════════════════════
    // SHIFT NOTES (NOTES-01) — read-only coordinator surface
    // ══════════════════════════════════════════════════════════════

    [Fact]
    public async Task GetShiftNotes_ReturnsNotesNewestFirst()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        };
        db.Shifts.Add(shift);
        db.ShiftNotes.AddRange(
            new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Older note", CreatedAt = DateTime.UtcNow.AddHours(-2) },
            new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Newer note", CreatedAt = DateTime.UtcNow.AddHours(-1) });
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetShiftNotes(shift.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<ShiftNoteDto>>>(ok.Value);
        Assert.Equal(2, body.Data!.Count);
        Assert.Equal("Newer note", body.Data[0].Body);
    }

    [Fact]
    public async Task GetShiftNotes_NonexistentShift_Returns404NotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetShiftNotes(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    /// <summary>Connection-map reverse link (Deliverable 2): an active IncidentReport whose ShiftNoteId points at <paramref name="shiftNoteId"/>.</summary>
    private static IncidentReport SeedIncidentForShiftNote(OdipDbContext db, Guid shiftNoteId, bool isActive = true, DateTime? createdAt = null)
    {
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), ShiftNoteId = shiftNoteId, ReportedByUserId = Guid.NewGuid(),
            Title = "Reported from a shift note", Description = "Auto-generated for test.", IncidentDateTime = DateTime.UtcNow,
            Severity = IncidentSeverity.Low, Status = IncidentStatus.Draft, IsActive = isActive,
            CreatedAt = createdAt ?? DateTime.UtcNow,
        };
        db.IncidentReports.Add(incident);
        db.SaveChanges();
        return incident;
    }

    [Fact]
    public async Task GetShiftNotes_IncidentId_PopulatedWhenActiveIncidentReferencesNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        };
        db.Shifts.Add(shift);
        var referencedNote = new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Fell during transfer.", FlaggedCategories = ShiftNoteFlagCategory.Falls };
        var unreferencedNote = new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Uneventful shift." };
        db.ShiftNotes.AddRange(referencedNote, unreferencedNote);
        db.SaveChanges();
        var incident = SeedIncidentForShiftNote(db, referencedNote.Id);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetShiftNotes(shift.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ShiftNoteDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(incident.Id, body.Data!.Single(n => n.Id == referencedNote.Id).IncidentId);
        Assert.Null(body.Data.Single(n => n.Id == unreferencedNote.Id).IncidentId);
    }

    // ══════════════════════════════════════════════════════════════
    // FLAGGED SHIFT NOTES (connection-map Deliverable 3) — GetFlaggedShiftNotes
    // ══════════════════════════════════════════════════════════════

    private static Shift SeedFlaggedNotesShift(OdipDbContext db, Guid participantId, Guid? staffId, DateOnly serviceDate) => new()
    {
        Id = Guid.NewGuid(), ParticipantId = participantId, UserId = staffId, ServiceDate = serviceDate,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Published,
    };

    [Fact]
    public async Task GetFlaggedShiftNotes_OnlyReturnsNotesWithFlaggedCategories()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedFlaggedNotesShift(db, participant.Id, staff.Id, ServiceDate);
        db.Shifts.Add(shift);
        var flagged = new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Participant fell in the bathroom.", FlaggedCategories = ShiftNoteFlagCategory.Falls };
        var unflagged = new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Quiet shift, nothing to report." };
        db.ShiftNotes.AddRange(flagged, unflagged);
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetFlaggedShiftNotes(null, null, null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<FlaggedShiftNoteDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var item = Assert.Single(body.Data!);
        Assert.Equal(flagged.Id, item.ShiftNoteId);
        Assert.Equal(new[] { "Falls" }, item.FlaggedCategories);
    }

    [Fact]
    public async Task GetFlaggedShiftNotes_ReturnsTheThreeNewShiftTimeFields()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedFlaggedNotesShift(db, participant.Id, staff.Id, ServiceDate);
        shift.StartTime = new TimeOnly(22, 0);
        shift.EndTime = new TimeOnly(6, 0);
        shift.EndsNextDay = true;
        db.Shifts.Add(shift);
        db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Bruising noted on arrival.", FlaggedCategories = ShiftNoteFlagCategory.Injury });
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetFlaggedShiftNotes(null, null, null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<FlaggedShiftNoteDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var item = Assert.Single(body.Data!);
        Assert.Equal(shift.Id, item.ShiftId);
        Assert.Equal(new TimeOnly(22, 0), item.StartTime);
        Assert.Equal(new TimeOnly(6, 0), item.EndTime);
        Assert.True(item.EndsNextDay);
        Assert.Equal(participant.Id, item.ParticipantId);
        Assert.Equal(staff.Id, item.StaffId);
    }

    [Fact]
    public async Task GetFlaggedShiftNotes_WithoutIncidentTrue_ExcludesNotesWithAnActiveIncident()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedFlaggedNotesShift(db, participant.Id, staff.Id, ServiceDate);
        db.Shifts.Add(shift);
        var withIncident = new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Fell near the kitchen.", FlaggedCategories = ShiftNoteFlagCategory.Falls };
        var withoutIncident = new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Medication refused.", FlaggedCategories = ShiftNoteFlagCategory.Medication };
        db.ShiftNotes.AddRange(withIncident, withoutIncident);
        db.SaveChanges();
        SeedIncidentForShiftNote(db, withIncident.Id);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var withFilter = await controller.GetFlaggedShiftNotes(true, null, null, CancellationToken.None);
        var filteredBody = Assert.IsType<ApiResponse<List<FlaggedShiftNoteDto>>>(Assert.IsType<OkObjectResult>(withFilter.Result).Value);
        var filteredItem = Assert.Single(filteredBody.Data!);
        Assert.Equal(withoutIncident.Id, filteredItem.ShiftNoteId);

        var withoutFilter = await controller.GetFlaggedShiftNotes(null, null, null, CancellationToken.None);
        var unfilteredBody = Assert.IsType<ApiResponse<List<FlaggedShiftNoteDto>>>(Assert.IsType<OkObjectResult>(withoutFilter.Result).Value);
        Assert.Equal(2, unfilteredBody.Data!.Count);
    }

    [Fact]
    public async Task GetFlaggedShiftNotes_FromToFilters_ScopeByShiftServiceDate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var inRangeShift = SeedFlaggedNotesShift(db, participant.Id, staff.Id, ServiceDate);
        var outOfRangeShift = SeedFlaggedNotesShift(db, participant.Id, staff.Id, ServiceDate.AddDays(30));
        db.Shifts.AddRange(inRangeShift, outOfRangeShift);
        var inRangeNote = new ShiftNote { Id = Guid.NewGuid(), ShiftId = inRangeShift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Injury noted.", FlaggedCategories = ShiftNoteFlagCategory.Injury };
        var outOfRangeNote = new ShiftNote { Id = Guid.NewGuid(), ShiftId = outOfRangeShift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Agitated behaviour.", FlaggedCategories = ShiftNoteFlagCategory.BehaviourOfConcern };
        db.ShiftNotes.AddRange(inRangeNote, outOfRangeNote);
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetFlaggedShiftNotes(null, ServiceDate.AddDays(-1), ServiceDate.AddDays(1), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<FlaggedShiftNoteDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var item = Assert.Single(body.Data!);
        Assert.Equal(inRangeNote.Id, item.ShiftNoteId);
    }

    [Fact]
    public async Task GetFlaggedShiftNotes_OrdersByCreatedAtAscending()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedFlaggedNotesShift(db, participant.Id, staff.Id, ServiceDate);
        db.Shifts.Add(shift);
        var newer = new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Fell again.", FlaggedCategories = ShiftNoteFlagCategory.Falls, CreatedAt = DateTime.UtcNow.AddHours(-1) };
        var older = new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Bruised elbow.", FlaggedCategories = ShiftNoteFlagCategory.Injury, CreatedAt = DateTime.UtcNow.AddHours(-2) };
        db.ShiftNotes.AddRange(newer, older);
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetFlaggedShiftNotes(null, null, null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<FlaggedShiftNoteDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new[] { older.Id, newer.Id }, body.Data!.Select(n => n.ShiftNoteId).ToArray());
    }

    [Fact]
    public async Task GetFlaggedShiftNotes_OtherTenantsFlaggedNote_IsExcluded()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;

        // Seed tenant B's flagged note under a real (non-super-admin) tenant context so
        // SaveChangesAsync auto-stamps TenantId on every ITenantEntity row — same idiom as
        // RosteringCompletionReviewTests.GetShiftCompletions_OtherTenant_Returns404.
        var tenantBContext = new Mock<ICurrentTenant>();
        tenantBContext.Setup(t => t.TenantId).Returns(tenantB);
        tenantBContext.Setup(t => t.IsSuperAdmin).Returns(false);
        using (var seedDb = new OdipDbContext(options, tenantBContext.Object))
        {
            var staff = SeedStaff(seedDb);
            var participant = SeedParticipant(seedDb);
            var shift = SeedFlaggedNotesShift(seedDb, participant.Id, staff.Id, ServiceDate);
            seedDb.Shifts.Add(shift);
            seedDb.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = staff.Id, AuthorName = staff.FullName, Body = "Fell in tenant B.", FlaggedCategories = ShiftNoteFlagCategory.Falls });
            seedDb.SaveChanges();
        }

        // Query as tenant A — the ambient ShiftNote/Shift query filters must hide tenant B's row.
        var tenantAContext = new Mock<ICurrentTenant>();
        tenantAContext.Setup(t => t.TenantId).Returns(tenantA);
        tenantAContext.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(options, tenantAContext.Object);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetFlaggedShiftNotes(null, null, null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<FlaggedShiftNoteDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Empty(body.Data!);
    }

    // ══════════════════════════════════════════════════════════════
    // STAFF LEAVE / RECURRING UNAVAILABILITY (Task 5) — IStaffUnavailabilityQuery wiring
    // ══════════════════════════════════════════════════════════════

    [Fact]
    public async Task CreateShift_AgainstApprovedLeave_RequiresAnOverrideReason()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        SeedLeave(db, staff.Id, LeaveStatus.Approved);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var withoutReason = await controller.CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);
        Assert.IsType<UnprocessableEntityObjectResult>(withoutReason.Result);

        var withReason = await controller.CreateShift(
            CleanCreateDto(participant.Id, staff.Id, overrideReason: "Covering an urgent gap; staff member agreed to work despite approved leave."),
            CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(withReason.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
        Assert.Contains(body.Data!.Findings, f => f.Code == RosterConflictService.StaffOnLeave);
    }

    [Fact]
    public async Task CreateShift_AgainstPendingLeave_SavesWithNoReason()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        SeedLeave(db, staff.Id, LeaveStatus.Pending);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
        Assert.Contains(body.Data!.Findings, f => f.Code == "STAFF_LEAVE_PENDING");
    }

    [Fact]
    public async Task CreateShift_WithOnlyReasonNotRequiredFindings_StillRecordsAcknowledgedFindingCodes()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        SeedLeave(db, staff.Id, LeaveStatus.Pending);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var shift = await db.Shifts.SingleAsync();
        Assert.Contains("STAFF_LEAVE_PENDING", shift.AcknowledgedFindingCodes);
        Assert.Null(shift.OverrideReason);
    }

    [Fact]
    public async Task GetBoard_StaffMode_LeaveBarReflectsApprovedLeaveKind()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        SeedLeave(db, staff.Id, LeaveStatus.Approved);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var row = body.Data!.StaffRows!.Single(r => r.StaffId == staff.Id);
        var bar = Assert.Single(row.Leave);
        Assert.Equal(UnavailabilityKind.ApprovedLeave, bar.Kind);
        // AvailabilityType is only filled for Legacy rows (A4) — the frontend labels this bar from Kind.
        Assert.Null(bar.AvailabilityType);
    }

    // Regression for Fix round 1: UnavailabilityWindow.End is EXCLUSIVE
    // (StaffUnavailabilityQuery builds whole-day leave as [StartDate 00:00, EndDate+1 00:00)),
    // so a naive DateOnly.FromDateTime(w.End) renders a 3-day leave span as spanning 4 days.
    [Fact]
    public async Task GetBoard_StaffMode_MultiDayLeaveBar_EndDateIsLastCoveredDayNotOneDayPast()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var leaveStart = ServiceDate.AddDays(1); // Tue
        var leaveEnd = ServiceDate.AddDays(3);   // Thu (inclusive) — 3-day span within the board week
        SeedLeave(db, staff.Id, LeaveStatus.Approved, leaveStart, leaveEnd);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var row = body.Data!.StaffRows!.Single(r => r.StaffId == staff.Id);
        var bar = Assert.Single(row.Leave);
        Assert.Equal(UnavailabilityKind.ApprovedLeave, bar.Kind);
        // AvailabilityType is only filled for Legacy rows (A4) — the frontend labels this bar from Kind.
        Assert.Null(bar.AvailabilityType);
        Assert.Equal(leaveStart, bar.StartDate);
        Assert.Equal(leaveEnd, bar.EndDate);
    }

    /// <summary>
    /// Regression guard for the deploy failure: en-AU (the dev machine's culture) abbreviates
    /// September as "Sept", while the container's invariant globalization renders "Sep" — see
    /// TemplateRenderingTests' equivalent for the notification templates. ComputeCompliance's
    /// "expired {date:d MMM yyyy}" notes must render invariantly regardless of the host's
    /// current culture.
    /// </summary>
    [Fact]
    public async Task GetBoard_StaffMode_ComplianceNote_RendersInvariantDate_RegardlessOfCurrentCulture()
    {
        var originalCulture = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("en-AU");

            using var db = CreateDb(Guid.NewGuid().ToString());
            var staff = SeedStaff(db);
            staff.IsFirstAidQualified = true;
            staff.FirstAidExpiryDate = new DateOnly(2025, 9, 20); // before ServiceDate (2026-08-24)
            await db.SaveChangesAsync();
            var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

            var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
            var row = body.Data!.StaffRows!.Single(r => r.StaffId == staff.Id);
            Assert.Contains(row.ComplianceNotes, n => n.Contains("20 Sep 2025"));
            Assert.DoesNotContain(row.ComplianceNotes, n => n.Contains("Sept"));
        }
        finally
        {
            System.Globalization.CultureInfo.CurrentCulture = originalCulture;
        }
    }

    [Fact]
    public async Task GetBoard_StaffMode_LeaveBarPopulatesKindSpecificFields()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var legacyStaff = SeedStaff(db, firstName: "Cara");
        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = legacyStaff.Id, AvailabilityType = AvailabilityType.Training,
            Notes = "First aid refresher", StartDateTime = ServiceDate.ToDateTime(new TimeOnly(9, 0)),
            EndDateTime = ServiceDate.ToDateTime(new TimeOnly(12, 0)),
        });
        var recurringStaff = SeedStaff(db, firstName: "Dev", lastName: "Patel");
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = recurringStaff.Id, DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = ServiceDate,
            Status = LeaveStatus.Approved, RequestedByUserId = recurringStaff.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);

        var legacyBar = Assert.Single(body.Data!.StaffRows!.Single(r => r.StaffId == legacyStaff.Id).Leave);
        Assert.Equal(UnavailabilityKind.Legacy, legacyBar.Kind);
        Assert.Equal(AvailabilityType.Training, legacyBar.AvailabilityType);
        Assert.Equal("First aid refresher", legacyBar.Notes);
        Assert.Null(legacyBar.StartTime);

        var recurringBar = Assert.Single(body.Data!.StaffRows!.Single(r => r.StaffId == recurringStaff.Id).Leave);
        Assert.Equal(UnavailabilityKind.RecurringRule, recurringBar.Kind);
        Assert.Equal(new TimeOnly(9, 0), recurringBar.StartTime);
        Assert.Equal(new TimeOnly(12, 0), recurringBar.EndTime);
        // AvailabilityType is only filled for Legacy rows (A4) — Kind is the real discriminator.
        Assert.Null(recurringBar.AvailabilityType);
    }

    // 2026-09-09 audit ruling: a Pending recurring rule must be visible on the board exactly like
    // an Approved one — including its time-of-day window, so LeaveBar can draw the same
    // partial-day bar (with pending styling).
    [Fact]
    public async Task GetBoard_StaffMode_PendingRecurringRuleBarPopulatesTimeWindow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, DayOfWeek = ServiceDate.DayOfWeek,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = ServiceDate,
            Status = LeaveStatus.Pending, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var bar = Assert.Single(body.Data!.StaffRows!.Single(r => r.StaffId == staff.Id).Leave);
        Assert.Equal(UnavailabilityKind.PendingRecurringRule, bar.Kind);
        Assert.Equal(new TimeOnly(9, 0), bar.StartTime);
        Assert.Equal(new TimeOnly(12, 0), bar.EndTime);
        Assert.Null(bar.AvailabilityType);
    }

    // ── AssigneeOnApprovedLeave (connection map item 5): reuses the same weekWindows load as
    // the Leave bars above — no per-shift query. ────────────────────────────────────────

    [Fact]
    public async Task GetBoard_ShiftDto_AssigneeOnApprovedLeave_TrueWhenStaffHasApprovedLeaveCoveringTheShift()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        SeedLeave(db, staff.Id, LeaveStatus.Approved);
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var dto = body.Data!.StaffRows!.Single(r => r.StaffId == staff.Id).Shifts.Single(s => s.Id == shift.Id);
        Assert.True(dto.AssigneeOnApprovedLeave);

        var exception = Assert.Single(body.Data!.Exceptions, e => e.Finding.Code == "ASSIGNEE_ON_LEAVE");
        Assert.Equal(shift.Id, exception.ShiftId);
        Assert.Equal(RosterFindingSeverity.Warning, exception.Finding.Severity);
        Assert.False(exception.Finding.RequiresReason);
        Assert.Equal($"{staff.FullName} is on approved leave on {ServiceDate:d MMM yyyy}", exception.Finding.Message);
    }

    [Fact]
    public async Task GetBoard_ShiftDto_AssigneeOnApprovedLeave_FalseWithNoLeave()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var dto = body.Data!.StaffRows!.Single(r => r.StaffId == staff.Id).Shifts.Single(s => s.Id == shift.Id);
        Assert.False(dto.AssigneeOnApprovedLeave);
        Assert.DoesNotContain(body.Data!.Exceptions, e => e.Finding.Code == "ASSIGNEE_ON_LEAVE");
    }

    [Fact]
    public async Task GetBoard_ShiftDto_AssigneeOnApprovedLeave_FalseWhenLeaveOnlyPending()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        SeedLeave(db, staff.Id, LeaveStatus.Pending);
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var dto = body.Data!.StaffRows!.Single(r => r.StaffId == staff.Id).Shifts.Single(s => s.Id == shift.Id);
        Assert.False(dto.AssigneeOnApprovedLeave);
        Assert.DoesNotContain(body.Data!.Exceptions, e => e.Finding.Code == "ASSIGNEE_ON_LEAVE");
    }

    [Fact]
    public async Task GetBoard_ShiftDto_AssigneeOnApprovedLeave_TrueForApprovedRecurringRuleOccurrence()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, DayOfWeek = ServiceDate.DayOfWeek,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = ServiceDate,
            Status = LeaveStatus.Approved, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Draft
        };
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var dto = body.Data!.StaffRows!.Single(r => r.StaffId == staff.Id).Shifts.Single(s => s.Id == shift.Id);
        Assert.True(dto.AssigneeOnApprovedLeave);
        Assert.Contains(body.Data!.Exceptions, e => e.Finding.Code == "ASSIGNEE_ON_LEAVE" && e.ShiftId == shift.Id);
    }

    // ── PUBLIC_HOLIDAY (connection-map item 8) ────────────────

    [Fact]
    public async Task CheckShift_ServiceDateIsSeededPublicHoliday_ReturnsPublicHolidayFinding()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = ServiceDate, Name = "Test Holiday", State = null });
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var dto = new CheckShiftDto
        {
            ParticipantId = participant.Id, StaffId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        };

        var result = await controller.CheckShift(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(ok.Value);
        var finding = Assert.Single(body.Data!, f => f.Code == RosterConflictService.PublicHoliday);
        Assert.False(finding.RequiresReason);
        Assert.Contains("Test Holiday", finding.Message);
    }

    [Fact]
    public async Task CheckShift_NoPublicHolidaySeeded_DoesNotReturnPublicHolidayFinding()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var dto = new CheckShiftDto
        {
            ParticipantId = participant.Id, StaffId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        };

        var result = await controller.CheckShift(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(ok.Value);
        Assert.DoesNotContain(body.Data!, f => f.Code == RosterConflictService.PublicHoliday);
    }

    [Fact]
    public async Task GetBoard_ShiftOnSeededPublicHoliday_IncludedInExceptions()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id,
            ServiceDate = ServiceDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            EndsNextDay = false, Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        });
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = ServiceDate, Name = "Test Holiday", State = null });
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        Assert.Contains(body.Data!.Exceptions, f => f.Finding.Code == RosterConflictService.PublicHoliday);
    }

    // StaffAssignmentsController's Check never fires PUBLIC_HOLIDAY even when a holiday sits
    // inside the assignment window — see StaffAssignmentGateTests / RosterConflictServiceTests
    // for the trip-assignment-side coverage (RosterConflictService.CheckStaffAssignment never
    // calls CheckPublicHoliday; VehiclesStaffController.StaffAssignmentsController still loads
    // PublicHolidays for context-shape consistency but nothing consumes it there).

    // ══════════════════════════════════════════════════════════════
    // NOTIFICATIONS — NotificationEventType.ShiftAssigned trigger
    // docs/specs/2026-09-08-notifications-design.md §5
    // ══════════════════════════════════════════════════════════════

    [Fact]
    public async Task AssignShift_SettingStaff_RaisesShiftAssignedForTheAssignedStaffMember()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var createResult = await controller.CreateShift(CleanCreateDto(participant.Id, null), CancellationToken.None);
        var shift = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(createResult.Result).Value).Data!;

        await controller.AssignShift(shift.Id, new Odip.Application.DTOs.AssignShiftDto { StaffId = staff.Id }, CancellationToken.None);

        var row = await db.NotificationOutbox.SingleAsync();
        Assert.Equal(Odip.Domain.Notifications.NotificationEventType.ShiftAssigned, row.EventType);
        Assert.Equal(staff.Id, row.RecipientUserId);
    }

    /// <summary>Clearing an assignment (StaffId null) has no recipient — no outbox row at all.</summary>
    [Fact]
    public async Task AssignShift_ClearingAssignment_RaisesNoNotification()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var createResult = await controller.CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);
        var shift = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(createResult.Result).Value).Data!;

        await controller.AssignShift(shift.Id, new Odip.Application.DTOs.AssignShiftDto { StaffId = null }, CancellationToken.None);

        Assert.Empty(await db.NotificationOutbox.ToListAsync());
    }

    // ══════════════════════════════════════════════════════════════
    // ITEM 9 — LeaveCoverage obligation task auto-completion
    // ══════════════════════════════════════════════════════════════

    private static Odip.Domain.Entities.BookingTask SeedLeaveCoverageTask(OdipDbContext db, Guid shiftId, Guid leaveId)
    {
        var task = new Odip.Domain.Entities.BookingTask
        {
            Id = Guid.NewGuid(), SourceKey = $"leave-coverage:{shiftId}:{leaveId}", TaskType = TaskType.LeaveCoverage,
            Title = "Re-cover shift", DueDate = ServiceDate, ShiftId = shiftId, LeaveRequestId = leaveId,
            Status = TaskItemStatus.NotStarted,
        };
        db.BookingTasks.Add(task);
        db.SaveChanges();
        return task;
    }

    [Fact]
    public async Task AssignShift_ReassigningAwayFromOnLeaveStaff_CompletesLeaveCoverageTask()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var onLeaveStaff = SeedStaff(db, firstName: "Ben", lastName: "OnLeave");
        var newStaff = SeedStaff(db, firstName: "Cara", lastName: "Covering");
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var createResult = await controller.CreateShift(CleanCreateDto(participant.Id, onLeaveStaff.Id), CancellationToken.None);
        var shift = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(createResult.Result).Value).Data!;
        var task = SeedLeaveCoverageTask(db, shift.Id, Guid.NewGuid());

        await controller.AssignShift(shift.Id, new Odip.Application.DTOs.AssignShiftDto { StaffId = newStaff.Id }, CancellationToken.None);

        var reloaded = await db.BookingTasks.SingleAsync(t => t.Id == task.Id);
        Assert.Equal(TaskItemStatus.Completed, reloaded.Status);
    }

    [Fact]
    public async Task AssignShift_ClearingAssignment_CompletesLeaveCoverageTask()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var onLeaveStaff = SeedStaff(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var createResult = await controller.CreateShift(CleanCreateDto(participant.Id, onLeaveStaff.Id), CancellationToken.None);
        var shift = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(createResult.Result).Value).Data!;
        var task = SeedLeaveCoverageTask(db, shift.Id, Guid.NewGuid());

        await controller.AssignShift(shift.Id, new Odip.Application.DTOs.AssignShiftDto { StaffId = null }, CancellationToken.None);

        var reloaded = await db.BookingTasks.SingleAsync(t => t.Id == task.Id);
        Assert.Equal(TaskItemStatus.Completed, reloaded.Status);
    }

    /// <summary>Reassigning back to the SAME staff member (no UserId change) leaves the task open — it's still that staff member's shift.</summary>
    [Fact]
    public async Task AssignShift_SameStaffMember_LeavesLeaveCoverageTaskOpen()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var createResult = await controller.CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);
        var shift = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(createResult.Result).Value).Data!;
        var task = SeedLeaveCoverageTask(db, shift.Id, Guid.NewGuid());

        await controller.AssignShift(shift.Id, new Odip.Application.DTOs.AssignShiftDto { StaffId = staff.Id }, CancellationToken.None);

        var reloaded = await db.BookingTasks.SingleAsync(t => t.Id == task.Id);
        Assert.Equal(TaskItemStatus.NotStarted, reloaded.Status);
    }

    [Fact]
    public async Task UpdateShift_CancellingTheShift_CompletesLeaveCoverageTask()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var createResult = await controller.CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);
        var shift = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(createResult.Result).Value).Data!;
        var task = SeedLeaveCoverageTask(db, shift.Id, Guid.NewGuid());

        var updateDto = new Odip.Application.DTOs.UpdateShiftDto
        {
            ParticipantId = participant.Id, StaffId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Cancelled,
        };
        await controller.UpdateShift(shift.Id, updateDto, CancellationToken.None);

        var reloaded = await db.BookingTasks.SingleAsync(t => t.Id == task.Id);
        Assert.Equal(TaskItemStatus.Completed, reloaded.Status);
    }

    [Fact]
    public async Task DeleteShift_CompletesLeaveCoverageTask()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var createResult = await controller.CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);
        var shift = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(createResult.Result).Value).Data!;
        var task = SeedLeaveCoverageTask(db, shift.Id, Guid.NewGuid());

        await controller.DeleteShift(shift.Id, CancellationToken.None);

        var reloaded = await db.BookingTasks.SingleAsync(t => t.Id == task.Id);
        Assert.Equal(TaskItemStatus.Completed, reloaded.Status);
    }

    // ══════════════════════════════════════════════════════════════
    // PARTICIPANT ROSTERING TAB (connection map item 12) — GET /api/v1/participants/{id}/rostering
    // ══════════════════════════════════════════════════════════════

    [Fact]
    public async Task GetParticipantRostering_ReturnsUpcomingShiftsAndAssignedStaffWithCompatibility()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        var filled = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = today.AddDays(1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        };
        var unfilled = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = null, ServiceDate = today.AddDays(2),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Draft,
        };
        db.Shifts.AddRange(filled, unfilled);
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), UserId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Preferred,
        });
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetParticipantRostering(participant.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantRosteringDto>>(ok.Value);

        Assert.Equal(2, body.Data!.UpcomingShifts.Count);
        var filledDto = Assert.Single(body.Data.UpcomingShifts, s => s.ShiftId == filled.Id);
        Assert.Equal(staff.Id, filledDto.StaffId);
        Assert.Equal(staff.FullName, filledDto.StaffName);
        Assert.False(filledDto.AssigneeOnApprovedLeave);
        var unfilledDto = Assert.Single(body.Data.UpcomingShifts, s => s.ShiftId == unfilled.Id);
        Assert.Null(unfilledDto.StaffId);
        Assert.Null(unfilledDto.StaffName);

        var assignedStaff = Assert.Single(body.Data.AssignedStaff);
        Assert.Equal(staff.Id, assignedStaff.StaffId);
        Assert.Equal(1, assignedStaff.ShiftCount);
        Assert.Equal(CompatibilityLevel.Preferred, assignedStaff.Compatibility);
    }

    [Fact]
    public async Task GetParticipantRostering_NoCompatibilityRow_DefaultsToAllowed()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = today.AddDays(1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        });
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetParticipantRostering(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantRosteringDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(CompatibilityLevel.Allowed, Assert.Single(body.Data!.AssignedStaff).Compatibility);
    }

    [Fact]
    public async Task GetParticipantRostering_AssigneeOnApprovedLeave_TrueWhenLeaveCoversTheShift()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = today.AddDays(1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        };
        db.Shifts.Add(shift);
        db.SaveChanges();
        SeedLeave(db, staff.Id, LeaveStatus.Approved, today.AddDays(1), today.AddDays(1));
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetParticipantRostering(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantRosteringDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var dto = Assert.Single(body.Data!.UpcomingShifts, s => s.ShiftId == shift.Id);
        Assert.True(dto.AssigneeOnApprovedLeave);
    }

    [Fact]
    public async Task GetParticipantRostering_ExcludesShiftsOutsideTheTwentyEightDayWindow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = today.AddDays(29),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        });
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = today.AddDays(-1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        });
        db.SaveChanges();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetParticipantRostering(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantRosteringDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Empty(body.Data!.UpcomingShifts);
        Assert.Empty(body.Data.AssignedStaff);
    }

    [Fact]
    public async Task GetParticipantRostering_ParticipantNotFound_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetParticipantRostering(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    /// <summary>Mandatory cross-tenant negative test — fixture pattern mirrors
    /// GetFlaggedShiftNotes_OtherTenantsFlaggedNote_IsExcluded above.</summary>
    [Fact]
    public async Task GetParticipantRostering_OtherTenantsParticipant_ReturnsNotFound()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;

        var tenantBContext = new Mock<ICurrentTenant>();
        tenantBContext.Setup(t => t.TenantId).Returns(tenantB);
        tenantBContext.Setup(t => t.IsSuperAdmin).Returns(false);
        Participant participantB;
        using (var seedDb = new OdipDbContext(options, tenantBContext.Object))
        {
            participantB = SeedParticipant(seedDb);
        }

        var tenantAContext = new Mock<ICurrentTenant>();
        tenantAContext.Setup(t => t.TenantId).Returns(tenantA);
        tenantAContext.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(options, tenantAContext.Object);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetParticipantRostering(participantB.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }
}
