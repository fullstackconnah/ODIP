using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Readiness;

/// <summary>
/// The mode-aware readiness check (<see cref="ParticipantReadiness"/>): Enforce is exactly the
/// strict gate as it was, Warn lets an active non-draft participant through, the hard stops (a
/// participant who does not exist, is a draft, or is inactive) hold in BOTH modes, and the issue
/// list says what is missing. The Warn defaults are in <see cref="ReadinessWarnModeDefaultTests"/>.
/// </summary>
public class ParticipantReadinessTests
{
    private static readonly DateOnly ServiceDate = new(2026, 10, 5); // a Monday

    private static readonly JsonSerializerOptions ApiJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() }
    };

    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static void SetMode(OdipDbContext db, ParticipantReadinessMode mode, Guid tenantId = default)
    {
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantReadinessMode = mode });
        db.SaveChanges();
    }

    private static Participant SeedParticipant(OdipDbContext db, Guid tenantId = default, bool active = true, bool draft = false,
        bool intakeDone = true, string first = "Amy", string last = "Ng")
    {
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = last,
            IsActive = active, IsDraft = draft, IntakeCompletedAt = intakeDone ? DateTime.UtcNow.AddMonths(-3) : null,
        };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static User SeedStaff(OdipDbContext db, Guid tenantId = default)
    {
        var staff = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
            WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1)
        };
        db.Users.Add(staff);
        db.SaveChanges();
        return staff;
    }

    private static RosteringController Rostering(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    private static CreateShiftDto ShiftDto(Guid participantId, Guid? staffId) => new()
    {
        ParticipantId = participantId, StaffId = staffId, ServiceDate = ServiceDate,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
    };

    private static Shift SeedShift(OdipDbContext db, Guid participantId, Guid? staffId)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, UserId = staffId, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft,
        };
        db.Shifts.Add(shift);
        db.SaveChanges();
        return shift;
    }

    private static ShiftPattern SeedPattern(OdipDbContext db, Guid participantId)
    {
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
            EffectiveFrom = new DateOnly(2026, 10, 1), EffectiveTo = new DateOnly(2026, 10, 31), IsActive = true,
        };
        db.ShiftPatterns.Add(pattern);
        db.SaveChanges();
        return pattern;
    }

    private static TripInstance SeedTrip(OdipDbContext db)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Gold Coast", StartDate = new DateOnly(2026, 11, 1), DurationDays = 3, Status = TripStatus.Planning };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static ParticipantsController Participants(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

    private static void AssertNotReady<T>(ActionResult<ApiResponse<T>> result)
    {
        var body = Assert.IsType<ApiResponse<T>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.False(body.Success);
        Assert.Equal(ParticipantReadinessGate.NotReadyMessage, Assert.Single(body.Errors!));
    }

    // ── Enforce: each caller refuses with NotReadyMessage, exactly as before ─────

    [Fact]
    public async Task Enforce_AssignShift_Returns400WithNotReadyMessage_AndDoesNotAssign()
    {
        using var db = CreateDb();
        SetMode(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        var shift = SeedShift(db, participant.Id, null);

        AssertNotReady(await Rostering(db).AssignShift(shift.Id, new AssignShiftDto { StaffId = staff.Id }, CancellationToken.None));

        Assert.Null((await db.Shifts.SingleAsync()).UserId);
    }

    [Fact]
    public async Task Enforce_CreateShift_Returns400WithNotReadyMessage_AndSavesNothing()
    {
        using var db = CreateDb();
        SetMode(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db);

        AssertNotReady(await Rostering(db).CreateShift(ShiftDto(participant.Id, null), CancellationToken.None));

        Assert.Empty(await db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task Enforce_UpdateShift_ChangingPlacement_Returns400WithNotReadyMessage()
    {
        using var db = CreateDb();
        SetMode(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);
        var shift = SeedShift(db, participant.Id, null);

        var result = await Rostering(db).UpdateShift(shift.Id, new UpdateShiftDto
        {
            ParticipantId = participant.Id, StaffId = staff.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft,
        }, CancellationToken.None);

        AssertNotReady(result);
        Assert.Null((await db.Shifts.SingleAsync()).UserId);
    }

    [Fact]
    public async Task Enforce_UpdateShift_StatusOnlyChange_StillWorksForALegacyShift()
    {
        // Existing history stays manageable after readiness is lost: cancelling is not a placement.
        using var db = CreateDb();
        SetMode(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, null);

        var result = await Rostering(db).UpdateShift(shift.Id, new UpdateShiftDto
        {
            ParticipantId = participant.Id, StaffId = null, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Cancelled,
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Enforce_CheckShift_Returns400WithNotReadyMessage()
    {
        using var db = CreateDb();
        SetMode(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db);

        var result = await Rostering(db).CheckShift(new CheckShiftDto
        {
            ParticipantId = participant.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        }, CancellationToken.None);

        AssertNotReady(result);
    }

    [Fact]
    public async Task Enforce_CreatePattern_UpdatePattern_GeneratePattern_AllReturn400WithNotReadyMessage()
    {
        using var db = CreateDb();
        SetMode(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db);
        var pattern = SeedPattern(db, participant.Id);
        var controller = Rostering(db);

        AssertNotReady(await controller.CreatePattern(new CreateShiftPatternDto
        {
            ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true,
        }, CancellationToken.None));
        AssertNotReady(await controller.UpdatePattern(pattern.Id, new UpdateShiftPatternDto
        {
            ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true,
        }, CancellationToken.None));
        AssertNotReady(await controller.GeneratePattern(pattern.Id, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), CancellationToken.None));

        Assert.Single(await db.ShiftPatterns.ToListAsync());
        Assert.Empty(await db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task Enforce_UpsertCompatibility_Returns400WithNotReadyMessage()
    {
        using var db = CreateDb();
        SetMode(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db);
        var staff = SeedStaff(db);

        AssertNotReady(await Rostering(db).UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Preferred }, CancellationToken.None));

        Assert.Empty(await db.StaffParticipantCompatibilities.ToListAsync());
    }

    [Fact]
    public async Task Enforce_CreateBooking_Returns400WithNotReadyMessage()
    {
        using var db = CreateDb();
        SetMode(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db);
        var trip = SeedTrip(db);

        AssertNotReady(await new BookingsController(db).Create(
            new CreateBookingDto { TripInstanceId = trip.Id, ParticipantId = participant.Id }, CancellationToken.None));

        Assert.Empty(await db.ParticipantBookings.ToListAsync());
    }

    [Fact]
    public async Task Enforce_Activation_LeavesAnInactiveNonDraftParticipantInactive()
    {
        using var db = CreateDb();
        SetMode(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db, active: false);

        var result = await Participants(db).Update(participant.Id, new UpdateParticipantDto
        {
            FirstName = participant.FirstName, LastName = participant.LastName, PlanType = PlanType.SelfManaged,
            OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne,
            SupportRatio = SupportRatio.OneToOne, IsActive = true, IsDraft = false,
        }, CancellationToken.None);

        Assert.False(Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.IsActive);
    }

    // ── The hard stops hold in Warn as well ─────────────────────────────────────

    [Theory]
    [InlineData("missing")]
    [InlineData("draft")]
    [InlineData("inactive")]
    public async Task Warn_ParticipantWhoIsMissingDraftOrInactive_IsStillRefused_ByEveryPlacement(string kind)
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var trip = SeedTrip(db);
        var participantId = kind switch
        {
            "missing" => Guid.NewGuid(),
            "draft" => SeedParticipant(db, draft: true).Id,
            _ => SeedParticipant(db, active: false).Id,
        };
        var existing = SeedParticipant(db, first: "Other", last: "Person");
        var shift = SeedShift(db, existing.Id, null);
        var controller = Rostering(db);

        AssertNotReady(await controller.CreateShift(ShiftDto(participantId, staff.Id), CancellationToken.None));
        AssertNotReady(await controller.CreatePattern(new CreateShiftPatternDto
        {
            ParticipantId = participantId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true,
        }, CancellationToken.None));
        AssertNotReady(await controller.UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = staff.Id, ParticipantId = participantId, Level = CompatibilityLevel.Preferred }, CancellationToken.None));
        AssertNotReady(await new BookingsController(db).Create(
            new CreateBookingDto { TripInstanceId = trip.Id, ParticipantId = participantId }, CancellationToken.None));
        Assert.Null((await db.Shifts.SingleAsync(s => s.Id == shift.Id)).UserId);
        Assert.Empty(await db.ParticipantBookings.ToListAsync());
        Assert.Empty(await db.StaffParticipantCompatibilities.ToListAsync());
    }

    // ── The mode is the PARTICIPANT's organisation's, and each organisation chooses for itself ──

    [Fact]
    public async Task Mode_IsLookedUpByTheParticipantsTenant_NotTheCallers()
    {
        using var db = CreateDb();
        var enforcing = Guid.NewGuid();
        var relaxed = Guid.NewGuid();
        SetMode(db, ParticipantReadinessMode.Enforce, enforcing);
        var inEnforcingOrg = SeedParticipant(db, enforcing, first: "Enf", last: "Orced");
        var inRelaxedOrg = SeedParticipant(db, relaxed, first: "Rel", last: "Axed");

        var strict = await ParticipantReadiness.CheckAsync(db, inEnforcingOrg.Id, CancellationToken.None);
        var warn = await ParticipantReadiness.CheckAsync(db, inRelaxedOrg.Id, CancellationToken.None);

        Assert.False(strict.Allowed);
        Assert.Equal(ParticipantReadinessMode.Enforce, strict.Mode);
        Assert.True(warn.Allowed);
        Assert.Equal(ParticipantReadinessMode.Warn, warn.Mode);
    }

    [Fact]
    public async Task Mode_NoProviderSettingsRow_IsWarn_AndANewRowDefaultsToWarn()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        Assert.Equal(ParticipantReadinessMode.Warn, (await ParticipantReadiness.CheckAsync(db, participant.Id, CancellationToken.None)).Mode);

        SetMode(db, ParticipantReadinessMode.Warn);
        Assert.Equal(ParticipantReadinessMode.Warn, new ProviderSettings().ParticipantReadinessMode);
        Assert.False(await ParticipantReadiness.IsEnforcedAsync(db, Guid.Empty, CancellationToken.None));
    }

    [Fact]
    public async Task Enforce_WinsWhenAnOrganisationSomehowHasTwoSettingsRows()
    {
        using var db = CreateDb();
        SetMode(db, ParticipantReadinessMode.Warn);
        SetMode(db, ParticipantReadinessMode.Enforce);

        Assert.True(await ParticipantReadiness.IsEnforcedAsync(db, Guid.Empty, CancellationToken.None));
    }

    // ── What is missing ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Issues_AreComputedFromDataThatExistsToday_InAStableOrder()
    {
        using var db = CreateDb();
        var tenant = Guid.NewGuid();
        var legacy = SeedParticipant(db, tenant, first: "Legacy", last: "Complete");                       // intake done, no onboarding row
        var noIntake = SeedParticipant(db, tenant, intakeDone: false, first: "No", last: "Intake");           // intake missing
        var incomplete = SeedParticipant(db, tenant, first: "Onboarding", last: "Incomplete");               // onboarding row, nothing done
        var profileOnly = SeedParticipant(db, tenant, first: "Service", last: "Missing");                    // profile done, service type not
        var foreignOnboarding = SeedParticipant(db, tenant, first: "Foreign", last: "Row");                  // a COMPLETE row, but another tenant's
        db.ParticipantOnboardings.AddRange(
            new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = incomplete.Id },
            new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = profileOnly.Id, ProfileComplete = true, ProfileCompletedAt = DateTime.UtcNow },
            new ParticipantOnboarding
            {
                Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ParticipantId = foreignOnboarding.Id,
                ProfileComplete = true, ProfileCompletedAt = DateTime.UtcNow, ServiceTypeConfirmed = true, ServiceTypeConfirmedAt = DateTime.UtcNow,
            });
        db.SaveChanges();

        var ids = new[] { legacy.Id, noIntake.Id, incomplete.Id, profileOnly.Id, foreignOnboarding.Id };
        var issues = await ParticipantReadiness.IssuesAsync(db, ids, CancellationToken.None);

        Assert.Equal(new[] { "No signed service agreement" }, issues[legacy.Id]);
        Assert.Equal(new[] { "Intake not complete", "No signed service agreement" }, issues[noIntake.Id]);
        Assert.Equal(new[] { "Onboarding not complete: profile", "Onboarding not complete: service type", "No signed service agreement" }, issues[incomplete.Id]);
        Assert.Equal(new[] { "Onboarding not complete: service type", "No signed service agreement" }, issues[profileOnly.Id]);
        // Another tenant's onboarding row is never read, so it neither helps nor hurts.
        Assert.Equal(new[] { "No signed service agreement" }, issues[foreignOnboarding.Id]);
    }

    [Fact]
    public async Task Issues_NoSignedAgreement_IsTrueWhileTheAgreementSourceIsUnapproved_EvenWithVerifiedEvidence()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        SeedVerifiedSigning(db, participant);

        var issues = await ParticipantReadiness.IssuesAsync(db, new[] { participant.Id }, CancellationToken.None);

        Assert.Contains("No signed service agreement", issues[participant.Id]);
        Assert.False(await ParticipantReadinessGate.IsActiveReadyAsync(db, participant.Id, CancellationToken.None));
    }

    private static (ServiceAgreementDraft draft, ElectronicSigningSnapshot snapshot, ElectronicSigningEvidence evidence) SeedVerifiedSigning(
        OdipDbContext db, Participant participant, Guid? evidenceTenant = null, string status = "Verified")
    {
        var draft = new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, Version = 1, State = "Approved",
            ParticipantNameSnapshot = participant.FullName, PlanStartDate = new(2026, 1, 1), PlanEndDate = new(2026, 12, 31),
            AgreementStartDate = new(2026, 1, 1), AgreementEndDate = new(2026, 12, 31),
        };
        var snapshot = new ElectronicSigningSnapshot
        {
            Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, DraftId = draft.Id,
            DraftVersion = 1, DocumentJson = "{\"immutable\":true}", DocumentHash = new string('a', 64),
        };
        var evidence = new ElectronicSigningEvidence
        {
            Id = Guid.NewGuid(), TenantId = evidenceTenant ?? participant.TenantId, SnapshotId = snapshot.Id,
            IdempotencyKey = Guid.NewGuid().ToString(), SignerName = "Fixture", SignerCapacity = "Representative",
            IsAuthorisedRepresentative = true, ConsentToElectronicMethod = true, IntendsToSign = true, DocumentWasDisplayed = true,
            EvidenceHash = new string('b', 64), PreviousEvidenceHash = "GENESIS", Status = status,
        };
        db.AddRange(draft, snapshot, evidence);
        db.SaveChanges();
        return (draft, snapshot, evidence);
    }

    /// <summary>
    /// The "No signed service agreement" clause is a copy of the signing half of the strict
    /// predicate, so it can say exactly what Enforce is waiting for. This pins the two together:
    /// strict-ready must equal intake AND complete onboarding AND this clause, case by case.
    /// </summary>
    [Theory]
    [InlineData("complete", true)]
    [InlineData("pending-evidence", false)]
    [InlineData("foreign-tenant-evidence", false)]
    [InlineData("newer-draft", false)]
    [InlineData("no-onboarding", false)]
    [InlineData("no-intake", false)]
    [InlineData("no-evidence", false)]
    public async Task SignedAgreementClause_AgreesWithTheStrictPredicate(string scenario, bool expectReady)
    {
        using var db = CreateDb();
        var tenant = Guid.NewGuid();
        var participant = SeedParticipant(db, tenant, intakeDone: scenario != "no-intake");
        if (scenario != "no-onboarding")
            db.ParticipantOnboardings.Add(new ParticipantOnboarding
            {
                Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = participant.Id,
                ProfileComplete = true, ProfileCompletedAt = DateTime.UtcNow, ServiceTypeConfirmed = true, ServiceTypeConfirmedAt = DateTime.UtcNow,
            });
        db.SaveChanges();
        if (scenario != "no-evidence")
        {
            var (draft, _, _) = SeedVerifiedSigning(db, participant,
                evidenceTenant: scenario == "foreign-tenant-evidence" ? Guid.NewGuid() : null,
                status: scenario == "pending-evidence" ? "PendingVerification" : "Verified");
            if (scenario == "newer-draft")
            {
                db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft
                {
                    Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = participant.Id, Version = draft.Version + 1, State = "Approved",
                    ParticipantNameSnapshot = participant.FullName, PlanStartDate = draft.PlanStartDate, PlanEndDate = draft.PlanEndDate,
                    AgreementStartDate = draft.AgreementStartDate, AgreementEndDate = draft.AgreementEndDate,
                });
                db.SaveChanges();
            }
        }

        var strict = await ParticipantReadinessGate.ActivationEvidenceParticipantsForApprovedSourceForTesting(db).AnyAsync(p => p.Id == participant.Id);
        var signed = await ParticipantReadiness.SignedAgreementParticipantsForApprovedSourceForTesting(db).AnyAsync(p => p.Id == participant.Id);
        var onboarding = await db.ParticipantOnboardings.AnyAsync(o => o.ParticipantId == participant.Id && o.TenantId == tenant && o.ProfileComplete && o.ServiceTypeConfirmed);
        var conjunction = participant.IntakeCompletedAt != null && onboarding && signed;

        Assert.Equal(expectReady, strict);
        Assert.Equal(strict, conjunction);
    }

    // ── Issues on the surfaces that show them ───────────────────────────────────

    [Fact]
    public async Task Board_ListsEveryActiveNonDraftParticipant_EachWithItsIssues_AndShiftsCarryThemToo()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var legacy = SeedParticipant(db, first: "Legacy", last: "Alpha");
        var noIntake = SeedParticipant(db, intakeDone: false, first: "No", last: "Beta");
        var inactive = SeedParticipant(db, active: false, first: "In", last: "Active");
        var draft = SeedParticipant(db, draft: true, first: "Dra", last: "Ft");
        SeedShift(db, legacy.Id, staff.Id);

        var result = await Rostering(db).GetBoard(ServiceDate, "participant", CancellationToken.None);

        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(new[] { legacy.Id, noIntake.Id }.OrderBy(i => i), board.ParticipantRows!.Select(r => r.ParticipantId).OrderBy(i => i));
        Assert.DoesNotContain(board.ParticipantRows!, r => r.ParticipantId == inactive.Id || r.ParticipantId == draft.Id);
        Assert.Equal(new[] { "No signed service agreement" }, board.ParticipantRows!.Single(r => r.ParticipantId == legacy.Id).ReadinessIssues);
        Assert.Equal(new[] { "Intake not complete", "No signed service agreement" }, board.ParticipantRows!.Single(r => r.ParticipantId == noIntake.Id).ReadinessIssues);
        Assert.Equal(new[] { "No signed service agreement" }, board.ParticipantRows!.Single(r => r.ParticipantId == legacy.Id).Shifts.Single().ReadinessIssues);
    }

    [Fact]
    public async Task Board_StaffGrouping_ShiftsCarryReadinessIssues()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        SeedShift(db, participant.Id, staff.Id);

        var result = await Rostering(db).GetBoard(ServiceDate, "staff", CancellationToken.None);

        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(new[] { "No signed service agreement" }, board.StaffRows!.Single(r => r.StaffId == staff.Id).Shifts.Single().ReadinessIssues);
    }

    [Fact]
    public async Task Board_Enforce_KeepsThePerShiftNotReadyException_ForOnlyTheEnforcingOrganisation()
    {
        using var db = CreateDb();
        var enforcing = Guid.NewGuid();
        var relaxed = Guid.NewGuid();
        SetMode(db, ParticipantReadinessMode.Enforce, enforcing);
        var staffA = SeedStaff(db, enforcing);
        var staffB = SeedStaff(db, relaxed);
        var inEnforcing = SeedParticipant(db, enforcing, first: "Enf", last: "Orced");
        var inRelaxed = SeedParticipant(db, relaxed, first: "Rel", last: "Axed");
        var enforcedShift = SeedShift(db, inEnforcing.Id, staffA.Id);
        SeedShift(db, inRelaxed.Id, staffB.Id);

        var result = await Rostering(db).GetBoard(ServiceDate, "participant", CancellationToken.None);

        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var exception = Assert.Single(board.Exceptions!, e => e.Finding.Code == "PARTICIPANT_NOT_READY");
        Assert.Equal(enforcedShift.Id, exception.ShiftId);
    }

    [Fact]
    public async Task CreateShift_Warn_ResponseCarriesReadinessIssues_AsCamelCaseJson()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db, intakeDone: false);
        var staff = SeedStaff(db);

        var result = await Rostering(db).CreateShift(ShiftDto(participant.Id, staff.Id), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
        Assert.Equal(new[] { "Intake not complete", "No signed service agreement" }, body.Data!.ReadinessIssues);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value, ApiJsonOptions));
        var issues = json.RootElement.GetProperty("data").GetProperty("readinessIssues");
        Assert.Equal("Intake not complete", issues[0].GetString());
        Assert.Equal("No signed service agreement", issues[1].GetString());
    }

    [Fact]
    public async Task ReadinessIssues_AreOmittedFromTheJson_WhenThereAreNone()
    {
        // A ShiftDto with no issues serialises without the field at all (WhenWritingNull), so
        // existing clients see no change in the shape.
        var json = JsonSerializer.Serialize(new ShiftDto { ReadinessIssues = null }, ApiJsonOptions);
        Assert.DoesNotContain("readinessIssues", json);
        Assert.Contains("readinessIssues", JsonSerializer.Serialize(new ShiftDto { ReadinessIssues = new List<string> { "x" } }, ApiJsonOptions));
        await Task.CompletedTask;
    }

    [Fact]
    public async Task CreateBooking_Warn_ResponseCarriesReadinessIssues()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db, intakeDone: false);
        var trip = SeedTrip(db);

        var result = await new BookingsController(db).Create(
            new CreateBookingDto { TripInstanceId = trip.Id, ParticipantId = participant.Id }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<BookingDetailDto>>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal(new[] { "Intake not complete", "No signed service agreement" }, body.Data!.ReadinessIssues);
    }

    [Fact]
    public async Task ParticipantList_AndDetail_CarryReadinessIssues()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db, intakeDone: false);

        var list = await Participants(db).GetAll(null, null, null, null, null, null, 1, 50, CancellationToken.None);
        var listed = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(list.Result).Value).Data!.Items.Single();
        var detail = await Participants(db).GetById(participant.Id, CancellationToken.None);
        var detailed = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(detail.Result).Value).Data!;

        Assert.Equal(new[] { "Intake not complete", "No signed service agreement" }, listed.ReadinessIssues);
        Assert.Equal(new[] { "Intake not complete", "No signed service agreement" }, detailed.ReadinessIssues);
    }

    [Fact]
    public async Task Register_Enforce_StillHidesAnOnboardingParticipantWhoFailsTheStrictGate_ButWarnShowsThemWhenActivated()
    {
        using var db = CreateDb();
        var enforcing = Guid.NewGuid();
        var relaxed = Guid.NewGuid();
        SetMode(db, ParticipantReadinessMode.Enforce, enforcing);
        var activeInEnforcing = SeedParticipant(db, enforcing, first: "Enf", last: "Orced");
        var activeInRelaxed = SeedParticipant(db, relaxed, first: "Rel", last: "Axed");
        var inactiveInRelaxed = SeedParticipant(db, relaxed, active: false, first: "Not", last: "Yet");
        foreach (var p in new[] { activeInEnforcing, activeInRelaxed, inactiveInRelaxed })
            db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id });
        db.SaveChanges();

        var result = await Participants(db).GetAll(null, null, null, null, null, false, 1, 50, CancellationToken.None, operationalOnly: true);

        var items = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Items;
        Assert.DoesNotContain(items, p => p.Id == activeInEnforcing.Id);
        Assert.Contains(items, p => p.Id == activeInRelaxed.Id);
        Assert.DoesNotContain(items, p => p.Id == inactiveInRelaxed.Id); // still in the onboarding stage until activated
    }

    [Fact]
    public async Task Activation_Warn_NeverActivatesADraftOrAnIntakeIncompleteParticipant()
    {
        using var db = CreateDb();
        var noIntake = SeedParticipant(db, active: false, intakeDone: false);

        var result = await Participants(db).Update(noIntake.Id, new UpdateParticipantDto
        {
            FirstName = noIntake.FirstName, LastName = noIntake.LastName, PlanType = PlanType.SelfManaged,
            OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne,
            SupportRatio = SupportRatio.OneToOne, IsActive = true, IsDraft = false,
        }, CancellationToken.None);

        var data = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.False(data.IsActive);
        Assert.True(data.IsDraft);
    }
}
