using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.RestrictivePractices;

/// <summary>
/// M16: a chemical-restraint medicine and its restrictive-practice register entry are kept in step. These drive the controllers, so what
/// is asserted is what the app does. Medicine to entry first; the register-side rules are in the second half of the class.
/// </summary>
public class RestraintRegisterSyncTests
{
    private const string PairCopy = "Add who authorised it and the date it was authorised.";
    private const string ReportingCopy = "Choose whether this needs to be reported to the NDIS Commission.";
    private const string StaleCopy = "This medicine's register entry was changed while you were editing. Reload the page to see the latest authorisation, then save again.";

    private static (OdipDbContext Db, ICurrentTenant Tenant) CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        var db = new OdipDbContext(options, tenant.Object);
        tenant.Setup(t => t.ViewAsUserId).Returns(MedicationTestIdentities.SeedCompetentUser(db).Id);
        return (db, tenant.Object);
    }

    private static Participant SeedParticipant(OdipDbContext db)
    {
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static CreateMedicationDto RestraintDto(bool? authorised = null, string? by = null, DateOnly? on = null, bool? report = null) => new()
    {
        Name = "Risperidone", Strength = "1 mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
        DoseDescription = "1 tablet", Type = MedicationType.Prn, PrnIndication = "Behavioural escalation", PrnMaxDosesPer24h = 2,
        Purpose = "Manage behaviour", IsChemicalRestraint = true, DrugSchedule = DrugSchedule.Schedule4,
        SupportLevel = MedicationSupportLevel.Administer, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        RestraintAuthorised = authorised, RestraintAuthorisedBy = by, RestraintAuthorisationDate = on, RestraintRequiresReporting = report,
    };

    private static UpdateMedicationDto AsUpdate(CreateMedicationDto c, MedicationStatus status = MedicationStatus.Active, DateTime? expectedEntryUpdatedAt = null) => new()
    {
        Name = c.Name, Strength = c.Strength, Form = c.Form, Route = c.Route, DoseDescription = c.DoseDescription, Type = c.Type,
        PrnIndication = c.PrnIndication, PrnMaxDosesPer24h = c.PrnMaxDosesPer24h, Purpose = c.Purpose, IsChemicalRestraint = c.IsChemicalRestraint,
        DrugSchedule = c.DrugSchedule, SupportLevel = c.SupportLevel, StartDate = c.StartDate, ConsentObtained = c.ConsentObtained,
        RestraintAuthorised = c.RestraintAuthorised, RestraintAuthorisedBy = c.RestraintAuthorisedBy,
        RestraintAuthorisationDate = c.RestraintAuthorisationDate, RestraintRequiresReporting = c.RestraintRequiresReporting,
        Status = status, ExpectedRestrictivePracticeUpdatedAt = expectedEntryUpdatedAt,
    };

    private static async Task<MedicationDetailDto> CreateOkAsync(MedicationsController c, Guid participantId, CreateMedicationDto dto)
    {
        var ok = Assert.IsType<OkObjectResult>((await c.Create(participantId, dto, CancellationToken.None)).Result);
        return Assert.IsType<ApiResponse<MedicationDetailDto>>(ok.Value).Data!;
    }

    private static async Task<MedicationDetailDto> UpdateOkAsync(MedicationsController c, Guid id, UpdateMedicationDto dto)
    {
        var ok = Assert.IsType<OkObjectResult>((await c.Update(id, dto, CancellationToken.None)).Result);
        return Assert.IsType<ApiResponse<MedicationDetailDto>>(ok.Value).Data!;
    }

    private static string? ErrorOf(IActionResult? result, int status)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(status, obj.StatusCode);
        return Assert.IsAssignableFrom<ApiResponse<MedicationDetailDto>>(obj.Value).Errors?.Single();
    }

    private static readonly DateOnly AuthDate = new(2026, 9, 1);

    // ── Medicine to entry ────────────────────────────────────────────

    [Fact]
    public async Task CreateMedication_RestraintTicked_CreatesOneActiveLinkedEntry()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var med = await CreateOkAsync(new MedicationsController(db, tenant), p.Id, RestraintDto(false, report: false));

        var entry = await db.RestrictivePractices.SingleAsync();
        Assert.Equal(RestrictivePracticeType.ChemicalRestraint, entry.Type);
        Assert.Equal(med.Id, entry.RelatedMedicationId);
        Assert.True(entry.IsActive);
        Assert.Equal("Risperidone 1 mg – Manage behaviour", entry.Description);
        Assert.True((await db.Participants.SingleAsync()).HasRestrictivePracticeFlag);
        Assert.Contains(await db.ParticipantNotes.ToListAsync(), n => n.Title.StartsWith("Restrictive Practices"));
    }

    [Fact]
    public async Task CreateMedication_Authorised_WritesWhoAndDateToEntry()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var med = await CreateOkAsync(new MedicationsController(db, tenant), p.Id, RestraintDto(true, " Dr Chen ", AuthDate));

        var entry = await db.RestrictivePractices.SingleAsync();
        Assert.Equal("Dr Chen", entry.AuthorisedBy);
        Assert.Equal(AuthDate, entry.AuthorisationDate);
        Assert.True(RestrictivePracticeAuthorisation.IsAuthorised(entry));
        Assert.DoesNotContain("ChemicalRestraintUnauthorised", med.ComplianceFlags);
        Assert.DoesNotContain("ChemicalRestraintReportable", med.ComplianceFlags);
        Assert.NotNull(med.LinkedRestrictivePractice);
    }

    [Fact]
    public async Task CreateMedication_NotAuthorisedReportYes_FlagsUnauthorisedAndReportable()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var med = await CreateOkAsync(new MedicationsController(db, tenant), p.Id, RestraintDto(false, report: true));

        Assert.True((await db.RestrictivePractices.SingleAsync()).RequiresReporting);
        var flags = med.ComplianceFlags;
        Assert.Equal(new[] { "ChemicalRestraintUnauthorised", "ChemicalRestraintReportable" }, flags.Where(f => f.StartsWith("ChemicalRestraint")).ToArray());
    }

    [Theory]
    [InlineData(null, "2026-09-01")]
    [InlineData("  ", "2026-09-01")]
    [InlineData("Dr Chen", null)]
    public async Task CreateMedication_AuthorisedWithoutWhoOrDate_400(string? by, string? on)
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var result = await new MedicationsController(db, tenant).Create(p.Id, RestraintDto(true, by, on == null ? null : DateOnly.Parse(on)), CancellationToken.None);

        Assert.Equal(PairCopy, ErrorOf(result.Result, 400));
        Assert.Empty(db.ParticipantMedications);
        Assert.Empty(db.RestrictivePractices);
    }

    /// <summary>[ApiController] turns the attribute into a 400 before the action runs, as for AuthorisedBy on the register.</summary>
    [Fact]
    public void RestraintAuthorisedBy_IsCappedAt200_LikeTheRegisterColumn() =>
        Assert.Contains(typeof(CreateMedicationDto).GetProperty(nameof(CreateMedicationDto.RestraintAuthorisedBy))!.GetCustomAttributes(false),
            attribute => attribute is System.ComponentModel.DataAnnotations.StringLengthAttribute { MaximumLength: 200 });

    [Fact]
    public async Task CreateMedication_NotAuthorisedNoAnswer_400()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var result = await new MedicationsController(db, tenant).Create(p.Id, RestraintDto(false), CancellationToken.None);

        Assert.Equal(ReportingCopy, ErrorOf(result.Result, 400));
        Assert.Empty(db.ParticipantMedications);
    }

    [Fact]
    public async Task OldClient_NoRestraintFields_Saves()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var med = await CreateOkAsync(new MedicationsController(db, tenant), p.Id, RestraintDto());

        var entry = await db.RestrictivePractices.SingleAsync();
        Assert.Null(entry.RequiresReporting);
        Assert.Null(entry.AuthorisedBy);
        Assert.Contains("ChemicalRestraintUnauthorised", med.ComplianceFlags);
    }

    [Fact]
    public async Task UpdateMedication_Ceased_DeactivatesEntry_AndRecomputesFlagAndNote()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(true, "Dr Chen", AuthDate));

        var updated = await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto(), MedicationStatus.Ceased));

        Assert.False((await db.RestrictivePractices.SingleAsync()).IsActive);
        Assert.False((await db.Participants.SingleAsync()).HasRestrictivePracticeFlag);
        Assert.DoesNotContain(updated.ComplianceFlags, f => f.StartsWith("ChemicalRestraint"));
        Assert.All(await db.ParticipantNotes.Where(n => n.Title.StartsWith("Restrictive Practices")).ToListAsync(), n => Assert.True(n.IsArchived));
    }

    [Fact]
    public async Task UpdateMedication_UnCeased_ReactivatesSameEntry()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(false, report: true));
        var entryId = (await db.RestrictivePractices.SingleAsync()).Id;
        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto(), MedicationStatus.Ceased));

        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto(), MedicationStatus.Active));

        var entry = await db.RestrictivePractices.SingleAsync();
        Assert.Equal(entryId, entry.Id);
        Assert.True(entry.IsActive);
    }

    [Fact]
    public async Task UpdateMedication_Untick_Deactivates_Retick_ReactivatesSame()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(false, report: false));
        var entryId = (await db.RestrictivePractices.SingleAsync()).Id;

        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto() with { IsChemicalRestraint = false }));
        Assert.False((await db.RestrictivePractices.SingleAsync()).IsActive);

        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto()));
        var entry = await db.RestrictivePractices.SingleAsync();
        Assert.Equal(entryId, entry.Id);
        Assert.True(entry.IsActive);
    }

    [Fact]
    public async Task UpdateMedication_OnHold_LeavesEntryUntouched()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(false, report: false));
        var before = await db.RestrictivePractices.AsNoTracking().SingleAsync();

        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto(), MedicationStatus.OnHold));

        var after = await db.RestrictivePractices.AsNoTracking().SingleAsync();
        Assert.True(after.IsActive);
        Assert.Equal(before.UpdatedAt, after.UpdatedAt);
    }

    [Fact]
    public async Task UpdateMedication_InStep_DoesNotWriteEntry()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(true, "Dr Chen", AuthDate, true));
        var before = (await db.RestrictivePractices.AsNoTracking().SingleAsync()).UpdatedAt;

        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto() with { DoseDescription = "2 tablets" }));

        Assert.Equal(before, (await db.RestrictivePractices.AsNoTracking().SingleAsync()).UpdatedAt);
    }

    [Fact]
    public async Task UpdateMedication_StaleRegisterToken_409_NothingChanged()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(false, report: false));
        var entry = await db.RestrictivePractices.AsNoTracking().SingleAsync();

        var result = await c.Update(med.Id, AsUpdate(RestraintDto(true, "Dr Chen", AuthDate) with { DoseDescription = "changed" }, expectedEntryUpdatedAt: entry.UpdatedAt.AddMinutes(-5)), CancellationToken.None);

        Assert.Equal(StaleCopy, ErrorOf(result.Result, 409));
        Assert.Equal("1 tablet", (await db.ParticipantMedications.AsNoTracking().SingleAsync()).DoseDescription);
        Assert.Null((await db.RestrictivePractices.AsNoTracking().SingleAsync()).AuthorisedBy);
    }

    [Fact]
    public async Task UpdateMedication_CurrentRegisterToken_Saves()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(false, report: false));
        var entry = await db.RestrictivePractices.AsNoTracking().SingleAsync();

        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto(true, "Dr Chen", AuthDate), expectedEntryUpdatedAt: entry.UpdatedAt));

        Assert.True(RestrictivePracticeAuthorisation.IsAuthorised(await db.RestrictivePractices.AsNoTracking().SingleAsync()));
    }

    [Fact]
    public async Task UpdateMedication_AuthorisedFalse_ClearsWhoAndDate_KeepsRequiresReporting()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(true, "Dr Chen", AuthDate, true));

        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto(false)));

        var entry = await db.RestrictivePractices.SingleAsync();
        Assert.Null(entry.AuthorisedBy);
        Assert.Null(entry.AuthorisationDate);
        Assert.True(entry.RequiresReporting);
    }

    [Fact]
    public async Task UpdateMedication_BecomingAuthorised_LeavesRequiresReportingAlone()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(false, report: true));

        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto(true, "Dr Chen", AuthDate)));

        Assert.True((await db.RestrictivePractices.SingleAsync()).RequiresReporting);
    }

    [Fact]
    public async Task UpdateMedication_Unticked_IgnoresRestraintAnswers()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(false, report: false));

        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto(true, "Someone", AuthDate, true) with { IsChemicalRestraint = false }));

        var entry = await db.RestrictivePractices.SingleAsync();
        Assert.Null(entry.AuthorisedBy);
        Assert.False(entry.RequiresReporting);
    }

    // ── Flags and DTO fields ─────────────────────────────────────────

    [Fact]
    public async Task GetRegister_EachMedicineReadsItsOwnEntry()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var authorised = await CreateOkAsync(c, p.Id, RestraintDto(true, "Dr Chen", AuthDate));
        var other = await CreateOkAsync(c, p.Id, RestraintDto(false, report: true) with { Name = "Olanzapine" });

        var ok = Assert.IsType<OkObjectResult>((await c.GetRegister(null, null, 1, 50, CancellationToken.None)).Result);
        var items = Assert.IsType<ApiResponse<PagedResult<MedicationListDto>>>(ok.Value).Data!.Items;
        Assert.DoesNotContain("ChemicalRestraintUnauthorised", items.Single(i => i.Id == authorised.Id).ComplianceFlags);
        Assert.Contains("ChemicalRestraintUnauthorised", items.Single(i => i.Id == other.Id).ComplianceFlags);
        Assert.Contains("ChemicalRestraintReportable", items.Single(i => i.Id == other.Id).ComplianceFlags);
    }

    [Fact]
    public async Task RegisterDto_CarriesRequiresReportingAndMedicationStatus()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var c = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(c, p.Id, RestraintDto(false, report: true));
        await UpdateOkAsync(c, med.Id, AsUpdate(RestraintDto(), MedicationStatus.Ceased));

        var rp = new RestrictivePracticesController(db, new SafetyNoteSyncService(db));
        var ok = Assert.IsType<OkObjectResult>((await rp.GetForParticipant(p.Id, true, CancellationToken.None)).Result);
        var dto = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(ok.Value).Data!.Single();
        Assert.True(dto.RequiresReporting);
        Assert.Equal(MedicationStatus.Ceased, dto.RelatedMedicationStatus);
    }
}
