using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The roster's budget gate end to end (budget phase 3): the dry run, create and update of a shift through <see cref="RosteringController"/>, with a real ledger behind them. Fixed clock: 4 Oct 2026, a Sunday;
/// the provider is in NSW, so an 8-hour weekday shift is $480 and the October to December period of the fixture participant holds $1,000. Two shifts of $480 are already booked, so a third is the one that
/// takes the forecast to $1,440 of $1,000.
/// </summary>
public class RosteringBudgetGateTests : IDisposable
{
    private static readonly DateOnly Mon12Oct = new(2026, 10, 12);
    private static readonly DateOnly Tue13Oct = new(2026, 10, 13);
    private static readonly DateOnly Wed14Oct = new(2026, 10, 14);
    private static readonly DateOnly Thu15Oct = new(2026, 10, 15);

    private static readonly JsonSerializerOptions ApiJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly LedgerKit _kit = LedgerKit.Create();
    private Participant _participant = null!;

    public void Dispose() => _kit.Dispose();

    // ── Rig ─────────────────────────────────────────────────────────────────

    /// <summary>The participant with a plan whose October quarter holds <paramref name="october"/>, two booked shifts, and the organisation in <paramref name="mode"/>.</summary>
    private RosteringController Rig(string role = "Coordinator", BudgetLimitMode mode = BudgetLimitMode.HardLimit, decimal october = 1000m, bool booked = true, IShiftCostSource? costs = null, bool withTenant = true)
    {
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        _participant = _kit.SeedParticipant();
        _kit.SeedPlan(_participant, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, october), LedgerKit.Q(3, 5000m)));
        if (booked)
        {
            _kit.SeedShift(_participant, Mon12Oct);
            _kit.SeedShift(_participant, Tue13Oct);
        }
        if (mode != BudgetSettings.DefaultMode)
        {
            _kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = _kit.TenantId, Mode = mode });
            _kit.Db.SaveChanges();
        }
        return Controller(role, costs, withTenant);
    }

    private RosteringController Controller(string role, IShiftCostSource? costs = null, bool withTenant = true)
    {
        var db = _kit.Db;
        var budget = new ShiftBudgetCheck(db, _kit.Ledger, costs);
        var controller = new RosteringController(
            db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: _kit.Clock, tenant: withTenant ? _kit.Tenant : null, budget: withTenant ? budget : null)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, role) }, "test")) },
            },
        };
        return controller;
    }

    private CreateShiftDto Create(DateOnly date, Guid? staffId = null, string? reason = null, bool emergency = false, List<string>? codes = null, int endHour = 17) => new()
    {
        ParticipantId = _participant.Id, StaffId = staffId, ServiceDate = date, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(endHour, 0), EndsNextDay = false,
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, OverrideReason = reason, Emergency = emergency, AcknowledgedFindingCodes = codes,
    };

    private UpdateShiftDto Update(Shift shift, DateOnly? date = null, int? endHour = null, ShiftStatus? status = null, string? notes = null, Guid? staffId = null, string? reason = null, bool emergency = false) => new()
    {
        ParticipantId = shift.ParticipantId, StaffId = staffId ?? shift.UserId, ServiceDate = date ?? shift.ServiceDate, StartTime = shift.StartTime, EndTime = endHour is { } h ? new TimeOnly(h, 0) : shift.EndTime,
        EndsNextDay = shift.EndsNextDay, Ratio = shift.Ratio, NightType = shift.NightType, Status = status ?? shift.Status, Notes = notes ?? shift.Notes, OverrideReason = reason, Emergency = emergency,
    };

    private CheckShiftDto Check(DateOnly date, Guid? id = null, ShiftStatus? status = null, Guid? staffId = null) => new()
    {
        Id = id, ParticipantId = _participant.Id, StaffId = staffId, ServiceDate = date, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
    };

    private static T Ok<T>(ActionResult<ApiResponse<T>> result) => ((ApiResponse<T>)Assert.IsType<OkObjectResult>(result.Result).Value!).Data!;

    private static ApiResponse<List<RosterFindingDto>> Refused<T>(ActionResult<ApiResponse<T>> result) =>
        (ApiResponse<List<RosterFindingDto>>)Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value!;

    private static string Said<T>(ActionResult<ApiResponse<T>> result) => Assert.Single(((ApiResponse<T>)Assert.IsType<BadRequestObjectResult>(result.Result).Value!).Errors!);

    private static RosterFindingDto? Budget(IEnumerable<RosterFindingDto> findings, string code = BudgetFindingCodes.ForecastOver) => findings.SingleOrDefault(f => f.Code == code);

    private int ShiftCount() => _kit.Db.Shifts.IgnoreQueryFilters().Count();

    private User SeedStaff(bool screeningExpired = false)
    {
        var staff = new User
        {
            Id = Guid.NewGuid(), TenantId = _kit.TenantId, FirstName = "Ben", LastName = "Turner", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker,
            Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = screeningExpired ? null : "WSC-1", WorkerScreeningExpiryDate = screeningExpired ? new DateOnly(2026, 1, 1) : new DateOnly(2030, 1, 1),
        };
        _kit.Db.Users.Add(staff);
        _kit.Db.SaveChanges();
        return staff;
    }

    // ── The stack canary's write sequence ───────────────────────────────────

    [Fact]
    public async Task TheStackCanarysShiftSequence_CreateAssignPublish_IsUntouched_ForAParticipantWithNoBudget()
    {
        // e2e/tests/_canary/stack.spec.ts books and rosters a shift in Warn mode for a fresh participant, and expects no findings at all from the assign. A participant with no plan has no budget
        // finding, in either mode, so none of the three writes may see one.
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        _participant = _kit.SeedParticipant();
        var staff = SeedStaff();
        var controller = Controller("Coordinator");

        var created = Ok(await controller.CreateShift(Create(Wed14Oct), default));
        var assigned = Ok(await controller.AssignShift(created.Id, new AssignShiftDto { StaffId = staff.Id }, default));
        var shift = _kit.Db.Shifts.Single(s => s.Id == created.Id);
        var published = Ok(await controller.UpdateShift(created.Id, Update(shift, status: ShiftStatus.Published), default));

        Assert.Empty(created.Findings.Where(f => f.Code.StartsWith("BUDGET_")));
        Assert.Empty(assigned.Findings);
        Assert.Empty(published.Findings.Where(f => f.Code.StartsWith("BUDGET_")));
        Assert.Equal(ShiftStatus.Published, published.Status);
        Assert.Null(published.AcknowledgedFindingCodes);
        Assert.Empty(_kit.Db.BookingTasks);
    }

    // ── A shift with no length (the phase 3 review, C1) ─────────────────────

    private const string EndsBeforeItStarts = "The shift must end after it starts. Tick 'Ends the next day' for an overnight shift.";

    [Fact]
    public async Task TheDryRun_RefusesAShiftThatEndsBeforeItStarts_AndSaysToTickEndsTheNextDay()
    {
        var controller = Rig();

        var result = await controller.CheckShift(Check(Wed14Oct) with { StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(6, 0), EndsNextDay = false }, default);

        Assert.Equal(EndsBeforeItStarts, Said(result));
    }

    [Theory]
    [InlineData(22, 6)]   // an overnight shift, the box not ticked: a length of minus sixteen hours
    [InlineData(9, 9)]    // nothing at all
    public async Task Create_RefusesAShiftWithNoLength_AndSavesNothing_SoNothingNegativeEntersTheLedger(int startHour, int endHour)
    {
        var controller = Rig();
        var before = ShiftCount();

        var result = await controller.CreateShift(Create(Wed14Oct) with { StartTime = new TimeOnly(startHour, 0), EndTime = new TimeOnly(endHour, 0) }, default);

        Assert.Equal(EndsBeforeItStarts, Said(result));
        Assert.Equal(before, ShiftCount());
    }

    [Fact]
    public async Task Update_RefusesAnEditThatMakesAShiftEndBeforeItStarts_AndLeavesTheShiftAsItWas()
    {
        var controller = Rig();
        var shift = _kit.Db.Shifts.First(s => s.ServiceDate == Mon12Oct);   // 09:00 to 17:00

        var result = await controller.UpdateShift(shift.Id, Update(shift, endHour: 8), default);

        Assert.Equal(EndsBeforeItStarts, Said(result));
        Assert.Equal(new TimeOnly(17, 0), _kit.Db.Shifts.Single(s => s.Id == shift.Id).EndTime);
    }

    [Fact]
    public async Task AnOvernightShiftWithTheBoxTicked_IsAShiftLikeAnyOther()
    {
        var controller = Rig(booked: false);
        var overnight = Create(Wed14Oct) with { StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(6, 0), EndsNextDay = true };

        var dryRun = Ok(await controller.CheckShift(Check(Wed14Oct) with { StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(6, 0), EndsNextDay = true }, default));
        var created = Ok(await controller.CreateShift(overnight, default));

        Assert.Empty(dryRun);
        Assert.Equal(8m, created.DurationHours);
    }

    [Fact]
    public async Task Update_NeverRefusesARowSavedBeforeTheRule_WhileItsTimesAreLeftAlone_OrItIsCancelled_ButNotAFreshBadTime()
    {
        // Rows with no length may already exist (a new shift's end time used to default to its start). The panel must still be able to annotate and cancel them; only times somebody sets now are refused.
        var controller = Rig(booked: false);
        var legacy = _kit.SeedShift(_participant, Wed14Oct);
        legacy.EndTime = legacy.StartTime;
        _kit.Db.SaveChanges();

        var annotated = Ok(await controller.UpdateShift(legacy.Id, Update(legacy, notes: "Family asked for a call first"), default));
        var anotherBadTime = await controller.UpdateShift(legacy.Id, Update(legacy, endHour: 8), default);
        var cancelled = Ok(await controller.UpdateShift(legacy.Id, Update(legacy, status: ShiftStatus.Cancelled), default));

        Assert.Equal("Family asked for a call first", annotated.Notes);
        Assert.Equal(EndsBeforeItStarts, Said(anotherBadTime));
        Assert.Equal(ShiftStatus.Cancelled, cancelled.Status);
    }

    // ── The dry run ─────────────────────────────────────────────────────────

    [Fact]
    public async Task TheDryRun_GivesACoordinatorABlockingFinding_AndAnAdminAReasonRequiredWarning_UnderAHardLimit()
    {
        var coordinator = Ok(await Rig("Coordinator").CheckShift(Check(Wed14Oct), default));
        var admin = Ok(await Controller("Admin").CheckShift(Check(Wed14Oct), default));
        var superAdmin = Ok(await Controller("SuperAdmin").CheckShift(Check(Wed14Oct), default));

        Assert.Equal((RosterFindingSeverity.Blocking, false), (Budget(coordinator)!.Severity, Budget(coordinator)!.RequiresReason));
        Assert.Equal((RosterFindingSeverity.Warning, true), (Budget(admin)!.Severity, Budget(admin)!.RequiresReason));
        Assert.Equal((RosterFindingSeverity.Warning, true), (Budget(superAdmin)!.Severity, Budget(superAdmin)!.RequiresReason));
        var figures = Budget(coordinator)!.Budget!;
        Assert.Equal(("Core (flexible)", 1000m, 0m, 1440m, 480m, 440m), (figures.PoolName, figures.Available, figures.Used, figures.Forecast, figures.ShiftCost, figures.OverBy));
    }

    [Fact]
    public async Task AnUnfilledShift_StillGetsTheBudgetFinding_ThoughTheConflictCheckSkipsIt()
    {
        var findings = Ok(await Rig("Coordinator", BudgetLimitMode.Warn).CheckShift(Check(Wed14Oct, staffId: null), default));

        var finding = Assert.Single(findings);
        Assert.Equal((BudgetFindingCodes.ForecastOver, RosterFindingSeverity.Warning), (finding.Code, finding.Severity));
    }

    [Fact]
    public async Task ABudgetFinding_SitsBesideTheConflictFindingsOfAFilledShift()
    {
        var controller = Rig("Coordinator", BudgetLimitMode.Warn);
        var staff = SeedStaff(screeningExpired: true);

        var findings = Ok(await controller.CheckShift(Check(Wed14Oct, staffId: staff.Id), default));

        Assert.Contains(findings, f => f.Code == "WSC_EXPIRED");
        Assert.NotNull(Budget(findings));
    }

    [Fact]
    public async Task TheDryRun_OfAShiftOnItsWayToCancelled_HasNoBudgetFinding()
    {
        var controller = Rig("Coordinator");
        var shift = _kit.SeedShift(_participant, Wed14Oct);

        var findings = Ok(await controller.CheckShift(Check(Wed14Oct, id: shift.Id, status: ShiftStatus.Cancelled), default));

        Assert.Empty(findings);
    }

    [Fact]
    public async Task AShiftTheEstimatorCannotPrice_GetsNoFinding_AndTheEnvelopeSaysItWasNotChecked()
    {
        var stub = new Mock<IShiftCostSource>();
        stub.Setup(s => s.EstimateAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<IReadOnlyList<ShiftSpec>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid _, Guid _, IReadOnlyList<ShiftSpec> specs, CancellationToken _) => specs.Select(_ => (ShiftCostEstimate)new ShiftCostEstimate.NotPriced("sleepover shifts are not priced yet")).ToList());
        var controller = Rig("Coordinator", costs: stub.Object);

        var dryRun = await controller.CheckShift(Check(Wed14Oct), default);
        var created = Ok(await controller.CreateShift(Create(Wed14Oct), default));

        var envelope = (ApiResponse<List<RosterFindingDto>>)Assert.IsType<OkObjectResult>(dryRun.Result).Value!;
        Assert.Empty(envelope.Data!);
        Assert.Equal("Budget not checked: sleepover shifts are not priced yet.", envelope.Message);
        Assert.Empty(created.Findings);   // never blocked: it saved
        Assert.Equal(3, ShiftCount());
    }

    [Fact]
    public async Task WithNoOrganisationOnTheRequest_ThereIsNoBudgetCheck()
    {
        var findings = Ok(await Rig("Coordinator", withTenant: false).CheckShift(Check(Wed14Oct), default));

        Assert.Empty(findings);
    }

    [Fact]
    public async Task AParticipantWithNoPlan_SavesWithNoFinding_EvenUnderAHardLimit()
    {
        var controller = Rig("Coordinator", booked: false);
        var other = _kit.SeedParticipant();
        var dto = Create(Wed14Oct) with { ParticipantId = other.Id };

        var saved = Ok(await controller.CreateShift(dto, default));

        Assert.Empty(saved.Findings);
        Assert.Null(saved.OverrideReason);
    }

    // ── Creating ────────────────────────────────────────────────────────────

    [Fact]
    public async Task InWarnMode_APastTheBudgetShiftSaves_WithTheWarning_AndNoMarker()
    {
        var controller = Rig("Coordinator", BudgetLimitMode.Warn);

        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, codes: new List<string> { BudgetFindingCodes.ForecastOver }), default));

        Assert.NotNull(Budget(saved.Findings));
        Assert.Null(saved.OverrideReason);
        Assert.Null(saved.AcknowledgedFindingCodes);   // a warning is not an override, even when the client names the code
        Assert.Null(saved.BudgetReview);
    }

    [Fact]
    public async Task UnderAHardLimit_ACoordinatorsOneOffPastTheBudget_IsRefusedAndNothingIsSaved()
    {
        var controller = Rig("Coordinator");

        var refusal = Refused(await controller.CreateShift(Create(Wed14Oct), default));

        Assert.False(refusal.Success);
        Assert.Equal(RosterFindingSeverity.Blocking, Budget(refusal.Data!)!.Severity);
        Assert.Equal(2, ShiftCount());
        Assert.Empty(_kit.Db.BookingTasks);
    }

    [Fact]
    public async Task UnderAHardLimit_AnAdminNeedsAReason_AndTheReasonAndTheCodeAreStored()
    {
        var controller = Rig("Admin");

        var withoutReason = Refused(await controller.CreateShift(Create(Wed14Oct), default));
        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, reason: "  Client's carer is in hospital  ", codes: new List<string> { BudgetFindingCodes.ForecastOver }), default));

        Assert.True(Budget(withoutReason.Data!)!.RequiresReason);
        Assert.Equal("Client's carer is in hospital", saved.OverrideReason);
        Assert.Equal(new[] { BudgetFindingCodes.ForecastOver }, saved.AcknowledgedFindingCodes);
        Assert.Null(saved.BudgetReview);   // an Admin's override raises no review task
        Assert.Empty(_kit.Db.BookingTasks);
    }

    [Fact]
    public async Task TheClientCannotForgeTheOverBudgetCodes_ButItsOtherCodesStillGoThroughAsBefore()
    {
        var controller = Rig("Coordinator", BudgetLimitMode.Warn);   // past the budget, but only a warning: nothing was overridden

        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, codes: new List<string> { BudgetFindingCodes.Emergency, BudgetFindingCodes.ForecastOver, "SOME_OTHER_CODE" }), default));

        Assert.Equal(new[] { "SOME_OTHER_CODE" }, saved.AcknowledgedFindingCodes);
        Assert.Empty(_kit.Db.BookingTasks);
    }

    [Fact]
    public async Task APatternShift_OnlyWarns_UnderAHardLimit_EvenForACoordinator()
    {
        var controller = Rig("Coordinator");
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = _kit.TenantId, ParticipantId = _participant.Id, DayOfWeek = DayOfWeek.Wednesday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
        };
        _kit.Db.ShiftPatterns.Add(pattern);
        _kit.Db.SaveChanges();

        var saved = Ok(await controller.CreateShift(Create(Wed14Oct) with { ShiftPatternId = pattern.Id }, default));

        Assert.Equal(RosterFindingSeverity.Warning, Budget(saved.Findings)!.Severity);
        Assert.Equal(3, ShiftCount());
    }

    // ── The emergency or safety path ────────────────────────────────────────

    [Fact]
    public async Task AnEmergency_IsAcceptedForACoordinator_WithItsMarker_ItsReasonAndExactlyOneAdminTask()
    {
        var controller = Rig("Coordinator");

        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, reason: "  Participant unsafe at home tonight  ", emergency: true), default));

        Assert.Equal("Emergency or safety: Participant unsafe at home tonight", saved.OverrideReason);
        Assert.Equal(new[] { BudgetFindingCodes.Emergency }, saved.AcknowledgedFindingCodes);
        var task = Assert.Single(_kit.Db.BookingTasks);
        Assert.Equal((TaskType.BudgetEmergencyReview, $"budget-emergency:{saved.Id}", saved.Id), (task.TaskType, task.SourceKey, task.ShiftId));
        Assert.Equal("Review emergency shift past budget: Sophie Brown on 14 Oct 2026", task.Title);
        Assert.Equal(new DateOnly(2026, 10, 5), task.DueDate);   // the provider's tomorrow: today is Sunday 4 Oct
        Assert.Equal($"/rostering?date=2026-10-14&participant={_participant.Id}", task.LinkTo);
        Assert.Equal((_participant.TenantId, TaskItemStatus.NotStarted), (task.TenantId, task.Status));
        Assert.Equal(BudgetReviewState.Pending, saved.BudgetReview!.State);
        Assert.Equal(task.Title, saved.BudgetReview.ReviewTaskTitle);
    }

    [Fact]
    public async Task TheEmergencyTask_BelongsToTheShiftsOrganisation()
    {
        var controller = Rig("Coordinator");

        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, reason: "Participant unsafe at home tonight", emergency: true), default));

        var task = _kit.Db.BookingTasks.IgnoreQueryFilters().Single();
        var shift = _kit.Db.Shifts.IgnoreQueryFilters().Single(s => s.Id == saved.Id);
        Assert.Equal(shift.TenantId, task.TenantId);
        Assert.Equal(LedgerKit.TenantA, task.TenantId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("too short")]    // nine characters
    [InlineData("         x          ")]
    public async Task AnEmergencyWithoutARealDescription_IsRefused_AndNothingIsSaved(string? description)
    {
        var controller = Rig("Coordinator");

        var result = await controller.CreateShift(Create(Wed14Oct, reason: description, emergency: true), default);

        Assert.Equal("Describe the emergency or safety need in at least 10 characters.", Said(result));
        Assert.Equal(2, ShiftCount());
        Assert.Empty(_kit.Db.BookingTasks);
    }

    [Fact]
    public async Task AnEmergency_IsAvailableInWarnModeToo_ItCannotBeSwitchedOff()
    {
        var controller = Rig("Coordinator", BudgetLimitMode.Warn);

        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, reason: "Participant unsafe at home tonight", emergency: true), default));

        Assert.Equal(new[] { BudgetFindingCodes.Emergency }, saved.AcknowledgedFindingCodes);
        Assert.Single(_kit.Db.BookingTasks);
    }

    [Fact]
    public async Task AnEmergencyFlag_OnAShiftThatIsNotPastTheBudget_IsJustASave()
    {
        var controller = Rig("Coordinator", october: 5000m);

        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, reason: "Participant unsafe at home tonight", emergency: true), default));

        Assert.Null(saved.AcknowledgedFindingCodes);
        Assert.Null(saved.OverrideReason);
        Assert.Empty(_kit.Db.BookingTasks);   // nothing past the budget to review
    }

    [Fact]
    public async Task AnEmergency_AnswersTheBudgetOnly_AnExpiredScreeningStillBlocks()
    {
        var controller = Rig("Coordinator");
        var staff = SeedStaff(screeningExpired: true);

        var refusal = Refused(await controller.CreateShift(Create(Wed14Oct, staffId: staff.Id, reason: "Participant unsafe at home tonight", emergency: true), default));

        Assert.Contains(refusal.Data!, f => f.Code == "WSC_EXPIRED" && f.Severity == RosterFindingSeverity.Blocking);
        Assert.Equal(2, ShiftCount());
        Assert.Empty(_kit.Db.BookingTasks);
    }

    // ── Editing ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task AnEditThatRaisesTheCost_IsRefusedForACoordinator_AndOneThatDoesNotIsAWarning()
    {
        var controller = Rig("Coordinator", october: 500m, booked: false);
        var shift = _kit.SeedShift(_participant, Mon12Oct);   // $480 of $500 ...
        _kit.SeedShift(_participant, Tue13Oct);               // ... and $960 with the second: already past

        var raise = await controller.UpdateShift(shift.Id, Update(shift, endHour: 19), default);          // 10 hours: $600
        var same = Ok(await controller.UpdateShift(shift.Id, Update(shift, notes: "bring the swimming bag"), default));
        var lower = Ok(await controller.UpdateShift(shift.Id, Update(shift, endHour: 15), default));       // 6 hours: $360

        Assert.Equal(RosterFindingSeverity.Blocking, Budget(Refused(raise).Data!)!.Severity);
        Assert.Equal(RosterFindingSeverity.Warning, Budget(same.Findings)!.Severity);
        Assert.Equal(RosterFindingSeverity.Warning, Budget(lower.Findings)!.Severity);
        Assert.Equal(new TimeOnly(15, 0), _kit.Db.Shifts.Single(s => s.Id == shift.Id).EndTime);
    }

    [Fact]
    public async Task AnEditThatLowersTheCost_OfAShiftPastTheBudget_IsNeverBlocked()
    {
        var controller = Rig("Coordinator", october: 300m, booked: false);
        var shift = _kit.SeedShift(_participant, Mon12Oct);   // $480 of $300: already past

        var saved = Ok(await controller.UpdateShift(shift.Id, Update(shift, endHour: 15), default));

        Assert.Equal(RosterFindingSeverity.Warning, Budget(saved.Findings)!.Severity);
    }

    [Fact]
    public async Task CancellingAShiftPastTheBudget_IsNeverBlocked()
    {
        var controller = Rig("Coordinator", october: 300m, booked: false);
        var shift = _kit.SeedShift(_participant, Mon12Oct);

        var saved = Ok(await controller.UpdateShift(shift.Id, Update(shift, status: ShiftStatus.Cancelled), default));

        Assert.Equal(ShiftStatus.Cancelled, saved.Status);
        Assert.Empty(saved.Findings);
    }

    [Fact]
    public async Task UnCancellingAShiftPastTheBudget_IsARaise_AndIsRefusedForACoordinator()
    {
        var controller = Rig("Coordinator", october: 300m, booked: false);
        var shift = _kit.SeedShift(_participant, Mon12Oct, ShiftStatus.Cancelled);

        var refusal = Refused(await controller.UpdateShift(shift.Id, Update(shift, status: ShiftStatus.Draft), default));

        Assert.Equal(RosterFindingSeverity.Blocking, Budget(refusal.Data!)!.Severity);
    }

    [Theory]
    [InlineData(ShiftStatus.InProgress)]
    [InlineData(ShiftStatus.PendingReview)]
    [InlineData(ShiftStatus.Completed)]
    public async Task AShiftThatHasStarted_IsNeverBlocked_ByTheBudget(ShiftStatus status)
    {
        var controller = Rig("Coordinator", october: 100m, booked: false);
        var shift = _kit.SeedShift(_participant, Mon12Oct, status);

        var saved = Ok(await controller.UpdateShift(shift.Id, Update(shift, notes: "handover note"), default));

        Assert.Equal(status, saved.Status);
        Assert.Empty(saved.Findings);
    }

    [Fact]
    public async Task EditingAPatternShiftInTheRosterPanel_KeepsItsPatternLink_SoItStaysRoutine()
    {
        var controller = Rig("Coordinator", october: 300m, booked: false);
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = _kit.TenantId, ParticipantId = _participant.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
        };
        _kit.Db.ShiftPatterns.Add(pattern);
        var shift = _kit.SeedShift(_participant, Mon12Oct);
        shift.ShiftPatternId = pattern.Id;
        _kit.Db.SaveChanges();

        // The panel never sends a pattern link; the edit also raises the cost past a $300 budget.
        var saved = Ok(await controller.UpdateShift(shift.Id, Update(shift, endHour: 19), default));

        Assert.Equal(pattern.Id, saved.ShiftPatternId);
        Assert.Equal(RosterFindingSeverity.Warning, Budget(saved.Findings)!.Severity);
    }

    // ── What a later save leaves alone ──────────────────────────────────────

    [Fact]
    public async Task AnEmergencyShift_KeepsItsMarkerAndReason_WhenAWorkerIsAssignedOrANoteIsEdited_AndItsTaskIsNeverDoubled()
    {
        var controller = Rig("Coordinator");
        var staff = SeedStaff();
        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, reason: "Participant unsafe at home tonight", emergency: true), default));
        var shift = _kit.Db.Shifts.Single(s => s.Id == saved.Id);

        var assigned = Ok(await controller.AssignShift(shift.Id, new AssignShiftDto { StaffId = staff.Id }, default));
        var noted = Ok(await controller.UpdateShift(shift.Id, Update(shift, notes: "bring the swimming bag", staffId: staff.Id), default));

        Assert.Equal(new[] { BudgetFindingCodes.Emergency }, assigned.AcknowledgedFindingCodes);
        Assert.Equal("Emergency or safety: Participant unsafe at home tonight", assigned.OverrideReason);
        Assert.Equal(new[] { BudgetFindingCodes.Emergency }, noted.AcknowledgedFindingCodes);
        Assert.Equal("Emergency or safety: Participant unsafe at home tonight", noted.OverrideReason);
        Assert.Single(_kit.Db.BookingTasks);
    }

    [Fact]
    public async Task AnEmergencyAgainOnTheSameShift_RaisesNoSecondTask_AndNeverReopensAClosedOne()
    {
        var controller = Rig("Coordinator");
        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, reason: "Participant unsafe at home tonight", emergency: true), default));
        var shift = _kit.Db.Shifts.Single(s => s.Id == saved.Id);

        Ok(await controller.UpdateShift(shift.Id, Update(shift, endHour: 19, reason: "Still unsafe, needs the extra two hours", emergency: true), default));
        var task = Assert.Single(_kit.Db.BookingTasks);
        task.Status = TaskItemStatus.Completed;
        _kit.Db.SaveChanges();
        var again = Ok(await controller.UpdateShift(shift.Id, Update(shift, endHour: 20, reason: "Still unsafe, needs a further hour", emergency: true), default));

        Assert.Single(_kit.Db.BookingTasks);
        Assert.Equal(TaskItemStatus.Completed, _kit.Db.BookingTasks.Single().Status);
        Assert.Equal(BudgetReviewState.Reviewed, again.BudgetReview!.State);
    }

    [Fact]
    public async Task AnAdminsOverride_IsKept_WhenALaterEditDoesNotRaiseTheCost()
    {
        var controller = Rig("Admin");
        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, reason: "Client's carer is in hospital"), default));
        var shift = _kit.Db.Shifts.Single(s => s.Id == saved.Id);

        var noted = Ok(await controller.UpdateShift(shift.Id, Update(shift, notes: "bring the swimming bag"), default));

        Assert.Equal(new[] { BudgetFindingCodes.ForecastOver }, noted.AcknowledgedFindingCodes);
        Assert.Equal("Client's carer is in hospital", noted.OverrideReason);
    }

    [Fact]
    public async Task APlainWarningShift_NeverGainsAMarker_WhenEdited()
    {
        var controller = Rig("Admin", BudgetLimitMode.Warn);
        var saved = Ok(await controller.CreateShift(Create(Wed14Oct), default));
        var shift = _kit.Db.Shifts.Single(s => s.Id == saved.Id);

        var noted = Ok(await controller.UpdateShift(shift.Id, Update(shift, notes: "bring the swimming bag", reason: "just a note"), default));

        Assert.Null(noted.AcknowledgedFindingCodes);
        Assert.Null(noted.OverrideReason);
    }

    // ── The board, and the wire ─────────────────────────────────────────────

    [Fact]
    public async Task TheBoard_CarriesTheStoredCodesAndTheReviewOfAnEmergencyShift_AndNothingOnTheOthers()
    {
        var controller = Rig("Coordinator");
        var saved = Ok(await controller.CreateShift(Create(Wed14Oct, reason: "Participant unsafe at home tonight", emergency: true), default));

        var board = Ok(await controller.GetBoard(new DateOnly(2026, 10, 12), "participant", default));

        var shifts = board.ParticipantRows!.SelectMany(r => r.Shifts).ToDictionary(s => s.Id);
        Assert.Equal(3, shifts.Count);
        Assert.Equal(new[] { BudgetFindingCodes.Emergency }, shifts[saved.Id].AcknowledgedFindingCodes);
        Assert.Equal("Emergency or safety: Participant unsafe at home tonight", shifts[saved.Id].OverrideReason);
        Assert.Equal(BudgetReviewState.Pending, shifts[saved.Id].BudgetReview!.State);
        Assert.All(shifts.Values.Where(s => s.Id != saved.Id), s => Assert.Equal((null, null), (s.AcknowledgedFindingCodes, s.BudgetReview)));
    }

    [Fact]
    public async Task TheFindingsWireShape_OmitsTheBudgetFiguresOnOtherFindings_AndNamesThemOnABudgetOne()
    {
        var findings = Ok(await Rig("Coordinator", BudgetLimitMode.Warn).CheckShift(Check(Wed14Oct), default));
        var other = new RosterFindingDto { Code = "OVER_HOURS", Severity = RosterFindingSeverity.Warning, Message = "Over the weekly hours" };

        var json = JsonSerializer.Serialize(new[] { findings.Single(), other }, ApiJson);

        using var doc = JsonDocument.Parse(json);
        var budget = doc.RootElement[0].GetProperty("budget");
        Assert.Equal("Core (flexible)", budget.GetProperty("poolName").GetString());
        Assert.Equal("2026-10-01", budget.GetProperty("periodStart").GetString());
        Assert.Equal("2026-12-31", budget.GetProperty("periodEnd").GetString());
        Assert.Equal(480m, budget.GetProperty("shiftCost").GetDecimal());
        Assert.False(doc.RootElement[1].TryGetProperty("budget", out _));
    }
}
