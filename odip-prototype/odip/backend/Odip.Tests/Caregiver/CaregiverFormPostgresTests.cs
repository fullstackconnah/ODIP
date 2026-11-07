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
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Caregiver;

/// <summary>The public caregiver form's name limits against a real PostgreSQL: the audit actor `caregiver:{name}` goes into a 200-character column, which EF InMemory never enforces (a long name was a 500 and a lost draft).</summary>
public class CaregiverFormPostgresTests : IClassFixture<PostgresFixture>
{
    private const string NoPg = "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.";
    private readonly PostgresFixture _pg;
    public CaregiverFormPostgresTests(PostgresFixture pg) => _pg = pg;

    private async Task<(CaregiverController Controller, OdipDbContext Db, string Raw, Guid SubmissionId)> OpenAsync()
    {
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        var raw = CaregiverTokenService.GenerateRawToken();
        var submissionId = Guid.NewGuid();
        await using (seed)
        {
            var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            seed.Participants.Add(p);
            seed.CaregiverProfileSubmissions.Add(new CaregiverProfileSubmission
            {
                Id = submissionId, TenantId = tenantId, ParticipantId = p.Id, TokenHash = CaregiverTokenService.Hash(raw),
                Status = CaregiverSubmissionStatus.Draft, CreatedByUserId = Guid.NewGuid(), ExpiresAt = DateTime.UtcNow.AddDays(14),
            });
            await seed.SaveChangesAsync();
        }

        var http = new DefaultHttpContext();
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(http);
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString)
            .AddInterceptors(new AuditInterceptor(accessor.Object)).Options, tenant.Object);
        return (new CaregiverController(db, accessor.Object) { ControllerContext = new ControllerContext { HttpContext = http } }, db, raw, submissionId);
    }

    [SkippableTheory]
    [InlineData(200)]
    [InlineData(151)]
    public async Task SaveDraft_LongName_Returns400NotA500(int nameLength)
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (controller, db, raw, id) = await OpenAsync();
        await using var _ = db;
        var result = await controller.SaveDraft(raw, new CaregiverDraftDto { CaregiverName = new string('a', nameLength), Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Null((await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(s => s.Id == id)).CaregiverName);
    }

    [SkippableFact]
    public async Task SaveDraft_NameAtTheLimit_Saves()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (controller, db, raw, id) = await OpenAsync();
        await using var _ = db;
        var result = await controller.SaveDraft(raw, new CaregiverDraftDto { CaregiverName = new string('a', 150), CaregiverRelationship = new string('b', 100), Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        Assert.Equal(150, (await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(s => s.Id == id)).CaregiverName!.Length);
    }
}
