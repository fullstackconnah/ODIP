using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Api.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>H47-2/3/4: PostgreSQL gives no stable order for rows tied on the sort key across separate OFFSET/LIMIT queries, so each list needs a unique last key. Rows are stored out of id order, all tied, and read two to a page.</summary>
public class PagingTiebreakPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public PagingTiebreakPostgresTests(PostgresFixture pg) => _pg = pg;

    private static readonly int[] StoredAs = [5, 2, 8, 1, 9, 3, 7, 4, 6];
    private static Guid IdOf(int n) => new($"00000000-0000-0000-0000-{n:D12}");

    [SkippableFact]
    public async Task AdminUsers_PageInIdOrder_WhenNamesTie()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        foreach (var n in StoredAs)
        {
            db.Users.Add(new User { Id = IdOf(n), Email = $"{n}@example.com", Username = $"u{n}", FirstName = "Sam", LastName = "Lee", Role = UserRole.SupportWorker, IsActive = true, TenantId = tenantId });
            await db.SaveChangesAsync();
        }
        var controller = new AdminUsersController(db, NullLogger<AdminUsersController>.Instance, Mock.Of<IFirebaseUserService>());

        var seen = new List<Guid>();
        for (var page = 1; page <= 5; page++)
        {
            var body = Assert.IsType<ApiResponse<PagedResult<AdminUserDto>>>(Assert.IsType<OkObjectResult>(await controller.GetAll(tenantId, null, null, null, page, 2, default)).Value);
            seen.AddRange(body.Data!.Items.Select(i => i.Id));
        }
        Assert.Equal(Enumerable.Range(1, 9).Select(IdOf), seen);
    }

    [SkippableFact]
    public async Task MedicationAdministrationReport_PageInIdDescendingOrder_WhenDosesTie()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true, TenantId = tenantId };
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Panadol", DoseDescription = "1 tablet", Type = MedicationType.Regular,
            TimesOfDay = "08:00", Frequency = MedicationFrequency.Daily, Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), TenantId = tenantId,
        };
        db.Participants.Add(participant);
        db.ParticipantMedications.Add(med);
        await db.SaveChangesAsync();
        foreach (var n in StoredAs)
        {
            db.MedicationAdministrations.Add(new MedicationAdministration
            {
                Id = IdOf(n), ParticipantMedicationId = med.Id, ParticipantId = participant.Id, TenantId = tenantId, Status = MedicationAdministrationStatus.Administered,
                AdministeredAt = new DateTime(2026, 9, 8, 8, 0, 0, DateTimeKind.Utc), WitnessStatus = WitnessStatus.Pending, RecordedByName = "Test",
            });
            await db.SaveChangesAsync();
        }
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        var controller = new MedicationsController(db, tenant.Object);

        var seen = new List<Guid>();
        for (var page = 1; page <= 5; page++)
        {
            var result = await controller.GetAdministrationReport(null, null, null, page, 2, default);
            var body = Assert.IsType<ApiResponse<PagedResult<AdministrationDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
            seen.AddRange(body.Data!.Items.Select(i => i.Id));
        }
        Assert.Equal(Enumerable.Range(1, 9).Reverse().Select(IdOf), seen);
    }

    [SkippableFact]
    public async Task Trips_PageInIdOrder_WhenStartDatesTie()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        foreach (var n in StoredAs)
        {
            db.TripInstances.Add(new TripInstance { Id = IdOf(n), TenantId = tenantId, TripName = $"Trip {n}", StartDate = new DateOnly(2026, 10, 12), DurationDays = 3 });
            await db.SaveChangesAsync();
        }
        var controller = new TripsController(db, NullLogger<TripsController>.Instance);

        var seen = new List<Guid>();
        for (var page = 1; page <= 5; page++)
        {
            var result = await controller.GetAll(null, null, null, null, null, false, page, 2, default);
            var body = Assert.IsType<ApiResponse<PagedResult<TripListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
            seen.AddRange(body.Data!.Items.Select(i => i.Id));
        }
        Assert.Equal(Enumerable.Range(1, 9).Select(IdOf), seen);
    }
}
