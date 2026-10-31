using System.Linq;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.RestrictivePractices;

/// <summary>The register's use kind, end date, behaviour support plan dates and earliest-use suggestion (RP PR 1), at controller level on EF InMemory.</summary>
public class RestrictivePracticeRegisterDatesTests
{
    // 2026-10-31 14:00Z is 01/11 in Sydney: the provider's today is 2026-11-01.
    private static RestrictivePracticesController Controller(OdipDbContext db) =>
        new(db, new SafetyNoteSyncService(db), FakeClock.AtUtc(2026, 10, 31, 14, 0));

    private static Participant SeedParticipant(OdipDbContext db, Guid? tenantId = null)
    {
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        if (tenantId != null) p.TenantId = tenantId.Value;
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static RestrictivePractice SeedPractice(OdipDbContext db, Participant p, Action<RestrictivePractice>? tweak = null)
    {
        var rp = new RestrictivePractice
        {
            Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id, Type = RestrictivePracticeType.PhysicalRestraint,
            Description = "Physical hold", IsActive = true, AuthorisedBy = "Dr Chen", AuthorisationDate = new DateOnly(2026, 1, 1),
        };
        tweak?.Invoke(rp);
        db.RestrictivePractices.Add(rp);
        db.SaveChanges();
        return rp;
    }

    private static ParticipantMedication SeedMedicine(OdipDbContext db, Participant p, MedicationType type)
    {
        var m = new ParticipantMedication { Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id, Name = "Risperidone", DoseDescription = "1 tablet", IsChemicalRestraint = true, Type = type };
        db.ParticipantMedications.Add(m);
        db.SaveChanges();
        return m;
    }

    private static UpdateRestrictivePracticeDto Put(RestrictivePractice rp) => new()
    {
        Type = rp.Type, Description = rp.Description, AuthorisedBy = rp.AuthorisedBy, AuthorisationDate = rp.AuthorisationDate, IsActive = true, DatesIncluded = true,
    };

    private static RestrictivePracticeDto Dto(ActionResult<ApiResponse<RestrictivePracticeDto>> r) =>
        Assert.IsType<ApiResponse<RestrictivePracticeDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;

    private static List<RestrictivePracticeDto> Items(ActionResult<ApiResponse<List<RestrictivePracticeDto>>> r) =>
        Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;

    private static string BadRequestMessage(ActionResult<ApiResponse<RestrictivePracticeDto>> r) =>
        Assert.IsType<ApiResponse<RestrictivePracticeDto>>(Assert.IsType<BadRequestObjectResult>(r.Result).Value).Errors!.Single();

    [Fact]
    public async Task Put_SavesNewFields_AndDtoCarriesBspState()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var rp = SeedPractice(db, SeedParticipant(db));
        var dto = new UpdateRestrictivePracticeDto
        {
            Type = rp.Type, Description = rp.Description, AuthorisedBy = "Dr Chen", AuthorisationDate = new DateOnly(2026, 1, 1), DatesIncluded = true,
            AuthorisationEndDate = new DateOnly(2027, 1, 1), UseKind = RestrictivePracticeUseKind.Prn, FirstUsedOn = new DateOnly(2026, 10, 1), IsActive = true,
        };

        var result = Dto(await Controller(db).Update(rp.Id, dto, CancellationToken.None));

        Assert.Equal(new DateOnly(2026, 11, 1), result.InterimBspDueOn);
        Assert.Equal(BspPlanState.DueSoon, result.InterimBspState);
        Assert.Equal(new DateOnly(2027, 4, 1), result.ComprehensiveBspDueOn);
        Assert.Equal(BspPlanState.Due, result.ComprehensiveBspState);
        Assert.Equal(RestrictivePracticeUseKind.Prn, result.UseKind);
        var saved = await db.RestrictivePractices.SingleAsync();
        Assert.Equal(new DateOnly(2027, 1, 1), saved.AuthorisationEndDate);
        Assert.Equal(new DateOnly(2026, 10, 1), saved.FirstUsedOn);
    }

    [Fact]
    public async Task Put_EndDateBeforeAuthorisationDate_400()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var rp = SeedPractice(db, SeedParticipant(db));
        var dto = Put(rp) with { AuthorisationEndDate = new DateOnly(2025, 12, 31) };

