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
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Medications;

/// <summary>
/// Medication reads and writes audit (PT-MONEY 12, 13, 19): the date-only <c>to</c> of the two administration lists is the END of that
/// provider-local day (a 15:00 dose today used to fall after the 00:00 bound), a PRN outcome is written once and only on a PRN dose, and
/// Create and Update share one field copy.
/// </summary>
public class MedicationReadsTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    // 15:00 Sydney on 14 Oct 2026 (AEDT, UTC+11) is 04:00 UTC the same day; the old `<= 2026-10-14 00:00` bound dropped it.
    private static readonly DateTime Day = new(2026, 10, 14);
    private static readonly DateTime Dose3pmSydney = new(2026, 10, 14, 4, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime NextDay0030Sydney = new(2026, 10, 14, 13, 30, 0, DateTimeKind.Utc);

    private readonly PostgresFixture _pg;
    public MedicationReadsTests(PostgresFixture pg) => _pg = pg;

    private static Mock<ICurrentTenant> Tenant(Guid? tenantId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(tenantId is null);
        return tenant;
    }

    private static (OdipDbContext Db, MedicationsController Controller) InMemory()
    {
        var tenant = Tenant();
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        return (db, new MedicationsController(db, tenant.Object));
    }

    private static async Task<(Participant P, ParticipantMedication Med)> SeedAsync(OdipDbContext db, Guid tenantId, MedicationType type = MedicationType.Regular)
    {
        var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, Name = type == MedicationType.Prn ? "Paracetamol" : "Levetiracetam",
            DoseDescription = "1 tablet", Type = type, TimesOfDay = type == MedicationType.Regular ? "08:00" : null,
            PrnIndication = type == MedicationType.Prn ? "Pain" : null, PrnMaxDosesPer24h = type == MedicationType.Prn ? 4 : null,
            StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        };
        db.Participants.Add(p);
        db.ParticipantMedications.Add(med);
        await db.SaveChangesAsync(Ct);
        return (p, med);
    }

    private static MedicationAdministration Dose(ParticipantMedication med, DateTime administeredAtUtc, string? outcome = null) => new()
    {
        Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId,
        Status = MedicationAdministrationStatus.Administered, AdministeredAt = administeredAtUtc, AdministeredAtTimeZone = "Australia/Sydney",
        RecordedByName = "Test", PrnOutcome = outcome, PrnOutcomeAt = outcome is null ? null : administeredAtUtc.AddHours(1),
        CreatedAt = administeredAtUtc, UpdatedAt = administeredAtUtc,
    };

    private static async Task AssertListsHoldTheLateDoseAsync(OdipDbContext db, MedicationsController controller, Participant p, ParticipantMedication med)
    {
        var late = Dose(med, Dose3pmSydney);
        var tomorrow = Dose(med, NextDay0030Sydney);
        db.MedicationAdministrations.AddRange(late, tomorrow);
        await db.SaveChangesAsync(Ct);

        var list = await controller.GetParticipantAdministrations(p.Id, Day.AddDays(-14), Day, Ct);
        var listed = Assert.IsType<ApiResponse<List<AdministrationDto>>>(Assert.IsType<OkObjectResult>(list.Result).Value).Data!;
        Assert.Equal(new[] { late.Id }, listed.Select(a => a.Id));

        var report = await controller.GetAdministrationReport(p.Id, Day, Day, 1, 50, Ct);
        var reported = Assert.IsType<ApiResponse<PagedResult<AdministrationDto>>>(Assert.IsType<OkObjectResult>(report.Result).Value).Data!;
        Assert.Equal(new[] { late.Id }, reported.Items.Select(a => a.Id));
    }

    [Fact]
    public async Task ADoseAt3pmSydneyToday_IsInTheFourteenDayListAndTheReport_WhenToIsTodaysDate()
    {
        var (db, controller) = InMemory();
        var (p, med) = await SeedAsync(db, Guid.Empty);
        await AssertListsHoldTheLateDoseAsync(db, controller, p, med);
    }

    [SkippableFact]
    public async Task ADoseAt3pmSydneyToday_IsInTheFourteenDayListAndTheReport_OnPostgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var (p, med) = await SeedAsync(db, tenantId);
        await AssertListsHoldTheLateDoseAsync(db, new MedicationsController(db, Tenant(tenantId).Object), p, med);
    }

    [Fact]
    public async Task TheParticipantList_WithNoFrom_StopsAtNinetyDays()
    {
        var (db, controller) = InMemory();
        var (p, med) = await SeedAsync(db, Guid.Empty);
        var recent = Dose(med, DateTime.UtcNow.AddDays(-5));
        db.MedicationAdministrations.AddRange(recent, Dose(med, DateTime.UtcNow.AddDays(-200)));
        await db.SaveChangesAsync(Ct);

        var list = await controller.GetParticipantAdministrations(p.Id, null, null, Ct);

        var listed = Assert.IsType<ApiResponse<List<AdministrationDto>>>(Assert.IsType<OkObjectResult>(list.Result).Value).Data!;
        Assert.Equal(new[] { recent.Id }, listed.Select(a => a.Id));
    }

    // ── PRN outcome ─────────────────────────────────────────────────────────

    [Fact]
    public async Task AnOutcome_OnAPrnDoseWithNone_IsSaved()
    {
        var (db, controller) = InMemory();
        var (_, med) = await SeedAsync(db, Guid.Empty, MedicationType.Prn);
        var dose = Dose(med, Dose3pmSydney);
        db.MedicationAdministrations.Add(dose);
        await db.SaveChangesAsync(Ct);

        var result = await controller.RecordOutcome(dose.Id, new RecordPrnOutcomeDto { PrnOutcome = "Settled" }, Ct);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("Settled", (await db.MedicationAdministrations.SingleAsync(Ct)).PrnOutcome);
    }

    [Fact]
    public async Task AnOutcome_OnARegularDose_IsRefused_AndNothingIsWritten()
    {
        var (db, controller) = InMemory();
        var (_, med) = await SeedAsync(db, Guid.Empty);
        var dose = Dose(med, Dose3pmSydney);
        db.MedicationAdministrations.Add(dose);
        await db.SaveChangesAsync(Ct);

        var result = await controller.RecordOutcome(dose.Id, new RecordPrnOutcomeDto { PrnOutcome = "Settled" }, Ct);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Null((await db.MedicationAdministrations.SingleAsync(Ct)).PrnOutcome);
    }

    [Fact]
    public async Task ASecondOutcome_OnAPrnDose_IsRefused_AndTheFirstIsKept()
    {
        var (db, controller) = InMemory();
        var (_, med) = await SeedAsync(db, Guid.Empty, MedicationType.Prn);
        var dose = Dose(med, Dose3pmSydney, outcome: "Settled");
        db.MedicationAdministrations.Add(dose);
        await db.SaveChangesAsync(Ct);

        var result = await controller.RecordOutcome(dose.Id, new RecordPrnOutcomeDto { PrnOutcome = "Overwritten" }, Ct);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.False(Assert.IsType<ApiResponse<AdministrationDto>>(conflict.Value).Success);
        var saved = await db.MedicationAdministrations.SingleAsync(Ct);
        Assert.Equal("Settled", saved.PrnOutcome);
        Assert.Equal(dose.PrnOutcomeAt, saved.PrnOutcomeAt);
    }

    // ── Create and Update share one field copy ──────────────────────────────

    private static readonly CreateMedicationDto Regular = new()
    {
        Name = "Levetiracetam", Strength = "500mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral, DoseDescription = "1 tablet",
        Directions = "With food", Type = MedicationType.Regular, TimesOfDay = "07:00,19:00", Frequency = MedicationFrequency.SpecificDays,
        DaysOfWeek = new() { "Monday", "Friday" }, IntervalDays = 3, AnchorDate = new DateOnly(2026, 3, 1),
        Purpose = "Seizure control", IsPsychotropic = true, IsChemicalRestraint = true, BspInPlace = true, RestrictivePracticeAuthorisationRef = "RP-1",
        IsHighRisk = true, IsHighIntensitySupport = true, DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
        PrescriberName = "Dr Who", PharmacyName = "Corner Pharmacy", PharmacyPhone = "02 5550 0000", Packaging = PackagingType.DosetteBox,
        StartDate = new DateTime(2026, 1, 2), EndDate = new DateTime(2027, 1, 2), NextReviewDue = new DateTime(2026, 12, 1),
        ConsentObtained = true, ConsentGivenBy = "Guardian", ConsentDate = new DateTime(2026, 1, 1), StorageRequirements = "Fridge", Notes = "n1",
    };

    private static readonly UpdateMedicationDto Prn = new()
    {
        Name = "Paracetamol", Strength = "250mg", Form = MedicationForm.Liquid, Route = MedicationRoute.Oral, DoseDescription = "10 mL",
        Directions = "As needed", Type = MedicationType.Prn, PrnIndication = "Mild pain", PrnMaxDosesPer24h = 4, PrnMinIntervalMinutes = 240,
        Purpose = null, IsPsychotropic = false, IsChemicalRestraint = false, BspInPlace = false, RestrictivePracticeAuthorisationRef = null,
        IsHighRisk = false, IsHighIntensitySupport = false, DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.Assist,
        PrescriberName = "Dr Two", PharmacyName = "Other Pharmacy", PharmacyPhone = "02 5550 1111", Packaging = PackagingType.OriginalPackaging,
        StartDate = new DateTime(2026, 2, 3), EndDate = null, NextReviewDue = new DateTime(2026, 11, 1),
        ConsentObtained = false, ConsentGivenBy = null, ConsentDate = null, StorageRequirements = "Cupboard", Notes = "n2", Status = MedicationStatus.OnHold,
    };

    private static readonly Dictionary<string, string[]> Groups = new()
    {
        ["identity"] = new[] { "Name", "Strength", "Form", "Route", "DoseDescription", "Directions" },
        ["schedule"] = new[] { "Type", "TimesOfDay", "Frequency", "IntervalDays", "AnchorDate" },
        ["prn"] = new[] { "PrnIndication", "PrnMaxDosesPer24h", "PrnMinIntervalMinutes" },
        ["risk"] = new[] { "Purpose", "IsPsychotropic", "IsChemicalRestraint", "BspInPlace", "RestrictivePracticeAuthorisationRef", "IsHighRisk", "IsHighIntensitySupport", "DrugSchedule", "SupportLevel" },
        ["supply"] = new[] { "PrescriberName", "PharmacyName", "PharmacyPhone", "Packaging", "StorageRequirements" },
        ["dates-consent-notes"] = new[] { "StartDate", "EndDate", "NextReviewDue", "ConsentObtained", "ConsentGivenBy", "ConsentDate", "Notes" },
    };

    private static void AssertGroup(string group, ParticipantMedication saved, CreateMedicationDto dto)
    {
        foreach (var name in Groups[group])
            Assert.Equal(typeof(CreateMedicationDto).GetProperty(name)!.GetValue(dto), typeof(ParticipantMedication).GetProperty(name)!.GetValue(saved));
    }

    public static IEnumerable<object[]> GroupNames() => Groups.Keys.Select(k => new object[] { k });

    [Theory]
    [MemberData(nameof(GroupNames))]
    public async Task CreateThenUpdate_SavesEveryFieldOfTheGroup(string group)
    {
        var (db, controller) = InMemory();
        var (p, existing) = await SeedAsync(db, Guid.Empty);
        db.ParticipantMedications.Remove(existing);
        await db.SaveChangesAsync(Ct);

        var created = await controller.Create(p.Id, Regular, Ct);
        var id = Assert.IsType<ApiResponse<MedicationDetailDto>>(Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;
        var saved = await db.ParticipantMedications.AsNoTracking().SingleAsync(m => m.Id == id, Ct);
        AssertGroup(group, saved, Regular);
        Assert.Equal(Weekdays.Monday | Weekdays.Friday, saved.DaysOfWeek);
        Assert.Equal(MedicationStatus.Active, saved.Status);

        Assert.IsType<OkObjectResult>((await controller.Update(id, Prn, Ct)).Result);
        saved = await db.ParticipantMedications.AsNoTracking().SingleAsync(m => m.Id == id, Ct);
        AssertGroup(group, saved, Prn);
        Assert.Null(saved.DaysOfWeek);
        Assert.Equal(MedicationStatus.OnHold, saved.Status);
    }
}
