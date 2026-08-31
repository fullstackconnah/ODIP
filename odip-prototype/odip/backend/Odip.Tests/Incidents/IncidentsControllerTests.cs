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
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>
/// Controller-level coverage for INC-04 (authorised-vs-unauthorised determination) and INC-05
/// (linking an incident to a register entry) on IncidentsController, using the same EF InMemory +
/// Moq&lt;ICurrentTenant&gt; pattern as RestrictivePracticesControllerTests.
/// </summary>
public class IncidentsControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    /// <summary>Tenant-scoped (non-SuperAdmin) context — mirrors RestrictivePracticesControllerTests.</summary>
    private static OdipDbContext CreateTenantScopedDb(string dbName, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static User SeedUser(OdipDbContext db, Guid? tenantId = null, string firstName = "Alex", string lastName = "Rivera")
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? Guid.NewGuid(), FirstName = firstName, LastName = lastName,
            Username = $"{firstName}.{lastName}".ToLowerInvariant(), Email = $"{firstName}.{lastName}@example.com".ToLowerInvariant(),
            IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static Participant SeedParticipant(OdipDbContext db, Guid? tenantId = null, string firstName = "Sophie", string lastName = "Brown")
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId ?? Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static RestrictivePractice SeedPractice(
        OdipDbContext db, Guid participantId, Guid? tenantId = null,
        RestrictivePracticeType type = RestrictivePracticeType.Seclusion, bool isActive = true, string description = "Seclusion room, acute crisis only.")
    {
        var practice = new RestrictivePractice
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? Guid.NewGuid(), ParticipantId = participantId,
            Type = type, Description = description, IsActive = isActive,
        };
        db.RestrictivePractices.Add(practice);
        db.SaveChanges();
        return practice;
    }

    private static CreateIncidentDto CreateDto(
        Guid reportedByStaffId, IncidentType incidentType = IncidentType.RestrictivePracticeUse,
        RestrictivePracticeType? rpType = RestrictivePracticeType.Seclusion, Guid? involvedParticipantId = null,
        Guid? restrictivePracticeId = null, IncidentSeverity severity = IncidentSeverity.Medium) => new()
    {
        ReportedByStaffId = reportedByStaffId,
        IncidentType = incidentType,
        RestrictivePracticeType = rpType,
        InvolvedParticipantId = involvedParticipantId,
        RestrictivePracticeId = restrictivePracticeId,
        Severity = severity,
        Title = "Incident title",
        Description = "What happened.",
        IncidentDateTime = new DateTime(2026, 8, 30, 10, 0, 0, DateTimeKind.Utc),
    };

    // ── INC-04: cross-field validation ──────────────────────────────────────

    [Fact]
    public async Task Create_RpIncidentMissingType_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, rpType: null);
        var result = await controller.Create(dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("restrictive practice type", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Create_NonRpIncident_LeavesRpFieldsNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, incidentType: IncidentType.Injury, rpType: null, involvedParticipantId: participant.Id);
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.Null(saved.RestrictivePracticeType);
        Assert.Null(saved.IsRestrictivePracticeAuthorised);
    }

    // ── INC-04: determination logic ─────────────────────────────────────────

    [Fact]
    public async Task Create_ActiveMatchingPractice_DeterminesAuthorised()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        SeedPractice(db, participant.Id, type: RestrictivePracticeType.Seclusion, isActive: true);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participant.Id);
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.True(saved.IsRestrictivePracticeAuthorised);
    }

    [Fact]
    public async Task Create_NoMatchingPracticeAtAll_DeterminesUnauthorisedAndForcesQscRequired()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        // participant has no register entries whatsoever
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participant.Id, severity: IncidentSeverity.Low);
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.False(saved.IsRestrictivePracticeAuthorised);
        Assert.Equal(QscReportingStatus.Required, saved.QscReportingStatus);
    }

    [Fact]
    public async Task Create_OnlyInactiveMatchingPractice_DeterminesUnauthorised()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        SeedPractice(db, participant.Id, type: RestrictivePracticeType.ChemicalRestraint, isActive: false);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.ChemicalRestraint, involvedParticipantId: participant.Id);
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.False(saved.IsRestrictivePracticeAuthorised);
    }

    [Fact]
    public async Task Create_MatchingPracticeOfDifferentType_DeterminesUnauthorised()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        SeedPractice(db, participant.Id, type: RestrictivePracticeType.PhysicalRestraint, isActive: true);
        var controller = new IncidentsController(db);

        // Reported type is Seclusion, but the participant's only active entry is PhysicalRestraint.
        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participant.Id);
        var result = await controller.Create(dto, CancellationToken.None);

        var saved = await db.IncidentReports.SingleAsync();
        Assert.False(saved.IsRestrictivePracticeAuthorised);
    }

    [Fact]
    public async Task Create_NoInvolvedParticipant_LeavesDeterminationNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: null);
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.Null(saved.IsRestrictivePracticeAuthorised);
    }

    [Fact]
    public async Task Create_TenantScoped_OtherTenantsActivePracticeIsInvisible_DeterminesUnauthorised()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        Guid participantId, reporterId;
        using (var seedDb = CreateDb(dbName))
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantA, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            var reporter = new User { Id = Guid.NewGuid(), TenantId = tenantA, FirstName = "Alex", LastName = "Rivera", Username = "alex.rivera", Email = "alex@example.com", IsActive = true };
            seedDb.Participants.Add(participant);
            seedDb.Users.Add(reporter);
            participantId = participant.Id;
            reporterId = reporter.Id;
            // Same participant id, but the active register entry belongs to a different tenant —
            // tenant A's context must never see it via the ambient query filter.
            seedDb.RestrictivePractices.Add(new RestrictivePractice
            {
                Id = Guid.NewGuid(), TenantId = tenantB, ParticipantId = participantId,
                Type = RestrictivePracticeType.Seclusion, Description = "Tenant B's entry", IsActive = true,
            });
            seedDb.SaveChanges();
        }

        using var scopedDb = CreateTenantScopedDb(dbName, tenantA);
        var controller = new IncidentsController(scopedDb);

        var dto = CreateDto(reporterId, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participantId);
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await scopedDb.IncidentReports.SingleAsync();
        Assert.False(saved.IsRestrictivePracticeAuthorised);
    }

    // ── INC-05: RestrictivePracticeId FK validation ─────────────────────────

    [Fact]
    public async Task Create_RestrictivePracticeIdNotFound_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, involvedParticipantId: participant.Id, restrictivePracticeId: Guid.NewGuid());
        var result = await controller.Create(dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("not found", StringComparison.OrdinalIgnoreCase));
        Assert.Empty(await db.IncidentReports.ToListAsync());
    }

    [Fact]
    public async Task Create_RestrictivePracticeIdBelongsToDifferentParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participantA = SeedParticipant(db, firstName: "Sophie", lastName: "Brown");
        var participantB = SeedParticipant(db, firstName: "Harrison", lastName: "Lee");
        var practiceForB = SeedPractice(db, participantB.Id, type: RestrictivePracticeType.Seclusion);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, involvedParticipantId: participantA.Id, restrictivePracticeId: practiceForB.Id);
        var result = await controller.Create(dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("does not belong", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Create_RestrictivePracticeIdTypeMismatch_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        var practice = SeedPractice(db, participant.Id, type: RestrictivePracticeType.PhysicalRestraint);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participant.Id, restrictivePracticeId: practice.Id);
        var result = await controller.Create(dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("does not match", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Create_ValidRestrictivePracticeIdLink_PersistsLinkAndDeterminesAuthorised()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        var practice = SeedPractice(db, participant.Id, type: RestrictivePracticeType.Seclusion);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participant.Id, restrictivePracticeId: practice.Id);
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal(practice.Id, saved.RestrictivePracticeId);
        Assert.True(saved.IsRestrictivePracticeAuthorised);
    }

    // ── GetById: RP fields surfaced ──────────────────────────────────────────

    [Fact]
    public async Task GetById_IncludesRestrictivePracticeFieldsAndLinkedEntryDetails()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        var practice = SeedPractice(db, participant.Id, type: RestrictivePracticeType.Seclusion, description: "Locked room during acute crisis.");
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participant.Id, restrictivePracticeId: practice.Id);
        await controller.Create(dto, CancellationToken.None);
        var createdId = (await db.IncidentReports.SingleAsync()).Id;

        var result = await controller.GetById(createdId, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<IncidentDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(RestrictivePracticeType.Seclusion, body.Data!.RestrictivePracticeType);
        Assert.Equal(practice.Id, body.Data.RestrictivePracticeId);
        Assert.Equal("Locked room during acute crisis.", body.Data.RestrictivePracticeDescription);
        Assert.True(body.Data.IsRestrictivePracticeAuthorised);
    }

    // ── Update: determination frozen at creation ─────────────────────────────

    [Fact]
    public async Task Update_ChangingParticipantAndType_DoesNotRecomputeDetermination()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participantWithPractice = SeedParticipant(db, firstName: "Sophie", lastName: "Brown");
        var participantWithoutPractice = SeedParticipant(db, firstName: "Harrison", lastName: "Lee");
        SeedPractice(db, participantWithPractice.Id, type: RestrictivePracticeType.Seclusion, isActive: true);
        var controller = new IncidentsController(db);

        // Created as Authorised (matching active entry for participantWithPractice/Seclusion).
        var createDto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participantWithPractice.Id);
        var created = await controller.Create(createDto, CancellationToken.None);
        var incidentId = (await db.IncidentReports.SingleAsync()).Id;
        Assert.True((await db.IncidentReports.SingleAsync()).IsRestrictivePracticeAuthorised);

        // Edit: swap to a participant/type combination that has NO matching active entry — if the
        // determination silently re-ran, it would flip to false (or null). It must not.
        var updateDto = new UpdateIncidentDto
        {
            ReportedByStaffId = reporter.Id,
            IncidentType = IncidentType.RestrictivePracticeUse,
            RestrictivePracticeType = RestrictivePracticeType.MechanicalRestraint,
            InvolvedParticipantId = participantWithoutPractice.Id,
            Severity = IncidentSeverity.Medium,
            Title = "Updated title",
            Description = "Updated description.",
            IncidentDateTime = new DateTime(2026, 8, 30, 11, 0, 0, DateTimeKind.Utc),
            Status = IncidentStatus.Draft,
            QscReportingStatus = QscReportingStatus.Required,
            FamilyNotified = false,
            SupportCoordinatorNotified = false,
        };

        var updateResult = await controller.Update(incidentId, updateDto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updateResult.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal(RestrictivePracticeType.MechanicalRestraint, saved.RestrictivePracticeType);
        Assert.Equal(participantWithoutPractice.Id, saved.InvolvedParticipantId);
        // Frozen: still true from creation, despite the new participant/type combination having
        // no matching active register entry.
        Assert.True(saved.IsRestrictivePracticeAuthorised);
    }
}
