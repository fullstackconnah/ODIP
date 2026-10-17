using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Controllers;

/// <summary>
/// TRIPS-2: Restore used to PUT the list row back, and the list row has no contact, notes or access details, so a restore wiped them.
/// Restore now only flips IsActive, and every other column survives.
/// </summary>
public class ArchiveRestoreTests
{
    [Fact]
    public async Task AccommodationRestore_KeepsEveryField()
    {
        using var db = Db();
        var p = new AccommodationProperty
        {
            Id = Guid.NewGuid(), TenantId = A, PropertyName = "Beach house", IsActive = false,
            ProviderOwner = "Owner", ContactPerson = "Casey", Email = "c@example.com", Phone = "0299990000", Mobile = "0400000000",
            Website = "https://example.com", AccessibilityNotes = "Ramp", BeddingConfiguration = "2 queens", HoistBathroomNotes = "Hoist", GeneralNotes = "Notes",
        };
        db.AccommodationProperties.Add(p);
        db.SaveChanges();

        Assert.IsType<OkObjectResult>((await new AccommodationController(db).Restore(p.Id, CancellationToken.None)).Result);

        var after = db.AccommodationProperties.Single(x => x.Id == p.Id);
        Assert.True(after.IsActive);
        Assert.Equal(
            ("Owner", "Casey", "c@example.com", "0299990000", "0400000000", "https://example.com", "Ramp", "2 queens", "Hoist", "Notes"),
            (after.ProviderOwner, after.ContactPerson, after.Email, after.Phone, after.Mobile, after.Website, after.AccessibilityNotes, after.BeddingConfiguration, after.HoistBathroomNotes, after.GeneralNotes));
    }

    [Fact]
    public async Task VehicleRestore_KeepsEveryField()
    {
        using var db = Db();
        var v = new Vehicle { Id = Guid.NewGuid(), TenantId = A, VehicleName = "Bus", IsActive = false, RampHoistDetails = "Rear hoist", DriverRequirements = "MR licence", Notes = "Notes" };
        db.Vehicles.Add(v);
        db.SaveChanges();

        Assert.IsType<OkObjectResult>((await new VehiclesController(db).Restore(v.Id, CancellationToken.None)).Result);

        var after = db.Vehicles.Single(x => x.Id == v.Id);
        Assert.True(after.IsActive);
        Assert.Equal(("Rear hoist", "MR licence", "Notes"), (after.RampHoistDetails, after.DriverRequirements, after.Notes));
    }

    [Fact]
    public async Task Restore_RowOfAnotherTenant_IsNotFound()
    {
        using var db = Db();
        var p = new AccommodationProperty { Id = Guid.NewGuid(), TenantId = B, PropertyName = "Theirs", IsActive = false };
        var v = new Vehicle { Id = Guid.NewGuid(), TenantId = B, VehicleName = "Theirs", IsActive = false };
        db.AccommodationProperties.Add(p);
        db.Vehicles.Add(v);
        db.SaveChanges();

        Assert.IsType<NotFoundObjectResult>((await new AccommodationController(db).Restore(p.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await new VehiclesController(db).Restore(v.Id, CancellationToken.None)).Result);
    }

    // An edit form loaded before someone else archived (or restored) the row sends the flag it loaded; only Archive and Restore may change it.
    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task AccommodationEdit_LeavesIsActiveAlone(bool storedActive, bool bodyActive)
    {
        using var db = Db();
        var p = new AccommodationProperty { Id = Guid.NewGuid(), TenantId = A, PropertyName = "Beach house", IsActive = storedActive };
        db.AccommodationProperties.Add(p);
        db.SaveChanges();

        var result = await new AccommodationController(db).Update(p.Id, new UpdateAccommodationDto { PropertyName = "Renamed", IsActive = bodyActive }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var after = db.AccommodationProperties.Single(x => x.Id == p.Id);
        Assert.Equal("Renamed", after.PropertyName);
        Assert.Equal(storedActive, after.IsActive);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task VehicleEdit_LeavesIsActiveAlone(bool storedActive, bool bodyActive)
    {
        using var db = Db();
        var v = new Vehicle { Id = Guid.NewGuid(), TenantId = A, VehicleName = "Bus", IsActive = storedActive };
        db.Vehicles.Add(v);
        db.SaveChanges();

        var result = await new VehiclesController(db).Update(v.Id, new UpdateVehicleDto { VehicleName = "Renamed", IsActive = bodyActive }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var after = db.Vehicles.Single(x => x.Id == v.Id);
        Assert.Equal("Renamed", after.VehicleName);
        Assert.Equal(storedActive, after.IsActive);
    }
}
