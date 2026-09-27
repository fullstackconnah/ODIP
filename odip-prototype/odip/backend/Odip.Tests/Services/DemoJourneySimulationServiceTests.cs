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
using System.Security.Claims;

namespace Odip.Tests.Services;

public class DemoJourneySimulationServiceTests
{
    private static (OdipDbContext Db, Guid TenantId) CreateDb()
    {
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return (new OdipDbContext(options, tenant.Object), tenantId);
    }

    private static (Tenant Tenant, User User, Participant Participant, ServiceAgreementDraft Draft) SeedDemo(OdipDbContext db, Guid tenantId)
    {
        var tenant = db.Tenants.Add(new Tenant { Id = tenantId, Name = "Demo", EmailDomain = "demo.local" }).Entity;
        var user = db.Users.Add(new User { Id = Guid.NewGuid(), TenantId = tenantId, Email = "tester@demo.local", Username = "tester", FirstName = "Demo", LastName = "Tester", Role = UserRole.Admin, IsActive = true }).Entity;
        var participant = db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Synthetic", LastName = "Demo", IsDraft = true, IsActive = false }).Entity;
        var draft = db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Version = 1, State = "VIC", ParticipantNameSnapshot = participant.FullName, CreatedBy = user.Email }).Entity;
        return (tenant, user, participant, draft);
    }

    [Fact]
    public async Task SimulateAsync_DemoDevDraft_ReturnsWalkthroughWithoutWritingActivationSigningBookingOrClaims()
    {
        var (db, tenantId) = CreateDb();
        using (db)
        {
            var (_, user, participant, draft) = SeedDemo(db, tenantId);
            await db.SaveChangesAsync();
            var before = (await db.ElectronicSigningEvidence.CountAsync(), await db.ElectronicSigningSnapshots.CountAsync(), participant.IsActive);

            var (result, error) = await new DemoJourneySimulationService(db).SimulateAsync(tenantId, participant.Id, draft.Id, user.Email, true, CancellationToken.None);

            Assert.Null(error);
            Assert.NotNull(result);
            Assert.Equal(DemoJourneySimulationService.Banner, result!.Banner);
            Assert.Contains("no booking", result.Booking, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(before.Item1, await db.ElectronicSigningEvidence.CountAsync());
            Assert.Equal(before.Item2, await db.ElectronicSigningSnapshots.CountAsync());
            Assert.False((await db.Participants.SingleAsync(x => x.Id == participant.Id)).IsActive);
        }
    }

    [Theory]
    [InlineData(false, "tester@demo.local", "Demo", "demo.local", true, "dev-auth")]
    [InlineData(true, "tester@demo.local", "Real Tenant", "real.example", true, "Demo tenant")]
    [InlineData(true, "tester@real.example", "Demo", "demo.local", true, "Demo dev-auth")]
    [InlineData(true, "tester@demo.local", "Demo", "demo.local", false, "draft participant")]
    public async Task SimulateAsync_RejectsRealTenantForeignIdentityOrExistingParticipant(bool devAuth, string actorEmail, string tenantName, string domain, bool isDraft, string expected)
    {
        var (db, tenantId) = CreateDb();
        using (db)
        {
            var (tenant, user, participant, draft) = SeedDemo(db, tenantId);
            tenant.Name = tenantName; tenant.EmailDomain = domain; user.Email = actorEmail; participant.IsDraft = isDraft;
            await db.SaveChangesAsync();

            var (result, error) = await new DemoJourneySimulationService(db).SimulateAsync(tenantId, participant.Id, draft.Id, actorEmail, devAuth, CancellationToken.None);

            Assert.Null(result);
            Assert.Contains(expected, error!, StringComparison.OrdinalIgnoreCase);
            Assert.Empty(db.ElectronicSigningEvidence);
            Assert.Empty(db.ElectronicSigningSnapshots);
        }
    }

    [Fact]
    public async Task SimulateAsync_RejectsForeignOrStaleDraft()
    {
        var (db, tenantId) = CreateDb();
        using (db)
        {
            var (_, user, participant, draft) = SeedDemo(db, tenantId);
            var foreignTenant = Guid.NewGuid();
            var foreignDraft = db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = foreignTenant, ParticipantId = participant.Id, Version = 2, State = "VIC", ParticipantNameSnapshot = "Foreign", CreatedBy = "foreign@demo.local" }).Entity;
            var newer = db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Version = 2, State = "VIC", ParticipantNameSnapshot = participant.FullName, CreatedBy = user.Email }).Entity;
            await db.SaveChangesAsync();
            var service = new DemoJourneySimulationService(db);

            var (stale, staleError) = await service.SimulateAsync(tenantId, participant.Id, draft.Id, user.Email, true, CancellationToken.None);
            var (foreign, foreignError) = await service.SimulateAsync(tenantId, participant.Id, foreignDraft.Id, user.Email, true, CancellationToken.None);

            Assert.Null(stale); Assert.Contains("newest", staleError!);
            Assert.Null(foreign); Assert.Contains("current", foreignError!);
            Assert.NotNull(newer);
        }
    }

    [Fact]
    public async Task Controller_AllowsDemoDevAuthInProductionButRejectsDevAuthOff()
    {
        var (db, tenantId) = CreateDb();
        using (db)
        {
            var (_, user, participant, draft) = SeedDemo(db, tenantId);
            await db.SaveChangesAsync();
            var currentTenant = new Mock<ICurrentTenant>();
            currentTenant.SetupGet(x => x.TenantId).Returns(tenantId);
            currentTenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
            ServiceAgreementDraftsController ControllerWithDevAuth(string enabled) => new(
                db, currentTenant.Object, new ServiceAgreementDraftService(db),
                simulation: new DemoJourneySimulationService(db),
                configuration: new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["DEV_AUTH_ENABLED"] = enabled
                }).Build())
            {
                ControllerContext = new Microsoft.AspNetCore.Mvc.ControllerContext
                {
                    HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext
                    {
                        User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Email, user.Email) }, "test"))
                    }
                }
            };

            var disabled = await ControllerWithDevAuth("false").SimulateDemoJourney(participant.Id, draft.Id, CancellationToken.None);
            var disabledResponse = Assert.IsType<ApiResponse<DemoJourneySimulationDto>>(
                Assert.IsType<Microsoft.AspNetCore.Mvc.BadRequestObjectResult>(disabled.Result).Value);
            Assert.False(disabledResponse.Success);
            Assert.Contains("dev-auth", Assert.Single(disabledResponse.Errors!), StringComparison.OrdinalIgnoreCase);

            var enabled = await ControllerWithDevAuth("true").SimulateDemoJourney(participant.Id, draft.Id, CancellationToken.None);
            var enabledResponse = Assert.IsType<ApiResponse<DemoJourneySimulationDto>>(
                Assert.IsType<Microsoft.AspNetCore.Mvc.OkObjectResult>(enabled.Result).Value);
            Assert.True(enabledResponse.Success);
            Assert.Equal(DemoJourneySimulationService.Banner, enabledResponse.Data!.Banner);
            Assert.Empty(db.ElectronicSigningEvidence);
            Assert.Empty(db.ElectronicSigningSnapshots);
            Assert.False((await db.Participants.SingleAsync(x => x.Id == participant.Id)).IsActive);
        }
    }
}
