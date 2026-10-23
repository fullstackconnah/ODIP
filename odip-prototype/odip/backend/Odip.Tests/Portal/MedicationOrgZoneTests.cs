using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// An unscoped SuperAdmin's JWT carries their HOME (Sydney) organisation, while the medication, its participant and its staff belong to a Perth one.
/// A witness must come from the medication's organisation, and a medication read is judged on that organisation's zone (#350, #352).
/// </summary>
public class MedicationOrgZoneTests
{
    private static readonly Guid WaOrg = Guid.Parse("7a000000-0000-0000-0000-000000000001");
    private static readonly Guid HomeOrg = Guid.Parse("4b000000-0000-0000-0000-000000000002");
    private static readonly Guid OtherOrg = Guid.Parse("5c000000-0000-0000-0000-000000000003");

    // 15:00 UTC on the 14th is 23:00 on the 14th in Perth but 01:00 on the 15th in Sydney.
    private static readonly DateTimeOffset PerthStillThe14th = new(2026, 7, 14, 15, 0, 0, TimeSpan.Zero);

    private static async Task<(ShiftPackageFixture F, ParticipantMedication Med, MedicationsController Controller)> Unscoped(bool highRisk = false)
    {
        var f = Create(ShiftStatus.InProgress, true, PerthStillThe14th, tenantId: WaOrg);
        (await f.Db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).State = "WA";
        f.Db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = HomeOrg, State = "NSW" });
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = WaOrg, ParticipantId = f.Participant.Id, Name = "Midazolam", Strength = "5mg",
            DoseDescription = "1 dose", Type = MedicationType.Regular, TimesOfDay = "09:00", StartDate = new DateTime(2026, 1, 1),
            Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer, IsHighRisk = highRisk, ConsentObtained = true,
            NextReviewDue = new DateTime(2026, 7, 14),
        };
        f.Db.ParticipantMedications.Add(med);
        await f.Db.SaveChangesAsync();
        f.Tenant.Setup(t => t.TenantId).Returns(HomeOrg);
        f.Tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return (f, med, new MedicationsController(f.Db, f.Tenant.Object, slots: new MedicationSlotService(f.Db, f.Clock)));
    }

    private static T Data<T>(ActionResult<ApiResponse<T>> r) =>
        Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;

    private static User Staff(Guid tenantId) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
        FirstName = "Wit", LastName = "Ness", IsActive = true,
    };

    private static async Task<RecordAdministrationResult> RecordWithWitness(ShiftPackageFixture f, ParticipantMedication med, User witness)
    {
        f.Db.Users.Add(witness);
        await f.Db.SaveChangesAsync();
        var dose = new CreateAdministrationDto
        {
            ScheduledAt = new DateTime(2026, 7, 14, 9, 0, 0, DateTimeKind.Unspecified), Status = MedicationAdministrationStatus.Administered,
            IdempotencyKey = "k1", DoseGiven = "1 dose", AdministeredAtTimeZone = "Australia/Perth", WitnessStaffId = witness.Id,
        };
        return await new MedicationAdministrationRecorder(f.Db, clock: f.Clock).RecordAsync(
            new RecordAdministrationRequest(med.Id, dose, f.Worker.Id, "Ben Turner"), default);
    }

    [Fact]
    public async Task HighRiskDose_WitnessFromAnotherOrganisation_IsNotFound()
    {
        var (f, med, _) = await Unscoped(highRisk: true);

        var result = await RecordWithWitness(f, med, Staff(OtherOrg));

        Assert.Equal(RecordAdministrationOutcome.Invalid, result.Outcome);
        Assert.Equal("Selected witness staff member was not found.", result.Message);
    }

    [Fact]
    public async Task HighRiskDose_WitnessFromTheMedicationsOrganisation_Records()
    {
        var (f, med, _) = await Unscoped(highRisk: true);

        var result = await RecordWithWitness(f, med, Staff(WaOrg));

        Assert.Equal(RecordAdministrationOutcome.Created, result.Outcome);
    }

    [Fact]
    public async Task GetById_ReviewOverdueFollowsTheMedicationsZone()
    {
        var (_, med, c) = await Unscoped();

        Assert.DoesNotContain("ReviewOverdue", Data(await c.GetById(med.Id, default)).ComplianceFlags);
    }

    [Fact]
    public async Task GetForParticipant_ReviewOverdueFollowsTheMedicationsZone()
    {
        var (f, _, c) = await Unscoped();

        Assert.DoesNotContain("ReviewOverdue", Assert.Single(Data(await c.GetForParticipant(f.Participant.Id, false, default))).ComplianceFlags);
    }

    [Fact]
    public async Task GetRegister_ReviewOverdueFollowsEachRowsZone()
    {
        var (_, _, c) = await Unscoped();

        Assert.DoesNotContain("ReviewOverdue", Assert.Single(Data(await c.GetRegister(null, null, 1, 50, default)).Items).ComplianceFlags);
    }

    [Fact]
    public async Task GetMar_TodayIsTheParticipantsOrganisationsDate()
    {
        var (f, _, c) = await Unscoped();

        Assert.Equal(new DateOnly(2026, 7, 14), Data(await c.GetMar(null, f.Participant.Id, default)).Date);
    }

    /// <summary>Given at 15:00 UTC on the 13th: 23:00 on the 13th in Perth, 01:00 on the 14th in Sydney, so a "from 14 July" range holds it in Sydney only.</summary>
    private static async Task<(ShiftPackageFixture F, MedicationsController C)> WithAnEarlyDose()
    {
        var (f, med, c) = await Unscoped();
        f.Db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), TenantId = WaOrg, ParticipantMedicationId = med.Id, ParticipantId = f.Participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = new DateTime(2026, 7, 13, 15, 0, 0, DateTimeKind.Utc),
            WitnessStatus = WitnessStatus.NotRequired, RecordedByName = "Test",
        });
        await f.Db.SaveChangesAsync();
        return (f, c);
    }

    [Fact]
    public async Task GetParticipantAdministrations_DayRangeFollowsTheParticipantsZone()
    {
        var (f, c) = await WithAnEarlyDose();

        Assert.Empty(Data(await c.GetParticipantAdministrations(f.Participant.Id, new DateTime(2026, 7, 14), null, default)));
    }

    [Fact]
    public async Task GetAdministrationReport_DayRangeFollowsTheParticipantsZone()
    {
        var (f, c) = await WithAnEarlyDose();

        Assert.Empty(Data(await c.GetAdministrationReport(f.Participant.Id, new DateTime(2026, 7, 14), null, 1, 50, default)).Items);
    }
}
