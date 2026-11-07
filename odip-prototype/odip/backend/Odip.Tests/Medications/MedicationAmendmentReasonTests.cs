using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
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

namespace Odip.Tests.Medications;

/// <summary>Every coordinator amendment of a recorded dose states a reason; the reason, note, amender and time are stored on the record.</summary>
public class MedicationAmendmentReasonTests
{
    private static (OdipDbContext Db, MedicationsController Controller, MedicationAdministration Admin) Seed()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);

        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test", Notes = "Original",
        };
        db.Participants.Add(participant);
        db.ParticipantMedications.Add(med);
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("fullName", "Cora Coordinator")], "Test")) },
            },
        };
        return (db, controller, admin);
    }

    private static UpdateAdministrationDto Dto(MedicationAmendmentReason? reason, string? note = null) => new()
    {
        Status = MedicationAdministrationStatus.Administered, Notes = "Changed", AmendmentReason = reason, AmendmentNote = note,
    };

    private static async Task AssertRefusedAsync(MedicationAmendmentReason? reason, string? note, string message)
    {
        var (db, controller, admin) = Seed();
        var result = await controller.UpdateAdministration(admin.Id, Dto(reason, note), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Equal(message, body.Errors![0]);
        var stored = await db.MedicationAdministrations.AsNoTracking().SingleAsync();
        Assert.Equal("Original", stored.Notes);
        Assert.Null(stored.AmendedAt);
        Assert.Null(stored.AmendmentReason);
    }

    [Fact]
    public Task Amend_WithoutReason_Returns400AndChangesNothing() =>
        AssertRefusedAsync(null, null, "Choose a reason for this correction.");

    [Fact]
    public Task Amend_WithUndefinedReason_Returns400() =>
        AssertRefusedAsync((MedicationAmendmentReason)99, null, "Choose a correction reason from the list.");

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public Task Amend_OtherWithBlankNote_Returns400(string? note) =>
        AssertRefusedAsync(MedicationAmendmentReason.Other, note, "Add a note saying why this record is being corrected.");

    // The 500 limit is the DTO's [StringLength]: [ApiController] model validation refuses the request before the action runs, so nothing is written.
    [Theory]
    [InlineData(500, true)]
    [InlineData(501, false)]
    public void Amend_NoteOver500Characters_FailsModelValidation(int length, bool valid)
    {
        var dto = Dto(MedicationAmendmentReason.Other, new string('x', length));
        var errors = new List<System.ComponentModel.DataAnnotations.ValidationResult>();
        Assert.Equal(valid, System.ComponentModel.DataAnnotations.Validator.TryValidateObject(dto, new(dto), errors, true));
        if (!valid) Assert.Equal(nameof(UpdateAdministrationDto.AmendmentNote), Assert.Single(errors).MemberNames.Single());
    }

    [Fact]
    public async Task Amend_StoresReasonNoteByAndAt()
    {
        var (db, controller, admin) = Seed();
        var result = await controller.UpdateAdministration(admin.Id, Dto(MedicationAmendmentReason.WrongDose, "  Gave two, not one  "), CancellationToken.None);

        var dto = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var stored = await db.MedicationAdministrations.AsNoTracking().SingleAsync();
        foreach (var (reason, note, by, at) in new[] { (stored.AmendmentReason, stored.AmendmentNote, stored.AmendedByName, stored.AmendedAt), (dto.AmendmentReason, dto.AmendmentNote, dto.AmendedByName, dto.AmendedAt) })
        {
            Assert.Equal(MedicationAmendmentReason.WrongDose, reason);
            Assert.Equal("Gave two, not one", note);
            Assert.Equal("Cora Coordinator", by);
            Assert.InRange((DateTime.UtcNow - at!.Value).TotalSeconds, -1, 5);
        }
    }

    [Fact]
    public async Task Amend_OtherWithNote_Succeeds()
    {
        var (_, controller, admin) = Seed();
        var result = await controller.UpdateAdministration(admin.Id, Dto(MedicationAmendmentReason.Other, "Typo in the dose"), CancellationToken.None);
        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Amend_WrongTimeWithoutNote_StoresNullNote()
    {
        var (db, controller, admin) = Seed();
        await controller.UpdateAdministration(admin.Id, Dto(MedicationAmendmentReason.WrongTime, "  "), CancellationToken.None);
        var stored = await db.MedicationAdministrations.AsNoTracking().SingleAsync();
        Assert.Equal(MedicationAmendmentReason.WrongTime, stored.AmendmentReason);
        Assert.Null(stored.AmendmentNote);
    }

    [Fact]
    public async Task Amend_ReasonReachesTheRecordsReadByTheParticipantList()
    {
        var (_, controller, admin) = Seed();
        await controller.UpdateAdministration(admin.Id, Dto(MedicationAmendmentReason.EnteredInError), CancellationToken.None);
        var list = await controller.GetParticipantAdministrations(admin.ParticipantId, null, null, CancellationToken.None);
        var rows = Assert.IsAssignableFrom<IEnumerable<AdministrationDto>>(Assert.IsType<ApiResponse<List<AdministrationDto>>>(Assert.IsType<OkObjectResult>(list.Result).Value).Data);
        Assert.Equal(MedicationAmendmentReason.EnteredInError, rows.Single().AmendmentReason);
    }

    [Fact]
    public void UpdateAdministration_StillRefusesSupportWorker()
    {
        var auth = typeof(MedicationsController).GetMethod(nameof(MedicationsController.UpdateAdministration))!.GetCustomAttribute<AuthorizeAttribute>()!;
        Assert.Equal("Admin,Coordinator,SuperAdmin", auth.Roles);
    }

    // The portal and shift-package responses go through the same mapper, so a support worker sees why a dose was corrected.
    [Fact]
    public void Mapper_CarriesTheAmendmentFields()
    {
        var at = new DateTime(2026, 11, 6, 1, 2, 3, DateTimeKind.Utc);
        var a = new MedicationAdministration
        {
            Id = Guid.NewGuid(), RecordedByName = "T", AmendmentReason = MedicationAmendmentReason.WrongPerson,
            AmendmentNote = "n", AmendedByName = "Cora", AmendedAt = at,
        };
        var dto = Odip.Infrastructure.Services.MedicationMapping.ToAdministrationDto(a, "P", "M", "D");
        Assert.Equal((MedicationAmendmentReason.WrongPerson, "n", "Cora", at), (dto.AmendmentReason, dto.AmendmentNote, dto.AmendedByName, dto.AmendedAt));
    }

    // Amend runs the create checks on the resulting values (hunt 33, H33-2).
    private static async Task<(OdipDbContext Db, MedicationsController C, MedicationAdministration A)> SeedAmend(
        Action<ParticipantMedication, MedicationAdministration> shape)
    {
        var (db, c, a) = Seed();
        var med = await db.ParticipantMedications.SingleAsync();
        shape(med, a);
        await db.SaveChangesAsync();
        return (db, c, a);
    }

    private static UpdateAdministrationDto AmendDto(DateTime? at = null, string? witness = null, string? prn = null) => new()
    {
        Status = MedicationAdministrationStatus.Administered, AdministeredAt = at, WitnessName = witness, PrnReason = prn,
        AmendmentReason = MedicationAmendmentReason.WrongTime,
    };

    private static async Task AssertAmendRefusedAsync(ActionResult<ApiResponse<AdministrationDto>> r, int status, string message, OdipDbContext db)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(r.Result);
        Assert.Equal(status, obj.StatusCode);
        Assert.Equal(message, Assert.IsType<ApiResponse<AdministrationDto>>(obj.Value).Errors![0]);
        Assert.Null((await db.MedicationAdministrations.AsNoTracking().SingleAsync()).AmendedAt);
    }

    [Fact]
    public async Task Amend_NullTimeWithNothingStored_IsRefused()
    {
        var (db, c, a) = await SeedAmend((_, adm) => adm.AdministeredAt = null);
        var r = await c.UpdateAdministration(a.Id, AmendDto(), CancellationToken.None);
        await AssertAmendRefusedAsync(r, 400, "The time this dose was given is required.", db);
    }

    [Fact]
    public async Task Amend_FutureTime_IsRefused()
    {
        var (db, c, a) = await SeedAmend((_, _) => { });
        var r = await c.UpdateAdministration(a.Id, AmendDto(DateTime.UtcNow.AddHours(2)), CancellationToken.None);
        await AssertAmendRefusedAsync(r, 422, "The time this dose was given can't be in the future. Check the time and try again.", db);
    }

    [Fact]
    public async Task Amend_HighRiskWithoutWitness_IsRefused()
    {
        var (db, c, a) = await SeedAmend((m, _) => m.IsHighRisk = true);
        var r = await c.UpdateAdministration(a.Id, AmendDto(), CancellationToken.None);
        await AssertAmendRefusedAsync(r, 400, "A witness is required for high-risk medication administration.", db);
    }

    [Fact]
    public async Task Amend_HighRiskWithStoredWitnessName_Succeeds()
    {
        var (_, c, a) = await SeedAmend((m, adm) => { m.IsHighRisk = true; adm.WitnessName = "Sam"; });
        Assert.IsType<OkObjectResult>((await c.UpdateAdministration(a.Id, AmendDto(), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Amend_HighRiskWithStoredWitnessUserId_NoWitnessSent_Succeeds()
    {
        var (_, c, a) = await SeedAmend((m, adm) => { m.IsHighRisk = true; adm.WitnessUserId = Guid.NewGuid(); adm.WitnessName = null; });
        Assert.IsType<OkObjectResult>((await c.UpdateAdministration(a.Id, AmendDto(), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Amend_HighRiskWithNoStoredWitness_WitnessNameSent_SavesIt()
    {
        var (db, c, a) = await SeedAmend((m, adm) => { m.IsHighRisk = true; adm.WitnessUserId = null; adm.WitnessName = null; });
        Assert.IsType<OkObjectResult>((await c.UpdateAdministration(a.Id, AmendDto(witness: "Sam"), CancellationToken.None)).Result);
        Assert.Equal("Sam", (await db.MedicationAdministrations.AsNoTracking().SingleAsync()).WitnessName);
    }

    [Fact]
    public async Task Amend_PrnWithoutReason_IsRefused()
    {
        var (db, c, a) = await SeedAmend((m, _) => m.Type = MedicationType.Prn);
        var r = await c.UpdateAdministration(a.Id, AmendDto(), CancellationToken.None);
        await AssertAmendRefusedAsync(r, 400, "A PRN reason is required when recording an administered PRN dose.", db);
    }

    [Fact]
    public async Task Amend_NullTime_KeepsTheStoredTime()
    {
        var stored = new DateTime(2026, 3, 1, 8, 0, 0, DateTimeKind.Utc);
        var (db, c, a) = await SeedAmend((_, adm) => adm.AdministeredAt = stored);
        Assert.IsType<OkObjectResult>((await c.UpdateAdministration(a.Id, AmendDto(), CancellationToken.None)).Result);
        Assert.Equal(stored, (await db.MedicationAdministrations.AsNoTracking().SingleAsync()).AdministeredAt);
    }
}
