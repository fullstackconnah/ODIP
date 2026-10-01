using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Odip.Tests.Portal;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Medications;

/// <summary>
/// The PRN limits (a maximum per 24 hours and a minimum interval), judged at the time the dose was GIVEN and not at the time it is recorded (review 3
/// finding m4). Round 2 allows a PRN dose to be back-dated on purpose, which exposed the blind spot: with a 240-minute interval and a dose recorded at
/// 06:00, a dose given at 07:00 but charted at 11:00 looked like 5 hours later and raised nothing. Both rules look at the Administered records on both
/// sides of the dose time. Fixture: Tue 14 July 2026 in Sydney (AEST = UTC+10); a call "at 06:00" sets the clock to 06:00 local.
/// </summary>
public class MedicationPrnLimitTests
{
    /// <summary>A local (Sydney) time on 14 July as the UTC instant the API receives.</summary>
    private static DateTime At(int hour, int minute = 0, int day = 14) => new DateTime(2026, 7, day, hour, minute, 0, DateTimeKind.Utc).AddHours(-10);

    private static ShiftPackageFixture CreateAt(int hour, int minute = 0, int day = 14) => Create(now: new DateTimeOffset(At(hour, minute, day), TimeSpan.Zero));

    private static void SetClock(ShiftPackageFixture f, int hour, int minute = 0, int day = 14) => f.Clock.Set(new DateTimeOffset(At(hour, minute, day), TimeSpan.Zero));

