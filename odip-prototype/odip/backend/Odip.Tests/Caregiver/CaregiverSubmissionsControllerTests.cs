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
        PatchParticipantDto? payload = null)
    {
        var s = new CaregiverProfileSubmission
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId,
            TokenHash = CaregiverTokenService.Hash(CaregiverTokenService.GenerateRawToken()),
            Status = status, CreatedByUserId = Guid.NewGuid(), ExpiresAt = DateTime.UtcNow.AddDays(14),
            CaregiverName = "Jane Smith",
            Payload = payload is null ? null : JsonSerializer.Serialize(payload, Json),
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
    public void IsRoleGated_AdminCoordinatorSuperAdmin()
    {
        var attr = typeof(CaregiverSubmissionsController).GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>().Single();
        Assert.Equal("Admin,Coordinator,SuperAdmin", attr.Roles);
    }
}
