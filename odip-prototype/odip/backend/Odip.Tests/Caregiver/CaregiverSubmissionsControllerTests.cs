using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Caregiver;

public class CaregiverSubmissionsControllerTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static (OdipDbContext db, Guid tenantId) CreateTenantDb()
    {
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return (new OdipDbContext(options, tenant.Object), tenantId);
    }

    private static Participant SeedParticipant(OdipDbContext db, Guid tenantId)
    {
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true,
            PlanType = PlanType.SelfManaged, OvernightSupport = OvernightSupportType.None,
            OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
        };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static CaregiverProfileSubmission SeedSubmission(
        OdipDbContext db, Guid tenantId, Guid participantId, CaregiverSubmissionStatus status,
        PatchParticipantDto? payload = null, PatchParticipantDto? basePayload = null)
    {
        var s = new CaregiverProfileSubmission
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId,
            TokenHash = CaregiverTokenService.Hash(CaregiverTokenService.GenerateRawToken()),
            Status = status, CreatedByUserId = Guid.NewGuid(), ExpiresAt = DateTime.UtcNow.AddDays(14),
            CaregiverName = "Jane Smith",
            Payload = payload is null ? null : JsonSerializer.Serialize(payload, Json),
            BasePayload = basePayload is null ? null : JsonSerializer.Serialize(basePayload, Json),
            SubmittedAt = status == CaregiverSubmissionStatus.Submitted ? DateTime.UtcNow : null,
        };
        db.CaregiverProfileSubmissions.Add(s);
        db.SaveChanges();
        return s;
    }

    private static CaregiverSubmissionsController MakeController(OdipDbContext db, Guid tenantId, Guid userId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "Test");
        var config = new ConfigurationBuilder().Build();
        return new CaregiverSubmissionsController(db, tenant.Object, new SafetyNoteSyncService(db), new StaffCompatibilityLinkService(db), config)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }

    [Fact]
    public async Task CreateLink_RevokesExistingActiveAndReturnsRawTokenOnce()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        var controller = MakeController(db, tenantId, userId: Guid.NewGuid());

        var first = await controller.CreateLink(p.Id, CancellationToken.None);
        var firstBody = Assert.IsType<ApiResponse<CaregiverLinkDto>>(Assert.IsType<OkObjectResult>(first.Result).Value);
        Assert.Equal(43, firstBody.Data!.Token.Length);

        var second = await controller.CreateLink(p.Id, CancellationToken.None);
        Assert.IsType<OkObjectResult>(second.Result);

        var rows = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().Where(s => s.ParticipantId == p.Id).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Single(rows, r => r.Status == CaregiverSubmissionStatus.Draft);
        Assert.Single(rows, r => r.Status == CaregiverSubmissionStatus.Revoked);
        // The raw token is never stored.
        Assert.DoesNotContain(rows, r => r.TokenHash == firstBody.Data.Token);
    }

    [Fact]
    public async Task CreateLink_OtherTenantsParticipant_Returns404()
    {
        var (db, tenantId) = CreateTenantDb();
        var foreign = SeedParticipant(db, Guid.NewGuid());
        var result = await MakeController(db, tenantId, Guid.NewGuid()).CreateLink(foreign.Id, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Empty(await db.CaregiverProfileSubmissions.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task RevokeLink_SetsRevoked()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Draft);
        var result = await MakeController(db, tenantId, Guid.NewGuid()).RevokeLink(p.Id, CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        Assert.Equal(CaregiverSubmissionStatus.Revoked, (await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id)).Status);
    }

    [Fact]
    public async Task List_DefaultsToSubmitted_TenantScoped()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted);
        SeedSubmission(db, tenantId, SeedParticipant(db, tenantId).Id, CaregiverSubmissionStatus.Draft);
        SeedSubmission(db, Guid.NewGuid(), SeedParticipant(db, Guid.NewGuid()).Id, CaregiverSubmissionStatus.Submitted);
        var result = await MakeController(db, tenantId, Guid.NewGuid()).List(null, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<List<CaregiverSubmissionListItemDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Single(body.Data!);
        Assert.Equal(p.Id, body.Data![0].ParticipantId);
    }

    [Fact]
    public async Task List_WithParticipantId_ReturnsOnlyThatParticipantsRows_StillTenantScoped()
    {
        var (db, tenantId) = CreateTenantDb();
        var mine = SeedParticipant(db, tenantId);
        SeedSubmission(db, tenantId, mine.Id, CaregiverSubmissionStatus.Draft);
        SeedSubmission(db, tenantId, SeedParticipant(db, tenantId).Id, CaregiverSubmissionStatus.Draft);
        // Another organisation's row for the same participant id must not appear either.
        SeedSubmission(db, Guid.NewGuid(), mine.Id, CaregiverSubmissionStatus.Draft);

        var result = await MakeController(db, tenantId, Guid.NewGuid()).List(CaregiverSubmissionStatus.Draft, CancellationToken.None, mine.Id);

        var body = Assert.IsType<ApiResponse<List<CaregiverSubmissionListItemDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var row = Assert.Single(body.Data!);
        Assert.Equal(mine.Id, row.ParticipantId);
    }

    [Fact]
    public async Task Accept_AppliesPayloadViaPatchAndMarksAccepted()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        // PatchAboutMeDto has no PersonalInterests member — that field is on
        // PatchCulturalBackgroundDto (confirmed against ParticipantPatchDTOs.cs and the Apply
        // section moved into ParticipantPatchApplier). Using the real group keeps the
        // PersonalInterests assertion below meaningful.
        var payload = new PatchParticipantDto { CulturalBackground = new PatchCulturalBackgroundDto { PersonalInterests = "Gardening" } };
        var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted, payload);
        var reviewer = Guid.NewGuid();
        var result = await MakeController(db, tenantId, reviewer).Accept(s.Id, CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        var reloadedSub = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id);
        Assert.Equal(CaregiverSubmissionStatus.Accepted, reloadedSub.Status);
        Assert.Equal(reviewer, reloadedSub.ReviewedByUserId);
        var reloadedP = await db.Participants.IgnoreQueryFilters().SingleAsync(x => x.Id == p.Id);
        Assert.Equal("Gardening", reloadedP.PersonalInterests);
    }

    [Fact]
    public async Task Accept_NotSubmitted_Returns409AndDoesNotApply()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        var payload = new PatchParticipantDto { CulturalBackground = new PatchCulturalBackgroundDto { PersonalInterests = "Gardening" } };
        var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Draft, payload);
        var result = await MakeController(db, tenantId, Guid.NewGuid()).Accept(s.Id, CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result);
        Assert.Null((await db.Participants.IgnoreQueryFilters().SingleAsync(x => x.Id == p.Id)).PersonalInterests);
    }

    [Fact]
    public async Task Reject_RequiresNote_ReopensAsDraft_ExtendsExpiry()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted);
        var oldExpiry = s.ExpiresAt;
        var controller = MakeController(db, tenantId, Guid.NewGuid());

        Assert.IsType<BadRequestObjectResult>(await controller.Reject(s.Id, new RejectCaregiverSubmissionDto { Note = " " }, CancellationToken.None));

        var result = await controller.Reject(s.Id, new RejectCaregiverSubmissionDto { Note = "Please check the phone number." }, CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        var r = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id);
        Assert.Equal(CaregiverSubmissionStatus.Draft, r.Status);
        Assert.Null(r.SubmittedAt);
        Assert.Equal("Please check the phone number.", r.RejectionNote);
        Assert.True(r.ExpiresAt > oldExpiry);
        Assert.Equal(s.TokenHash, r.TokenHash);   // same link keeps working
    }

    [Fact]
    public async Task Accept_CraftedPayloadCannotChangeInternalField()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        p.BehaviourRiskRating = RiskRatingLevel.Low;
        p.PreferredUserId = null;
        await db.SaveChangesAsync();
        var crafted = new PatchParticipantDto
        {
            BehaviourCommunication = new PatchBehaviourCommunicationDto { BehaviourRiskRating = RiskRatingLevel.Critical },
            PreferredStaff = new PatchPreferredStaffDto { PreferredStaffId = Guid.NewGuid() },
        };
        var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted, crafted);
        var result = await MakeController(db, tenantId, Guid.NewGuid()).Accept(s.Id, CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        var reloaded = await db.Participants.IgnoreQueryFilters().SingleAsync(x => x.Id == p.Id);
        Assert.Equal(RiskRatingLevel.Low, reloaded.BehaviourRiskRating);
        Assert.Null(reloaded.PreferredUserId);
    }


    private static PatchPersonalDetailsDto Pd(string? phone, string? email = null) =>
        new() { FirstName = "Sophie", LastName = "Brown", Phone = phone, Email = email };

    private static async Task<Participant> AcceptAsync(OdipDbContext db, Guid tenantId, Participant p, PatchParticipantDto payload, PatchParticipantDto? basePayload)
    {
        var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted, payload, basePayload);
        db.ChangeTracker.Clear();   // Accept reads from the database as in production, so a missing Include shows
        var result = await MakeController(db, tenantId, Guid.NewGuid()).Accept(s.Id, CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        return await db.Participants.IgnoreQueryFilters().SingleAsync(x => x.Id == p.Id);
    }

    [Fact]
    public async Task Accept_KeepsStaffEditMadeAfterFormOpened()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        p.Phone = "0400000002"; p.Email = "old@example.test";   // staff set the phone to B after the caregiver loaded A
        await db.SaveChangesAsync();
        var reloaded = await AcceptAsync(db, tenantId, p,
            new PatchParticipantDto { PersonalDetails = Pd("0400000001", "new@example.test") },
            new PatchParticipantDto { PersonalDetails = Pd("0400000001", "old@example.test") });
        Assert.Equal("0400000002", reloaded.Phone);
        Assert.Equal("new@example.test", reloaded.Email);
        Assert.Equal("Sophie", reloaded.FirstName);
    }

    [Fact]
    public async Task Accept_BothChanged_CaregiverWins()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        p.Phone = "0400000002";
        await db.SaveChangesAsync();
        var reloaded = await AcceptAsync(db, tenantId, p,
            new PatchParticipantDto { PersonalDetails = Pd("0400000003") },
            new PatchParticipantDto { PersonalDetails = Pd("0400000001") });
        Assert.Equal("0400000003", reloaded.Phone);
    }

    [Fact]
    public async Task Accept_LegacySubmissionWithoutBase_AppliesFullPayload()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        p.Phone = "0400000002";
        await db.SaveChangesAsync();
        var reloaded = await AcceptAsync(db, tenantId, p, new PatchParticipantDto { PersonalDetails = Pd("0400000001") }, basePayload: null);
        Assert.Equal("0400000001", reloaded.Phone);
    }

    [Fact]
    public async Task Accept_NullAndEmptyStringAreTheSameValue()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        p.Phone = "0400000002";
        await db.SaveChangesAsync();
        var reloaded = await AcceptAsync(db, tenantId, p,
            new PatchParticipantDto { PersonalDetails = Pd("") },
            new PatchParticipantDto { PersonalDetails = Pd(null) });
        Assert.Equal("0400000002", reloaded.Phone);
    }

    [Fact]
    public async Task Accept_RowsUnchangedFromBaseAreLeftAlone()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        // Staff edited both rows after the caregiver loaded the form.
        db.ParticipantConsents.Add(new ParticipantConsent { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, ConsentType = ConsentType.PhotoVideo, Granted = true, SignedByName = "Staff Signer" });
        db.ParticipantHealthConditions.Add(new ParticipantHealthCondition { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, ConditionType = HealthConditionType.MentalHealth, Has = true, Severity = "Mild", Notes = "staff notes" });
        await db.SaveChangesAsync();
        var consentBase = new CreateParticipantConsentDto { ConsentType = ConsentType.PhotoVideo, Granted = null };
        var healthBase = new CreateParticipantHealthConditionDto { ConditionType = HealthConditionType.MentalHealth, Has = true, Severity = "Mild", Notes = "old notes" };
        await AcceptAsync(db, tenantId, p,
            new PatchParticipantDto
            {
                Consents = [consentBase],
                HealthConditions = [healthBase with { Severity = "Severe" }],
            },
            new PatchParticipantDto { Consents = [consentBase], HealthConditions = [healthBase] });
        var consent = await db.ParticipantConsents.IgnoreQueryFilters().SingleAsync(c => c.ParticipantId == p.Id && c.ConsentType == ConsentType.PhotoVideo);
        Assert.True(consent.Granted);
        Assert.Equal("Staff Signer", consent.SignedByName);
        var health = await db.ParticipantHealthConditions.IgnoreQueryFilters().SingleAsync(c => c.ParticipantId == p.Id && c.ConditionType == HealthConditionType.MentalHealth);
        Assert.Equal("Severe", health.Severity);
        Assert.Equal("staff notes", health.Notes);
        Assert.True(health.Has);
    }

    [Fact]
    public async Task Accept_LeavesSeededConsentRowsWhenPayloadChangesOtherField()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        foreach (var t in Enum.GetValues<ConsentType>())
            db.ParticipantConsents.Add(new ParticipantConsent { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, ConsentType = t, Granted = true, SignedByName = "Staff Signer" });
        await db.SaveChangesAsync();
        var rows = Enum.GetValues<ConsentType>().Select(t => new CreateParticipantConsentDto { ConsentType = t }).ToList();
        await AcceptAsync(db, tenantId, p,
            new PatchParticipantDto { Consents = rows, CulturalBackground = new PatchCulturalBackgroundDto { PersonalInterests = "Gardening" } },
            new PatchParticipantDto { Consents = rows, CulturalBackground = new PatchCulturalBackgroundDto() });
        var after = await db.ParticipantConsents.IgnoreQueryFilters().Where(c => c.ParticipantId == p.Id).ToListAsync();
        Assert.Equal(Enum.GetValues<ConsentType>().Length, after.Count);
        Assert.All(after, c => { Assert.True(c.Granted); Assert.Equal("Staff Signer", c.SignedByName); });
        Assert.Equal("Gardening", (await db.Participants.IgnoreQueryFilters().SingleAsync(x => x.Id == p.Id)).PersonalInterests);
    }

    [Fact]
    public async Task Accept_PayloadRowNotInBase_BlankRowDoesNotClearStaffRow_RealChangeApplies()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        db.ParticipantConsents.Add(new ParticipantConsent { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, ConsentType = ConsentType.PhotoVideo, Granted = true, SignedByName = "Staff Signer" });
        db.ParticipantConsents.Add(new ParticipantConsent { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, ConsentType = ConsentType.Alcohol });
        await db.SaveChangesAsync();
        await AcceptAsync(db, tenantId, p,
            new PatchParticipantDto
            {
                Consents = [
                    new CreateParticipantConsentDto { ConsentType = ConsentType.PhotoVideo },
                    new CreateParticipantConsentDto { ConsentType = ConsentType.Alcohol, Granted = false }],
            },
            new PatchParticipantDto { Consents = [] });
        var photo = await db.ParticipantConsents.IgnoreQueryFilters().SingleAsync(c => c.ParticipantId == p.Id && c.ConsentType == ConsentType.PhotoVideo);
        var alcohol = await db.ParticipantConsents.IgnoreQueryFilters().SingleAsync(c => c.ParticipantId == p.Id && c.ConsentType == ConsentType.Alcohol);
        Assert.True(photo.Granted);
        Assert.Equal("Staff Signer", photo.SignedByName);
        Assert.False(alcohol.Granted);
    }

    [Fact]
    public async Task Accept_DuplicateRowKeysDoNotThrow()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        var dup = new CreateParticipantConsentDto { ConsentType = ConsentType.Privacy, Granted = true };
        await AcceptAsync(db, tenantId, p,
            new PatchParticipantDto { Consents = [dup, dup] },
            new PatchParticipantDto { Consents = [dup, dup with { Granted = false }] });
    }

    [Fact]
    public async Task Accept_PayloadGroupMissingFromBase_AppliesWholeGroup()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        p.Phone = "0400000002";
        await db.SaveChangesAsync();
        var reloaded = await AcceptAsync(db, tenantId, p, new PatchParticipantDto { PersonalDetails = Pd("0400000001") }, new PatchParticipantDto());
        Assert.Equal("0400000001", reloaded.Phone);
    }

    [Fact]
    public async Task Accept_NothingChanged_StillAcceptsAndKeepsEverything()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        p.Phone = "0400000002"; p.BehaviourRiskRating = RiskRatingLevel.Low;
        await db.SaveChangesAsync();
        var same = new PatchParticipantDto { PersonalDetails = Pd("0400000001"), BehaviourCommunication = new PatchBehaviourCommunicationDto { Memory = MemoryLevel.Excellent } };
        var reloaded = await AcceptAsync(db, tenantId, p, same, same);
        Assert.Equal("0400000002", reloaded.Phone);
        Assert.Equal(RiskRatingLevel.Low, reloaded.BehaviourRiskRating);
    }

    [Fact]
    public async Task Accept_RatingStillRestored_WhenGroupHasABaseAndChange()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        p.BehaviourRiskRating = RiskRatingLevel.Low;
        await db.SaveChangesAsync();
        var reloaded = await AcceptAsync(db, tenantId, p,
            new PatchParticipantDto { BehaviourCommunication = new PatchBehaviourCommunicationDto { Memory = MemoryLevel.Excellent, BehaviourRiskRating = RiskRatingLevel.Critical } },
            new PatchParticipantDto { BehaviourCommunication = new PatchBehaviourCommunicationDto() });
        Assert.Equal(RiskRatingLevel.Low, reloaded.BehaviourRiskRating);
        Assert.Equal(MemoryLevel.Excellent, reloaded.Memory);
    }

    [Fact]
    public async Task Accept_CraftedNdisPlanInPayloadAndBase_Returns200AndLeavesPlanUnchanged()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        p.NdisNumber = "430000001"; p.PlanType = PlanType.PlanManaged;
        await db.SaveChangesAsync();
        var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted,
            new PatchParticipantDto { NdisPlan = new PatchNdisPlanDto { NdisNumber = "999999999" } },
            new PatchParticipantDto { NdisPlan = new PatchNdisPlanDto { NdisNumber = "111111111" } });
        db.ChangeTracker.Clear();
        var result = await MakeController(db, tenantId, Guid.NewGuid()).Accept(s.Id, CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        var reloaded = await db.Participants.IgnoreQueryFilters().SingleAsync(x => x.Id == p.Id);
        Assert.Equal("430000001", reloaded.NdisNumber);
        Assert.Equal(PlanType.PlanManaged, reloaded.PlanType);
    }

    [Fact]
    public async Task Get_ReturnsStoredBaseToStaff()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted, new PatchParticipantDto { PersonalDetails = Pd("0400000003") }, new PatchParticipantDto { PersonalDetails = Pd("0400000001") });
        var result = await MakeController(db, tenantId, Guid.NewGuid()).Get(s.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<CaregiverSubmissionDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("0400000001", body.Data!.Base!.PersonalDetails!.Phone);
        Assert.Equal("0400000003", body.Data.Payload!.PersonalDetails!.Phone);
    }

    [Fact]
    public void IsRoleGated_AdminCoordinatorSuperAdmin()
    {
        var attr = typeof(CaregiverSubmissionsController).GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>().Single();
        Assert.Equal("Admin,Coordinator,SuperAdmin", attr.Roles);
    }

    [Fact]
    public async Task Accept_bumps_the_changed_groups()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        await AcceptAsync(db, tenantId, p, new PatchParticipantDto { AboutMe = new PatchAboutMeDto { Goals = "A goal" } }, basePayload: null);
        Assert.Equal(1, await db.ParticipantGroupRevisions.Where(r => r.ParticipantId == p.Id && r.GroupKey == "aboutMe").Select(r => r.Revision).SingleAsync());
    }

    [Fact]
    public async Task Accept_with_stale_expected_in_payload_is_never_refused()
    {
        var (db, tenantId) = CreateTenantDb();
        var p = SeedParticipant(db, tenantId);
        db.ParticipantGroupRevisions.Add(new ParticipantGroupRevision { ParticipantId = p.Id, GroupKey = "aboutMe", Revision = 3, UpdatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        var reloaded = await AcceptAsync(db, tenantId, p,
            new PatchParticipantDto { AboutMe = new PatchAboutMeDto { Goals = "A goal" }, ExpectedRevisions = new() { ["aboutMe"] = 0 } }, basePayload: null);
        Assert.Equal("A goal", reloaded.Goals);
        Assert.Equal(4, await db.ParticipantGroupRevisions.Where(r => r.ParticipantId == p.Id && r.GroupKey == "aboutMe").Select(r => r.Revision).SingleAsync());
    }
}
