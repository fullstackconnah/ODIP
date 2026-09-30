using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Medications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Medications;

/// <summary>
/// The Medication Competency gate (D3): recording ANY administration needs the recording user to hold a
/// current, unexpired Medication Competency credential — for every role, including the existing coordinator
/// MAR path. This changes behaviour for users without the credential; that is intended.
/// </summary>
public class MedicationCompetencyGateTests
{
    private static readonly DateOnly Today = new(2026, 7, 14);

    private static User UserWith(bool competent, DateOnly? expiry) => new()
    {
        Id = Guid.NewGuid(), FirstName = "Sam", LastName = "Worker", IsMedicationCompetent = competent, MedicationCompetencyExpiryDate = expiry,
    };

    // ── the pure rule ─────────────────────────────────────────────────

    [Fact]
    public void Current_WhenTickedAndExpiryInTheFuture() =>
        Assert.True(MedicationCompetencyGate.Evaluate(UserWith(true, Today.AddDays(30)), Today).IsCurrent);

    [Fact]
    public void Current_WhenTickedAndNoExpiryRecorded_LikeTheRosterAndHasExpiredQualifications() =>
        Assert.True(MedicationCompetencyGate.Evaluate(UserWith(true, null), Today).IsCurrent);

    [Fact]
    public void Current_OnTheExpiryDateItself_TheExpiryDateIsTheLastValidDay() =>
        Assert.True(MedicationCompetencyGate.Evaluate(UserWith(true, Today), Today).IsCurrent);

    [Fact]
    public void Expired_TheDayAfterTheExpiryDate()
    {
        var check = MedicationCompetencyGate.Evaluate(UserWith(true, Today.AddDays(-1)), Today);

        Assert.Equal(MedicationCompetencyStatus.Expired, check.Status);
        Assert.Equal("MEDICATION_COMPETENCY_EXPIRED", check.Code);
        Assert.Contains("13 Jul 2026", check.Message);
    }

    [Theory]
    [InlineData(false, null)]
    [InlineData(false, 30)]   // an expiry date alone, without the credential flag, is not a credential
    public void Missing_WhenTheCredentialIsNotTicked(bool competent, int? expiryDaysAhead)
    {
        var check = MedicationCompetencyGate.Evaluate(UserWith(competent, expiryDaysAhead is { } d ? Today.AddDays(d) : null), Today);

        Assert.Equal(MedicationCompetencyStatus.NotRecorded, check.Status);
        Assert.Equal("MEDICATION_COMPETENCY_MISSING", check.Code);
    }

    [Fact]
    public void Unverifiable_WhenNoUserCanBeResolved()
    {
        var check = MedicationCompetencyGate.Evaluate(null, Today);

        Assert.Equal(MedicationCompetencyStatus.Unverifiable, check.Status);
        Assert.Equal("MEDICATION_COMPETENCY_UNVERIFIABLE", check.Code);
    }

