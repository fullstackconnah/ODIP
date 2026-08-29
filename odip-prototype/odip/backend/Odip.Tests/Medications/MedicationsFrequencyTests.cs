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
/// Controller-level coverage for the non-daily schedule feature: GetMar only expands a Regular
/// medication into MAR entries on days it's actually due (Daily/SpecificDays/EveryNDays), Create
/// validates the new frequency fields, and pre-existing rows behave exactly as Daily (the
/// migration backfill's behavioural contract) without ever setting Frequency explicitly.
/// </summary>
public class MedicationsFrequencyTests
{
    private static (OdipDbContext Db, ICurrentTenant Tenant) CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return (new OdipDbContext(options, tenant.Object), tenant.Object);
    }

    private static Participant SeedParticipant(OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    [Fact]
    public async Task GetMar_PreExistingRowWithDefaultFrequency_BehavesAsDaily()
    {
        // Simulates a pre-migration row: Frequency is never set explicitly, so it takes the
        // entity default (Daily) exactly as the migration backfills existing data — the medication
        // must still be due every day, unchanged from behaviour before this feature existed.
        var (db, tenant) = CreateDb();
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

        Assert.Equal(MedicationFrequency.Daily, med.Frequency);

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetMar(today, participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Single(body.Data!.Entries);
    }

    [Fact]
    public async Task GetMar_SpecificDaysNotDueToday_ExcludesEntry()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        // Pick "today" as whatever weekday it happens to be, then flag every OTHER weekday as due
        // so today is guaranteed not due, regardless of when the suite runs.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var allExceptToday = Enum.GetValues<Weekdays>()
            .Where(w => w != Weekdays.None)
            .Aggregate(Weekdays.None, (acc, w) => acc | w);
        var todayFlag = today.DayOfWeek switch
        {
            DayOfWeek.Monday => Weekdays.Monday, DayOfWeek.Tuesday => Weekdays.Tuesday,
            DayOfWeek.Wednesday => Weekdays.Wednesday, DayOfWeek.Thursday => Weekdays.Thursday,
            DayOfWeek.Friday => Weekdays.Friday, DayOfWeek.Saturday => Weekdays.Saturday,
            _ => Weekdays.Sunday,
        };
        var mask = allExceptToday & ~todayFlag;

        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            Frequency = MedicationFrequency.SpecificDays, DaysOfWeek = mask,
            StartDate = today.ToDateTime(TimeOnly.MinValue).AddMonths(-1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);
        var result = await controller.GetMar(today, participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Empty(body.Data!.Entries);
    }

    [Fact]
    public async Task GetMar_EveryNDaysNotDueToday_ExcludesEntry_AndDueDayIncludesIt()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        // Anchor 1 day after today with a 5-day interval -> today can't be a multiple, tomorrow is.
        var anchor = today.AddDays(1);

        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active,
            Frequency = MedicationFrequency.EveryNDays, IntervalDays = 5, AnchorDate = anchor,
            StartDate = today.ToDateTime(TimeOnly.MinValue).AddMonths(-1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();

        var controller = new MedicationsController(db, tenant);

        var notDueResult = await controller.GetMar(today, participant.Id, CancellationToken.None);
        var notDueBody = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(notDueResult.Result).Value);
        Assert.Empty(notDueBody.Data!.Entries);

        var dueResult = await controller.GetMar(anchor, participant.Id, CancellationToken.None);
        var dueBody = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(dueResult.Result).Value);
        Assert.Single(dueBody.Data!.Entries);
    }

    // ── Create validation ────────────────────────────────────────────────

    private static CreateMedicationDto RegularDto() => new()
    {
        Name = "Levetiracetam", Strength = "500mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
        DoseDescription = "1 tablet (500mg)", Type = MedicationType.Regular, TimesOfDay = "08:00",
        DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
        StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
    };

    [Fact]
    public async Task Create_SpecificDaysWithoutAnyDaySelected_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var dto = RegularDto() with { Frequency = MedicationFrequency.SpecificDays, DaysOfWeek = new List<string>() };
        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await db.ParticipantMedications.ToListAsync());
    }

    [Fact]
    public async Task Create_SpecificDaysWithDaysSelected_Saves()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var dto = RegularDto() with { Frequency = MedicationFrequency.SpecificDays, DaysOfWeek = new List<string> { "Monday", "Wednesday" } };
        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(new[] { "Monday", "Wednesday" }, body.Data!.DaysOfWeek);

        var saved = await db.ParticipantMedications.SingleAsync();
        Assert.Equal(Weekdays.Monday | Weekdays.Wednesday, saved.DaysOfWeek);
    }

    [Fact]
    public async Task Create_EveryNDaysWithoutIntervalOrAnchor_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var dto = RegularDto() with { Frequency = MedicationFrequency.EveryNDays };
        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await db.ParticipantMedications.ToListAsync());
    }

    [Fact]
    public async Task Create_EveryNDaysWithIntervalAndAnchor_Saves()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var dto = RegularDto() with { Frequency = MedicationFrequency.EveryNDays, IntervalDays = 2, AnchorDate = new DateOnly(2026, 1, 1) };
        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(ok.Value);
        Assert.Equal(2, body.Data!.IntervalDays);
        Assert.Equal(new DateOnly(2026, 1, 1), body.Data.AnchorDate);
    }

    [Fact]
    public async Task Create_DailyFrequencyIsDefault_WhenNotSpecified()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var controller = new MedicationsController(db, tenant);

        var result = await controller.Create(participant.Id, RegularDto(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<MedicationDetailDto>>(ok.Value);
        Assert.Equal(MedicationFrequency.Daily, body.Data!.Frequency);
    }
}
