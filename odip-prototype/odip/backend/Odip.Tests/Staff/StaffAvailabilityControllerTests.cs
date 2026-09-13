using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Staff;

/// <summary>
/// GET api/v1/staff-availability (Deliverable 3) — a query surface over the legacy StaffAvailability
/// table, filterable by userId and a from/to window. No such GET existed before this task; only
/// POST/PUT/DELETE lived on StaffAvailabilityController.
/// </summary>
public class StaffAvailabilityControllerTests
{
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static User SeedUser(OdipDbContext db)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static StaffAvailability SeedAvailability(
        OdipDbContext db, Guid userId, DateTime start, DateTime end, AvailabilityType type = AvailabilityType.Unavailable)
    {
        var availability = new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = userId, StartDateTime = start, EndDateTime = end, AvailabilityType = type,
        };
        db.StaffAvailabilities.Add(availability);
        db.SaveChanges();
        return availability;
    }

    [Fact]
    public async Task GetAll_FiltersByUserId()
    {
        using var db = CreateDb();
        var user1 = SeedUser(db);
        var user2 = SeedUser(db);
        SeedAvailability(db, user1.Id, new DateTime(2026, 9, 1), new DateTime(2026, 9, 2));
        SeedAvailability(db, user2.Id, new DateTime(2026, 9, 1), new DateTime(2026, 9, 2));

        var controller = new StaffAvailabilityController(db);
        var result = await controller.GetAll(user1.Id, null, null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<StaffAvailabilityDto>>>(ok.Value);
        var row = Assert.Single(body.Data!);
        Assert.Equal(user1.Id, row.StaffId);
    }

    [Fact]
    public async Task GetAll_FiltersByFromToWindow()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var inWindow = SeedAvailability(db, user.Id, new DateTime(2026, 9, 10), new DateTime(2026, 9, 12));
        var beforeWindow = SeedAvailability(db, user.Id, new DateTime(2026, 8, 1), new DateTime(2026, 8, 2));
        var afterWindow = SeedAvailability(db, user.Id, new DateTime(2026, 10, 1), new DateTime(2026, 10, 2));

        var controller = new StaffAvailabilityController(db);
        var result = await controller.GetAll(null, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<StaffAvailabilityDto>>>(ok.Value);
        var row = Assert.Single(body.Data!);
        Assert.Equal(inWindow.Id, row.Id);
        Assert.DoesNotContain(body.Data!, r => r.Id == beforeWindow.Id);
        Assert.DoesNotContain(body.Data!, r => r.Id == afterWindow.Id);
    }

    [Fact]
    public async Task GetAll_OrdersByStartDateTimeDescending()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var earlier = SeedAvailability(db, user.Id, new DateTime(2026, 9, 1), new DateTime(2026, 9, 2));
        var later = SeedAvailability(db, user.Id, new DateTime(2026, 9, 15), new DateTime(2026, 9, 16));

        var controller = new StaffAvailabilityController(db);
        var result = await controller.GetAll(user.Id, null, null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<StaffAvailabilityDto>>>(ok.Value);
        Assert.Equal(new[] { later.Id, earlier.Id }, body.Data!.Select(r => r.Id));
    }
}
