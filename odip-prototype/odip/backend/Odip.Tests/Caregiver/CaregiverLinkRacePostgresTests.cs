using System.Data.Common;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Moq;
using Odip.Api.Controllers;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
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
    private async Task<(CaregiverSubmissionsController Controller, OdipDbContext Db)> StaffAsync(Guid tenantId, Guid submissionId, CaregiverSubmissionStatus? otherSets = null)
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
}
