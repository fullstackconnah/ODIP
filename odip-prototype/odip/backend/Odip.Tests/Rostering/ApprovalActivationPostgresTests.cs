using System.Data.Common;
using System.Diagnostics;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Approving with ApprovalActivatesParticipant on, against a real PostgreSQL: the activation runs as its own step after the approval has committed and released its roster locks,
/// so nothing nests, and a roster held by somebody else turns into NotActivated, never a lost approval.
/// </summary>
public sealed class ApprovalActivationPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ApprovalActivationPostgresTests(PostgresFixture pg) => _pg = pg;

    private static ICurrentTenant Tenant(Guid id) => Mock.Of<ICurrentTenant>(x => x.TenantId == id && !x.IsSuperAdmin);
    private static OdipDbContext Context(string cs, Guid tenantId, params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(cs).AddInterceptors(interceptors).Options, Tenant(tenantId));

    private static ServiceAgreementDraftsController Controller(OdipDbContext db, Guid tenantId)
    {
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, Admin.UserId!.Value.ToString()), new Claim("fullName", "Alex Admin"), new Claim(ClaimTypes.Role, "Admin") };
        var approval = new ServiceAgreementApprovalService(db, new RosterPlacementGate(), new RosterShiftGenerator(), clock: FakeClock.AtUtc(2026, 10, 10, 2, 0));
        return new ServiceAgreementDraftsController(db, Tenant(tenantId), new ServiceAgreementDraftService(db), approval: approval)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } },
        };
    }

    /// <summary>A migrated scratch database: an onboarding draft with intake finished, the fixture's started weeks, the setting on, and one revision to approve.</summary>
    private async Task<(string Cs, Guid TenantId, Guid ParticipantId, Guid DraftId)> SetUpAsync()
    {
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var (seed, tenantId) = await _pg.NewTenantContextAsync(cs);
        await using (seed)
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Amy", LastName = "Ng", IsActive = false, IsDraft = true, IntakeCompletedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc) };
            var draft = BuildRevision(tenantId, participant.Id, 1, new[] { WeekdayBlock() }, null, null);
            seed.AddRange(participant, new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = "NSW" },
                new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = tenantId, ApprovalActivatesParticipant = true }, draft);
            seed.RosterWeeks.AddRange(StartedWeekRows(tenantId));
            await seed.SaveChangesAsync();
            return (cs, tenantId, participant.Id, draft.Id);
        }
    }

    private static ServiceAgreementDraftDto Value(ActionResult<ApiResponse<ServiceAgreementDraftDto>> result) =>
        Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    [SkippableFact]
    public async Task Approve_WithSettingOn_ActivatesAfterTheApprovalCommits_AndFillsStartedWeeksOnce()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (cs, tenantId, participantId, draftId) = await SetUpAsync();
        var clock = Stopwatch.StartNew();

        await using (var request = Context(cs, tenantId))
        {
            var dto = Value(await Controller(request, tenantId).Approve(participantId, draftId, new ApproveDraftDto(), CancellationToken.None));
            Assert.Equal(ActivationResults.Activated, dto.Activation!.Result);
        }

        Assert.True(clock.Elapsed < RosterGenerationLock.DefaultWait, $"took {clock.Elapsed}: a nested lock would have waited it out");
        await using var read = Context(cs, tenantId);
        Assert.True(await read.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == draftId));
        Assert.False((await read.Participants.SingleAsync(p => p.Id == participantId)).IsDraft);
        var shifts = await read.Shifts.Where(s => s.ParticipantId == participantId).Select(s => new { s.ShiftPatternId, s.ServiceDate }).ToListAsync();
        Assert.Equal(40, shifts.Count);                                   // five weekdays a week, 2026-10-12 to 2026-12-06, as approving an active participant makes
        Assert.Equal(shifts.Count, shifts.Distinct().Count());
    }

    /// <summary>On the approval's commit (its roster locks are released then), takes the organisation's roster-board lock on a second connection and holds it, as a long board change would.</summary>
    private sealed class HoldBoardAfterApproval(string cs, Guid tenantId) : DbTransactionInterceptor
    {
        public OdipDbContext? Contender { get; private set; }
        public RosterGenerationLock? Held { get; private set; }

        public override async Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken ct = default)
        {
            if (Held is null && eventData.Context!.ChangeTracker.Entries<ServiceAgreementDraftApproval>().Any())
            {
                Contender = Context(cs, tenantId);
                Held = await RosterGenerationLock.AcquireAsync(Contender, tenantId, ct, TimeSpan.FromSeconds(5), "roster-board");
            }
            await base.TransactionCommittedAsync(transaction, eventData, ct);
        }
    }

    [SkippableFact]
    public async Task Approve_WithSettingOn_WhenTheBoardIsBusyDuringActivation_KeepsTheApproval_AndSaysNotActivated()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (cs, tenantId, participantId, draftId) = await SetUpAsync();
        var hold = new HoldBoardAfterApproval(cs, tenantId);
        var clock = Stopwatch.StartNew();
        try
        {
            await using var request = Context(cs, tenantId, hold);
            var dto = Value(await Controller(request, tenantId).Approve(participantId, draftId, new ApproveDraftDto(), CancellationToken.None));

            Assert.NotNull(hold.Held);
            Assert.Equal((ActivationResults.NotActivated, ServiceAgreementApprovalService.ActivationBusyReason), (dto.Activation!.Result, dto.Activation.Reason));
            Assert.True(clock.Elapsed < RosterGenerationLock.DefaultWait, $"took {clock.Elapsed}: activation should give up after its short wait");
        }
        finally
        {
            if (hold.Held is not null) await hold.Held.DisposeAsync();
            if (hold.Contender is not null) await hold.Contender.DisposeAsync();
        }

        await using var read = Context(cs, tenantId);
        Assert.True(await read.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == draftId));
        var stored = await read.Participants.SingleAsync(p => p.Id == participantId);
        Assert.True(stored.IsDraft && !stored.IsActive);
    }
}