    [Fact]
    public void ExpiredMessage_IsInvariantCulture_NotTheHostLocale()
    {
        // The deploy image runs invariant globalization, this machine is en-AU ("Sept" vs "Sep"): server-rendered
        // text must not depend on either.
        var previous = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("en-AU");
            var message = MedicationCompetencyGate.Evaluate(UserWith(true, new DateOnly(2026, 9, 12)), new DateOnly(2026, 10, 1)).Message;
            Assert.Contains("12 Sep 2026", message);
            Assert.DoesNotContain("Sept", message);
        }
        finally { CultureInfo.CurrentCulture = previous; }
    }

    // ── enforced on the existing endpoint (POST medications/{id}/administrations) ──

    private static (MedicationsController Controller, OdipDbContext Db, Guid MedId) Arrange(
        User? recorder, DateTimeOffset? now = null, string providerState = "NSW")
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var db = new OdipDbContext(
            new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = p.Id, Name = "Paracetamol", DoseDescription = "2 tablets", Type = MedicationType.Regular,
            TimesOfDay = "08:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        };
        db.Participants.Add(p);
        db.ParticipantMedications.Add(med);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), State = providerState });
        if (recorder is not null)
        {
            db.Users.Add(recorder);
            tenant.Setup(t => t.ViewAsUserId).Returns(recorder.Id);
        }
        db.SaveChanges();
        var clock = now is null ? null : new FakeClock(now.Value);
        var recorderService = new MedicationAdministrationRecorder(db, clock: clock);
        return (new MedicationsController(db, tenant.Object, recorder: recorderService), db, med.Id);
    }

    private static CreateAdministrationDto Given() => new() { Status = MedicationAdministrationStatus.Administered, DoseGiven = "2 tablets" };

    private static User Staff(UserRole role, bool competent, DateOnly? expiry) => new()
    {
        Id = Guid.NewGuid(), FirstName = "Sam", LastName = "Worker", Role = role, IsActive = true,
        Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
        IsMedicationCompetent = competent, MedicationCompetencyExpiryDate = expiry,
    };

    [Fact]
    public async Task CurrentCredential_RecordsTheDose()
    {
        var (controller, db, medId) = Arrange(Staff(UserRole.SupportWorker, true, new DateOnly(2099, 1, 1)));

        var result = await controller.RecordAdministration(medId, Given(), default);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Single(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task ExpiredCredential_Is403WithACodeAndAClearMessage_AndNothingIsRecorded()
    {
        var (controller, db, medId) = Arrange(Staff(UserRole.SupportWorker, true, new DateOnly(2026, 9, 12)));

        var result = await controller.RecordAdministration(medId, Given(), default);

        var forbidden = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, forbidden.StatusCode);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(forbidden.Value);
        Assert.False(body.Success);
        Assert.Equal("MEDICATION_COMPETENCY_EXPIRED", body.Code);
        Assert.Contains("12 Sep 2026", Assert.Single(body.Errors!));
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task MissingCredential_Is403WithACode_AndNothingIsRecorded()
    {
        var (controller, db, medId) = Arrange(Staff(UserRole.SupportWorker, false, null));

        var result = await controller.RecordAdministration(medId, Given(), default);

        var forbidden = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, forbidden.StatusCode);
        Assert.Equal("MEDICATION_COMPETENCY_MISSING", Assert.IsType<ApiResponse<AdministrationDto>>(forbidden.Value).Code);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Theory]
    [InlineData(UserRole.Admin)]
    [InlineData(UserRole.Coordinator)]
    [InlineData(UserRole.SuperAdmin)]
    public async Task TheCoordinatorMarPath_HasNoRoleBypass_WithoutTheCredentialIs403(UserRole role)
    {
        var (controller, db, medId) = Arrange(Staff(role, competent: false, expiry: null));

        var result = await controller.RecordAdministration(medId, Given(), default);

        Assert.Equal(403, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Theory]
    [InlineData(UserRole.Admin)]
    [InlineData(UserRole.Coordinator)]
    [InlineData(UserRole.SuperAdmin)]
    public async Task TheCoordinatorMarPath_WithTheCredential_StillRecords(UserRole role)
    {
        var (controller, db, medId) = Arrange(Staff(role, competent: true, expiry: null));

        var result = await controller.RecordAdministration(medId, Given(), default);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Single(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task NoResolvableUser_Is403Unverifiable()
    {
        var (controller, _, medId) = Arrange(recorder: null);

        var result = await controller.RecordAdministration(medId, Given(), default);

        var forbidden = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, forbidden.StatusCode);
        Assert.Equal("MEDICATION_COMPETENCY_UNVERIFIABLE", Assert.IsType<ApiResponse<AdministrationDto>>(forbidden.Value).Code);
    }

    [Fact]
    public async Task TheGateComesBeforeValidation_AWorkerWithoutTheCredentialIsTold403NotAskedForAReason()
    {
        var (controller, _, medId) = Arrange(Staff(UserRole.SupportWorker, false, null));

        // Refused with no reason would be a 400 for a competent user.
        var result = await controller.RecordAdministration(medId, new CreateAdministrationDto { Status = MedicationAdministrationStatus.Refused }, default);

        Assert.Equal(403, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task UnknownMedication_Is404_NotA403()
    {
        var (controller, _, _) = Arrange(Staff(UserRole.SupportWorker, false, null));

        var result = await controller.RecordAdministration(Guid.NewGuid(), Given(), default);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Theory]
    [InlineData(14, true)]   // expiry 14 July is still valid on the 14th (the last valid day)
    [InlineData(13, false)]  // expiry 13 July has passed in Sydney, although UTC is still 13 July
    public async Task Expiry_IsJudgedAgainstTheProvidersLocalDate_NotUtc(int expiryDay, bool allowed)
    {
        // 23:30 UTC on 13 July is 09:30 on 14 July in Sydney (AEST, UTC+10).
        var now = new DateTimeOffset(2026, 7, 13, 23, 30, 0, TimeSpan.Zero);
        var (controller, _, medId) = Arrange(Staff(UserRole.SupportWorker, true, new DateOnly(2026, 7, expiryDay)), now);

        var result = await controller.RecordAdministration(medId, Given(), default);

        if (allowed) Assert.IsType<OkObjectResult>(result.Result);
        else Assert.Equal(403, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }
}
