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
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Search;

/// <summary>
/// The medication register, the contact picker and the trips list searched with a plain <c>.Contains(text)</c>, which is case-sensitive on PostgreSQL (and in these InMemory tests too), so
/// "paracetamol" never found "Paracetamol". They lower-case both sides, as <c>ParticipantQueries.SearchByName</c> does for the participant register.
/// </summary>
public class SearchBoxCaseTests
{
    private static (OdipDbContext Db, ICurrentTenant Tenant) CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return (new OdipDbContext(options, tenant.Object), tenant.Object);
    }

    [Fact]
    public async Task MedicationRegister_FindsAMedicineAndAParticipantWhateverTheCaseTyped()
    {
        var (db, tenant) = CreateDb();
        var smith = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Smith", IsActive = true };
        var lee = new Participant { Id = Guid.NewGuid(), FirstName = "Harrison", LastName = "Lee", IsActive = true };
        db.Participants.AddRange(smith, lee);
        db.ParticipantMedications.AddRange(
            new ParticipantMedication { Id = Guid.NewGuid(), ParticipantId = smith.Id, Name = "Paracetamol", Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true },
            new ParticipantMedication { Id = Guid.NewGuid(), ParticipantId = lee.Id, Name = "Ibuprofen", Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true });
        db.SaveChanges();
        var controller = new MedicationsController(db, tenant);

        async Task<List<string>> Names(string search)
        {
            var result = await controller.GetRegister(search, null, ct: CancellationToken.None);
            return Assert.IsType<ApiResponse<PagedResult<MedicationListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Items.Select(m => m.Name).ToList();
        }

        Assert.Equal(new[] { "Paracetamol" }, await Names("paracetamol"));
        Assert.Equal(new[] { "Paracetamol" }, await Names("SOPHIE smith"));
    }

    [Fact]
    public async Task ContactPicker_FindsAPersonByNameOrOrganisationWhateverTheCaseTyped()
    {
        var (db, _) = CreateDb();
        db.People.AddRange(
            new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Smith", Organisation = "Blue Mountains Respite" },
            new Person { Id = Guid.NewGuid(), FirstName = "David", LastName = "Brown" });
        db.SaveChanges();
        var controller = new PersonsController(db);

        async Task<List<string>> Names(string search)
        {
            var result = await controller.GetAll(search, CancellationToken.None);
            return Assert.IsType<ApiResponse<List<PersonDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Select(p => p.FullName).ToList();
        }

        Assert.Equal(new[] { "Karen Smith" }, await Names("smith"));
        Assert.Equal(new[] { "Karen Smith" }, await Names("blue mountains"));
    }

    [Fact]
    public async Task TripsList_FindsATripByNameOrDestinationWhateverTheCaseTyped()
    {
        var (db, _) = CreateDb();
        db.TripInstances.AddRange(
            new TripInstance { Id = Guid.NewGuid(), TripName = "Blue Mountains Escape", Destination = "Katoomba", StartDate = new DateOnly(2026, 11, 1), DurationDays = 3, Status = TripStatus.Planning },
            new TripInstance { Id = Guid.NewGuid(), TripName = "Gold Coast Beach Break", Destination = "Burleigh Heads", StartDate = new DateOnly(2026, 11, 8), DurationDays = 3, Status = TripStatus.Planning });
        db.SaveChanges();
        var controller = new TripsController(db, Mock.Of<ILogger<TripsController>>());

        async Task<List<string>> Names(string search)
        {
            var result = await controller.GetAll(null, null, search, null, null, ct: CancellationToken.None);
            return Assert.IsType<ApiResponse<PagedResult<TripListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Items.Select(t => t.TripName).ToList();
        }

        Assert.Equal(new[] { "Blue Mountains Escape" }, await Names("blue mountains"));
        Assert.Equal(new[] { "Blue Mountains Escape" }, await Names("KATOOMBA"));
    }
}
