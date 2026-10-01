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
/// The Medication Competency gate (D3), per the provider mode. In ENFORCE mode recording ANY administration needs the recording user to
/// hold a current, unexpired Medication Competency credential - for every role, including the existing coordinator MAR path. In WARN
/// mode (the default, the rollout setting) the same user may record and the record is flagged RecordedWithoutCompetency.
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

    // ── the existing endpoint (POST medications/{id}/administrations); the tests below this line run in ENFORCE mode unless they say otherwise ──

    private static (MedicationsController Controller, OdipDbContext Db, Guid MedId) Arrange(
        User? recorder, DateTimeOffset? now = null, string providerState = "NSW",
        MedicationCompetencyMode mode = MedicationCompetencyMode.Enforce, bool withSettingsRow = true)
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
        if (withSettingsRow) db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), State = providerState, MedicationCompetencyMode = mode });
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

    // ── WARN mode (the default): the dose is recorded and flagged, never refused ──

    private static AdministrationDto Recorded(ActionResult<ApiResponse<AdministrationDto>> result) =>
        Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    [Fact]
    public async Task Warn_AUserWithoutTheCredential_Records_AndTheRecordIsFlagged()
    {
        var (controller, db, medId) = Arrange(Staff(UserRole.SupportWorker, false, null), mode: MedicationCompetencyMode.Warn);

        var record = Recorded(await controller.RecordAdministration(medId, Given(), default));

        Assert.True(record.RecordedWithoutCompetency);
        Assert.True((await db.MedicationAdministrations.SingleAsync()).RecordedWithoutCompetency);
    }

    [Fact]
    public async Task Warn_AnExpiredCredential_Records_AndIsFlagged()
    {
        var (controller, db, medId) = Arrange(Staff(UserRole.SupportWorker, true, new DateOnly(2026, 9, 12)), mode: MedicationCompetencyMode.Warn);

        Assert.True(Recorded(await controller.RecordAdministration(medId, Given(), default)).RecordedWithoutCompetency);
        Assert.True((await db.MedicationAdministrations.SingleAsync()).RecordedWithoutCompetency);
    }

    [Theory]
    [InlineData(UserRole.Admin)]
    [InlineData(UserRole.Coordinator)]
    [InlineData(UserRole.SuperAdmin)]
    public async Task Warn_TheCoordinatorMarPath_WithoutTheCredential_Records_AndIsFlagged(UserRole role)
    {
        var (controller, db, medId) = Arrange(Staff(role, competent: false, expiry: null), mode: MedicationCompetencyMode.Warn);

        Assert.True(Recorded(await controller.RecordAdministration(medId, Given(), default)).RecordedWithoutCompetency);
        Assert.Single(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task Warn_ACurrentCredential_IsNotFlagged()
    {
        var (controller, db, medId) = Arrange(Staff(UserRole.SupportWorker, true, new DateOnly(2099, 1, 1)), mode: MedicationCompetencyMode.Warn);

        Assert.False(Recorded(await controller.RecordAdministration(medId, Given(), default)).RecordedWithoutCompetency);
        Assert.False((await db.MedicationAdministrations.SingleAsync()).RecordedWithoutCompetency);
    }

    [Fact]
    public async Task Enforce_ACurrentCredential_IsNotFlagged_BecauseNothingWithoutOneIsRecorded()
    {
        var (controller, db, medId) = Arrange(Staff(UserRole.SupportWorker, true, null), mode: MedicationCompetencyMode.Enforce);

        Assert.False(Recorded(await controller.RecordAdministration(medId, Given(), default)).RecordedWithoutCompetency);
        Assert.False((await db.MedicationAdministrations.SingleAsync()).RecordedWithoutCompetency);
    }

    [Fact]
    public async Task Warn_NoResolvableUser_Records_Flagged_AgainstTheFallbackName()
    {
        var (controller, db, medId) = Arrange(recorder: null, mode: MedicationCompetencyMode.Warn);

        var record = Recorded(await controller.RecordAdministration(medId, Given(), default));

        Assert.True(record.RecordedWithoutCompetency);
        Assert.Null(record.RecordedByUserId);
        Assert.Equal("Unknown", record.RecordedByName);
        Assert.Single(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task Warn_TheOtherRulesStillApply_AFlaggedWorkerStillNeedsAReasonToRefuseADose()
    {
        var (controller, db, medId) = Arrange(Staff(UserRole.SupportWorker, false, null), mode: MedicationCompetencyMode.Warn);

        var result = await controller.RecordAdministration(medId, new CreateAdministrationDto { Status = MedicationAdministrationStatus.Refused }, default);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task TheDefaultIsWarn_ForANewSettingsRow_AndWhenTheProviderHasNoSettingsAtAll()
    {
        Assert.Equal(MedicationCompetencyMode.Warn, new ProviderSettings().MedicationCompetencyMode);

        // No ProviderSettings row at all (a tenant that never filled the form in): records, flagged - not refused.
        var (controller, db, medId) = Arrange(Staff(UserRole.SupportWorker, false, null), withSettingsRow: false);
        Assert.True(Recorded(await controller.RecordAdministration(medId, Given(), default)).RecordedWithoutCompetency);
        Assert.Single(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task TheModeIsPerTenant_OneProviderEnforcingDoesNotMakeAnotherEnforce()
    {
        var dbName = Guid.NewGuid().ToString();
        var (tenantA, tenantB) = (Guid.NewGuid(), Guid.NewGuid());
        (OdipDbContext Db, Mock<ICurrentTenant> Tenant) ContextFor(Guid? tenantId, Guid? viewAs = null)
        {
            var t = new Mock<ICurrentTenant>();
            t.Setup(x => x.TenantId).Returns(tenantId);
            t.Setup(x => x.IsSuperAdmin).Returns(tenantId is null);
            t.Setup(x => x.ViewAsUserId).Returns(viewAs);
            return (new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options, t.Object), t);
        }

        var userA = Staff(UserRole.SupportWorker, false, null); userA.TenantId = tenantA;
        var userB = Staff(UserRole.SupportWorker, false, null); userB.TenantId = tenantB;
        var medA = Guid.NewGuid(); var medB = Guid.NewGuid();
        var (seed, _) = ContextFor(null);
        using (seed)
        {
            seed.ProviderSettings.AddRange(
                new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantA, State = "NSW", MedicationCompetencyMode = MedicationCompetencyMode.Enforce },
                new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantB, State = "NSW", MedicationCompetencyMode = MedicationCompetencyMode.Warn });
            seed.Users.AddRange(userA, userB);
            foreach (var (tenant, med) in new[] { (tenantA, medA), (tenantB, medB) })
            {
                var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenant, FirstName = "Sophie", LastName = "Brown", IsActive = true };
                seed.Participants.Add(participant);
                seed.ParticipantMedications.Add(new ParticipantMedication
                {
                    Id = med, TenantId = tenant, ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
                    Type = MedicationType.Regular, TimesOfDay = "08:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
                });
            }
            seed.SaveChanges();
        }

        var (dbA, tenantMockA) = ContextFor(tenantA, userA.Id);
        var (dbB, tenantMockB) = ContextFor(tenantB, userB.Id);
        using var _a = dbA; using var _b = dbB;
        var resultA = await new MedicationsController(dbA, tenantMockA.Object).RecordAdministration(medA, Given(), default);
        var resultB = await new MedicationsController(dbB, tenantMockB.Object).RecordAdministration(medB, Given(), default);

        Assert.Equal(403, Assert.IsType<ObjectResult>(resultA.Result).StatusCode);   // tenant A enforces
        Assert.True(Recorded(resultB).RecordedWithoutCompetency);                      // tenant B only warns
    }

    [Theory]
    [InlineData(MedicationCompetencyStatus.Current, MedicationCompetencyMode.Warn, true, null)]
    [InlineData(MedicationCompetencyStatus.Current, MedicationCompetencyMode.Enforce, true, null)]
    [InlineData(MedicationCompetencyStatus.NotRecorded, MedicationCompetencyMode.Warn, true, "MEDICATION_COMPETENCY_MISSING")]
    [InlineData(MedicationCompetencyStatus.Expired, MedicationCompetencyMode.Warn, true, "MEDICATION_COMPETENCY_EXPIRED")]
    [InlineData(MedicationCompetencyStatus.Unverifiable, MedicationCompetencyMode.Warn, true, "MEDICATION_COMPETENCY_UNVERIFIABLE")]
    [InlineData(MedicationCompetencyStatus.NotRecorded, MedicationCompetencyMode.Enforce, false, "MEDICATION_COMPETENCY_MISSING")]
    [InlineData(MedicationCompetencyStatus.Expired, MedicationCompetencyMode.Enforce, false, "MEDICATION_COMPETENCY_EXPIRED")]
    [InlineData(MedicationCompetencyStatus.Unverifiable, MedicationCompetencyMode.Enforce, false, "MEDICATION_COMPETENCY_UNVERIFIABLE")]
    public void DescribeAccess_CombinesTheCredentialWithTheMode(
        MedicationCompetencyStatus status, MedicationCompetencyMode mode, bool canRecord, string? code)
    {
        var access = MedicationAdministrationRecorder.DescribeAccess(
            new MedicationCompetencyCheck(status, status == MedicationCompetencyStatus.Expired ? new DateOnly(2026, 7, 1) : null), mode);

        Assert.Equal(canRecord, access.CanRecord);
        Assert.Equal(code, access.Code);
        Assert.Equal(status == MedicationCompetencyStatus.Current, access.IsCurrent);
        if (status == MedicationCompetencyStatus.Current) Assert.Null(access.Reason);
        else if (mode == MedicationCompetencyMode.Warn) Assert.Equal(MedicationCompetencyGate.WarningMessage, access.Reason);
        else Assert.False(string.IsNullOrWhiteSpace(access.Reason));
    }

    [Fact]
    public void TheWarning_IsTheTextTheCoordinatorSpecified()
    {
        Assert.Equal("Medication Competency not current — this record will be flagged", MedicationCompetencyGate.WarningMessage);
    }
}
