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
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Caregiver;

/// <summary>Accept and Reject on one Submitted form (H81-2, H11-3): the status change is a compare-and-set, so the loser gets 409 and changes nothing. Each staff member's context loaded the form before the other acted, as two tabs do.</summary>
public class CaregiverSubmissionRacePostgresTests : IClassFixture<PostgresFixture>
{
    private const string NoPg = "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.";
    private const string Phone = "0400 000 000";
    private const string Handled = "This form was already handled by someone else. Refresh to see it.";
    private readonly PostgresFixture _pg;
    public CaregiverSubmissionRacePostgresTests(PostgresFixture pg) => _pg = pg;

    private async Task<(Guid TenantId, Guid ParticipantId, Guid SubmissionId)> SeedSubmittedAsync()
    {
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        await using (seed)
        {
            var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            var payload = new PatchParticipantDto { PersonalDetails = new PatchPersonalDetailsDto { FirstName = "Sophie", LastName = "Brown", Phone = Phone } };
            var s = new CaregiverProfileSubmission
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, TokenHash = CaregiverTokenService.Hash(CaregiverTokenService.GenerateRawToken()),
                Status = CaregiverSubmissionStatus.Submitted, CreatedByUserId = Guid.NewGuid(), CaregiverName = "Jane Smith",
                ExpiresAt = DateTime.UtcNow.AddDays(14), SubmittedAt = DateTime.UtcNow,
                Payload = JsonSerializer.Serialize(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            };
            seed.Participants.Add(p);
            seed.CaregiverProfileSubmissions.Add(s);
            await seed.SaveChangesAsync();
            return (tenantId, p.Id, s.Id);
        }
    }

    /// <summary>A staff member's controller whose context has already loaded the form as Submitted (a tracked row is not refreshed by the controller's own query).</summary>
    private async Task<(CaregiverSubmissionsController Controller, OdipDbContext Db)> StaffWhoSawItAsync(Guid tenantId, Guid submissionId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = PostgresFixture.NewContext(_pg.ConnectionString, tenant.Object);
        await db.CaregiverProfileSubmissions.SingleAsync(s => s.Id == submissionId);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test");
        var controller = new CaregiverSubmissionsController(db, tenant.Object, new SafetyNoteSyncService(db), new StaffCompatibilityLinkService(db), new ConfigurationBuilder().Build())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } }
        };
        return (controller, db);
    }

    private static string Sentence(IActionResult result) =>
        Assert.IsType<ApiResponse<object>>(Assert.IsType<ConflictObjectResult>(result).Value).Errors!.Single();

    private async Task<(CaregiverSubmissionStatus Status, string? Phone)> ReadAsync(Guid participantId, Guid submissionId)
    {
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        var s = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == submissionId);
        var p = await db.Participants.IgnoreQueryFilters().SingleAsync(x => x.Id == participantId);
        return (s.Status, p.Phone);
    }

    [SkippableFact]
    public async Task AcceptThenReject_TheRejectGets409_TheFormStaysAcceptedAndTheParticipantIsChanged()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, participantId, id) = await SeedSubmittedAsync();
        var (accept, db1) = await StaffWhoSawItAsync(tenantId, id);
        var (reject, db2) = await StaffWhoSawItAsync(tenantId, id);
        await using var _1 = db1;
        await using var _2 = db2;

        Assert.IsType<NoContentResult>(await accept.Accept(id, CancellationToken.None));
        Assert.Equal(Handled, Sentence(await reject.Reject(id, new RejectCaregiverSubmissionDto { Note = "Please fix." }, CancellationToken.None)));

        var (status, phone) = await ReadAsync(participantId, id);
        Assert.Equal(CaregiverSubmissionStatus.Accepted, status);
        Assert.Equal(Phone, phone);
    }

    [SkippableFact]
    public async Task RejectThenAccept_TheAcceptGets409_TheFormStaysDraftAndTheParticipantIsUnchanged()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, participantId, id) = await SeedSubmittedAsync();
        var (reject, db1) = await StaffWhoSawItAsync(tenantId, id);
        var (accept, db2) = await StaffWhoSawItAsync(tenantId, id);
        await using var _1 = db1;
        await using var _2 = db2;

        Assert.IsType<NoContentResult>(await reject.Reject(id, new RejectCaregiverSubmissionDto { Note = "Please fix." }, CancellationToken.None));
        Assert.Equal(Handled, Sentence(await accept.Accept(id, CancellationToken.None)));

        var (status, phone) = await ReadAsync(participantId, id);
        Assert.Equal(CaregiverSubmissionStatus.Draft, status);
        Assert.Null(phone);
    }

    [SkippableFact]
    public async Task TwoAccepts_OneGets409_TheParticipantIsChangedOnce()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, participantId, id) = await SeedSubmittedAsync();
        var (first, db1) = await StaffWhoSawItAsync(tenantId, id);
        var (second, db2) = await StaffWhoSawItAsync(tenantId, id);
        await using var _1 = db1;
        await using var _2 = db2;

        Assert.IsType<NoContentResult>(await first.Accept(id, CancellationToken.None));
        Assert.Equal(Handled, Sentence(await second.Accept(id, CancellationToken.None)));

        var (status, phone) = await ReadAsync(participantId, id);
        Assert.Equal(CaregiverSubmissionStatus.Accepted, status);
        Assert.Equal(Phone, phone);
    }
}
