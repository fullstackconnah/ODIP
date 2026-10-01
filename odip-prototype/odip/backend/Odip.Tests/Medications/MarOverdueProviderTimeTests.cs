using System.Text.Json;
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
using Odip.Infrastructure.Services;
using Odip.Tests.Serialization;
using Xunit;

namespace Odip.Tests.Medications;

/// <summary>
/// L4-09, verified on main after PR #166: through the real GetMar endpoint, a scheduled dose is "Overdue" once it is more than 60
/// minutes past its PROVIDER-LOCAL time. Before #166 the controller compared the zone-less slot ("18:46" on the wall clock) with
/// DateTime.UtcNow, so in Sydney (UTC+10) an 18:46 dose was flagged ten hours late.
///
/// Fixed clock: 2026-10-01 10:46Z = Thursday 1 Oct 20:46 AEST.
/// </summary>
public class MarOverdueProviderTimeTests
{
    private static (OdipDbContext Db, ICurrentTenant Tenant, Participant Participant) Fixture()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        var db = new OdipDbContext(options, tenant.Object);
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return (db, tenant.Object, participant);
    }

    private static async Task<MarDayDto> GetMarAsync(OdipDbContext db, ICurrentTenant tenant, Participant participant, FakeClock clock, DateOnly date)
    {
        var controller = new MedicationsController(db, tenant, slots: new MedicationSlotService(db, clock));
        var result = await controller.GetMar(date, participant.Id, CancellationToken.None);
        return Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    private static void AddRegularMedication(OdipDbContext db, Guid participantId, string timesOfDay)
    {
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = "Levetiracetam", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = timesOfDay, Status = MedicationStatus.Active, ConsentObtained = true,
            StartDate = new DateTime(2026, 1, 1),
        });
        db.SaveChanges();
    }

    [Fact]
    public async Task AnUnrecordedDoseTwoHoursPastItsSydneyTime_IsOverdue_AtTheRightTimeNotTenHoursLater()
    {
        var (db, tenant, participant) = Fixture();
        AddRegularMedication(db, participant.Id, "18:46");

        var mar = await GetMarAsync(db, tenant, participant, FakeClock.AtUtc(2026, 10, 1, 10, 46), new DateOnly(2026, 10, 1));

        Assert.True(Assert.Single(mar.Entries).IsOverdue);
    }

    [Theory]
    [InlineData("18:46", true)]    // 120 minutes late
    [InlineData("19:45", true)]    // 61 minutes late: past the 60-minute grace
    [InlineData("19:46", false)]   // exactly 60 minutes: still inside the grace
    [InlineData("20:00", false)]   // 46 minutes late
    [InlineData("21:00", false)]   // not due yet
    public async Task TheGraceBoundaryIsSixtyMinutesOnTheProvidersClock(string slot, bool expectedOverdue)
    {
        var (db, tenant, participant) = Fixture();
        AddRegularMedication(db, participant.Id, slot);

        var mar = await GetMarAsync(db, tenant, participant, FakeClock.AtUtc(2026, 10, 1, 10, 46), new DateOnly(2026, 10, 1));

        Assert.Equal(expectedOverdue, Assert.Single(mar.Entries).IsOverdue);
    }

    [Fact]
    public async Task ARecordedDose_IsNeverOverdue_HoweverLate()
    {
        var (db, tenant, participant) = Fixture();
        AddRegularMedication(db, participant.Id, "08:00");
        var med = db.ParticipantMedications.Single();
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            ScheduledAt = new DateTime(2026, 10, 1, 8, 0, 0), AdministeredAt = new DateTime(2026, 9, 30, 22, 5, 0),
            Status = MedicationAdministrationStatus.Administered, RecordedByName = "Test",
        });
        db.SaveChanges();

        var mar = await GetMarAsync(db, tenant, participant, FakeClock.AtUtc(2026, 10, 1, 10, 46), new DateOnly(2026, 10, 1));

        Assert.False(Assert.Single(mar.Entries).IsOverdue);
    }

    [Fact]
    public async Task TheMarWireShape_IsOverdueTrueWithAZonelessSlot_AndTheAdministeredInstantInUtc()
    {
        var (db, tenant, participant) = Fixture();
        AddRegularMedication(db, participant.Id, "18:46");

        var mar = await GetMarAsync(db, tenant, participant, FakeClock.AtUtc(2026, 10, 1, 10, 46), new DateOnly(2026, 10, 1));
        var json = JsonSerializer.Serialize(mar, WireTypeWalker.ApiOptions());

        Assert.Contains("\"scheduledTime\":\"18:46\"", json);
        Assert.Contains("\"scheduledAt\":\"2026-10-01T18:46:00\"", json);   // wall clock: no Z, so a browser shows 18:46 wherever it is
        Assert.Contains("\"isOverdue\":true", json);
    }
}
