using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.SameTenantValidation;

/// <summary>
/// Design spec §4.4: every write path that accepts a user foreign key from a request DTO must
/// validate that the chosen UserId exists, is active, AND belongs to the current tenant, 400ing
/// on violation. This suite exercises the same-tenant half of that rule across all six named
/// paths (medication witness; incident ×3; trip lead-coordinator + driver; task owner;
/// participant preferred-user; roster shift assignment + compatibility linking) — a caller
/// scoped to Tenant A must never be able to link a Tenant B user via any of these DTOs. Same-tenant
/// scoping here comes for free from OdipDbContext's ambient tenant query filter on `Users` (a
/// non-SuperAdmin ICurrentTenant mock scopes every `_db.Users` read to its own TenantId) — these
/// tests exist to prove that filter is actually reached (i.e. no `IgnoreQueryFilters()` slipped
/// into any of these six controllers) rather than to test the filter mechanism itself.
/// </summary>
public class SameTenantWritePathTests
{
    private static (OdipDbContext Db, Guid TenantAId, Guid TenantBId) CreateDbWithTwoTenants()
    {
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();

        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantAId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        var db = new OdipDbContext(options, tenant.Object);

        // Seed both tenant rows themselves (FK targets for TenantId, though not strictly
        // enforced by EF InMemory) so any Include(u => u.Tenant) on a foreign-tenant row
        // doesn't blow up.
        db.Tenants.AddRange(
            new Tenant { Id = tenantAId, Name = "Tenant A", EmailDomain = $"{Guid.NewGuid()}.example.com", IsActive = true },
            new Tenant { Id = tenantBId, Name = "Tenant B", EmailDomain = $"{Guid.NewGuid()}.example.com", IsActive = true });
        db.SaveChanges();

        return (db, tenantAId, tenantBId);
    }

    /// <summary>A User seeded directly via IgnoreQueryFilters-equivalent add (bypasses the ambient tenant filter on read, not write) under the given tenant.</summary>
    private static User SeedUserInTenant(OdipDbContext db, Guid tenantId, string firstName = "Foreign", string lastName = "User")
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = firstName, LastName = lastName,
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    // ── Medications: witness selection ──────────────────────────────────

