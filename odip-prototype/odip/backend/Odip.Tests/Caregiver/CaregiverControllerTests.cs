using Microsoft.AspNetCore.Http;
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
using Xunit;

namespace Odip.Tests.Caregiver;

public class CaregiverControllerTests
{
    private static OdipDbContext CreateDb()
    {
        // Public routes carry no principal: model that with a null-tenant, non-superadmin tenant
        // service so the global query filter would HIDE everything — proving the controller must
        // use IgnoreQueryFilters() with explicit TenantId matching, not the ambient filter.
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static CaregiverController MakeController(OdipDbContext db)
    {
        var accessor = new Mock<IHttpContextAccessor>();
        var http = new DefaultHttpContext();
        accessor.Setup(a => a.HttpContext).Returns(http);
        var controller = new CaregiverController(db, accessor.Object);
        controller.ControllerContext = new ControllerContext { HttpContext = http };
        return controller;
    }

    private static (Participant p, CaregiverProfileSubmission s, string rawToken) Seed(
        OdipDbContext db, CaregiverSubmissionStatus status = CaregiverSubmissionStatus.Draft,
        DateTime? expiresAt = null, Guid? tenantId = null)
    {
        var tid = tenantId ?? Guid.NewGuid();
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tid, FirstName = "Sophie", LastName = "Brown", IsActive = true,
            PlanType = PlanType.SelfManaged, OvernightSupport = OvernightSupportType.None,
            OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
        };
        db.Participants.Add(p);
        var raw = CaregiverTokenService.GenerateRawToken();
        var s = new CaregiverProfileSubmission
        {
            Id = Guid.NewGuid(), TenantId = tid, ParticipantId = p.Id,
            TokenHash = CaregiverTokenService.Hash(raw), Status = status,
            CreatedByUserId = Guid.NewGuid(), ExpiresAt = expiresAt ?? DateTime.UtcNow.AddDays(14),
        };
        db.CaregiverProfileSubmissions.Add(s);
        db.SaveChanges();
        return (p, s, raw);
    }

    [Fact]
    public async Task Get_ValidDraftToken_ReturnsForm()
    {
        using var db = CreateDb();
        var (_, s, raw) = Seed(db);
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<CaregiverFormDto>>(ok.Value);
        Assert.Equal(CaregiverSubmissionStatus.Draft, body.Data!.Status);
        Assert.Equal(s.ExpiresAt, body.Data.ExpiresAt);
    }

