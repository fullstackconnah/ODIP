using System.Text.Json;
using System.Text.Json.Serialization;
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

/// <summary>
/// Controller-level coverage for the Medication Management API slice (MedicationsController),
/// using the same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as RosteringControllerTests.
/// </summary>
public class MedicationsControllerTests
{
    private static readonly JsonSerializerOptions ApiJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() }
    };

    private static (OdipDbContext Db, ICurrentTenant Tenant) CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return (new OdipDbContext(options, tenant.Object), tenant.Object);
    }

    private static Participant SeedParticipant(OdipDbContext db, string firstName = "Sophie", string lastName = "Brown")
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static CreateMedicationDto RegularDto(string timesOfDay = "08:00,20:00") => new()
    {
        Name = "Levetiracetam", Strength = "500mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
        DoseDescription = "1 tablet (500mg)", Type = MedicationType.Regular, TimesOfDay = timesOfDay,
        DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
        StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
    };

    private static CreateMedicationDto PrnDto(string? prnIndication = "Mild pain", int? maxDoses = 4, int? minInterval = 240) => new()
    {
        Name = "Paracetamol", Strength = "500mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
        DoseDescription = "2 tablets (1000mg)", Type = MedicationType.Prn,
        PrnIndication = prnIndication, PrnMaxDosesPer24h = maxDoses, PrnMinIntervalMinutes = minInterval,
        DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.Assist,
        StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
    };

    // ── INTAKE-08: a draft participant is excluded from the medication picker ──────────

    [Fact]
    public async Task Create_DraftParticipant_ReturnsNotFound()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.Add(draft);
        db.SaveChanges();
        var controller = new MedicationsController(db, tenant);

        var result = await controller.Create(draft.Id, RegularDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Empty(await db.ParticipantMedications.ToListAsync());
    }

    // ── Create validation ────────────────────────────────────────────────

    [Fact]
    public async Task Create_PrnWithoutIndication_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var dto = PrnDto(prnIndication: null);

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(badRequest.Value);
        Assert.False(body.Success);
        Assert.Empty(await db.ParticipantMedications.ToListAsync());
    }

    [Fact]
    public async Task Create_PrnWithoutMaxDoses_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var dto = PrnDto(maxDoses: null);

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_RegularWithoutTimesOfDay_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var dto = RegularDto(timesOfDay: null!);

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ChemicalRestraintWithoutPurpose_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var dto = PrnDto() with { IsChemicalRestraint = true, Purpose = null };

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ParticipantMissing_ReturnsNotFound()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var controller = new MedicationsController(db, tenant);

        var result = await controller.Create(Guid.NewGuid(), RegularDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ValidRegular_SavesAndReturnsDetail()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var result = await controller.Create(participant.Id, RegularDto(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Levetiracetam", body.Data!.Name);
        Assert.Equal(MedicationStatus.Active, body.Data.Status);

        var saved = await db.ParticipantMedications.SingleAsync();
        Assert.Equal(participant.Id, saved.ParticipantId);
    }

    // ── MED-01: PharmacyPhone round-trip ────────────────────────────────

    [Fact]
    public async Task Create_WithPharmacyPhone_RoundTripsInDetail()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var dto = RegularDto() with { PharmacyName = "Chemist Warehouse", PharmacyPhone = "03 9123 4567" };

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(ok.Value);
        Assert.Equal("03 9123 4567", body.Data!.PharmacyPhone);

        var saved = await db.ParticipantMedications.SingleAsync();
        Assert.Equal("03 9123 4567", saved.PharmacyPhone);
    }

    [Fact]
    public async Task Update_ChangesPharmacyPhone_PersistsNewValue()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var createController = new MedicationsController(db, tenant);
        var created = await createController.Create(participant.Id, RegularDto() with { PharmacyPhone = "03 9000 0000" }, CancellationToken.None);
        var id = Assert.IsType<ApiResponse<MedicationDetailDto>>(Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;

        var updateController = new MedicationsController(db, tenant);
        var updateDto = new UpdateMedicationDto
        {
            Name = "Levetiracetam", Strength = "500mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
            DoseDescription = "1 tablet (500mg)", Type = MedicationType.Regular, TimesOfDay = "08:00,20:00",
            DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
            Status = MedicationStatus.Active, PharmacyPhone = "03 9111 1111",
        };
        var result = await updateController.Update(id, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(ok.Value);
        Assert.Equal("03 9111 1111", body.Data!.PharmacyPhone);
    }

    [Fact]
    public async Task Create_WithoutPharmacyPhone_DetailPharmacyPhoneIsNull()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var result = await controller.Create(participant.Id, RegularDto(), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(body.Data!.PharmacyPhone);
    }

    [Fact]
    public async Task GetMar_ExposesPharmacyNameAndPhoneOnEntries()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = today.ToDateTime(TimeOnly.MinValue).AddMonths(-1), ConsentObtained = true,
            PharmacyName = "Chemist Warehouse", PharmacyPhone = "03 9123 4567",
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetMar(today, participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!.Entries);
        Assert.Equal("Chemist Warehouse", entry.PharmacyName);
        Assert.Equal("03 9123 4567", entry.PharmacyPhone);
    }

    // ── Compliance flags ─────────────────────────────────────────────────

    [Fact]
    public async Task GetById_ChemicalRestraintWithoutBsp_FlagsChemicalRestraintUnauthorised()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Risperidone", DoseDescription = "1 tablet",
            Type = MedicationType.Prn, PrnIndication = "Behavioural escalation", PrnMaxDosesPer24h = 2,
            IsChemicalRestraint = true, BspInPlace = false, RestrictivePracticeAuthorisationRef = null,
            Purpose = "Manage behaviour", Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1),
            ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetById(med.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(ok.Value);
        Assert.Contains("ChemicalRestraintUnauthorised", body.Data!.ComplianceFlags);
    }

    [Fact]
    public async Task GetById_ChemicalRestraintWithBspAndAuth_NoUnauthorisedFlag()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Risperidone", DoseDescription = "1 tablet",
            Type = MedicationType.Prn, PrnIndication = "Behavioural escalation", PrnMaxDosesPer24h = 2,
            IsChemicalRestraint = true, BspInPlace = true, RestrictivePracticeAuthorisationRef = "QLD-RP-001",
            Purpose = "Manage behaviour", Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1),
            ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetById(med.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(ok.Value);
        Assert.DoesNotContain("ChemicalRestraintUnauthorised", body.Data!.ComplianceFlags);
    }

    [Fact]
    public async Task GetById_ReviewDateInPastAndActive_FlagsReviewOverdue()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1),
            NextReviewDue = DateTime.UtcNow.AddDays(-5), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetById(med.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Contains("ReviewOverdue", body.Data!.ComplianceFlags);
    }

    // ── Administration validation ─────────────────────────────────────────

    [Fact]
    public async Task RecordAdministration_NotAdministeredWithoutReason_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Missed, Reason = null };

        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.False(body.Success);
        Assert.Contains("reason is required", body.Errors![0]);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_HighRiskAdministeredWithoutWitness_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Insulin", DoseDescription = "18 units",
            Type = MedicationType.Regular, TimesOfDay = "08:00", IsHighRisk = true, Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessName = null };

        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("witness", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_HighRiskAdministeredWithWitness_Saves()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Insulin", DoseDescription = "18 units",
            Type = MedicationType.Regular, TimesOfDay = "08:00", IsHighRisk = true, Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessName = "Rachel Thompson" };

        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Rachel Thompson", body.Data!.WitnessName);
        Assert.NotNull(body.Data.AdministeredAt); // defaulted to now
        Assert.Equal(1, await db.MedicationAdministrations.CountAsync());
    }

    [Fact]
    public async Task RecordAdministration_PrnWithoutPrnReason_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4, PrnMinIntervalMinutes = 240,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, PrnReason = null };

        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    // ── MED-03: wrong medication administered ──────────────────────────────

    [Fact]
    public async Task RecordAdministration_WrongMedicationWithoutNote_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        // Reason satisfies the generic non-Administered requirement, but Notes ("what was given
        // instead") is left blank — MED-03 requires it specifically for WrongMedication.
        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.WrongMedication, Reason = "Grabbed the wrong blister pack", Notes = null };

        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.False(body.Success);
        Assert.Contains("what was given instead", body.Errors![0]);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_WrongMedicationWithoutReason_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.WrongMedication, Reason = null, Notes = "Gave Paracetamol 500mg instead" };

        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_WrongMedicationWithReasonAndNote_Saves()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var dto = new CreateAdministrationDto
        {
            Status = MedicationAdministrationStatus.WrongMedication,
            Reason = "Grabbed the wrong blister pack",
            Notes = "Gave Paracetamol 500mg instead",
        };

        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(MedicationAdministrationStatus.WrongMedication, body.Data!.Status);
        Assert.Equal("Gave Paracetamol 500mg instead", body.Data.Notes);
        Assert.Equal(1, await db.MedicationAdministrations.CountAsync());
    }

    [Fact]
    public async Task UpdateAdministration_ChangedToWrongMedicationWithoutNote_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
        };
        db.ParticipantMedications.Add(med);
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var dto = new UpdateAdministrationDto { Status = MedicationAdministrationStatus.WrongMedication, Reason = "Wrong pack", Notes = null };

        var result = await controller.UpdateAdministration(admin.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("what was given instead", body.Errors![0]);
    }

    // ── PRN ceiling ──────────────────────────────────────────────────────

    [Fact]
    public async Task RecordAdministration_PrnMaxDosesReached_BlockedWithoutAcknowledge()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 2, PrnMinIntervalMinutes = 0,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        // Two doses already administered within the last 24h -> ceiling reached.
        db.MedicationAdministrations.AddRange(
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow.AddHours(-10),
                RecordedByName = "Test",
            },
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow.AddHours(-5),
                RecordedByName = "Test",
            });
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var dto = new CreateAdministrationDto
        {
            Status = MedicationAdministrationStatus.Administered, PrnReason = "Headache",
            AcknowledgeLimitBreach = false,
        };

        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("Maximum 2 doses in 24 hours reached", body.Errors![0]);
        Assert.Equal(2, await db.MedicationAdministrations.CountAsync());
    }

    [Fact]
    public async Task RecordAdministration_PrnMaxDosesReachedWithAcknowledge_SavesWithLimitBreachFlag()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 2, PrnMinIntervalMinutes = 0,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.MedicationAdministrations.AddRange(
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow.AddHours(-10),
                RecordedByName = "Test",
            },
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow.AddHours(-5),
                RecordedByName = "Test",
            });
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var dto = new CreateAdministrationDto
        {
            Status = MedicationAdministrationStatus.Administered, PrnReason = "Headache",
            AcknowledgeLimitBreach = true,
        };

        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.True(body.Data!.LimitBreachAcknowledged);
        Assert.Equal(3, await db.MedicationAdministrations.CountAsync());
    }

    [Fact]
    public async Task RecordAdministration_PrnMinIntervalNotElapsed_BlockedWithoutAcknowledge()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4, PrnMinIntervalMinutes = 240,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow.AddMinutes(-30),
            RecordedByName = "Test",
        });
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, PrnReason = "Headache" };

        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("Minimum interval of 240 minutes not yet elapsed", body.Errors![0]);
    }

    // ── MAR expansion ────────────────────────────────────────────────────

    [Fact]
    public async Task GetMar_RegularMedication_ReturnsOneEntryPerTimeOfDay()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00,20:00", Status = MedicationStatus.Active,
            StartDate = today.ToDateTime(TimeOnly.MinValue).AddMonths(-1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetMar(today, participant.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<MarDayDto>>(ok.Value);
        Assert.Equal(2, body.Data!.Entries.Count);
        Assert.Contains(body.Data.Entries, e => e.ScheduledTime == "08:00");
        Assert.Contains(body.Data.Entries, e => e.ScheduledTime == "20:00");
    }

    [Fact]
    public async Task GetMar_PastScheduledTimeWithNoAdministration_IsOverdue()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        // Fixed time-of-day on a past date, not an offset from DateTime.UtcNow: the slot must
        // clear MedicationsController's 60-minute overdue grace (scheduledAt.AddMinutes(60) <
        // now), and yesterday at 08:00 is always well past that grace no matter what time of
        // day the suite happens to run at.
        var targetDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);

        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = targetDate.ToDateTime(TimeOnly.MinValue).AddMonths(-1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetMar(targetDate, participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!.Entries);
        Assert.True(entry.IsOverdue);
        Assert.Null(entry.Administration);
    }

    [Fact]
    public async Task GetMar_RecordedAdministration_NotOverdueAndAttached()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = today.ToDateTime(TimeOnly.MinValue).AddMonths(-1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        var scheduledAt = today.ToDateTime(new TimeOnly(8, 0));
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            ScheduledAt = scheduledAt, AdministeredAt = scheduledAt.AddMinutes(5),
            Status = MedicationAdministrationStatus.Administered, RecordedByName = "Test",
        });
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetMar(today, participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!.Entries);
        Assert.False(entry.IsOverdue);
        Assert.NotNull(entry.Administration);
        Assert.Equal(MedicationAdministrationStatus.Administered, entry.Administration!.Status);
    }

    // ── Administration report (task 6b) ───────────────────────────────────

    [Fact]
    public async Task GetAdministrationReport_OrdersByAdministrationTimeDescending()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        var earliest = DateTime.UtcNow.AddDays(-2);
        var middle = DateTime.UtcNow.AddDays(-1);
        var latest = DateTime.UtcNow;
        db.MedicationAdministrations.AddRange(
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = middle, RecordedByName = "Test",
            },
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = latest, RecordedByName = "Test",
            },
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = earliest, RecordedByName = "Test",
            });
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetAdministrationReport(null, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<AdministrationDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(3, body.Data!.TotalCount);
        Assert.Equal(
            new[] { latest, middle, earliest },
            body.Data.Items.Select(a => a.AdministeredAt!.Value).ToArray());
    }

    [Fact]
    public async Task GetAdministrationReport_FiltersByParticipant()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participantA = SeedParticipant(db, "Sophie", "Brown");
        var participantB = SeedParticipant(db, "Harrison", "Lee");
        var medA = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantA.Id, Name = "Paracetamol",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        var medB = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantB.Id, Name = "Ibuprofen",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.AddRange(medA, medB);
        db.MedicationAdministrations.AddRange(
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = medA.Id, ParticipantId = participantA.Id,
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
            },
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = medB.Id, ParticipantId = participantB.Id,
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
            });
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetAdministrationReport(participantA.Id, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<AdministrationDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var item = Assert.Single(body.Data!.Items);
        Assert.Equal(participantA.Id, item.ParticipantId);
    }

    [Fact]
    public async Task GetAdministrationReport_TenantScoped_OnlyReturnsCallersTenant()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();

        // Seed as SuperAdmin (bypasses the query filter) with explicit TenantId per row, using
        // the sync SaveChanges (not overridden) so the explicit TenantId values aren't touched.
        using (var seedDb = CreateDb(dbName).Db)
        {
            var participantA = new Participant { Id = Guid.NewGuid(), TenantId = tenantAId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            var participantB = new Participant { Id = Guid.NewGuid(), TenantId = tenantBId, FirstName = "Harrison", LastName = "Lee", IsActive = true };
            seedDb.Participants.AddRange(participantA, participantB);
            var medA = new ParticipantMedication
            {
                Id = Guid.NewGuid(), TenantId = tenantAId, ParticipantId = participantA.Id, Name = "Paracetamol",
                Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
                Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
            };
            var medB = new ParticipantMedication
            {
                Id = Guid.NewGuid(), TenantId = tenantBId, ParticipantId = participantB.Id, Name = "Ibuprofen",
                Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
                Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
            };
            seedDb.ParticipantMedications.AddRange(medA, medB);
            seedDb.MedicationAdministrations.AddRange(
                new MedicationAdministration
                {
                    Id = Guid.NewGuid(), TenantId = tenantAId, ParticipantMedicationId = medA.Id, ParticipantId = participantA.Id,
                    Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
                },
                new MedicationAdministration
                {
                    Id = Guid.NewGuid(), TenantId = tenantBId, ParticipantMedicationId = medB.Id, ParticipantId = participantB.Id,
                    Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
                });
            seedDb.SaveChanges();
        }

        // Query as a non-SuperAdmin user scoped to tenant A.
        var tenantAMock = new Mock<ICurrentTenant>();
        tenantAMock.Setup(t => t.TenantId).Returns(tenantAId);
        tenantAMock.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        using var scopedDb = new OdipDbContext(options, tenantAMock.Object);

        var controller = new MedicationsController(scopedDb, tenantAMock.Object);
        var result = await controller.GetAdministrationReport(null, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<AdministrationDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var item = Assert.Single(body.Data!.Items);
        Assert.Equal(tenantAId, (await scopedDb.MedicationAdministrations.IgnoreQueryFilters().SingleAsync(a => a.Id == item.Id)).TenantId);
    }

    [Fact]
    public void GetAdministrationReport_IsRoleGated_AdminCoordinatorSuperAdminOnly()
    {
        var method = typeof(MedicationsController).GetMethod(nameof(MedicationsController.GetAdministrationReport));
        var authorizeAttr = method!.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), false)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Single();
        Assert.Equal("Admin,Coordinator,SuperAdmin", authorizeAttr.Roles);
    }

    // ══════════════════════════════════════════════════════════════
    // Connection-map reverse link (Deliverable 2): AdministrationDto/MarEntryDto.IncidentId
    // ══════════════════════════════════════════════════════════════

    /// <summary>An active IncidentReport whose MedicationAdministrationId points at <paramref name="administrationId"/>.</summary>
    private static IncidentReport SeedIncidentForAdministration(
        OdipDbContext db, Guid administrationId, bool isActive = true, DateTime? createdAt = null, string title = "Missed dose")
    {
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), MedicationAdministrationId = administrationId, ReportedByUserId = Guid.NewGuid(),
            Title = title, Description = "Auto-generated for test.", IncidentDateTime = DateTime.UtcNow,
            Severity = IncidentSeverity.Low, Status = IncidentStatus.Draft, IsActive = isActive,
            CreatedAt = createdAt ?? DateTime.UtcNow,
        };
        db.IncidentReports.Add(incident);
        db.SaveChanges();
        return incident;
    }

    [Fact]
    public async Task GetAdministrationReport_IncidentId_NullWhenNoIncidentReferencesAdministration()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetAdministrationReport(null, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<AdministrationDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var item = Assert.Single(body.Data!.Items);
        Assert.Null(item.IncidentId);
    }

    [Fact]
    public async Task GetAdministrationReport_IncidentId_PopulatedForOneAdministrationAndNullForAnother()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        var referencedAdmin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow.AddHours(-1), RecordedByName = "Test",
        };
        var unreferencedAdmin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
        };
        db.MedicationAdministrations.AddRange(referencedAdmin, unreferencedAdmin);
        db.SaveChanges();
        // Older active incident, then a newer one — the newest active one must win.
        var older = SeedIncidentForAdministration(db, referencedAdmin.Id, createdAt: DateTime.UtcNow.AddDays(-2), title: "Older report");
        var newer = SeedIncidentForAdministration(db, referencedAdmin.Id, createdAt: DateTime.UtcNow.AddDays(-1), title: "Newer report");
        // A closed-out (inactive) incident on the other administration must be ignored.
        SeedIncidentForAdministration(db, unreferencedAdmin.Id, isActive: false);

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetAdministrationReport(null, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<AdministrationDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(2, body.Data!.TotalCount);
        var referencedItem = body.Data.Items.Single(a => a.Id == referencedAdmin.Id);
        var unreferencedItem = body.Data.Items.Single(a => a.Id == unreferencedAdmin.Id);
        Assert.Equal(newer.Id, referencedItem.IncidentId);
        Assert.Null(unreferencedItem.IncidentId);
    }

    [Fact]
    public async Task GetParticipantAdministrations_IncidentId_Populated()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();
        var incident = SeedIncidentForAdministration(db, admin.Id);

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetParticipantAdministrations(participant.Id, null, null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<AdministrationDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var item = Assert.Single(body.Data!);
        Assert.Equal(incident.Id, item.IncidentId);
    }

    [Fact]
    public async Task UpdateAdministration_IncidentId_ReflectsIncidentReferencingIt()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Missed, Reason = "Not available", RecordedByName = "Test",
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();
        var incident = SeedIncidentForAdministration(db, admin.Id);

        var controller = new MedicationsController(db, tenant);
        var dto = new UpdateAdministrationDto { Status = MedicationAdministrationStatus.Missed, Reason = "Still not available" };
        var result = await controller.UpdateAdministration(admin.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(incident.Id, body.Data!.IncidentId);
    }

    [Fact]
    public async Task RecordOutcome_IncidentId_ReflectsIncidentReferencingIt()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();
        var incident = SeedIncidentForAdministration(db, admin.Id);

        var controller = new MedicationsController(db, tenant);
        var result = await controller.RecordOutcome(admin.Id, new RecordPrnOutcomeDto { PrnOutcome = "Settled within 30 minutes." }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(incident.Id, body.Data!.IncidentId);
    }

    [Fact]
    public async Task GetMar_IncidentId_PopulatedOnEntryAndItsAdministration()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = today.ToDateTime(TimeOnly.MinValue).AddMonths(-1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();
        var scheduledAt = today.ToDateTime(new TimeOnly(8, 0));
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, ScheduledAt = scheduledAt, AdministeredAt = scheduledAt,
            RecordedByName = "Test",
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();
        var incident = SeedIncidentForAdministration(db, admin.Id);

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetMar(today, participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!.Entries);
        Assert.Equal(incident.Id, entry.IncidentId);
        Assert.Equal(incident.Id, entry.Administration!.IncidentId);
    }

    [Fact]
    public async Task GetMar_NoAdministrationYet_IncidentIdIsNull()
    {
        var (db, tenant) = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            StartDate = today.ToDateTime(TimeOnly.MinValue).AddMonths(-1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetMar(today, participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!.Entries);
        Assert.Null(entry.Administration);
        Assert.Null(entry.IncidentId);
    }
}
