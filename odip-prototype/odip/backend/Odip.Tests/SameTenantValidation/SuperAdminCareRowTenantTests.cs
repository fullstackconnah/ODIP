using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.SameTenantValidation;

/// <summary>
/// A SuperAdmin with no view-as tenant has no ambient tenant, so SaveChanges stamps nothing: a care row created
/// for a participant must take the PARTICIPANT's tenant, or it is an orphan no organisation can see.
/// </summary>
public class SuperAdminCareRowTenantTests
{
    private static readonly Guid TenantA = Guid.NewGuid();

    private static (OdipDbContext Db, ICurrentTenant Tenant, Participant P) Setup(bool superAdmin = true)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(superAdmin ? null : TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var p = new Participant { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(p);
        db.SaveChanges();
        return (db, tenant.Object, p);
    }

    private static async Task AssertAllInTenantA<T>(OdipDbContext db) where T : class, ITenantEntity
    {
        var rows = await db.Set<T>().IgnoreQueryFilters().ToListAsync();
        Assert.NotEmpty(rows);
        Assert.All(rows, r => Assert.Equal(TenantA, r.TenantId));
    }

    [Fact]
    public async Task Routine_Create_TakesParticipantTenant()
    {
        var (db, _, p) = Setup();
        var dto = new CreateParticipantRoutineDto { Title = "Morning", Description = "Wake gently.", Days = new[] { DayOfWeek.Monday } };
        Assert.IsType<OkObjectResult>((await new ParticipantRoutinesController(db).Create(p.Id, dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<ParticipantRoutine>(db);
    }

    [Fact]
    public async Task Routine_Create_ByTenantCoordinator_TakesTenant()
    {
        var (db, _, p) = Setup(superAdmin: false);
        var dto = new CreateParticipantRoutineDto { Title = "Morning", Description = "Wake gently.", Days = new[] { DayOfWeek.Monday } };
        Assert.IsType<OkObjectResult>((await new ParticipantRoutinesController(db).Create(p.Id, dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<ParticipantRoutine>(db);
    }

    [Fact]
    public async Task RiskEntry_Create_TakesParticipantTenant()
    {
        var (db, _, p) = Setup();
        var dto = new CreateParticipantRiskEntryDto { AtRiskParty = AtRiskParty.Participant, Description = "Falls" };
        Assert.IsType<OkObjectResult>((await new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db)).Create(p.Id, dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<ParticipantRiskEntry>(db);
        await AssertAllInTenantA<ParticipantNote>(db);
    }

    [Fact]
    public async Task AdlAssessment_Upsert_TakesParticipantTenant()
    {
        var (db, _, p) = Setup();
        var dto = new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Supervision };
        Assert.IsType<OkObjectResult>((await new ParticipantAdlAssessmentsController(db).Upsert(p.Id, nameof(AdlType.Bathing), dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<ParticipantAdlAssessment>(db);
    }

    [Fact]
    public async Task HealthCondition_Upsert_TakesParticipantTenant()
    {
        var (db, _, p) = Setup();
        var type = Enum.GetValues<HealthConditionType>().First();
        var dto = new UpsertParticipantHealthConditionDto { Has = true };
        Assert.IsType<OkObjectResult>((await new ParticipantHealthConditionsController(db).Upsert(p.Id, type.ToString(), dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<ParticipantHealthCondition>(db);
    }

    [Fact]
    public async Task CommunityAccessRiskItem_Upsert_TakesParticipantTenant()
    {
        var (db, _, p) = Setup();
        var type = Enum.GetValues<CommunityAccessRiskItemType>().First();
        var dto = new UpsertParticipantCommunityAccessRiskItemDto { Rating = Enum.GetValues<RiskRatingLevel>().First() };
        Assert.IsType<OkObjectResult>((await new ParticipantCommunityAccessRiskItemsController(db).Upsert(p.Id, type.ToString(), dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<ParticipantCommunityAccessRiskItem>(db);
    }

    [Fact]
    public async Task RestrictivePractice_BulkCreate_TakesParticipantTenant()
    {
        var (db, _, p) = Setup();
        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = { new BulkCreateRestrictivePracticeRowDto { Type = RestrictivePracticeType.EnvironmentalRestraint, Description = "Locked pantry" } },
        };
        Assert.IsType<OkObjectResult>((await new RestrictivePracticesController(db, new SafetyNoteSyncService(db)).CreateBulk(p.Id, dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<RestrictivePractice>(db);
        await AssertAllInTenantA<ParticipantNote>(db);
    }

    [Fact]
    public async Task Medication_Create_TakesParticipantTenant_AndItsRegisterEntry()
    {
        var (db, tenant, p) = Setup();
        var dto = new CreateMedicationDto
        {
            Name = "Risperidone", Strength = "1 mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
            DoseDescription = "1 tablet", Type = MedicationType.Prn, PrnIndication = "Behavioural escalation", PrnMaxDosesPer24h = 2,
            Purpose = "Manage behaviour", IsChemicalRestraint = true, DrugSchedule = DrugSchedule.Schedule4,
            SupportLevel = MedicationSupportLevel.Administer, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
            RestraintAuthorised = false, RestraintRequiresReporting = false,
        };
        Assert.IsType<OkObjectResult>((await new MedicationsController(db, tenant).Create(p.Id, dto, CancellationToken.None)).Result);
        await AssertAllInTenantA<ParticipantMedication>(db);
        await AssertAllInTenantA<RestrictivePractice>(db);
    }
}
