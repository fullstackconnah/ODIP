using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;

namespace Odip.Tests.Security;

/// <summary>
/// The caller in every cross-tenant test is a tenant-scoped (not SuperAdmin) user of organisation <see cref="A"/>, and the rows under test belong to
/// organisation <see cref="B"/>: the query filters then hide B's rows exactly as they do in production, and a controller that finds one anyway has leaked.
/// </summary>
internal static class CrossTenant
{
    public static readonly Guid A = Guid.NewGuid();
    public static readonly Guid B = Guid.NewGuid();

    public static OdipDbContext Db(Guid? tenantId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId ?? A);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    public static User User(OdipDbContext db, Guid tenantId)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Hill", Username = Guid.NewGuid().ToString(),
            Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    public static Participant Participant(OdipDbContext db, Guid tenantId)
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Lee", NdisNumber = "43188882222", PlanType = PlanType.SelfManaged };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    public static TripInstance Trip(OdipDbContext db, Guid tenantId)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip", StartDate = new DateOnly(2026, 2, 1), DurationDays = 3 };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    public static Vehicle Vehicle(OdipDbContext db, Guid tenantId)
    {
        var vehicle = new Vehicle { Id = Guid.NewGuid(), TenantId = tenantId, VehicleName = "Van", Registration = "ABC123", TotalSeats = 8, WheelchairPositions = 1 };
        db.Vehicles.Add(vehicle);
        db.SaveChanges();
        return vehicle;
    }
}
