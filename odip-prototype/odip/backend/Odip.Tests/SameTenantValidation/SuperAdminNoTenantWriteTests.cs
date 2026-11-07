using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.SameTenantValidation;

/// <summary>
/// A SuperAdmin with no view-as tenant has no ambient tenant, so SaveChanges stamps nothing. A row created under an existing
/// parent (participant, user, trip) must take the PARENT's tenant, or it is an orphan no organisation can see (or a 500 where the
/// table has a tenant foreign key). A row with no parent is refused with a 400 before anything is saved. A tenant user is unchanged.
/// </summary>
public class SuperAdminNoTenantWriteTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly DateOnly ServiceDate = new(2026, 10, 5);

    private sealed record World(OdipDbContext Db, ICurrentTenant Tenant, Participant P, User Staff, TripInstance Trip);

    private static World Setup(bool superAdmin = true)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(superAdmin ? null : TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Sophie", LastName = "Brown", IsActive = true, IsDraft = false,
            IntakeCompletedAt = DateTime.UtcNow.AddMonths(-3),
        };
        var staff = new User
        {
            Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
            WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
        };
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = TenantA, TripName = "Gold Coast", StartDate = new DateOnly(2026, 11, 1), DurationDays = 3, Status = TripStatus.InProgress };
        db.Participants.Add(p);
        db.Users.Add(staff);
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return new World(db, tenant.Object, p, staff, trip);
    }

    private static async Task AssertAllInTenantA<T>(OdipDbContext db) where T : class, ITenantEntity
    {
        var rows = await db.Set<T>().IgnoreQueryFilters().ToListAsync();
        Assert.NotEmpty(rows);
        Assert.All(rows, r => Assert.Equal(TenantA, r.TenantId));
    }

    private static void AssertRefused<T>(ActionResult<ApiResponse<T>> result, string message)
    {
        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(message, Assert.Single(Assert.IsType<ApiResponse<T>>(bad.Value).Errors!));
    }

    private static RosteringController Rostering(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    private static LeaveController Leave(OdipDbContext db, Guid callerId) =>
        new(db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, callerId.ToString())], "Test")) },
            },
        };

    private static CreateShiftDto ShiftDto(Guid participantId, Guid staffId) => new()
    {
        ParticipantId = participantId, StaffId = staffId, ServiceDate = ServiceDate,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
    };

    private static CreateShiftPatternDto PatternDto(Guid participantId) => new()
    {
        ParticipantId = participantId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        EffectiveFrom = new DateOnly(2026, 10, 1), EffectiveTo = new DateOnly(2026, 10, 31), IsActive = true,
    };

    // ── Copy the parent's tenant: participant children ──────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Consent_Upsert_TakesParticipantTenant(bool superAdmin)
    {
        var w = Setup(superAdmin);
        var dto = new UpsertParticipantConsentDto { Granted = true, SignedByName = "Sophie Brown", SignedDate = new DateOnly(2026, 1, 15) };
        Assert.IsType<OkObjectResult>((await new ParticipantConsentsController(w.Db).Upsert(w.P.Id, nameof(ConsentType.PhotoVideo), dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<ParticipantConsent>(w.Db);
    }

    [Fact]
    public async Task ContactRole_Create_NewPerson_TakesParticipantTenant()
    {
        var w = Setup();
        var dto = new CreateParticipantContactRoleDto { NewPersonFirstName = "Karen", NewPersonLastName = "Johnson", RoleType = ContactRoleType.NextOfKin, IsPrimary = true };
        Assert.IsType<OkObjectResult>((await new ParticipantContactRolesController(w.Db).Create(w.P.Id, dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<Person>(w.Db);
        await AssertAllInTenantA<ParticipantContactRole>(w.Db);
    }

    [Fact]
    public async Task Note_Create_TakesParticipantTenant()
    {
        var w = Setup();
        var dto = new CreateParticipantNoteDto { Title = "Handover", Description = "Settled well." };
        Assert.IsType<OkObjectResult>((await new ParticipantNotesController(w.Db, new SafetyNoteSyncService(w.Db)).Create(w.P.Id, dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<ParticipantNote>(w.Db);
    }

    [Fact]
    public async Task IntakeGridRows_TakeParticipantTenant()
    {
        var w = Setup();
        await ParticipantPatchApplier.UpsertConsentsAsync(w.Db, w.P.Id, [new CreateParticipantConsentDto { ConsentType = ConsentType.PhotoVideo, Granted = true }], CancellationToken.None);
        await ParticipantPatchApplier.UpsertHealthConditionsAsync(w.Db, w.P.Id, [new CreateParticipantHealthConditionDto { ConditionType = Enum.GetValues<HealthConditionType>().First(), Has = true }], CancellationToken.None);
        await ParticipantPatchApplier.UpsertAdlAssessmentsAsync(w.Db, w.P.Id, [new CreateParticipantAdlAssessmentDto { AdlType = AdlType.Bathing, Level = AdlLevel.Supervision }], CancellationToken.None);
        await ParticipantPatchApplier.UpsertChecklistItemsAsync(w.Db, w.P.Id, [new CreateParticipantChecklistItemDto { ItemType = Enum.GetValues<ChecklistItemType>().First(), Value = Enum.GetValues<ChecklistItemValue>().First() }], CancellationToken.None);
        await ParticipantPatchApplier.UpsertCommunityAccessRiskItemsAsync(w.Db, w.P.Id, [new CreateParticipantCommunityAccessRiskItemDto { ItemType = Enum.GetValues<CommunityAccessRiskItemType>().First(), Rating = Enum.GetValues<RiskRatingLevel>().First() }], CancellationToken.None);
        await w.Db.SaveChangesAsync();
        await AssertAllInTenantA<ParticipantConsent>(w.Db);
        await AssertAllInTenantA<ParticipantHealthCondition>(w.Db);
        await AssertAllInTenantA<ParticipantAdlAssessment>(w.Db);
        await AssertAllInTenantA<ParticipantChecklistItem>(w.Db);
        await AssertAllInTenantA<ParticipantCommunityAccessRiskItem>(w.Db);
    }

    [Fact]
    public async Task PreferredStaffAutoLink_TakesParticipantTenant()
    {
        var w = Setup();
        await new StaffCompatibilityLinkService(w.Db).SyncFromParticipantPreferredStaffAsync(w.P.Id, null, w.Staff.Id, CancellationToken.None);
        await w.Db.SaveChangesAsync();
        await AssertAllInTenantA<StaffParticipantCompatibility>(w.Db);
    }

    [Fact]
    public async Task NotificationPreference_Update_TakesCallerTenant()
    {
        var w = Setup();
        var controller = new NotificationsController(w.Db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, w.Staff.Id.ToString())], "Test")) },
            },
        };
        var dto = new UpdateNotificationPreferenceDto { EventType = nameof(NotificationEventType.ShiftAssigned), Channel = nameof(NotificationChannelKind.Email), Enabled = false };
        Assert.IsType<OkObjectResult>((await controller.UpdatePreferences([dto], CancellationToken.None)).Result);
        await AssertAllInTenantA<NotificationPreference>(w.Db);
    }

    // ── Copy the parent's tenant: leave ─────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Leave_Create_TakesUserTenant(bool superAdmin)
    {
        var w = Setup(superAdmin);
        var dto = new CreateLeaveRequestDto { UserId = w.Staff.Id, LeaveType = LeaveType.Annual, StartDate = new DateOnly(2026, 11, 2), EndDate = new DateOnly(2026, 11, 4) };
        Assert.Equal(201, Assert.IsType<ObjectResult>((await Leave(w.Db, Guid.NewGuid()).CreateLeave(dto, CancellationToken.None)).Result).StatusCode);
        await AssertAllInTenantA<LeaveRequest>(w.Db);
    }

    [Fact]
    public async Task Unavailability_Create_TakesUserTenant()
    {
        var w = Setup();
        var dto = new CreateRecurringUnavailabilityDto { UserId = w.Staff.Id, DayOfWeek = DayOfWeek.Wednesday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = new DateOnly(2026, 11, 2) };
        Assert.Equal(201, Assert.IsType<ObjectResult>((await Leave(w.Db, Guid.NewGuid()).CreateUnavailability(dto, CancellationToken.None)).Result).StatusCode);
        await AssertAllInTenantA<RecurringUnavailability>(w.Db);
    }

    // ── Copy the parent's tenant: trips and bookings ────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task TripCompleted_ClaimsTask_TakesTripTenant(bool superAdmin)
    {
        var w = Setup(superAdmin);
        await new TripsController(w.Db, NullLogger<TripsController>.Instance).Patch(w.Trip.Id, new PatchTripDto { Status = TripStatus.Completed }, CancellationToken.None);
        await AssertAllInTenantA<BookingTask>(w.Db);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Booking_Create_InsuranceTask_TakesParticipantTenant(bool superAdmin)
    {
        var w = Setup(superAdmin);
        var result = await new BookingsController(w.Db).Create(new CreateBookingDto { TripInstanceId = w.Trip.Id, ParticipantId = w.P.Id }, CancellationToken.None);
        Assert.IsType<CreatedAtActionResult>(result.Result);
        await AssertAllInTenantA<BookingTask>(w.Db);
    }

    // ── Copy the parent's tenant: rostering ─────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Shift_Create_TakesParticipantTenant(bool superAdmin)
    {
        var w = Setup(superAdmin);
        Assert.IsType<OkObjectResult>((await Rostering(w.Db).CreateShift(ShiftDto(w.P.Id, w.Staff.Id), CancellationToken.None)).Result);
        await AssertAllInTenantA<Shift>(w.Db);
    }

    [Fact]
    public async Task ShiftPattern_Create_TakesParticipantTenant()
    {
        var w = Setup();
        Assert.IsType<CreatedAtActionResult>((await Rostering(w.Db).CreatePattern(PatternDto(w.P.Id), CancellationToken.None)).Result);
        await AssertAllInTenantA<ShiftPattern>(w.Db);
    }

    [Fact]
    public async Task Compatibility_Upsert_TakesParticipantTenant()
    {
        var w = Setup();
        var dto = new UpsertCompatibilityDto { StaffId = w.Staff.Id, ParticipantId = w.P.Id, Level = CompatibilityLevel.Allowed };
        Assert.IsType<OkObjectResult>((await Rostering(w.Db).UpsertCompatibility(dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<StaffParticipantCompatibility>(w.Db);
    }

    // ── No parent: refuse, and save nothing ─────────────────────────────────────

    [Fact]
    public async Task Accommodation_Create_Refused()
    {
        var w = Setup();
        AssertRefused(await new AccommodationController(w.Db, w.Tenant).Create(new CreateAccommodationDto { PropertyName = "Beach House" }, CancellationToken.None), AccommodationController.ChooseOrganisation);
        Assert.Empty(await w.Db.AccommodationProperties.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Trip_Create_Refused()
    {
        var w = Setup();
        var dto = new CreateTripDto { TripName = "Beach Trip", StartDate = new DateOnly(2026, 9, 1), DurationDays = 3 };
        AssertRefused(await new TripsController(w.Db, NullLogger<TripsController>.Instance, tenant: w.Tenant).Create(dto, CancellationToken.None), TripsController.ChooseOrganisation);
        Assert.Single(await w.Db.TripInstances.IgnoreQueryFilters().ToListAsync()); // only the seeded one
    }

    [Fact]
    public async Task Vehicle_Create_Refused()
    {
        var w = Setup();
        AssertRefused(await new VehiclesController(w.Db, w.Tenant).Create(new CreateVehicleDto { VehicleName = "Bus" }, CancellationToken.None), VehiclesController.ChooseOrganisation);
        Assert.Empty(await w.Db.Vehicles.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Activity_Create_Refused()
    {
        var w = Setup();
        AssertRefused(await new ActivitiesController(w.Db, w.Tenant).Create(new CreateActivityDto { ActivityName = "Kayaking" }, CancellationToken.None), ActivitiesController.ChooseOrganisation);
        Assert.Empty(await w.Db.Activities.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task EventTemplate_Create_Refused()
    {
        var w = Setup();
        AssertRefused(await new EventTemplatesController(w.Db, w.Tenant).Create(new CreateEventTemplateDto { EventName = "Beach" }, CancellationToken.None), EventTemplatesController.ChooseOrganisation);
        Assert.Empty(await w.Db.EventTemplates.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Person_Create_Refused()
    {
        var w = Setup();
        AssertRefused(await new PersonsController(w.Db, w.Tenant).Create(new CreatePersonDto { FirstName = "Karen", LastName = "Johnson" }, CancellationToken.None), PersonsController.ChooseOrganisation);
        Assert.Empty(await w.Db.People.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Participant_Create_Refused()
    {
        var w = Setup();
        var controller = new ParticipantsController(w.Db, new StaffCompatibilityLinkService(w.Db), new ParticipantDocumentService(w.Db), new SafetyNoteSyncService(w.Db), tenant: w.Tenant);
        AssertRefused(await controller.Create(new CreateParticipantDto { FirstName = "Dana", LastName = "Lee", IsDraft = true }, CancellationToken.None), ParticipantsController.ChooseOrganisation);
        Assert.Single(await w.Db.Participants.IgnoreQueryFilters().ToListAsync()); // only the seeded one
    }

    [Fact]
    public async Task Staff_Create_Refused()
    {
        var w = Setup();
        var dto = new CreateStaffDto { FirstName = "Jane", LastName = "Doe", Email = "jane.doe@example.com", Position = Position.SupportWorker, IsActive = true };
        AssertRefused(await new StaffController(w.Db, currentTenant: w.Tenant).Create(dto, CancellationToken.None), StaffController.ChooseOrganisation);
        Assert.Single(await w.Db.Users.IgnoreQueryFilters().ToListAsync()); // only the seeded one
    }

    // ── A tenant user is unchanged: the save stamps the same tenant ─────────────

    [Fact]
    public async Task TenantUser_Vehicle_Create_KeepsTenant()
    {
        var w = Setup(superAdmin: false);
        Assert.IsType<CreatedAtActionResult>((await new VehiclesController(w.Db, w.Tenant).Create(new CreateVehicleDto { VehicleName = "Bus", Registration = "ABC123", TotalSeats = 10 }, CancellationToken.None)).Result);
        await AssertAllInTenantA<Vehicle>(w.Db);
    }

    [Fact]
    public async Task TenantUser_Activity_Create_KeepsTenant()
    {
        var w = Setup(superAdmin: false);
        Assert.IsType<OkObjectResult>((await new ActivitiesController(w.Db, w.Tenant).Create(new CreateActivityDto { ActivityName = "Kayaking" }, CancellationToken.None)).Result);
        await AssertAllInTenantA<Activity>(w.Db);
    }

    [Fact]
    public async Task TenantUser_Trip_Create_KeepsTenant()
    {
        var w = Setup(superAdmin: false);
        var dto = new CreateTripDto { TripName = "Beach Trip", StartDate = new DateOnly(2026, 9, 1), DurationDays = 3 };
        Assert.IsType<CreatedAtActionResult>((await new TripsController(w.Db, NullLogger<TripsController>.Instance, tenant: w.Tenant).Create(dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<TripInstance>(w.Db);
    }
}
