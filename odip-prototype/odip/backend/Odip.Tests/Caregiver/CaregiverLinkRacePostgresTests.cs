using System.Data.Common;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Audit;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Caregiver;

/// <summary>PB65-D1: CreateLink and RevokeLink write the status in one statement, so a caregiver Submit or a staff Accept that commits just before their write is never overwritten with Revoked.</summary>
public class CaregiverLinkRacePostgresTests : IClassFixture<PostgresFixture>
{
    private const string NoPg = "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.";
    private readonly PostgresFixture _pg;
    public CaregiverLinkRacePostgresTests(PostgresFixture pg) => _pg = pg;

    /// <summary>Runs the other party's commit once, just before the controller's first UPDATE or INSERT reaches the database.</summary>
    private sealed class OtherPartyCommitsFirst(Func<Task> commit) : DbCommandInterceptor
    {
        private bool _done;
        private async ValueTask Hook(DbCommand c)
        {
            var sql = c.CommandText.TrimStart();
            if (_done || !(sql.StartsWith("UPDATE", StringComparison.Ordinal) || sql.StartsWith("INSERT", StringComparison.Ordinal))) return;
            _done = true;
            await commit();
        }
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand c, CommandEventData d, InterceptionResult<DbDataReader> r, CancellationToken ct = default) { await Hook(c); return r; }
        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand c, CommandEventData d, InterceptionResult<int> r, CancellationToken ct = default) { await Hook(c); return r; }
    }

    private async Task<(Guid TenantId, Guid ParticipantId, Guid SubmissionId)> SeedAsync(CaregiverSubmissionStatus status)
    {
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        await using (seed)
        {
            var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            var s = new CaregiverProfileSubmission
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, TokenHash = CaregiverTokenService.Hash(CaregiverTokenService.GenerateRawToken()),
                Status = status, CreatedByUserId = Guid.NewGuid(), ExpiresAt = DateTime.UtcNow.AddDays(14),
            };
            seed.Participants.Add(p);
            seed.CaregiverProfileSubmissions.Add(s);
            await seed.SaveChangesAsync();
            return (tenantId, p.Id, s.Id);
        }
    }

    /// <summary>A staff controller whose context has already loaded the form (a stale view), with an optional other party who commits mid-request.</summary>
    private async Task<(CaregiverSubmissionsController Controller, OdipDbContext Db)> StaffAsync(Guid tenantId, Guid submissionId, CaregiverSubmissionStatus? otherSets = null, bool audited = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString);
        if (otherSets is { } status)
            options.AddInterceptors(new OtherPartyCommitsFirst(async () =>
            {
                await using var other = PostgresFixture.NewContext(_pg.ConnectionString);
                await other.CaregiverProfileSubmissions.IgnoreQueryFilters().Where(x => x.Id == submissionId).ExecuteUpdateAsync(u => u.SetProperty(x => x.Status, status));
            }));
        if (audited) options.AddInterceptors(new AuditInterceptor(new HttpContextAccessor()));
        var db = new OdipDbContext(options.Options, tenant.Object);
        await db.CaregiverProfileSubmissions.SingleAsync(s => s.Id == submissionId);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test");
        var controller = new CaregiverSubmissionsController(db, tenant.Object, new SafetyNoteSyncService(db), new StaffCompatibilityLinkService(db), new ConfigurationBuilder().Build())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } }
        };
        return (controller, db);
    }

    private async Task<List<CaregiverSubmissionStatus>> StatusesAsync(Guid participantId)
    {
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        return await db.CaregiverProfileSubmissions.IgnoreQueryFilters().Where(x => x.ParticipantId == participantId).Select(x => x.Status).ToListAsync();
    }

    [SkippableFact]
    public async Task CreateLink_WhenTheCaregiverSubmitsFirst_Answers409_TheFormStaysSubmittedAndNoDraftIsAdded()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, participantId, id) = await SeedAsync(CaregiverSubmissionStatus.Draft);
        var (staff, db) = await StaffAsync(tenantId, id, CaregiverSubmissionStatus.Submitted);
        await using var _ = db;

        Assert.IsType<ConflictObjectResult>((await staff.CreateLink(participantId, CancellationToken.None)).Result);

        Assert.Equal([CaregiverSubmissionStatus.Submitted], await StatusesAsync(participantId));
    }

    [SkippableFact]
    public async Task RevokeLink_WhenAnAcceptCommitsFirst_TheFormStaysAccepted()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, participantId, id) = await SeedAsync(CaregiverSubmissionStatus.Submitted);
        var (staff, db) = await StaffAsync(tenantId, id, CaregiverSubmissionStatus.Accepted);
        await using var _ = db;

        await staff.RevokeLink(participantId, CancellationToken.None);

        Assert.Equal([CaregiverSubmissionStatus.Accepted], await StatusesAsync(participantId));
    }

    [SkippableTheory]
    [InlineData(CaregiverSubmissionStatus.Draft)]
    [InlineData(CaregiverSubmissionStatus.Submitted)]
    public async Task RevokeLink_RevokesADraftAndASubmittedForm(CaregiverSubmissionStatus status)
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, participantId, id) = await SeedAsync(status);
        var (staff, db) = await StaffAsync(tenantId, id);
        await using var _ = db;

        Assert.IsType<NoContentResult>(await staff.RevokeLink(participantId, CancellationToken.None));

        Assert.Equal([CaregiverSubmissionStatus.Revoked], await StatusesAsync(participantId));
    }

    private async Task<List<string>> RevokeAuditChangesAsync(Guid submissionId)
    {
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        return await db.AuditLogs.IgnoreQueryFilters()
            .Where(a => a.EntityId == submissionId && a.EntityType == nameof(CaregiverProfileSubmission) && a.Action == AuditAction.Updated)
            .Select(a => a.Changes).ToListAsync();
    }

    [SkippableFact]
    public async Task RevokeLink_WritesAnAuditRowForTheRevoke()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, participantId, id) = await SeedAsync(CaregiverSubmissionStatus.Draft);
        var (staff, db) = await StaffAsync(tenantId, id, audited: true);
        await using var _ = db;

        await staff.RevokeLink(participantId, CancellationToken.None);

        var changes = Assert.Single(await RevokeAuditChangesAsync(id));
        Assert.Contains("Revoked", changes);
    }

    [SkippableFact]
    public async Task CreateLink_WritesAnAuditRowForTheDraftItRevokes()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, participantId, id) = await SeedAsync(CaregiverSubmissionStatus.Draft);
        var (staff, db) = await StaffAsync(tenantId, id, audited: true);
        await using var _ = db;

        Assert.IsType<OkObjectResult>((await staff.CreateLink(participantId, CancellationToken.None)).Result);

        var changes = Assert.Single(await RevokeAuditChangesAsync(id));
        Assert.Contains("Revoked", changes);
    }

    // PB66-O1: a caregiver Submit claims the Draft first, so a revoke or another Submit that committed since the load is never overwritten.
    private const string OriginalPayload = "{\"original\": true}";

    private async Task<(Guid TenantId, Guid SubmissionId, string Token)> SeedCaregiverAsync()
    {
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        await using (seed)
        {
            var raw = CaregiverTokenService.GenerateRawToken();
            var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            var s = new CaregiverProfileSubmission
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, TokenHash = CaregiverTokenService.Hash(raw),
                Status = CaregiverSubmissionStatus.Draft, CreatedByUserId = Guid.NewGuid(), ExpiresAt = DateTime.UtcNow.AddDays(14), Payload = OriginalPayload,
            };
            seed.Participants.Add(p);
            seed.CaregiverProfileSubmissions.Add(s);
            seed.Users.Add(new User { Id = Guid.NewGuid(), TenantId = tenantId, Username = "admin" + Guid.NewGuid().ToString("N"), Email = Guid.NewGuid().ToString("N") + "@example.test", FirstName = "A", LastName = "B", Role = UserRole.Admin, IsActive = true });
            await seed.SaveChangesAsync();
            return (tenantId, s.Id, raw);
        }
    }

    private static CaregiverController CaregiverFor(OdipDbContext db)
    {
        var http = new DefaultHttpContext();
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(http);
        return new CaregiverController(db, accessor.Object) { ControllerContext = new ControllerContext { HttpContext = http } };
    }

    private static CaregiverDraftDto SubmitBody(string name) => new() { CaregiverName = name, Payload = new PatchParticipantDto() };

    /// <summary>The public route has no ambient tenant.</summary>
    private OdipDbContext AnonymousDb(Func<Task>? otherCommits = null, bool audited = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString);
        if (otherCommits != null) options.AddInterceptors(new OtherPartyCommitsFirst(otherCommits));
        if (audited) options.AddInterceptors(new AuditInterceptor(new HttpContextAccessor()));
        return new OdipDbContext(options.Options, tenant.Object);
    }

    private async Task<(CaregiverSubmissionStatus Status, string? Payload, string? Name, int Notifications, int Audits)> StateAsync(Guid id)
    {
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        var row = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == id);
        var notices = await db.NotificationOutbox.IgnoreQueryFilters().CountAsync(o => o.EntityId == id);
        var audits = await db.AuditLogs.IgnoreQueryFilters().CountAsync(a => a.EntityId == id && a.EntityType == nameof(CaregiverProfileSubmission) && a.Action == AuditAction.Updated);
        return (row.Status, row.Payload, row.CaregiverName, notices, audits);
    }

    [SkippableFact]
    public async Task Submit_WhenStaffRevokeCommitsFirst_Answers404_TheFormStaysRevokedAndNothingIsStored()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (_, id, token) = await SeedCaregiverAsync();
        await using var db = AnonymousDb(async () =>
        {
            await using var other = PostgresFixture.NewContext(_pg.ConnectionString);
            await other.CaregiverProfileSubmissions.IgnoreQueryFilters().Where(x => x.Id == id).ExecuteUpdateAsync(u => u.SetProperty(x => x.Status, CaregiverSubmissionStatus.Revoked));
        });

        Assert.IsType<NotFoundObjectResult>(await CaregiverFor(db).Submit(token, SubmitBody("Jane Smith"), CancellationToken.None));

        var state = await StateAsync(id);
        Assert.Equal(CaregiverSubmissionStatus.Revoked, state.Status);
        Assert.Equal(OriginalPayload, state.Payload);
        Assert.Null(state.Name);
        Assert.Equal(0, state.Notifications);
    }

    [SkippableFact]
    public async Task Submit_WhenAnotherSubmitCommitsFirst_Answers409_TheFormStaysSubmittedWithOneNotification()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (_, id, token) = await SeedCaregiverAsync();
        await using var db = AnonymousDb(async () =>
        {
            await using var other = AnonymousDb();
            Assert.IsType<NoContentResult>(await CaregiverFor(other).Submit(token, SubmitBody("First Caregiver"), CancellationToken.None));
        });

        Assert.IsType<ConflictObjectResult>(await CaregiverFor(db).Submit(token, SubmitBody("Second Caregiver"), CancellationToken.None));

        var state = await StateAsync(id);
        Assert.Equal(CaregiverSubmissionStatus.Submitted, state.Status);
        Assert.Equal("First Caregiver", state.Name);
        Assert.Equal(1, state.Notifications);
    }

    [SkippableFact]
    public async Task Submit_OnADraft_Succeeds_SetsSubmittedAndWritesAnAuditRow()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (_, id, token) = await SeedCaregiverAsync();
        await using var db = AnonymousDb(audited: true);

        Assert.IsType<NoContentResult>(await CaregiverFor(db).Submit(token, SubmitBody("Jane Smith"), CancellationToken.None));

        var state = await StateAsync(id);
        Assert.Equal(CaregiverSubmissionStatus.Submitted, state.Status);
        Assert.Equal(1, state.Notifications);
        Assert.Equal(1, state.Audits);
        // The Status change itself, not SubmittedAt: the claim already set the column, so only the tracked entity keeps the audit row honest.
        Assert.Contains("\"Field\":\"Status\",\"Old\":\"Draft\",\"New\":\"Submitted\"", Assert.Single(await RevokeAuditChangesAsync(id)));
    }

    // PB68-D3: a draft save claims the Draft too, so a revoke that committed since the load keeps its row untouched.
    [SkippableFact]
    public async Task SaveDraft_WhenStaffRevokeCommitsFirst_Answers404_TheFormStaysRevokedAndNothingIsStored()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (_, id, token) = await SeedCaregiverAsync();
        await using var db = AnonymousDb(async () =>
        {
            await using var other = PostgresFixture.NewContext(_pg.ConnectionString);
            await other.CaregiverProfileSubmissions.IgnoreQueryFilters().Where(x => x.Id == id).ExecuteUpdateAsync(u => u.SetProperty(x => x.Status, CaregiverSubmissionStatus.Revoked));
        });

        Assert.IsType<NotFoundObjectResult>(await CaregiverFor(db).SaveDraft(token, SubmitBody("Jane Smith"), CancellationToken.None));

        var state = await StateAsync(id);
        Assert.Equal(CaregiverSubmissionStatus.Revoked, state.Status);
        Assert.Equal(OriginalPayload, state.Payload);
        Assert.Null(state.Name);
    }

    [SkippableFact]
    public async Task SaveDraft_OnALiveDraft_StoresNameAndPayloadAndLeavesItADraft()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (_, id, token) = await SeedCaregiverAsync();
        await using var db = AnonymousDb();

        Assert.IsType<NoContentResult>(await CaregiverFor(db).SaveDraft(token, SubmitBody("Jane Smith"), CancellationToken.None));

        var state = await StateAsync(id);
        Assert.Equal(CaregiverSubmissionStatus.Draft, state.Status);
        Assert.Equal("Jane Smith", state.Name);
        Assert.NotEqual(OriginalPayload, state.Payload);
        Assert.Equal(0, state.Notifications);
    }
}
