using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>An incident edit deletes and re-adds its injuries and deletes an omitted witness with their statement, so those child rows must leave AuditLog rows.</summary>
public class IncidentChildAuditTests
{
    [Fact]
    public async Task Update_DroppingAWitnessWithAStatementAndReplacingAnInjury_AuditsTheChildRows()
    {
        var actorId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, actorId.ToString()), new Claim("fullName", "Jane Coordinator")], "Test");
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(new AuditInterceptor(accessor.Object)).Options;
        using var db = new OdipDbContext(options, tenant.Object);

        var reporter = new User
        {
            Id = Guid.NewGuid(), FirstName = "Alex", LastName = "Rivera", Username = "alex", Email = "alex@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        };
        db.Users.Add(reporter);
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), ReportedByUserId = reporter.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Medium,
            Title = "Incident title", Description = "What happened.", IncidentDateTime = new DateTime(2026, 8, 30, 10, 0, 0, DateTimeKind.Utc), Status = IncidentStatus.Draft,
        };
        db.IncidentReports.Add(incident);
        var injury = new IncidentInjury { Id = Guid.NewGuid(), IncidentReportId = incident.Id, Region = BodyRegion.Head, InjuryType = InjuryType.Bruise, Description = "Bump" };
        var witness = new IncidentWitness
        {
            Id = Guid.NewGuid(), IncidentReportId = incident.Id, WitnessName = "Priya Nair", WitnessStatus = WitnessStatus.Approved,
            WitnessRespondedAt = DateTime.UtcNow, StatementText = "I saw the whole thing.",
        };
        db.IncidentInjuries.Add(injury);
        db.IncidentWitnesses.Add(witness);
        await db.SaveChangesAsync();

        var result = await new IncidentsController(db).Update(incident.Id, new UpdateIncidentDto
        {
            ReportedByStaffId = reporter.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Medium,
            Title = "Incident title", Description = "What happened.", IncidentDateTime = incident.IncidentDateTime, Status = IncidentStatus.Draft,
            Injuries = [new CreateIncidentInjuryDto { Region = BodyRegion.LeftHand, InjuryType = InjuryType.Laceration, Description = "Graze" }],
        }, CancellationToken.None);

        Assert.IsType<Microsoft.AspNetCore.Mvc.OkObjectResult>(result.Result);
        var logs = await db.AuditLogs.ToListAsync();
        var removedWitness = Assert.Single(logs, l => l.EntityType == "IncidentWitness" && l.Action == AuditAction.Deleted);
        Assert.Equal(witness.Id, removedWitness.EntityId);
        Assert.Equal(actorId, removedWitness.ChangedById);
        Assert.Single(logs, l => l.EntityType == "IncidentInjury" && l.Action == AuditAction.Deleted && l.EntityId == injury.Id && l.ChangedById == actorId);
        Assert.Single(logs, l => l.EntityType == "IncidentInjury" && l.Action == AuditAction.Created && l.ChangedById == actorId);
        // The witness's statement is recorded in the Deleted row's changes (no property exclusion covers it).
        Assert.Contains("I saw the whole thing.", removedWitness.Changes);
    }
}