    [Fact]
    public async Task Get_UnknownToken_Returns404()
    {
        using var db = CreateDb();
        Seed(db);
        var result = await MakeController(db).Get("not-a-real-token", CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Theory]
    [InlineData(CaregiverSubmissionStatus.Revoked)]
    [InlineData(CaregiverSubmissionStatus.Accepted)]
    public async Task Get_DeadStatus_Returns404(CaregiverSubmissionStatus status)
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db, status);
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Get_ExpiredToken_Returns404()
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db, expiresAt: DateTime.UtcNow.AddMinutes(-1));
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Get_ParticipantDeleted_Returns404()
    {
        using var db = CreateDb();
        var (p, _, raw) = Seed(db);
        db.Participants.Remove(p);
        await db.SaveChangesAsync();
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Get_TokenFromAnotherTenant_Returns404()
    {
        // The submission row references a participant that belongs to a DIFFERENT tenant than
        // the submission itself claims — ResolveLiveAsync's explicit p.TenantId == sub.TenantId
        // match must reject this, not just the submission's own existence check.
        using var db = CreateDb();
        var participantTenant = Guid.NewGuid();
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = participantTenant, FirstName = "Sophie", LastName = "Brown", IsActive = true,
            PlanType = PlanType.SelfManaged, OvernightSupport = OvernightSupportType.None,
            OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
        };
        db.Participants.Add(p);
        var raw = CaregiverTokenService.GenerateRawToken();
        db.CaregiverProfileSubmissions.Add(new CaregiverProfileSubmission
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ParticipantId = p.Id,
            TokenHash = CaregiverTokenService.Hash(raw), Status = CaregiverSubmissionStatus.Draft,
            CreatedByUserId = Guid.NewGuid(), ExpiresAt = DateTime.UtcNow.AddDays(14),
        });
        await db.SaveChangesAsync();

        var result = await MakeController(db).Get(raw, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Get_SubmittedToken_ReturnsFormReadOnlyStatus()
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db, CaregiverSubmissionStatus.Submitted);
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<CaregiverFormDto>>(ok.Value);
        Assert.Equal(CaregiverSubmissionStatus.Submitted, body.Data!.Status);
    }

    [Fact]
    public async Task SaveDraft_EmptyName_Returns400AndDoesNotSave()
    {
        using var db = CreateDb();
        var (_, s, raw) = Seed(db);
        var result = await MakeController(db).SaveDraft(raw,
            new CaregiverDraftDto { CaregiverName = "  ", Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result);
        var reloaded = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id);
        Assert.Null(reloaded.Payload);
        Assert.Null(reloaded.CaregiverName);
    }

    [Fact]
    public async Task SaveDraft_Valid_PersistsNameAndPayload()
    {
        using var db = CreateDb();
        var (_, s, raw) = Seed(db);
        // PatchAboutMeDto has no PersonalInterests member (that field lives on
        // PatchCulturalBackgroundDto) — the fact sheet's own real-signature quote for
        // ParticipantsController.Patch's Apply section confirms p.PersonalInterests is set from
        // dto.CulturalBackground, not dto.AboutMe. Using the real group here keeps the assertion
        // on Participant.PersonalInterests meaningful.
        var payload = new PatchParticipantDto { CulturalBackground = new PatchCulturalBackgroundDto { PersonalInterests = "Gardening" } };
        var result = await MakeController(db).SaveDraft(raw,
            new CaregiverDraftDto { CaregiverName = "Jane Smith", CaregiverRelationship = "Mother", Payload = payload },
            CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        var reloaded = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id);
        Assert.Equal("Jane Smith", reloaded.CaregiverName);
        Assert.Contains("Gardening", reloaded.Payload);
        Assert.Equal(CaregiverSubmissionStatus.Draft, reloaded.Status);
    }

    [Fact]
    public async Task SaveDraft_AfterSubmit_Returns409()
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db, CaregiverSubmissionStatus.Submitted);
        var result = await MakeController(db).SaveDraft(raw,
            new CaregiverDraftDto { CaregiverName = "Jane", Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task Submit_Valid_SetsSubmittedAndTimestamp()
    {
        using var db = CreateDb();
        var (_, s, raw) = Seed(db);
        var result = await MakeController(db).Submit(raw,
            new CaregiverDraftDto { CaregiverName = "Jane Smith", Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        var reloaded = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id);
        Assert.Equal(CaregiverSubmissionStatus.Submitted, reloaded.Status);
        Assert.NotNull(reloaded.SubmittedAt);
    }

    [Fact]
    public async Task Submit_Twice_Returns409()
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db, CaregiverSubmissionStatus.Submitted);
        var result = await MakeController(db).Submit(raw,
            new CaregiverDraftDto { CaregiverName = "Jane", Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task Submit_SetsAuditActorItem()
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db);
        var controller = MakeController(db);
        await controller.Submit(raw,
            new CaregiverDraftDto { CaregiverName = "Jane Smith", Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.Equal("caregiver:Jane Smith", controller.HttpContext.Items[Odip.Infrastructure.Audit.AuditInterceptor.ActorItemKey]);
    }

    [Fact]
    public async Task Get_ProjectionOmitsInternalFields_AndListsEditable()
    {
        using var db = CreateDb();
        var (p, _, raw) = Seed(db);
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<CaregiverFormDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Sophie", body.Data!.Current["firstName"]!.GetValue<string>());
        foreach (var f in CaregiverFieldPolicy.InternalFields)
            Assert.False(body.Data.Current.ContainsKey(f), $"leaked '{f}'");
        Assert.NotEmpty(body.Data.Editable);
    }

    [Fact]
    public void CaregiverController_IsRateLimitedAsPublic()
    {
        var attr = typeof(CaregiverController).GetCustomAttributes(typeof(Microsoft.AspNetCore.RateLimiting.EnableRateLimitingAttribute), true)
            .Cast<Microsoft.AspNetCore.RateLimiting.EnableRateLimitingAttribute>().Single();
        Assert.Equal("public", attr.PolicyName);
    }

    [Fact]
    public void CaregiverController_HasNoClassLevelAuthorize()
    {
        var attrs = typeof(CaregiverController).GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true);
        Assert.Empty(attrs);
    }
}
