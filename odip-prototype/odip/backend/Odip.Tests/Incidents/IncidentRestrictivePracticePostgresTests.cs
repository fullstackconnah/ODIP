using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>
/// The restrictive-practice side of an incident Create against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING). What EF
/// InMemory cannot show: that the determination's register read returns the entry Npgsql stores (a blank "Authorised by" still reads Not authorised),
/// and that the coordinator's "add it to the register" task saves beside the QSC task under the BookingTasks unique, filtered SourceKey index.
/// </summary>
public class IncidentRestrictivePracticePostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly PostgresFixture _pg;
    public IncidentRestrictivePracticePostgresTests(PostgresFixture pg) => _pg = pg;

    private static CreateIncidentDto Dto(Guid reporterId, Guid participantId) => new()
    {
        ReportedByStaffId = reporterId, IncidentType = IncidentType.RestrictivePracticeUse, RestrictivePracticeType = RestrictivePracticeType.PhysicalRestraint,
        InvolvedParticipantId = participantId, Severity = IncidentSeverity.Medium, Title = "Held at the kerb", Description = "What happened.",
        IncidentDateTime = new DateTime(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc),
    };

    [SkippableFact]
    public async Task NotAuthorisedLink_AndASupportWorkersNoneOfThese_OverNpgsql()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var reporter = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Support", Username = $"sam.{tenantId:N}", Email = $"sam@{tenantId:N}.example.com", Role = UserRole.SupportWorker, IsActive = true };
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var blankAuthoriser = new RestrictivePractice
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Type = RestrictivePracticeType.PhysicalRestraint,
            Description = "Hand-over-hand guidance", AuthorisedBy = "   ", AuthorisationDate = new DateOnly(2026, 9, 1), IsActive = true,
        };
        db.AddRange(reporter, participant, blankAuthoriser);
        await db.SaveChangesAsync(Ct);
        var controller = new IncidentsController(db)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "SupportWorker"), new Claim(ClaimTypes.NameIdentifier, reporter.Id.ToString())], "Test")) } },
        };

        Assert.IsType<OkObjectResult>((await controller.Create(Dto(reporter.Id, participant.Id) with { RestrictivePracticeId = blankAuthoriser.Id }, Ct)).Result);
        Assert.IsType<OkObjectResult>((await controller.Create(Dto(reporter.Id, participant.Id) with { UnapprovedRestrictivePracticeDetails = "Held both arms at the kerb." }, Ct)).Result);

        await using var check = PostgresFixture.NewContext(_pg.ConnectionString);
        var incidents = await check.IncidentReports.AsNoTracking().Where(i => i.InvolvedParticipantId == participant.Id).ToListAsync(Ct);
        Assert.Equal(2, incidents.Count);
        Assert.All(incidents, i => Assert.False(i.IsRestrictivePracticeAuthorised));
        var noneOfThese = incidents.Single(i => i.UnapprovedRestrictivePracticeDetails != null);
        var tasks = await check.BookingTasks.AsNoTracking().Where(t => t.IncidentReportId == noneOfThese.Id).OrderBy(t => t.TaskType).ToListAsync(Ct);
        Assert.Equal(new[] { TaskType.IncidentQscReport, TaskType.RestrictivePracticeRegisterAddition }, tasks.Select(t => t.TaskType));
        Assert.Equal("Add physical restraint to Sophie Brown's restrictive practice register", tasks[1].Title);
        Assert.Equal(tenantId, tasks[1].TenantId);
        Assert.Equal(1, await check.RestrictivePractices.CountAsync(rp => rp.ParticipantId == participant.Id, Ct));
    }
}
