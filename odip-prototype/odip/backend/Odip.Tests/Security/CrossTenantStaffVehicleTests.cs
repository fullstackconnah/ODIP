using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Security;

/// <summary>
/// VehicleAssignment, StaffAssignment and StaffAvailability have no organisation column and no query filter, so an endpoint that loads one by its id (or reads it by a vehicle or
/// staff id from the route) answered for any organisation. Each route below starts from a tenant-filtered parent (the trip, the vehicle, the user) and a row of another
/// organisation is "not found". An id of another organisation in a request body (a vehicle, a trip) is refused too.
/// </summary>
public class CrossTenantStaffVehicleTests
{
    private static VehicleAssignment PlantVehicleAssignment(OdipDbContext db, Guid tenantId, out Vehicle vehicle, out TripInstance trip)
    {
        vehicle = Vehicle(db, tenantId);
        trip = Trip(db, tenantId);
        var assignment = new VehicleAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, VehicleId = vehicle.Id, Status = VehicleAssignmentStatus.Requested };
        db.VehicleAssignments.Add(assignment);
        db.SaveChanges();
        return assignment;
    }

    private static StaffAssignment PlantStaffAssignment(OdipDbContext db, Guid tenantId, out User staff, out TripInstance trip)
    {
        staff = User(db, tenantId);
        trip = Trip(db, tenantId);
        var assignment = new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = staff.Id, AssignmentStart = new DateOnly(2026, 2, 1), AssignmentEnd = new DateOnly(2026, 2, 3),
            Status = AssignmentStatus.Proposed,
        };
        db.StaffAssignments.Add(assignment);
        db.SaveChanges();
        return assignment;
    }

    private static StaffAvailability PlantAvailability(OdipDbContext db, Guid tenantId, out User staff)
    {
        staff = User(db, tenantId);
        var availability = new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, StartDateTime = new DateTime(2026, 9, 1), EndDateTime = new DateTime(2026, 9, 2), AvailabilityType = AvailabilityType.Unavailable,
        };
        db.StaffAvailabilities.Add(availability);
        db.SaveChanges();
        return availability;
    }

    // ── vehicle-assignments ────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task VehicleAssignmentCreate_VehicleOfAnotherTenant_IsRefused_AndWritesNothing()
    {
        using var db = Db();
        var trip = Trip(db, A);
        var foreignVehicle = Vehicle(db, B);

        var result = await new VehicleAssignmentsController(db).Create(new CreateVehicleAssignmentDto { TripInstanceId = trip.Id, VehicleId = foreignVehicle.Id }, CancellationToken.None);

        Assert.IsNotType<OkObjectResult>(result.Result);
        Assert.Empty(await db.VehicleAssignments.ToListAsync());
    }

    [Fact]
    public async Task VehicleAssignmentCheck_VehicleOfAnotherTenant_IsRefused()
    {
        using var db = Db();
        var trip = Trip(db, A);
        var foreignVehicle = Vehicle(db, B);

        var result = await new VehicleAssignmentsController(db).Check(new CheckVehicleAssignmentDto { TripInstanceId = trip.Id, VehicleId = foreignVehicle.Id }, CancellationToken.None);

        Assert.IsNotType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task VehicleAssignmentUpdate_AssignmentOfAnotherTenant_ReturnsNotFound_AndChangesNothing()
    {
        using var db = Db();
        var foreign = PlantVehicleAssignment(db, B, out var vehicle, out _);

        var result = await new VehicleAssignmentsController(db).Update(foreign.Id,
            new UpdateVehicleAssignmentDto { TripInstanceId = foreign.TripInstanceId, VehicleId = vehicle.Id, Status = VehicleAssignmentStatus.Cancelled, Comments = "hijacked" }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var stored = await db.VehicleAssignments.AsNoTracking().SingleAsync(a => a.Id == foreign.Id);
        Assert.Equal((VehicleAssignmentStatus.Requested, (string?)null), (stored.Status, stored.Comments));
    }

    [Fact]
    public async Task VehicleAssignmentUpdate_VehicleOfAnotherTenant_IsRefused_AndKeepsTheVehicle()
    {
        using var db = Db();
        var own = PlantVehicleAssignment(db, A, out var ownVehicle, out _);
        var foreignVehicle = Vehicle(db, B);

        var result = await new VehicleAssignmentsController(db).Update(own.Id,
            new UpdateVehicleAssignmentDto { TripInstanceId = own.TripInstanceId, VehicleId = foreignVehicle.Id, Status = VehicleAssignmentStatus.Requested }, CancellationToken.None);

        Assert.IsNotType<OkObjectResult>(result.Result);
        Assert.Equal(ownVehicle.Id, (await db.VehicleAssignments.AsNoTracking().SingleAsync(a => a.Id == own.Id)).VehicleId);
    }

    [Fact]
    public async Task VehicleAssignmentDelete_AssignmentOfAnotherTenant_ReturnsNotFound_AndCancelsNothing()
    {
        using var db = Db();
        var foreign = PlantVehicleAssignment(db, B, out _, out _);

        var result = await new VehicleAssignmentsController(db).Delete(foreign.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal(VehicleAssignmentStatus.Requested, (await db.VehicleAssignments.AsNoTracking().SingleAsync(a => a.Id == foreign.Id)).Status);
    }

    [Fact]
    public async Task VehicleAssignment_OwnRows_StillCreateUpdateAndCancel()
    {
        using var db = Db();
        var trip = Trip(db, A);
        var vehicle = Vehicle(db, A);
        var controller = new VehicleAssignmentsController(db);

        var created = await controller.Create(new CreateVehicleAssignmentDto { TripInstanceId = trip.Id, VehicleId = vehicle.Id }, CancellationToken.None);
        var id = Assert.IsType<Odip.Application.Common.ApiResponse<VehicleAssignmentDto>>(Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;

        var updated = await controller.Update(id, new UpdateVehicleAssignmentDto { TripInstanceId = trip.Id, VehicleId = vehicle.Id, Status = VehicleAssignmentStatus.Requested, Comments = "ok" }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updated.Result);

        Assert.IsType<OkObjectResult>((await controller.Delete(id, CancellationToken.None)).Result);
        Assert.Equal(VehicleAssignmentStatus.Cancelled, (await db.VehicleAssignments.AsNoTracking().SingleAsync(a => a.Id == id)).Status);
    }

    // ── staff/{id}/availability and staff/{id}/assignments ─────────────────────────────────────

    [Fact]
    public async Task StaffAvailabilityList_StaffOfAnotherTenant_ReturnsNotFound()
    {
        using var db = Db();
        PlantAvailability(db, B, out var foreignStaff);

        var result = await new StaffController(db).GetAvailability(foreignStaff.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task StaffAvailabilityList_OwnStaff_ReturnsTheirRows()
    {
        using var db = Db();
        var own = PlantAvailability(db, A, out var staff);

        var result = await new StaffController(db).GetAvailability(staff.Id, CancellationToken.None);

        var body = Assert.IsType<Odip.Application.Common.ApiResponse<List<StaffAvailabilityDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(own.Id, Assert.Single(body.Data!).Id);
    }

    [Fact]
    public async Task StaffAssignmentList_StaffOfAnotherTenant_ReturnsNotFound()
    {
        using var db = Db();
        PlantStaffAssignment(db, B, out var foreignStaff, out _);

        var result = await new StaffController(db).GetAssignments(foreignStaff.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // ── staff-availability ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task StaffAvailabilityUpdate_RowOfAnotherTenant_ReturnsNotFound_AndChangesNothing()
    {
        using var db = Db();
        var foreign = PlantAvailability(db, B, out _);
        var ownStaff = User(db, A);

        var result = await new StaffAvailabilityController(db).Update(foreign.Id,
            new UpdateStaffAvailabilityDto { StaffId = ownStaff.Id, StartDateTime = foreign.StartDateTime, EndDateTime = foreign.EndDateTime, AvailabilityType = AvailabilityType.Available, Notes = "hijacked" },
            CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var stored = await db.StaffAvailabilities.AsNoTracking().SingleAsync(a => a.Id == foreign.Id);
        Assert.Equal((AvailabilityType.Unavailable, (string?)null), (stored.AvailabilityType, stored.Notes));
    }

    [Fact]
    public async Task StaffAvailabilityDelete_RowOfAnotherTenant_ReturnsNotFound_AndDeletesNothing()
    {
        using var db = Db();
        var foreign = PlantAvailability(db, B, out _);

        var result = await new StaffAvailabilityController(db).Delete(foreign.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.True(await db.StaffAvailabilities.AnyAsync(a => a.Id == foreign.Id));
    }

    [Fact]
    public async Task StaffAvailabilityDelete_OwnRow_StillDeletes()
    {
        using var db = Db();
        var own = PlantAvailability(db, A, out _);

        Assert.IsType<OkObjectResult>((await new StaffAvailabilityController(db).Delete(own.Id, CancellationToken.None)).Result);
        Assert.False(await db.StaffAvailabilities.AnyAsync(a => a.Id == own.Id));
    }

    // ── staff-assignments ──────────────────────────────────────────────────────────────────────

    private static StaffAssignmentsController StaffAssignments(OdipDbContext db) => new(db, new StaffUnavailabilityQuery(db));

    [Fact]
    public async Task StaffAssignmentCreate_TripOfAnotherTenant_IsRefused_AndWritesNothing()
    {
        using var db = Db();
        var staff = User(db, A);
        var foreignTrip = Trip(db, B);

        var result = await StaffAssignments(db).Create(new CreateStaffAssignmentDto
        {
            TripInstanceId = foreignTrip.Id, StaffId = staff.Id, AssignmentStart = new DateOnly(2026, 2, 1), AssignmentEnd = new DateOnly(2026, 2, 3),
        }, CancellationToken.None);

        Assert.IsNotType<OkObjectResult>(result.Result);
        Assert.Empty(await db.StaffAssignments.ToListAsync());
    }

    [Fact]
    public async Task StaffAssignmentUpdate_AssignmentOfAnotherTenant_ReturnsNotFound_AndChangesNothing()
    {
        using var db = Db();
        var foreign = PlantStaffAssignment(db, B, out _, out _);
        var ownStaff = User(db, A);

        var result = await StaffAssignments(db).Update(foreign.Id, new UpdateStaffAssignmentDto
        {
            TripInstanceId = foreign.TripInstanceId, StaffId = ownStaff.Id, AssignmentStart = foreign.AssignmentStart, AssignmentEnd = foreign.AssignmentEnd,
            Status = AssignmentStatus.Cancelled, ShiftNotes = "hijacked",
        }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var stored = await db.StaffAssignments.AsNoTracking().SingleAsync(a => a.Id == foreign.Id);
        Assert.Equal((AssignmentStatus.Proposed, foreign.UserId), (stored.Status, stored.UserId));
    }

    [Fact]
    public async Task StaffAssignmentDelete_AssignmentOfAnotherTenant_ReturnsNotFound_AndCancelsNothing()
    {
        using var db = Db();
        var foreign = PlantStaffAssignment(db, B, out _, out _);

        var result = await StaffAssignments(db).Delete(foreign.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal(AssignmentStatus.Proposed, (await db.StaffAssignments.AsNoTracking().SingleAsync(a => a.Id == foreign.Id)).Status);
    }

    [Fact]
    public async Task StaffAssignment_OwnRows_StillCreateAndCancel()
    {
        using var db = Db();
        var staff = User(db, A);
        var trip = Trip(db, A);
        var controller = StaffAssignments(db);

        var created = await controller.Create(new CreateStaffAssignmentDto
        {
            TripInstanceId = trip.Id, StaffId = staff.Id, AssignmentStart = new DateOnly(2026, 2, 1), AssignmentEnd = new DateOnly(2026, 2, 3),
        }, CancellationToken.None);
        var id = Assert.IsType<Odip.Application.Common.ApiResponse<StaffAssignmentDto>>(Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;

        Assert.IsType<OkObjectResult>((await controller.Delete(id, CancellationToken.None)).Result);
        Assert.Equal(AssignmentStatus.Cancelled, (await db.StaffAssignments.AsNoTracking().SingleAsync(a => a.Id == id)).Status);
    }
}
