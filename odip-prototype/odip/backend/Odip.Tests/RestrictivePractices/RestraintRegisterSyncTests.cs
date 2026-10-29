using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
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

    private static (OdipDbContext Db, ICurrentTenant Tenant) CreateDb(SaveChangesInterceptor? interceptor = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var builder = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString());
        if (interceptor != null) builder.AddInterceptors(interceptor);
        var options = builder.Options;
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

    // ── Register to medicine ─────────────────────────────────────────

    private static string RegisterError<T>(ActionResult<ApiResponse<T>> result, int status)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(status, obj.StatusCode);
        return Assert.IsType<ApiResponse<T>>(obj.Value).Errors!.First();
    }

    private static UpdateRestrictivePracticeDto AsForm(RestrictivePractice e) => new()
    {
        Type = e.Type, Description = e.Description, AuthorisedBy = e.AuthorisedBy, AuthorisationDate = e.AuthorisationDate, ReviewDate = e.ReviewDate,
        RelatedMedicationId = e.RelatedMedicationId, IsActive = e.IsActive, ExpectedUpdatedAt = e.UpdatedAt,
    };

    private static RestrictivePracticesController Register(OdipDbContext db) => new(db, new SafetyNoteSyncService(db));

    private static async Task<(OdipDbContext Db, ICurrentTenant Tenant, Participant P, MedicationDetailDto Med, MedicationsController Meds)> LinkedAsync(bool authorised = false)
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var meds = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(meds, p.Id, authorised ? RestraintDto(true, "Dr Chen", AuthDate) : RestraintDto(false, report: false));
        return (db, tenant, p, med, meds);
    }

    [Fact]
    public async Task UpdateEntry_DeactivateLinked_UntickesMedicine_ThenMedicineSaveLeavesEntryAlone()
    {
        var (db, _, _, med, meds) = await LinkedAsync();
        var entry = await db.RestrictivePractices.AsNoTracking().SingleAsync();

        var ok = Assert.IsType<OkObjectResult>((await Register(db).Update(entry.Id, AsForm(entry) with { IsActive = false, Description = "Edited" }, CancellationToken.None)).Result);
        var dto = Assert.IsType<ApiResponse<RestrictivePracticeDto>>(ok.Value).Data!;

        Assert.False(dto.IsActive);
        Assert.Equal("Edited", dto.Description);
        Assert.Equal(MedicationStatus.Active, dto.RelatedMedicationStatus);
        Assert.False((await db.ParticipantMedications.AsNoTracking().SingleAsync()).IsChemicalRestraint);

        var after = await db.RestrictivePractices.AsNoTracking().SingleAsync();
        await UpdateOkAsync(meds, med.Id, AsUpdate(RestraintDto() with { IsChemicalRestraint = false }));
        Assert.Equal(after.UpdatedAt, (await db.RestrictivePractices.AsNoTracking().SingleAsync()).UpdatedAt);
    }

    [Fact]
    public async Task UpdateEntry_ReactivateLinked_TicksMedicine()
    {
        var (db, _, _, med, meds) = await LinkedAsync();
        await UpdateOkAsync(meds, med.Id, AsUpdate(RestraintDto() with { IsChemicalRestraint = false }));
        var entry = await db.RestrictivePractices.AsNoTracking().SingleAsync();

        Assert.IsType<OkObjectResult>((await Register(db).Update(entry.Id, AsForm(entry) with { IsActive = true }, CancellationToken.None)).Result);

        Assert.True((await db.ParticipantMedications.AsNoTracking().SingleAsync()).IsChemicalRestraint);
    }

    [Fact]
    public async Task UpdateEntry_ReactivateWithCeasedMedicine_400_NothingChanged()
    {
        var (db, _, _, med, meds) = await LinkedAsync();
        await UpdateOkAsync(meds, med.Id, AsUpdate(RestraintDto(), MedicationStatus.Ceased));
        var entry = await db.RestrictivePractices.AsNoTracking().SingleAsync();

        var result = await Register(db).Update(entry.Id, AsForm(entry) with { IsActive = true }, CancellationToken.None);

        Assert.Equal("Risperidone 1 mg is ceased. Restart the medicine to reactivate this entry.", RegisterError(result, 400));
        Assert.False((await db.RestrictivePractices.AsNoTracking().SingleAsync()).IsActive);
    }

    [Fact]
    public async Task UpdateEntry_TypeChangeOnLinked_400()
    {
        var (db, _, _, _, _) = await LinkedAsync();
        var entry = await db.RestrictivePractices.AsNoTracking().SingleAsync();

        var result = await Register(db).Update(entry.Id, AsForm(entry) with { Type = RestrictivePracticeType.Seclusion, RelatedMedicationId = null }, CancellationToken.None);

        Assert.Equal("This entry is linked to Risperidone 1 mg, so it stays a chemical restraint.", RegisterError(result, 400));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task UpdateEntry_RepointOrUnlinkLinked_400(bool unlink)
    {
        var (db, _, p, _, meds) = await LinkedAsync();
        var other = await CreateOkAsync(meds, p.Id, RestraintDto(false, report: false) with { Name = "Olanzapine", Strength = null });
        var entry = await db.RestrictivePractices.AsNoTracking().SingleAsync(e => e.RelatedMedicationId != other.Id);

        var result = await Register(db).Update(entry.Id, AsForm(entry) with { RelatedMedicationId = unlink ? null : other.Id }, CancellationToken.None);

        Assert.Equal("This entry is linked to Risperidone 1 mg. To stop this restraint, untick Chemical restraint on the medicine or deactivate this entry.", RegisterError(result, 400));
    }

    [Fact]
    public async Task UpdateEntry_LinkMedicineThatHasEntry_400()
    {
        var (db, _, p, med, _) = await LinkedAsync();
        var loose = new RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = p.Id, Type = RestrictivePracticeType.ChemicalRestraint, Description = "Hand made", IsActive = true };
        db.RestrictivePractices.Add(loose);
        db.SaveChanges();

        var result = await Register(db).Update(loose.Id, AsForm(loose) with { RelatedMedicationId = med.Id }, CancellationToken.None);

        Assert.Equal("Risperidone 1 mg already has its own register entry.", RegisterError(result, 400));
    }

    [Fact]
    public async Task UpdateEntry_LinkFreeMedicine_TicksIt()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var medId = Guid.NewGuid();
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = medId, ParticipantId = p.Id, Name = "Risperidone", Strength = "1 mg", DoseDescription = "1 tablet", Type = MedicationType.Regular,
            Purpose = "Manage behaviour", StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        });
        var loose = new RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = p.Id, Type = RestrictivePracticeType.ChemicalRestraint, Description = "Hand made", IsActive = true };
        db.RestrictivePractices.Add(loose);
        db.SaveChanges();

        Assert.IsType<OkObjectResult>((await Register(db).Update(loose.Id, AsForm(loose) with { RelatedMedicationId = medId }, CancellationToken.None)).Result);

        Assert.True((await db.ParticipantMedications.AsNoTracking().SingleAsync()).IsChemicalRestraint);
    }

    [Fact]
    public async Task UpdateEntry_RequiresReporting_NullKeepsStoredAnswer_FalseSaves_AndEditsDoNotFlowBack()
    {
        var (db, _, _, med, _) = await LinkedAsync();
        var medBefore = await db.ParticipantMedications.AsNoTracking().SingleAsync();
        var seeded = await db.RestrictivePractices.SingleAsync();
        seeded.RequiresReporting = true;
        db.SaveChanges();
        var entry = await db.RestrictivePractices.AsNoTracking().SingleAsync();

        await Register(db).Update(entry.Id, AsForm(entry) with { RequiresReporting = null, Description = "New words", ReviewDate = new DateOnly(2027, 1, 1) }, CancellationToken.None);
        var kept = await db.RestrictivePractices.AsNoTracking().SingleAsync();
        Assert.True(kept.RequiresReporting);
        // Description and review date edits never touch the medicine.
        var medAfter = await db.ParticipantMedications.AsNoTracking().SingleAsync();
        Assert.Equal(medBefore.UpdatedAt, medAfter.UpdatedAt);
        Assert.Equal(medBefore.IsChemicalRestraint, medAfter.IsChemicalRestraint);

        await Register(db).Update(kept.Id, AsForm(kept) with { RequiresReporting = false }, CancellationToken.None);
        Assert.False((await db.RestrictivePractices.AsNoTracking().SingleAsync()).RequiresReporting);
    }

    [Fact]
    public async Task BulkCreate_TwoRowsSameMedicine_MedicineAlreadyLinked_AndActiveRowTicks()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var medId = Guid.NewGuid();
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = medId, ParticipantId = p.Id, Name = "Risperidone", Strength = "1 mg", DoseDescription = "1 tablet", Type = MedicationType.Regular,
            Purpose = "Manage behaviour", StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        });
        db.SaveChanges();
        BulkCreateRestrictivePracticeRowDto Row() => new() { Type = RestrictivePracticeType.ChemicalRestraint, Description = "Row", RelatedMedicationId = medId, IsActive = true };
        var register = Register(db);

        var twice = await register.CreateBulk(p.Id, new BulkCreateRestrictivePracticeDto { Items = { Row(), Row() } }, CancellationToken.None);
        Assert.Contains("Risperidone 1 mg already has its own register entry.", Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsAssignableFrom<ObjectResult>(twice.Result).Value).Errors!.First());
        Assert.Empty(db.RestrictivePractices);

        Assert.IsType<OkObjectResult>((await register.CreateBulk(p.Id, new BulkCreateRestrictivePracticeDto { Items = { Row() } }, CancellationToken.None)).Result);
        Assert.True((await db.ParticipantMedications.AsNoTracking().SingleAsync()).IsChemicalRestraint);

        var again = await register.CreateBulk(p.Id, new BulkCreateRestrictivePracticeDto { Items = { Row() } }, CancellationToken.None);
        Assert.Contains("already has its own register entry", Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsAssignableFrom<ObjectResult>(again.Result).Value).Errors!.First());
        Assert.Single(db.RestrictivePractices);
    }

    [Fact]
    public async Task BulkCreate_ActiveRowForCeasedMedicine_400()
    {
        var (db, tenant) = CreateDb();
        var p = SeedParticipant(db);
        var medId = Guid.NewGuid();
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = medId, ParticipantId = p.Id, Name = "Risperidone", Strength = "1 mg", DoseDescription = "1 tablet", Type = MedicationType.Regular,
            Purpose = "Manage behaviour", Status = MedicationStatus.Ceased, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        });
        db.SaveChanges();

        var result = await Register(db).CreateBulk(p.Id, new BulkCreateRestrictivePracticeDto
        {
            Items = { new() { Type = RestrictivePracticeType.ChemicalRestraint, Description = "Row", RelatedMedicationId = medId, IsActive = true } },
        }, CancellationToken.None);

        Assert.Contains("Risperidone 1 mg is ceased. Restart the medicine to reactivate this entry.", Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsAssignableFrom<ObjectResult>(result.Result).Value).Errors!.First());
    }

    [Fact]
    public async Task Delete_LinkedEntry_400_EntryKept_EvenWhenTheMedicineIsCeased()
    {
        var (db, _, _, med, meds) = await LinkedAsync();
        var entry = await db.RestrictivePractices.AsNoTracking().SingleAsync();

        var refused = await Register(db).Delete(entry.Id, CancellationToken.None);
        Assert.Equal("This entry is linked to Risperidone 1 mg. Deactivate it instead.", RegisterError(refused, 400));
        Assert.Single(db.RestrictivePractices);

        await UpdateOkAsync(meds, med.Id, AsUpdate(RestraintDto(), MedicationStatus.Ceased));
        var refusedCeased = await Register(db).Delete(entry.Id, CancellationToken.None);
        Assert.Equal("This entry is linked to Risperidone 1 mg. Deactivate it instead.", RegisterError(refusedCeased, 400));
        Assert.Single(db.RestrictivePractices);
    }

    [Fact]
    public async Task MedicineSave_UniqueViolationOnTheLink_409WithTheChangedCopy()
    {
        var interceptor = new UniqueViolationInterceptor();
        var (db, tenant) = CreateDb(interceptor);
        var p = SeedParticipant(db);
        var meds = new MedicationsController(db, tenant);
        var med = await CreateOkAsync(meds, p.Id, RestraintDto(false, report: false));
        interceptor.Armed = true;

        var result = await meds.Update(med.Id, AsUpdate(RestraintDto(false, report: false)), CancellationToken.None);

        Assert.Equal(StaleCopy, ErrorOf(result.Result, 409));
    }

    [Fact]
    public async Task UpdateEntry_UniqueViolationOnSave_409WithTheAlreadyLinkedCopy()
    {
        var interceptor = new UniqueViolationInterceptor();
        var (db, tenant) = CreateDb(interceptor);
        var p = SeedParticipant(db);
        await CreateOkAsync(new MedicationsController(db, tenant), p.Id, RestraintDto(false, report: false));
        var entry = await db.RestrictivePractices.AsNoTracking().SingleAsync();
        interceptor.Armed = true;

        var result = await Register(db).Update(entry.Id, AsForm(entry) with { Description = "Edited" }, CancellationToken.None);

        Assert.Equal("This medicine already has its own register entry.", RegisterError(result, 409));
    }

    /// <summary>Throws the error Npgsql raises when the unique index on the medicine link refuses a save, once armed.</summary>
    private sealed class UniqueViolationInterceptor : SaveChangesInterceptor
    {
        public bool Armed { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            Armed ? throw new DbUpdateException("x", new PostgresException("dup", "ERROR", "ERROR", "23505")) : ValueTask.FromResult(result);
    }
}