    [Fact]
    public async Task Medications_WitnessFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var foreignWitness = SeedUserInTenant(db, tenantBId);

        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantAId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = tenantAId, ParticipantId = participant.Id, Name = "Insulin", DoseDescription = "18 units",
            Type = MedicationType.Regular, TimesOfDay = "08:00", IsHighRisk = true, Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var tenantMock = new Mock<ICurrentTenant>();
        tenantMock.Setup(t => t.TenantId).Returns(tenantAId);
        tenantMock.Setup(t => t.IsSuperAdmin).Returns(false);
        var controller = new MedicationsController(db, tenantMock.Object);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessStaffId = foreignWitness.Id };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("not found", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    // ── Incidents: all three user pickers ───────────────────────────────

    [Fact]
    public async Task Incidents_InvolvedStaffFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var reporter = SeedUserInTenant(db, tenantAId, "Own", "Reporter");
        var foreignInvolved = SeedUserInTenant(db, tenantBId, "Foreign", "Involved");
        var trip = SeedTrip(db, tenantAId);
        var controller = new IncidentsController(db);

        var dto = new CreateIncidentDto
        {
            TripInstanceId = trip.Id, InvolvedStaffId = foreignInvolved.Id, ReportedByStaffId = reporter.Id,
            IncidentType = IncidentType.Other, Severity = IncidentSeverity.Low, Title = "T", Description = "D",
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(badRequest.Value);
        Assert.Contains("involved", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Incidents_ReportedByStaffFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var foreignReporter = SeedUserInTenant(db, tenantBId, "Foreign", "Reporter");
        var trip = SeedTrip(db, tenantAId);
        var controller = new IncidentsController(db);

        var dto = new CreateIncidentDto
        {
            TripInstanceId = trip.Id, ReportedByStaffId = foreignReporter.Id,
            IncidentType = IncidentType.Other, Severity = IncidentSeverity.Low, Title = "T", Description = "D",
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(badRequest.Value);
        Assert.Contains("reported-by", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Incidents_ReviewedByStaffFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var reporter = SeedUserInTenant(db, tenantAId, "Own", "Reporter");
        var foreignReviewer = SeedUserInTenant(db, tenantBId, "Foreign", "Reviewer");
        var trip = SeedTrip(db, tenantAId);
        var controller = new IncidentsController(db);

        var createDto = new CreateIncidentDto
        {
            TripInstanceId = trip.Id, ReportedByStaffId = reporter.Id,
            IncidentType = IncidentType.Other, Severity = IncidentSeverity.Low, Title = "T", Description = "D",
        };
        var created = await controller.Create(createDto, CancellationToken.None);
        var incidentId = Assert.IsType<ApiResponse<IncidentListDto>>(
            Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;

        var updateDto = new UpdateIncidentDto
        {
            TripInstanceId = trip.Id, ReportedByStaffId = reporter.Id, ReviewedByStaffId = foreignReviewer.Id,
            IncidentType = IncidentType.Other, Severity = IncidentSeverity.Low, Title = "T", Description = "D",
        };
        var result = await controller.Update(incidentId, updateDto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(badRequest.Value);
        Assert.Contains("reviewed-by", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    // ── Trips: lead coordinator + driver ────────────────────────────────

    [Fact]
    public async Task Trips_LeadCoordinatorFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var foreignCoordinator = SeedUserInTenant(db, tenantBId, "Foreign", "Coordinator");
        var controller = new TripsController(db, Mock.Of<ILogger<TripsController>>());

        var dto = new CreateTripDto { TripName = "Beach Trip", StartDate = new DateOnly(2026, 9, 1), DurationDays = 3, LeadCoordinatorId = foreignCoordinator.Id };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<TripDetailDto>>(badRequest.Value);
        Assert.Contains("lead coordinator", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task VehicleAssignments_DriverFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var foreignDriver = SeedUserInTenant(db, tenantBId, "Foreign", "Driver");
        var trip = SeedTrip(db, tenantAId);
        var vehicle = new Vehicle { Id = Guid.NewGuid(), TenantId = tenantAId, VehicleName = "Van 1", VehicleType = VehicleType.Van, TotalSeats = 8, IsActive = true };
        db.Vehicles.Add(vehicle);
        db.SaveChanges();

        var controller = new VehicleAssignmentsController(db);
        var dto = new CreateVehicleAssignmentDto { TripInstanceId = trip.Id, VehicleId = vehicle.Id, DriverStaffId = foreignDriver.Id };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<VehicleAssignmentDto>>(badRequest.Value);
        Assert.Contains("driver", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task VehicleAssignments_Update_DriverFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var ownDriver = SeedUserInTenant(db, tenantAId, "Own", "Driver");
        var foreignDriver = SeedUserInTenant(db, tenantBId, "Foreign", "Driver");
        var trip = SeedTrip(db, tenantAId);
        var vehicle = new Vehicle { Id = Guid.NewGuid(), TenantId = tenantAId, VehicleName = "Van 1", VehicleType = VehicleType.Van, TotalSeats = 8, IsActive = true };
        db.Vehicles.Add(vehicle);
        db.SaveChanges();

        var controller = new VehicleAssignmentsController(db);
        var created = await controller.Create(
            new CreateVehicleAssignmentDto { TripInstanceId = trip.Id, VehicleId = vehicle.Id, DriverStaffId = ownDriver.Id },
            CancellationToken.None);
        var assignmentId = Assert.IsType<ApiResponse<VehicleAssignmentDto>>(
            Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;

        var updateDto = new UpdateVehicleAssignmentDto { TripInstanceId = trip.Id, VehicleId = vehicle.Id, DriverStaffId = foreignDriver.Id };
        var result = await controller.Update(assignmentId, updateDto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<VehicleAssignmentDto>>(badRequest.Value);
        Assert.Contains("driver", body.Errors![0], StringComparison.OrdinalIgnoreCase);

        var reloaded = await db.VehicleAssignments.SingleAsync(a => a.Id == assignmentId);
        Assert.Equal(ownDriver.Id, reloaded.DriverUserId); // unchanged
    }

    // ── Staff availability + staff (trip) assignments: fix-round-1 finding ──
    // These write UserId directly from the request DTO with no prior validation at all before
    // this fix — closing spec §4.4's gap ("everywhere a user foreign key is written from a
    // request DTO"), which §7 names these two tables as receiving.

    [Fact]
    public async Task StaffAvailability_Create_StaffFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var foreignStaff = SeedUserInTenant(db, tenantBId, "Foreign", "Staff");
        var controller = new StaffAvailabilityController(db);

        var dto = new CreateStaffAvailabilityDto
        {
            StaffId = foreignStaff.Id, StartDateTime = new DateTime(2026, 9, 1), EndDateTime = new DateTime(2026, 9, 2),
            AvailabilityType = AvailabilityType.Unavailable,
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAvailabilityDto>>(badRequest.Value);
        Assert.Contains("staff member", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.StaffAvailabilities.ToListAsync());
    }

    [Fact]
    public async Task StaffAvailability_Create_InactiveStaff_ReturnsBadRequest()
    {
        var (db, tenantAId, _) = CreateDbWithTwoTenants();
        var inactiveStaff = SeedUserInTenant(db, tenantAId, "Inactive", "Staff");
        inactiveStaff.IsActive = false;
        db.SaveChanges();
        var controller = new StaffAvailabilityController(db);

        var dto = new CreateStaffAvailabilityDto
        {
            StaffId = inactiveStaff.Id, StartDateTime = new DateTime(2026, 9, 1), EndDateTime = new DateTime(2026, 9, 2),
            AvailabilityType = AvailabilityType.Unavailable,
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAvailabilityDto>>(badRequest.Value);
        Assert.Contains("staff member", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StaffAvailability_Update_StaffFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var ownStaff = SeedUserInTenant(db, tenantAId, "Own", "Staff");
        var foreignStaff = SeedUserInTenant(db, tenantBId, "Foreign", "Staff");
        var controller = new StaffAvailabilityController(db);

        var created = await controller.Create(
            new CreateStaffAvailabilityDto
            {
                StaffId = ownStaff.Id, StartDateTime = new DateTime(2026, 9, 1), EndDateTime = new DateTime(2026, 9, 2),
                AvailabilityType = AvailabilityType.Unavailable,
            }, CancellationToken.None);
        var availabilityId = Assert.IsType<ApiResponse<StaffAvailabilityDto>>(
            Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;

        var updateDto = new UpdateStaffAvailabilityDto
        {
            StaffId = foreignStaff.Id, StartDateTime = new DateTime(2026, 9, 1), EndDateTime = new DateTime(2026, 9, 2),
            AvailabilityType = AvailabilityType.Leave,
        };
        var result = await controller.Update(availabilityId, updateDto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAvailabilityDto>>(badRequest.Value);
        Assert.Contains("staff member", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StaffAssignments_Create_StaffFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var foreignStaff = SeedUserInTenant(db, tenantBId, "Foreign", "Staff");
        var trip = SeedTrip(db, tenantAId);
        var controller = new StaffAssignmentsController(db);

        var dto = new CreateStaffAssignmentDto
        {
            TripInstanceId = trip.Id, StaffId = foreignStaff.Id,
            AssignmentStart = new DateOnly(2026, 9, 1), AssignmentEnd = new DateOnly(2026, 9, 3),
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(badRequest.Value);
        Assert.Contains("staff member", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.StaffAssignments.ToListAsync());
    }

    [Fact]
    public async Task StaffAssignments_Create_InactiveStaff_ReturnsBadRequest()
    {
        var (db, tenantAId, _) = CreateDbWithTwoTenants();
        var inactiveStaff = SeedUserInTenant(db, tenantAId, "Inactive", "Staff");
        inactiveStaff.IsActive = false;
        db.SaveChanges();
        var trip = SeedTrip(db, tenantAId);
        var controller = new StaffAssignmentsController(db);

        var dto = new CreateStaffAssignmentDto
        {
            TripInstanceId = trip.Id, StaffId = inactiveStaff.Id,
            AssignmentStart = new DateOnly(2026, 9, 1), AssignmentEnd = new DateOnly(2026, 9, 3),
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(badRequest.Value);
        Assert.Contains("staff member", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StaffAssignments_Update_StaffFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var ownStaff = SeedUserInTenant(db, tenantAId, "Own", "Staff");
        var foreignStaff = SeedUserInTenant(db, tenantBId, "Foreign", "Staff");
        var trip = SeedTrip(db, tenantAId);
        var controller = new StaffAssignmentsController(db);

        var created = await controller.Create(
            new CreateStaffAssignmentDto
            {
                TripInstanceId = trip.Id, StaffId = ownStaff.Id,
                AssignmentStart = new DateOnly(2026, 9, 1), AssignmentEnd = new DateOnly(2026, 9, 3),
            }, CancellationToken.None);
        var assignmentId = Assert.IsType<ApiResponse<StaffAssignmentDto>>(
            Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;

        var updateDto = new UpdateStaffAssignmentDto
        {
            TripInstanceId = trip.Id, StaffId = foreignStaff.Id,
            AssignmentStart = new DateOnly(2026, 9, 1), AssignmentEnd = new DateOnly(2026, 9, 3),
        };
        var result = await controller.Update(assignmentId, updateDto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(badRequest.Value);
        Assert.Contains("staff member", body.Errors![0], StringComparison.OrdinalIgnoreCase);

        var reloaded = await db.StaffAssignments.SingleAsync(a => a.Id == assignmentId);
        Assert.Equal(ownStaff.Id, reloaded.UserId); // unchanged
    }

    // ── Tasks: task owner ────────────────────────────────────────────────

    [Fact]
    public async Task Tasks_OwnerFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var foreignOwner = SeedUserInTenant(db, tenantBId, "Foreign", "Owner");
        var trip = SeedTrip(db, tenantAId);
        var controller = new TasksController(db);

        var dto = new CreateTaskDto { TripInstanceId = trip.Id, TaskType = TaskType.Other, Title = "Follow up", OwnerId = foreignOwner.Id };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<TaskDto>>(badRequest.Value);
        Assert.Contains("owner", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    // ── Participants: preferred-staff (now preferred-user) ──────────────

    [Fact]
    public async Task Participants_PreferredUserFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var foreignPreferred = SeedUserInTenant(db, tenantBId, "Foreign", "Preferred");
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

        var dto = new CreateParticipantDto { FirstName = "Amy", LastName = "Ng", PreferredStaffId = foreignPreferred.Id };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("preferred", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    // ── Rostering: shift assignment + compatibility linking ─────────────

    [Fact]
    public async Task Rostering_ShiftStaffFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var foreignStaff = SeedUserInTenant(db, tenantBId, "Foreign", "Staff");
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantAId, FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));
        var dto = new CreateShiftDto
        {
            ParticipantId = participant.Id, StaffId = foreignStaff.Id, ServiceDate = new DateOnly(2026, 9, 1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        };
        var result = await controller.CreateShift(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(badRequest.Value);
        Assert.Contains("staff member", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Rostering_CompatibilityStaffFromAnotherTenant_ReturnsBadRequest()
    {
        var (db, tenantAId, tenantBId) = CreateDbWithTwoTenants();
        var foreignStaff = SeedUserInTenant(db, tenantBId, "Foreign", "Staff");
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantAId, FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db));
        var dto = new UpsertCompatibilityDto { StaffId = foreignStaff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Preferred };
        var result = await controller.UpsertCompatibility(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<CompatibilityRowDto>>(badRequest.Value);
        Assert.Contains("staff member", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    // ── Helper ────────────────────────────────────────────────────────

    private static TripInstance SeedTrip(OdipDbContext db, Guid tenantId)
    {
        var trip = new TripInstance
        {
            Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Test Trip", StartDate = new DateOnly(2026, 9, 1),
            DurationDays = 3, Status = TripStatus.Draft,
        };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }
}