    private static ParticipantMedication AddPrn(ShiftPackageFixture f, int? max = null, int? intervalMinutes = null)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Name = "Paracetamol", Strength = "500mg", DoseDescription = "1 tablet",
            Type = MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = max, PrnMinIntervalMinutes = intervalMinutes, StartDate = new DateTime(2026, 1, 1),
            Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer,
        };
        f.Db.ParticipantMedications.Add(med);
        f.Db.SaveChanges();
        return med;
    }

    /// <summary>The existing general endpoint (the MAR modal's), on the fixture's database, clock and competent worker.</summary>
    private static MedicationsController Mar(ShiftPackageFixture f)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, f.Worker.Id.ToString())], "Test");
        return new MedicationsController(f.Db, f.Tenant.Object, recorder: new MedicationAdministrationRecorder(f.Db, clock: f.Clock))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private static Task<ActionResult<ApiResponse<AdministrationDto>>> Give(
        ShiftPackageFixture f, ParticipantMedication med, DateTime? givenAt = null, bool acknowledge = false, MedicationAdministrationStatus status = MedicationAdministrationStatus.Administered) =>
        Mar(f).RecordAdministration(med.Id, new CreateAdministrationDto
        {
            Status = status, PrnReason = status == MedicationAdministrationStatus.Administered ? "Headache" : null, Reason = status == MedicationAdministrationStatus.Administered ? null : "Declined",
            DoseGiven = "500mg", AdministeredAt = givenAt, AcknowledgeLimitBreach = acknowledge,
        }, default);

    private static int Status(ActionResult<ApiResponse<AdministrationDto>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode!.Value;

    private static ApiResponse<AdministrationDto> Body(ActionResult<ApiResponse<AdministrationDto>> r) =>
        Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value);

    // ── the minimum interval, at the time the dose was given ──

    [Fact]
    public async Task ADoseGivenAt0700ButChartedAt1100_IsOneHourAfterTheDoseRecordedAt0600_NotFiveHours_TheReviewsScenario()
    {
        var f = CreateAt(6);
        var med = AddPrn(f, intervalMinutes: 240);
        Assert.Equal(200, Status(await Give(f, med)));   // A: given and recorded at 06:00
        SetClock(f, 11);

        var breach = await Give(f, med, givenAt: At(7));   // B: given at 07:00, charted at 11:00
        var acknowledged = await Give(f, med, givenAt: At(7), acknowledge: true);

        Assert.Equal(400, Status(breach));
        Assert.Contains("Minimum interval of 240 minutes", Assert.Single(Body(breach).Errors!));
        Assert.Equal(200, Status(acknowledged));
        Assert.True(Body(acknowledged).Data!.LimitBreachAcknowledged);
        Assert.Equal(2, await f.Db.MedicationAdministrations.CountAsync());   // the refused attempt wrote nothing
    }

    [Theory]
    [InlineData(10, 0, 200)]   // exactly 240 minutes after the dose recorded at 06:00
    [InlineData(9, 59, 400)]   // 239 minutes
    public async Task TheIntervalBoundary_IsJudgedFromTheNearestEarlierRecord(int hour, int minute, int expectedStatus)
    {
        var f = CreateAt(6);
        var med = AddPrn(f, intervalMinutes: 240);
        await Give(f, med);
        SetClock(f, 11);

        var result = await Give(f, med, givenAt: At(hour, minute));

        Assert.Equal(expectedStatus, Status(result));
    }

    [Theory]
    [InlineData(5, 0)]    // one hour BEFORE the dose recorded at 06:00
    [InlineData(2, 1)]    // 239 minutes before it
    public async Task ADoseGivenBeforeAnExistingOne_IsCheckedAgainstTheNextRecordToo(int hour, int minute)
    {
        var f = CreateAt(6);
        var med = AddPrn(f, intervalMinutes: 240);
        await Give(f, med);
        SetClock(f, 11);

        var result = await Give(f, med, givenAt: At(hour, minute));

        Assert.Equal(400, Status(result));
        Assert.Contains("before the dose recorded at 06:00", Assert.Single(Body(result).Errors!));
    }

    [Fact]
    public async Task ADoseGivenExactlyTheIntervalBeforeAnExistingOne_IsFine()
    {
        var f = CreateAt(6);
        var med = AddPrn(f, intervalMinutes: 240);
        await Give(f, med);
        SetClock(f, 11);

        var result = await Give(f, med, givenAt: At(2));   // 02:00: 240 minutes before the record at 06:00

        Assert.Equal(200, Status(result));
    }

    [Theory]
    [InlineData(9, 30, 400)]   // 3.5 hours after the record: still the old rule for a dose given now
    [InlineData(10, 0, 200)]
    public async Task ADoseGivenNow_FollowsTheSameRuleAsBefore(int hour, int minute, int expectedStatus)
    {
        var f = CreateAt(6);
        var med = AddPrn(f, intervalMinutes: 240);
        await Give(f, med);
        SetClock(f, hour, minute);

        var result = await Give(f, med);   // no administeredAt: the server stamps now

        Assert.Equal(expectedStatus, Status(result));
    }

    [Fact]
    public async Task ARecordFromAWeekAgo_IsOutsideBothRules()
    {
        var f = CreateAt(11);
        var med = AddPrn(f, max: 1, intervalMinutes: 240);
        f.Db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId, Status = MedicationAdministrationStatus.Administered,
            AdministeredAt = At(11, 0, day: 7), RecordedByName = "Ben Turner", PrnReason = "Headache",
        });
        f.Db.SaveChanges();

        Assert.Equal(200, Status(await Give(f, med)));
    }

    // ── the maximum per 24 hours, over the window around the dose ──

    [Fact]
    public async Task TheDailyMaximum_IsCountedOverTheWindowEndingAtTheDoseTime_SoABackDatedDoseOutsideTheBusyWindowIsFine()
    {
        var f = CreateAt(6);
        var med = AddPrn(f, max: 2);
        await Give(f, med);                 // 06:00
        SetClock(f, 7);
        await Give(f, med);                 // 07:00
        SetClock(f, 11);

        var tooMany = await Give(f, med);                                  // a third in the last 24 hours, given now
        var longAgo = await Give(f, med, givenAt: At(5, 0, day: 13));      // given at 05:00 yesterday: the 24 hours around it hold none of today's doses

        Assert.Equal(400, Status(tooMany));
        Assert.Contains("Maximum 2 doses in 24 hours", Assert.Single(Body(tooMany).Errors!));
        Assert.Equal(200, Status(longAgo));   // the old rule counted the last 24 hours from NOW (2) and refused this one
    }

    [Fact]
    public async Task ABackDatedDose_ThatWouldPushALaterWindowOverTheMaximum_IsABreach()
    {
        var f = CreateAt(6);
        var med = AddPrn(f, max: 2);
        await Give(f, med);                 // 06:00
        SetClock(f, 7);
        await Give(f, med);                 // 07:00
        SetClock(f, 11);

        // Given at 06:30: the 24 hours ending at 06:30 hold only the 06:00 dose, but the window that starts at 06:00 would then hold three.
        var result = await Give(f, med, givenAt: At(6, 30));

        Assert.Equal(400, Status(result));
        Assert.Contains("Maximum 2 doses in 24 hours", Assert.Single(Body(result).Errors!));
        Assert.Equal(200, Status(await Give(f, med, givenAt: At(6, 30), acknowledge: true)));
    }

    [Fact]
    public async Task TheDailyMaximum_StillFollowsTheOldRuleForADoseGivenNow()
    {
        var f = CreateAt(6);
        var med = AddPrn(f, max: 3);
        for (var hour = 6; hour <= 8; hour++)
        {
            SetClock(f, hour);
            Assert.Equal(200, Status(await Give(f, med)));
        }
        SetClock(f, 9);

        var fourth = await Give(f, med);

        Assert.Equal(400, Status(fourth));
        Assert.Contains("Maximum 3 doses in 24 hours", Assert.Single(Body(fourth).Errors!));
    }

    [Fact]
    public async Task ADoseOutsideEveryWindowOfTheDay_IsNotAffectedByDosesMoreThanADayAway()
    {
        var f = CreateAt(11);
        var med = AddPrn(f, max: 1);
        await Give(f, med);   // 11:00 today, recorded

        var lastWeek = await Give(f, med, givenAt: At(11, 0, day: 7));
        var twoDaysAgo = await Give(f, med, givenAt: At(11, 0, day: 12));

        Assert.Equal(200, Status(lastWeek));
        Assert.Equal(200, Status(twoDaysAgo));
    }

    // ── what is not judged ──

    [Fact]
    public async Task ANotGivenPrnOutcome_IsNotLimitChecked_AndDoesNotCountTowardsTheLimits()
    {
        var f = CreateAt(6);
        var med = AddPrn(f, max: 1, intervalMinutes: 240);
        Assert.Equal(200, Status(await Give(f, med, status: MedicationAdministrationStatus.Refused)));
        Assert.Equal(200, Status(await Give(f, med, status: MedicationAdministrationStatus.Refused)));

        Assert.Equal(200, Status(await Give(f, med)));   // the refusals count for nothing
    }

    [Fact]
    public async Task AnotherMedicationsDoses_AreNotCounted()
    {
        var f = CreateAt(6);
        var med = AddPrn(f, max: 1, intervalMinutes: 240);
        var other = AddPrn(f, max: 1, intervalMinutes: 240);
        await Give(f, other);

        Assert.Equal(200, Status(await Give(f, med)));
    }

    [Fact]
    public async Task APrnMedicationWithNoLimits_IsNeverRefused()
    {
        var f = CreateAt(6);
        var med = AddPrn(f);
        for (var i = 0; i < 4; i++) Assert.Equal(200, Status(await Give(f, med)));
    }
}
