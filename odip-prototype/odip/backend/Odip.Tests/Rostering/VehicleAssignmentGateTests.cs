using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Xunit;
using Odip.Tests.Support;
using Odip.Infrastructure.Rostering;

namespace Odip.Tests.Rostering;

/// <summary>
/// VehicleAssignmentsController's parity with StaffAssignmentsController: the same
/// Blocking/RequiresReason/override gate (via RosterGate), HasConflict correctly derived on both
/// create and update, /check never writing. Exactly the three rules from the 2026-09-09 audit
/// ruling — same-vehicle overlap (Blocking), over-seats and over-wheelchair (RequiresReason).
/// See RosterConflictService.CheckVehicleAssignment and RosterConflictServiceTests for the pure
/// domain-rule coverage; these tests exercise the controller/gate wiring on top of that.
/// </summary>
public class VehicleAssignmentGateTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    private static Vehicle SeedVehicle(OdipDbContext db, int totalSeats = 10, int wheelchairPositions = 2)
    {
        var vehicle = new Vehicle
        {
            Id = Guid.NewGuid(), VehicleName = "Bus 1", VehicleType = VehicleType.Bus,
            TotalSeats = totalSeats, WheelchairPositions = wheelchairPositions, IsActive = true,
        };
        db.Vehicles.Add(vehicle);
        db.SaveChanges();
        return vehicle;
    }

    private static TripInstance SeedTrip(OdipDbContext db, DateOnly start, int days = 3)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Beach Trip", StartDate = start, DurationDays = days };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static void SeedConfirmedBookings(OdipDbContext db, Guid tripId, int count, int wheelchairCount = 0)
    {
        for (var i = 0; i < count; i++)
        {
            var participant = new Participant { Id = Guid.NewGuid(), FirstName = "P", LastName = i.ToString() };
            db.Participants.Add(participant);
            db.ParticipantBookings.Add(new ParticipantBooking
            {
                Id = Guid.NewGuid(), TripInstanceId = tripId, ParticipantId = participant.Id,
                BookingStatus = BookingStatus.Confirmed, BookingDate = DateOnly.FromDateTime(DateTime.UtcNow),
                WheelchairRequired = i < wheelchairCount,
            });
        }
        db.SaveChanges();
    }

    private static CreateVehicleAssignmentDto CreateDto(Guid tripId, Guid vehicleId, string? overrideReason = null) => new()
    {
        TripInstanceId = tripId, VehicleId = vehicleId, OverrideReason = overrideReason,
    };

    [Fact]
    public async Task Check_OverlappingOtherAssignment_ReturnsVehicleDoubleBookedFinding_AndNeverWrites()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        var otherTrip = SeedTrip(db, new DateOnly(2026, 9, 11));
        db.VehicleAssignments.Add(new VehicleAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = otherTrip.Id, VehicleId = vehicle.Id,
            Status = VehicleAssignmentStatus.Confirmed,
        });
        db.SaveChanges();

        var controller = new VehicleAssignmentsController(db);
        var dto = new CheckVehicleAssignmentDto { VehicleId = vehicle.Id, TripInstanceId = trip.Id };

        var result = await controller.Check(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(ok.Value);
        Assert.Contains(body.Data!, f => f.Code == RosterConflictService.VehicleDoubleBooked);
        Assert.Single(await db.VehicleAssignments.ToListAsync()); // only the seeded row — check never writes
    }

    [Fact]
    public async Task Check_NonOverlappingOtherAssignment_ReturnsNoFindings()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10), days: 2);
        var otherTrip = SeedTrip(db, new DateOnly(2026, 9, 20), days: 2);
        db.VehicleAssignments.Add(new VehicleAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = otherTrip.Id, VehicleId = vehicle.Id,
            Status = VehicleAssignmentStatus.Confirmed,
        });
        db.SaveChanges();

        var controller = new VehicleAssignmentsController(db);
        var dto = new CheckVehicleAssignmentDto { VehicleId = vehicle.Id, TripInstanceId = trip.Id };

        var result = await controller.Check(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(ok.Value);
        Assert.Empty(body.Data!);
    }

    [Fact]
    public async Task Create_OverlappingAssignment_WithReason_StillReturns422_AndDoesNotSave()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        var otherTrip = SeedTrip(db, new DateOnly(2026, 9, 11));
        db.VehicleAssignments.Add(new VehicleAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = otherTrip.Id, VehicleId = vehicle.Id,
            Status = VehicleAssignmentStatus.Confirmed,
        });
        db.SaveChanges();

        var controller = new VehicleAssignmentsController(db);
        var dto = CreateDto(trip.Id, vehicle.Id, overrideReason: "please override");

        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.Single(await db.VehicleAssignments.ToListAsync()); // still just the seeded row
    }

    [Fact]
    public async Task Create_OverSeats_NoReason_Returns422_AndDoesNotSave()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db, totalSeats: 4);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedConfirmedBookings(db, trip.Id, count: 5);

        var controller = new VehicleAssignmentsController(db);
        var dto = CreateDto(trip.Id, vehicle.Id);

        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.Empty(await db.VehicleAssignments.ToListAsync());
    }

    [Fact]
    public async Task Create_OverSeats_WithReason_Succeeds_SetsHasConflictTrue_RecordsCode()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db, totalSeats: 4);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedConfirmedBookings(db, trip.Id, count: 5);

        var controller = new VehicleAssignmentsController(db);
        var dto = CreateDto(trip.Id, vehicle.Id, overrideReason: "Coordinator approved extra participant.");

        var result = await controller.Create(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<VehicleAssignmentDto>>(ok.Value);
        Assert.True(body.Data!.HasConflict);
        Assert.Equal("Coordinator approved extra participant.", body.Data.OverrideReason);
        Assert.Contains(RosterConflictService.VehicleOverSeats, body.Data.AcknowledgedFindingCodes);

        var saved = await db.VehicleAssignments.SingleAsync();
        Assert.True(saved.HasConflict);
    }

    [Fact]
    public async Task Create_OverWheelchairPositions_NoReason_Returns422_WithVehicleOverWheelchairCode()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db, wheelchairPositions: 1);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedConfirmedBookings(db, trip.Id, count: 2, wheelchairCount: 2);

        var controller = new VehicleAssignmentsController(db);
        var dto = CreateDto(trip.Id, vehicle.Id);

        var result = await controller.Create(dto, CancellationToken.None);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(unprocessable.Value);
        Assert.Contains(body.Data!, f => f.Code == RosterConflictService.VehicleOverWheelchair && f.RequiresReason);
        Assert.Empty(await db.VehicleAssignments.ToListAsync());
    }

    [Fact]
    public async Task Create_WithinCapacity_NoOverlap_Succeeds_HasOverlapConflictFalse_HasConflictFalse()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db, totalSeats: 10, wheelchairPositions: 2);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedConfirmedBookings(db, trip.Id, count: 3, wheelchairCount: 1);

        var controller = new VehicleAssignmentsController(db);
        var dto = CreateDto(trip.Id, vehicle.Id);

        var result = await controller.Create(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<VehicleAssignmentDto>>(ok.Value);
        Assert.False(body.Data!.HasOverlapConflict);
        Assert.False(body.Data.HasConflict);
        Assert.Null(body.Data.OverrideReason);
    }

    [Fact]
    public async Task Update_MovingToVehicleWithEnoughCapacity_ClearsHasConflictAndOverrideReason()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var smallVehicle = SeedVehicle(db, totalSeats: 1);
        var roomyVehicle = SeedVehicle(db, totalSeats: 10);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedConfirmedBookings(db, trip.Id, count: 2);

        var controller = new VehicleAssignmentsController(db);
        var createResult = await controller.Create(
            CreateDto(trip.Id, smallVehicle.Id, overrideReason: "Over capacity but approved."),
            CancellationToken.None);
        var created = ((ApiResponse<VehicleAssignmentDto>)((OkObjectResult)createResult.Result!).Value!).Data!;
        Assert.True(created.HasConflict);

        // Move to a vehicle with enough seats for the same trip's confirmed participants — the
        // over-seats finding no longer fires, so HasConflict/OverrideReason should clear.
        var updateDto = new UpdateVehicleAssignmentDto
        {
            TripInstanceId = trip.Id, VehicleId = roomyVehicle.Id, Status = VehicleAssignmentStatus.Requested,
        };
        var updateResult = await controller.Update(created.Id, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<VehicleAssignmentDto>>(ok.Value);
        Assert.False(body.Data!.HasConflict);
        Assert.Null(body.Data.OverrideReason);
    }

    [Fact]
    public async Task Update_WithExcludeAssignmentId_DoesNotDoubleBookAgainstItself()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));

        var controller = new VehicleAssignmentsController(db);
        var createResult = await controller.Create(CreateDto(trip.Id, vehicle.Id), CancellationToken.None);
        var created = ((ApiResponse<VehicleAssignmentDto>)((OkObjectResult)createResult.Result!).Value!).Data!;

        // Updating the same row with the same trip/vehicle must not double-book against its own prior row.
        var updateDto = new UpdateVehicleAssignmentDto
        {
            TripInstanceId = trip.Id, VehicleId = vehicle.Id, Status = VehicleAssignmentStatus.Confirmed,
        };
        var updateResult = await controller.Update(created.Id, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<VehicleAssignmentDto>>(ok.Value);
        Assert.False(body.Data!.HasConflict);
        Assert.Equal(VehicleAssignmentStatus.Confirmed, body.Data.Status);
    }

    [Fact]
    public async Task Update_StatusCancelled_SkipsGate_NoOverrideReasonRequired()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db, totalSeats: 4);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedConfirmedBookings(db, trip.Id, count: 5);

        var controller = new VehicleAssignmentsController(db);
        var createResult = await controller.Create(
            CreateDto(trip.Id, vehicle.Id, overrideReason: "Covering shortfall."),
            CancellationToken.None);
        var created = ((ApiResponse<VehicleAssignmentDto>)((OkObjectResult)createResult.Result!).Value!).Data!;
        Assert.True(created.HasConflict);

        var updateDto = new UpdateVehicleAssignmentDto
        {
            TripInstanceId = trip.Id, VehicleId = vehicle.Id, Status = VehicleAssignmentStatus.Cancelled,
        };
        var updateResult = await controller.Update(created.Id, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<VehicleAssignmentDto>>(ok.Value);
        Assert.Equal(VehicleAssignmentStatus.Cancelled, body.Data!.Status);

        var saved = await db.VehicleAssignments.SingleAsync(x => x.Id == created.Id);
        Assert.Equal(VehicleAssignmentStatus.Cancelled, saved.Status);
    }

    private static string Json(object? o) => System.Text.Json.JsonSerializer.Serialize(o, new System.Text.Json.JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });

    private static User SeedDriver(OdipDbContext db, bool eligible = true, DateOnly? licenceExpiry = null)
    {
        var u = new User
        {
            Id = Guid.NewGuid(), Email = Guid.NewGuid() + "@x.test", FirstName = "Dana", LastName = "Driver", IsActive = true,
            IsDriverEligible = eligible, DriverLicenceExpiryDate = licenceExpiry,
        };
        db.Users.Add(u);
        db.SaveChanges();
        return u;
    }

    [Fact]
    public async Task Create_ArchivedVehicle_Returns400()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db);
        vehicle.IsActive = false;
        db.SaveChanges();
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));

        var result = await new VehicleAssignmentsController(db).Create(CreateDto(trip.Id, vehicle.Id), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("This vehicle is archived. Choose another vehicle.", Assert.Single(Assert.IsType<ApiResponse<VehicleAssignmentDto>>(bad.Value).Errors!));
        Assert.Empty(await db.VehicleAssignments.ToListAsync());
    }

    [Fact]
    public async Task Update_ToAnArchivedVehicle_Returns400_ButEditingAnAssignmentWhoseVehicleWasArchivedStillSaves()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var live = SeedVehicle(db);
        var archived = SeedVehicle(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        var assignment = new VehicleAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, VehicleId = live.Id, Status = VehicleAssignmentStatus.Requested };
        db.VehicleAssignments.Add(assignment);
        archived.IsActive = false;
        db.SaveChanges();
        var controller = new VehicleAssignmentsController(db);

        var switched = await controller.Update(assignment.Id, new UpdateVehicleAssignmentDto { VehicleId = archived.Id, Status = VehicleAssignmentStatus.Requested }, CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(switched.Result);
        Assert.Equal("This vehicle is archived. Choose another vehicle.", Assert.Single(Assert.IsType<ApiResponse<VehicleAssignmentDto>>(bad.Value).Errors!));

        live.IsActive = false;
        db.SaveChanges();
        var edited = await controller.Update(assignment.Id, new UpdateVehicleAssignmentDto { VehicleId = live.Id, Comments = "note", Status = VehicleAssignmentStatus.Requested }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(edited.Result);
    }

    [Theory]
    [InlineData(true, "2026-09-09", "Dana Driver's driver licence expires before this trip.")]
    [InlineData(false, null, "Dana Driver isn't marked as an eligible driver.")]
    public async Task Create_DriverNotFit_Returns422WithFinding_AndSavesWithAReason(bool eligible, string? expiry, string message)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        var driver = SeedDriver(db, eligible, expiry is null ? null : DateOnly.Parse(expiry));
        var controller = new VehicleAssignmentsController(db);

        var refused = await controller.Create(CreateDto(trip.Id, vehicle.Id) with { DriverStaffId = driver.Id }, CancellationToken.None);

        var rejected = Assert.IsType<UnprocessableEntityObjectResult>(refused.Result);
        Assert.Contains(message, Json(rejected.Value));
        Assert.Contains(RosterConflictService.VehicleDriverLicence, Json(rejected.Value));

        var saved = await controller.Create(CreateDto(trip.Id, vehicle.Id, "covering") with { DriverStaffId = driver.Id }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(saved.Result);
        Assert.Contains(RosterConflictService.VehicleDriverLicence, (await db.VehicleAssignments.SingleAsync()).AcknowledgedFindingCodes!);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("2026-09-10")]
    public async Task Create_EligibleDriverWithNoExpiryOrExpiryOnTheStartDay_HasNoFinding(string? expiry)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        var driver = SeedDriver(db, true, expiry is null ? null : DateOnly.Parse(expiry));

        var result = await new VehicleAssignmentsController(db).Create(CreateDto(trip.Id, vehicle.Id) with { DriverStaffId = driver.Id }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_DriverWithExpiredLicence_Returns422()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var vehicle = SeedVehicle(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        var driver = SeedDriver(db, true, new DateOnly(2026, 9, 9));
        var assignment = new VehicleAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, VehicleId = vehicle.Id, Status = VehicleAssignmentStatus.Requested };
        db.VehicleAssignments.Add(assignment);
        db.SaveChanges();

        var result = await new VehicleAssignmentsController(db).Update(assignment.Id,
            new UpdateVehicleAssignmentDto { VehicleId = vehicle.Id, DriverStaffId = driver.Id, Status = VehicleAssignmentStatus.Requested }, CancellationToken.None);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
    }
}
