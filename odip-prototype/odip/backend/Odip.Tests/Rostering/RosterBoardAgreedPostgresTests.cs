using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The board's waiting-agreements query (pendingAgreements, spec 2026-10-15) on a real PostgreSQL: the NOT EXISTS for a newer revision, the blocks and stored-answer test and the approval
/// EXISTS must translate and filter as they do on EF InMemory. Skipped without POSTGRES_CONNECTION_STRING; the runner's dotnet target provides one. Each test makes an organisation of its own.
/// </summary>
public class RosterBoardAgreedPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly DateOnly Monday = new(2026, 8, 24);
    private static readonly IReadOnlyList<Odip.Domain.Billing.Pricing.PlanBlock> Blocks = new[] { ApprovalTestSupport.WeekdayBlock() };
    private readonly PostgresFixture _pg;
    public RosterBoardAgreedPostgresTests(PostgresFixture pg) => _pg = pg;

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero));

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private static Participant Person(OdipDbContext db, string first, bool isActive = true, bool isDraft = false) =>
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = first, LastName = "Test", IsActive = isActive, IsDraft = isDraft }).Entity;

    private static ServiceAgreementDraftApproval Approval(Guid tenantId, ServiceAgreementDraft draft) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, DraftId = draft.Id, ParticipantId = draft.ParticipantId, DraftVersion = draft.Version,
        ApprovedAt = new DateTime(2026, 8, 19, 0, 0, 0, DateTimeKind.Utc), ApprovedByName = "Alex Admin",
    };

    [SkippableFact]
    public async Task PendingAgreements_AreTheNewestUnapprovedBlocksRevisions_OnPostgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        Guid miaId, ivyId, miaV2Id, ivyV1Id;
        await using (seed)
        {
            var mia = Person(seed, "Mia");   // v1 approved, v2 waiting: v2
            var jo = Person(seed, "Jo");     // v1 waiting, v2 approved: nothing (only the newest counts)
            var kim = Person(seed, "Kim");   // hand-typed: nothing
            var ivy = Person(seed, "Ivy", isActive: false, isDraft: true);   // still in onboarding, no board row: listed, not able to receive services
            var ola = Person(seed, "Ola", isActive: false);                  // archived: nothing
            await seed.SaveChangesAsync();
            var miaV1 = ApprovalTestSupport.BuildRevision(tenantId, mia.Id, 1, Blocks);
            var miaV2 = ApprovalTestSupport.BuildRevision(tenantId, mia.Id, 2, Blocks);
            var joV1 = ApprovalTestSupport.BuildRevision(tenantId, jo.Id, 1, Blocks);
            var joV2 = ApprovalTestSupport.BuildRevision(tenantId, jo.Id, 2, Blocks);
            var ivyV1 = ApprovalTestSupport.BuildRevision(tenantId, ivy.Id, 1, Blocks);
            seed.ServiceAgreementDrafts.AddRange(miaV1, miaV2, joV1, joV2, ivyV1, ApprovalTestSupport.BuildRevision(tenantId, kim.Id, 1, Blocks, handTyped: true),
                ApprovalTestSupport.BuildRevision(tenantId, ola.Id, 1, Blocks));
            await seed.SaveChangesAsync();
            seed.ServiceAgreementDraftApprovals.AddRange(Approval(tenantId, miaV1), Approval(tenantId, joV2));
            await seed.SaveChangesAsync();
            (miaId, ivyId, miaV2Id, ivyV1Id) = (mia.Id, ivy.Id, miaV2.Id, ivyV1.Id);
        }

        await using var db = PostgresFixture.NewContext(_pg.ConnectionString, TenantOf(tenantId));
        var result = await new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: Clock).GetBoard(Monday, "participant", default);
        var waiting = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.PendingAgreements!;

        // Jo (newest approved), Kim (hand-typed) and Ola (archived) are left out; the order is by last name, then first name.
        Assert.Equal(new[]
        {
            new PendingAgreementDto { ParticipantId = ivyId, DisplayName = "Ivy Test", DraftId = ivyV1Id, Version = 1, CanReceiveServices = false },
            new PendingAgreementDto { ParticipantId = miaId, DisplayName = "Mia Test", DraftId = miaV2Id, Version = 2, CanReceiveServices = true },
        }, waiting);
    }
}
