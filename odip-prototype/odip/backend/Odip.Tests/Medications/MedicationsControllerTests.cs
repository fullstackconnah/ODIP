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
        // Use "now minus 2 hours" as the time-of-day so today's slot is clearly in the past.
        // Guard against the 2-hour subtraction rolling into the previous day (which would make
        // the computed slot look like it's still in the future today) by falling back to a
        // fixed early-morning time in that rare window.
        var pastTime = DateTime.UtcNow.AddHours(-2);
        if (pastTime.Date != DateTime.UtcNow.Date)
            pastTime = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, DateTime.UtcNow.Day, 0, 1, 0);
        var timeOfDay = pastTime.ToString("HH:mm");
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = timeOfDay, Status = MedicationStatus.Active,
            StartDate = today.ToDateTime(TimeOnly.MinValue).AddMonths(-1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetMar(today, participant.Id, CancellationToken.None);

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
}