        Assert.Equal("The end date can't be before the authorisation date", BadRequestMessage(await Controller(db).Update(rp.Id, dto, CancellationToken.None)));
    }

    [Fact]
    public async Task Put_EndDateWithoutAuthorisationDate_400()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var rp = SeedPractice(db, SeedParticipant(db), r => { r.AuthorisedBy = null; r.AuthorisationDate = null; });
        var dto = Put(rp) with { AuthorisationEndDate = new DateOnly(2027, 1, 1) };

        Assert.Equal("Add the authorisation date before an end date", BadRequestMessage(await Controller(db).Update(rp.Id, dto, CancellationToken.None)));
    }

    [Theory]
    [InlineData("2026-11-01", true)]
    [InlineData("2026-11-02", false)]
    public async Task Put_FirstUsedInFuture_UsesTheProviderZone(string firstUsed, bool accepted)
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var rp = SeedPractice(db, SeedParticipant(db));
        var dto = Put(rp) with { FirstUsedOn = DateOnly.Parse(firstUsed) };

        var result = await Controller(db).Update(rp.Id, dto, CancellationToken.None);

        if (accepted) Dto(result); else Assert.Equal("The first use date can't be in the future", BadRequestMessage(result));
    }

    [Theory]
    [InlineData("2026-10-31", false)] // ended yesterday (today is 2026-11-01)
    [InlineData("2026-11-01", true)]  // the end date is inclusive
    public async Task Get_EndDate_IsInclusiveOnTheProvidersToday(string end, bool expected)
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        SeedPractice(db, p, r => r.AuthorisationEndDate = DateOnly.Parse(end));

        var result = await Controller(db).GetForParticipant(p.Id, includeInactive: false, CancellationToken.None);

        Assert.Equal(expected, Items(result).Single().IsAuthorised);
    }

    [Fact]
    public async Task Get_LinkedChemical_UseKindFollowsMedicine()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        var med = SeedMedicine(db, p, MedicationType.Prn);
        SeedPractice(db, p, r => { r.Type = RestrictivePracticeType.ChemicalRestraint; r.RelatedMedicationId = med.Id; r.UseKind = RestrictivePracticeUseKind.Routine; });

        var result = await Controller(db).GetForParticipant(p.Id, includeInactive: false, CancellationToken.None);

        Assert.Equal(RestrictivePracticeUseKind.Prn, Items(result).Single().UseKind);
    }

    [Fact]
    public async Task Put_LinkedChemical_IgnoresUseKind_AndReturnsTheMedicinesKind()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        var med = SeedMedicine(db, p, MedicationType.Prn);
        var rp = SeedPractice(db, p, r => { r.Type = RestrictivePracticeType.ChemicalRestraint; r.RelatedMedicationId = med.Id; });
        var dto = Put(rp) with { Type = RestrictivePracticeType.ChemicalRestraint, RelatedMedicationId = med.Id, UseKind = RestrictivePracticeUseKind.Routine };

        var result = Dto(await Controller(db).Update(rp.Id, dto, CancellationToken.None));

        Assert.Equal(RestrictivePracticeUseKind.Prn, result.UseKind);
        Assert.Equal(RestrictivePracticeUseKind.Routine, (await db.RestrictivePractices.SingleAsync()).UseKind);
    }

    [Fact]
    public async Task Put_OlderTabWithoutUseKind_LeavesTheStoredKind()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var rp = SeedPractice(db, SeedParticipant(db), r => r.UseKind = RestrictivePracticeUseKind.Prn);

        Dto(await Controller(db).Update(rp.Id, Put(rp), CancellationToken.None));

        Assert.Equal(RestrictivePracticeUseKind.Prn, (await db.RestrictivePractices.SingleAsync()).UseKind);
    }

    [Fact]
    public async Task Get_EarliestRecordedUse_MinOfIncidentsAndDoses()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        var med = SeedMedicine(db, p, MedicationType.Regular);
        var rp = SeedPractice(db, p, r => { r.Type = RestrictivePracticeType.ChemicalRestraint; r.RelatedMedicationId = med.Id; });
        IncidentReport Incident(DateTime when, bool active) => new()
        {
            Id = Guid.NewGuid(), TenantId = p.TenantId, IncidentType = IncidentType.RestrictivePracticeUse, RestrictivePracticeId = rp.Id,
            IncidentDateTime = when, IsActive = active, Title = "t", Description = "d",
        };
        db.IncidentReports.AddRange(Incident(new DateTime(2026, 3, 5, 8, 0, 0), true), Incident(new DateTime(2026, 2, 1, 8, 0, 0), false));
        MedicationAdministration Dose(DateTime atUtc, MedicationAdministrationStatus s) => new()
        {
            Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantMedicationId = med.Id, ParticipantId = p.Id, AdministeredAt = atUtc, Status = s, RecordedByName = "x",
        };
        db.MedicationAdministrations.AddRange(
            Dose(new DateTime(2026, 3, 3, 14, 30, 0, DateTimeKind.Utc), MedicationAdministrationStatus.Administered), // 04/03 in Sydney
            Dose(new DateTime(2026, 3, 1, 1, 0, 0, DateTimeKind.Utc), MedicationAdministrationStatus.Refused));
        db.SaveChanges();

        var result = await Controller(db).GetForParticipant(p.Id, includeInactive: false, CancellationToken.None);

        Assert.Equal(new DateOnly(2026, 3, 4), Items(result).Single().EarliestRecordedUseDate);
    }

    [Fact]
    public async Task Get_EarliestRecordedUse_IgnoresOtherTenants()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        Guid participantId;
        using (var seed = TestDb.Create(dbName))
        {
            var p = SeedParticipant(seed, tenantA);
            participantId = p.Id;
            var rp = SeedPractice(seed, p);
            seed.IncidentReports.Add(new IncidentReport
            {
                Id = Guid.NewGuid(), TenantId = tenantB, IncidentType = IncidentType.RestrictivePracticeUse, RestrictivePracticeId = rp.Id,
                IncidentDateTime = new DateTime(2026, 1, 5, 8, 0, 0), IsActive = true, Title = "t", Description = "d",
            });
            seed.SaveChanges();
        }
        using var scoped = TestDb.ForTenant(dbName, tenantA);

        var result = await Controller(scoped).GetForParticipant(participantId, includeInactive: false, CancellationToken.None);

        Assert.Null(Items(result).Single().EarliestRecordedUseDate);
    }

    [Fact]
    public async Task Bulk_SavesUseKindAndEndDate_AndRejectsABadEndDate()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        BulkCreateRestrictivePracticeRowDto Row(DateOnly? end) => new()
        {
            Description = "Physical hold", Type = RestrictivePracticeType.PhysicalRestraint, AuthorisedBy = "Dr Chen", AuthorisationDate = new DateOnly(2026, 1, 1),
            AuthorisationEndDate = end, UseKind = RestrictivePracticeUseKind.Prn, IsActive = true,
        };

        var bad = await Controller(db).CreateBulk(p.Id, new BulkCreateRestrictivePracticeDto { Items = new() { Row(new DateOnly(2025, 6, 1)) } }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(bad.Result);
        Assert.Empty(db.RestrictivePractices);

        var good = await Controller(db).CreateBulk(p.Id, new BulkCreateRestrictivePracticeDto { Items = new() { Row(new DateOnly(2027, 1, 1)) } }, CancellationToken.None);
        var entry = Assert.Single(Items(good));
        Assert.Equal(RestrictivePracticeUseKind.Prn, entry.UseKind);
        Assert.Equal(new DateOnly(2027, 1, 1), entry.AuthorisationEndDate);
    }

    [Fact]
    public async Task Bulk_LinkedChemicalPrn_ReturnsPrn()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        var med = SeedMedicine(db, p, MedicationType.Prn);
        var row = new BulkCreateRestrictivePracticeRowDto
        {
            Description = "Chemical", Type = RestrictivePracticeType.ChemicalRestraint, RelatedMedicationId = med.Id, UseKind = RestrictivePracticeUseKind.Routine, IsActive = true,
        };

        var result = await Controller(db).CreateBulk(p.Id, new BulkCreateRestrictivePracticeDto { Items = new() { row } }, CancellationToken.None);

        Assert.Equal(RestrictivePracticeUseKind.Prn, Assert.Single(Items(result)).UseKind);
    }

    [Fact]
    public async Task Put_OtherTenantsPractice_NotFound_Unchanged()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        Guid id;
        using (var seed = TestDb.Create(dbName))
        {
            var p = SeedParticipant(seed, tenantB);
            id = SeedPractice(seed, p).Id;
        }
        using var scoped = TestDb.ForTenant(dbName, tenantA);
        var dto = new UpdateRestrictivePracticeDto { Description = "x", AuthorisationDate = new DateOnly(2026, 1, 1), AuthorisationEndDate = new DateOnly(2026, 6, 1), IsActive = true, DatesIncluded = true };

        var result = await Controller(scoped).Update(id, dto, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        using var check = TestDb.Create(dbName);
        Assert.Null((await check.RestrictivePractices.SingleAsync()).AuthorisationEndDate);
    }

    [Fact]
    public void Update_IsForAdminCoordinatorOnly()
    {
        var roles = typeof(RestrictivePracticesController).GetMethod(nameof(RestrictivePracticesController.Update))!
            .GetCustomAttribute<AuthorizeAttribute>()!.Roles!;

        Assert.DoesNotContain("SupportWorker", roles);
    }
}
