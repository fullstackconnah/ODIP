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

        // Not IncidentType.Injury — that requires >=1 Injuries row (IN-5) and this test only
        // cares about non-RP incidents leaving the RP fields null.
        var dto = CreateDto(reporter.Id, incidentType: IncidentType.PropertyDamage, rpType: null, involvedParticipantId: participant.Id);
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

    // ── IN-5: injuries ────────────────────────────────────────────────────

    [Fact]
    public async Task Create_InjuryIncidentWithZeroRows_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, incidentType: IncidentType.Injury, rpType: null);

        var result = await controller.Create(dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("at least one injury", StringComparison.OrdinalIgnoreCase));
        Assert.Empty(await db.IncidentReports.ToListAsync());
    }

    [Fact]
    public async Task Create_NonInjuryIncidentWithNoInjuries_IsValid()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var controller = new IncidentsController(db);

        // Default IncidentType from CreateDto is RestrictivePracticeUse, unrelated to injuries —
        // an incident with an empty Injuries list must not be blocked when it isn't an Injury.
        var dto = CreateDto(reporter.Id, involvedParticipantId: null, rpType: RestrictivePracticeType.Seclusion);

        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.Empty(await db.IncidentInjuries.Where(x => x.IncidentReportId == saved.Id).ToListAsync());
    }

    [Fact]
    public async Task Create_InjuryIncidentWithRows_PersistsAndRoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, incidentType: IncidentType.Injury, rpType: null) with
        {
            Injuries = new List<CreateIncidentInjuryDto>
            {
                new() { Region = BodyRegion.LeftForearm, InjuryType = InjuryType.Laceration, Description = "Cut from broken glass." },
                new() { Region = BodyRegion.RightAnkle, InjuryType = InjuryType.SprainOrStrain, Description = "Twisted stepping off the bus." },
            }
        };

        var createResult = await controller.Create(dto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(createResult.Result);
        var incidentId = (await db.IncidentReports.SingleAsync()).Id;

        var getResult = await controller.GetById(incidentId, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<IncidentDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Equal(2, body.Data!.Injuries.Count);
        Assert.Contains(body.Data.Injuries, i => i.Region == BodyRegion.LeftForearm && i.InjuryType == InjuryType.Laceration && i.Description == "Cut from broken glass.");
        Assert.Contains(body.Data.Injuries, i => i.Region == BodyRegion.RightAnkle && i.InjuryType == InjuryType.SprainOrStrain && i.Description == "Twisted stepping off the bus.");
    }

    [Fact]
    public async Task Update_RemovingOneInjuryRow_ResultsInExactlyRemainingRowsPersisted()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var controller = new IncidentsController(db);

        var createDto = CreateDto(reporter.Id, incidentType: IncidentType.Injury, rpType: null) with
        {
            Injuries = new List<CreateIncidentInjuryDto>
            {
                new() { Region = BodyRegion.Head, InjuryType = InjuryType.Bruise, Description = "Bumped head on doorway." },
                new() { Region = BodyRegion.LeftHand, InjuryType = InjuryType.Abrasion, Description = "Grazed hand on wall." },
                new() { Region = BodyRegion.RightKnee, InjuryType = InjuryType.Swelling, Description = "Knee swelled after fall." },
            }
        };
        await controller.Create(createDto, CancellationToken.None);
        var incident = await db.IncidentReports.SingleAsync();

        // Full-replace with only 2 of the original 3 rows — mirrors the wizard's "the form owns
        // the full list, always sends the full list" contract.
        var updateDto = new UpdateIncidentDto
        {
            ReportedByStaffId = reporter.Id,
            IncidentType = IncidentType.Injury,
            Severity = IncidentSeverity.Medium,
            Title = "Updated title",
            Description = "Updated description.",
            IncidentDateTime = new DateTime(2026, 8, 30, 11, 0, 0, DateTimeKind.Utc),
            Status = IncidentStatus.Draft,
            QscReportingStatus = QscReportingStatus.NotRequired,
            FamilyNotified = false,
            SupportCoordinatorNotified = false,
            Injuries = new List<CreateIncidentInjuryDto>
            {
                new() { Region = BodyRegion.Head, InjuryType = InjuryType.Bruise, Description = "Bumped head on doorway." },
                new() { Region = BodyRegion.RightKnee, InjuryType = InjuryType.Swelling, Description = "Knee swelled after fall." },
            }
        };

        var updateResult = await controller.Update(incident.Id, updateDto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updateResult.Result);
        var remaining = await db.IncidentInjuries.Where(x => x.IncidentReportId == incident.Id).ToListAsync();
        Assert.Equal(2, remaining.Count);
        Assert.Contains(remaining, x => x.Region == BodyRegion.Head);
        Assert.Contains(remaining, x => x.Region == BodyRegion.RightKnee);
        Assert.DoesNotContain(remaining, x => x.Region == BodyRegion.LeftHand);
    }

    [Fact]
    public async Task Update_InjuryIncidentToZeroRows_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var controller = new IncidentsController(db);

        var createDto = CreateDto(reporter.Id, incidentType: IncidentType.Injury, rpType: null) with
        {
            Injuries = new List<CreateIncidentInjuryDto>
            {
                new() { Region = BodyRegion.Head, InjuryType = InjuryType.Bruise, Description = "Bumped head." },
            }
        };
        await controller.Create(createDto, CancellationToken.None);
        var incident = await db.IncidentReports.SingleAsync();

        var updateDto = new UpdateIncidentDto
        {
            ReportedByStaffId = reporter.Id,
            IncidentType = IncidentType.Injury,
            Severity = IncidentSeverity.Medium,
            Title = "Updated title",
            Description = "Updated description.",
            IncidentDateTime = new DateTime(2026, 8, 30, 11, 0, 0, DateTimeKind.Utc),
            Status = IncidentStatus.Draft,
            QscReportingStatus = QscReportingStatus.NotRequired,
            FamilyNotified = false,
            SupportCoordinatorNotified = false,
            Injuries = new List<CreateIncidentInjuryDto>(),
        };

        var updateResult = await controller.Update(incident.Id, updateDto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("at least one injury", StringComparison.OrdinalIgnoreCase));
        // Original row must survive an update that was rejected before SaveChangesAsync.
        Assert.Single(await db.IncidentInjuries.Where(x => x.IncidentReportId == incident.Id).ToListAsync());
    }

    // ── IN-4: unapproved restrictive practice details — the register must NEVER be touched ────

    /// <summary>
    /// THE critical rule: recording an unapproved restrictive practice on an incident must never
    /// insert a row into the participant's RestrictivePractices register — there is no code path
    /// anywhere (Create or Update) that does so. This asserts both halves: the incident itself
    /// persists the free text with RestrictivePracticeId left null, AND the participant's
    /// register table is untouched (still exactly whatever it was seeded with, here: empty).
    /// </summary>
    [Fact]
    public async Task Create_UnapprovedRestrictivePracticeDetails_PersistsOnIncident_AndNeverCreatesRegisterEntry()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participant.Id) with
        {
            RestrictivePracticeId = null,
            UnapprovedRestrictivePracticeDetails = "Staff improvised a locked-room seclusion that isn't on the register.",
        };

        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal("Staff improvised a locked-room seclusion that isn't on the register.", saved.UnapprovedRestrictivePracticeDetails);
        Assert.Null(saved.RestrictivePracticeId);
        // THE assertion: the participant's register itself was never written to.
        Assert.Empty(await db.RestrictivePractices.Where(rp => rp.ParticipantId == participant.Id).ToListAsync());
    }

    [Fact]
    public async Task Create_BlankUnapprovedRestrictivePracticeDetails_IsTrimmedToNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, incidentType: IncidentType.PropertyDamage, rpType: null) with
        {
            UnapprovedRestrictivePracticeDetails = "   ",
        };

        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.Null(saved.UnapprovedRestrictivePracticeDetails);
    }

    [Fact]
    public async Task Create_BothRestrictivePracticeIdAndUnapprovedDetailsSet_ReturnsBadRequest_AndNeverCreatesRegisterEntry()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        var practice = SeedPractice(db, participant.Id, type: RestrictivePracticeType.Seclusion);
        var controller = new IncidentsController(db);

        // Simulates a modified/malicious client bypassing the frontend's own mutual-exclusivity
        // enforcement — both fields set at once is an incoherent state that must be rejected
        // server-side regardless of what the wizard's own client-side rule would have prevented.
        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participant.Id, restrictivePracticeId: practice.Id) with
        {
            UnapprovedRestrictivePracticeDetails = "Also describing an unapproved use at the same time.",
        };

        var result = await controller.Create(dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("cannot both link", StringComparison.OrdinalIgnoreCase));
        Assert.Empty(await db.IncidentReports.ToListAsync());
        // No incident was created at all, so the register obviously wasn't touched either — but
        // assert it explicitly since that's the property under test in this file.
        Assert.Single(await db.RestrictivePractices.Where(rp => rp.ParticipantId == participant.Id).ToListAsync());
    }

    [Fact]
    public async Task Update_BothRestrictivePracticeIdAndUnapprovedDetailsSet_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        var practice = SeedPractice(db, participant.Id, type: RestrictivePracticeType.Seclusion);
        var controller = new IncidentsController(db);

        var createDto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participant.Id);
        await controller.Create(createDto, CancellationToken.None);
        var incident = await db.IncidentReports.SingleAsync();

        var updateDto = new UpdateIncidentDto
        {
            ReportedByStaffId = reporter.Id,
            IncidentType = IncidentType.RestrictivePracticeUse,
            RestrictivePracticeType = RestrictivePracticeType.Seclusion,
            RestrictivePracticeId = practice.Id,
            UnapprovedRestrictivePracticeDetails = "Also set on update — incoherent.",
            InvolvedParticipantId = participant.Id,
            Severity = IncidentSeverity.Medium,
            Title = "Updated title",
            Description = "Updated description.",
            IncidentDateTime = new DateTime(2026, 8, 30, 11, 0, 0, DateTimeKind.Utc),
            Status = IncidentStatus.Draft,
            QscReportingStatus = QscReportingStatus.Required,
            FamilyNotified = false,
            SupportCoordinatorNotified = false,
        };

        var updateResult = await controller.Update(incident.Id, updateDto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("cannot both link", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GetById_IncludesUnapprovedRestrictivePracticeDetails()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var participant = SeedParticipant(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, rpType: RestrictivePracticeType.Seclusion, involvedParticipantId: participant.Id) with
        {
            RestrictivePracticeId = null,
            UnapprovedRestrictivePracticeDetails = "An unregistered practice was used.",
        };
        await controller.Create(dto, CancellationToken.None);
        var incidentId = (await db.IncidentReports.SingleAsync()).Id;

        var result = await controller.GetById(incidentId, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<IncidentDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("An unregistered practice was used.", body.Data!.UnapprovedRestrictivePracticeDetails);
        Assert.Null(body.Data.RestrictivePracticeId);
    }

    // ── IN-7: witnesses ──────────────────────────────────────────────────────

    [Fact]
    public async Task Create_WithStaffAndExternalWitnesses_PersistsAllWithCorrectStatuses()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var witness1 = SeedUser(db, firstName: "Priya", lastName: "Nair");
        var witness2 = SeedUser(db, firstName: "Tom", lastName: "Baker");
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, incidentType: IncidentType.PropertyDamage, rpType: null) with
        {
            Witnesses = new List<CreateIncidentWitnessDto>
            {
                new() { WitnessUserId = witness1.Id, WitnessName = witness1.FullName },
                new() { WitnessUserId = witness2.Id, WitnessName = witness2.FullName },
                new() { WitnessUserId = null, WitnessName = "Jamie Passerby" },
            },
        };

        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var incident = await db.IncidentReports.SingleAsync();
        var witnesses = await db.IncidentWitnesses.Where(w => w.IncidentReportId == incident.Id).ToListAsync();
        Assert.Equal(3, witnesses.Count);
        Assert.Equal(2, witnesses.Count(w => w.WitnessStatus == WitnessStatus.Pending && w.WitnessUserId != null));
        var external = Assert.Single(witnesses, w => w.WitnessUserId == null);
        Assert.Equal(WitnessStatus.NotRequired, external.WitnessStatus);
        Assert.Equal("Jamie Passerby", external.WitnessName);
        Assert.All(witnesses.Where(w => w.WitnessUserId != null), w => Assert.NotNull(w.WitnessRequestedAt));
    }

    [Fact]
    public async Task Create_WitnessUserIdEqualsReporter_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, incidentType: IncidentType.PropertyDamage, rpType: null) with
        {
            Witnesses = new List<CreateIncidentWitnessDto> { new() { WitnessUserId = reporter.Id, WitnessName = reporter.FullName } },
        };

        var result = await controller.Create(dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("witness their own", StringComparison.OrdinalIgnoreCase));
        Assert.Empty(await db.IncidentReports.ToListAsync());
    }

    [Fact]
    public async Task Create_WitnessUserIdNotFound_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, incidentType: IncidentType.PropertyDamage, rpType: null) with
        {
            Witnesses = new List<CreateIncidentWitnessDto> { new() { WitnessUserId = Guid.NewGuid(), WitnessName = "Ghost" } },
        };

        var result = await controller.Create(dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<IncidentListDto>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("not found", StringComparison.OrdinalIgnoreCase));
        Assert.Empty(await db.IncidentReports.ToListAsync());
    }

    [Fact]
    public async Task GetById_IncludesWitnesses()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var witness = SeedUser(db, firstName: "Priya", lastName: "Nair");
        var controller = new IncidentsController(db);

        var dto = CreateDto(reporter.Id, incidentType: IncidentType.PropertyDamage, rpType: null) with
        {
            Witnesses = new List<CreateIncidentWitnessDto>
            {
                new() { WitnessUserId = witness.Id, WitnessName = witness.FullName },
                new() { WitnessUserId = null, WitnessName = "Jamie Passerby" },
            },
        };
        await controller.Create(dto, CancellationToken.None);
        var incidentId = (await db.IncidentReports.SingleAsync()).Id;

        var result = await controller.GetById(incidentId, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<IncidentDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(2, body.Data!.Witnesses.Count);
        Assert.Contains(body.Data.Witnesses, w => w.IsStaffWitness && w.WitnessUserId == witness.Id && w.WitnessStatus == WitnessStatus.Pending);
        Assert.Contains(body.Data.Witnesses, w => !w.IsStaffWitness && w.WitnessName == "Jamie Passerby" && w.WitnessStatus == WitnessStatus.NotRequired);
    }

    /// <summary>
    /// THE critical regression this step must never reintroduce: resubmitting the full witnesses
    /// list on Update (the wizard's "form owns the full list" contract) must not reset a witness
    /// who has already Approved/Declined back to Pending.
    /// </summary>
    [Fact]
    public async Task Update_ResubmitWithoutChangingApprovedWitness_PreservesApprovedStatus()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var witness = SeedUser(db, firstName: "Priya", lastName: "Nair");
        var controller = new IncidentsController(db);

        var createDto = CreateDto(reporter.Id, incidentType: IncidentType.PropertyDamage, rpType: null) with
        {
            Witnesses = new List<CreateIncidentWitnessDto> { new() { WitnessUserId = witness.Id, WitnessName = witness.FullName } },
        };
        await controller.Create(createDto, CancellationToken.None);
        var incident = await db.IncidentReports.SingleAsync();
        var witnessRow = await db.IncidentWitnesses.SingleAsync(w => w.IncidentReportId == incident.Id);

        // Simulate the witness already approving via the portal before the reporter edits/resaves.
        witnessRow.WitnessStatus = WitnessStatus.Approved;
        witnessRow.WitnessRespondedAt = DateTime.UtcNow;
        witnessRow.StatementText = "I saw the whole thing.";
        await db.SaveChangesAsync();

        // Reporter edits the incident and resubmits the SAME witness (echoing its persisted id) —
        // must not reset the approval.
        var updateDto = new UpdateIncidentDto
        {
            ReportedByStaffId = reporter.Id,
            IncidentType = IncidentType.PropertyDamage,
            Severity = IncidentSeverity.Medium,
            Title = "Updated title",
            Description = "Updated description.",
            IncidentDateTime = new DateTime(2026, 8, 30, 11, 0, 0, DateTimeKind.Utc),
            Status = IncidentStatus.Draft,
            QscReportingStatus = QscReportingStatus.NotRequired,
            FamilyNotified = false,
            SupportCoordinatorNotified = false,
            Witnesses = new List<CreateIncidentWitnessDto>
            {
                new() { Id = witnessRow.Id, WitnessUserId = witness.Id, WitnessName = witness.FullName },
            },
        };

        var updateResult = await controller.Update(incident.Id, updateDto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updateResult.Result);
        var reloaded = await db.IncidentWitnesses.SingleAsync(w => w.Id == witnessRow.Id);
        Assert.Equal(WitnessStatus.Approved, reloaded.WitnessStatus);
        Assert.NotNull(reloaded.WitnessRespondedAt);
        Assert.Equal("I saw the whole thing.", reloaded.StatementText);
    }

    [Fact]
    public async Task Update_DroppingAWitnessRowFromTheSubmittedList_DeletesIt()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var witness1 = SeedUser(db, firstName: "Priya", lastName: "Nair");
        var witness2 = SeedUser(db, firstName: "Tom", lastName: "Baker");
        var controller = new IncidentsController(db);

        var createDto = CreateDto(reporter.Id, incidentType: IncidentType.PropertyDamage, rpType: null) with
        {
            Witnesses = new List<CreateIncidentWitnessDto>
            {
                new() { WitnessUserId = witness1.Id, WitnessName = witness1.FullName },
                new() { WitnessUserId = witness2.Id, WitnessName = witness2.FullName },
            },
        };
        await controller.Create(createDto, CancellationToken.None);
        var incident = await db.IncidentReports.SingleAsync();
        var keep = await db.IncidentWitnesses.SingleAsync(w => w.WitnessUserId == witness1.Id);

        var updateDto = new UpdateIncidentDto
        {
            ReportedByStaffId = reporter.Id,
            IncidentType = IncidentType.PropertyDamage,
            Severity = IncidentSeverity.Medium,
            Title = "Updated title",
            Description = "Updated description.",
            IncidentDateTime = new DateTime(2026, 8, 30, 11, 0, 0, DateTimeKind.Utc),
            Status = IncidentStatus.Draft,
            QscReportingStatus = QscReportingStatus.NotRequired,
            FamilyNotified = false,
            SupportCoordinatorNotified = false,
            // witness2 dropped entirely.
            Witnesses = new List<CreateIncidentWitnessDto> { new() { Id = keep.Id, WitnessUserId = witness1.Id, WitnessName = witness1.FullName } },
        };

        var updateResult = await controller.Update(incident.Id, updateDto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updateResult.Result);
        var remaining = await db.IncidentWitnesses.Where(w => w.IncidentReportId == incident.Id).ToListAsync();
        var only = Assert.Single(remaining);
        Assert.Equal(witness1.Id, only.WitnessUserId);
    }

    [Fact]
    public async Task Update_AddingANewWitnessRowWithNoId_InsertsFreshAsPending()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var reporter = SeedUser(db);
        var witness1 = SeedUser(db, firstName: "Priya", lastName: "Nair");
        var witness2 = SeedUser(db, firstName: "Tom", lastName: "Baker");
        var controller = new IncidentsController(db);

        var createDto = CreateDto(reporter.Id, incidentType: IncidentType.PropertyDamage, rpType: null) with
        {
            Witnesses = new List<CreateIncidentWitnessDto> { new() { WitnessUserId = witness1.Id, WitnessName = witness1.FullName } },
        };
        await controller.Create(createDto, CancellationToken.None);
        var incident = await db.IncidentReports.SingleAsync();
        var existing = await db.IncidentWitnesses.SingleAsync();

        var updateDto = new UpdateIncidentDto
        {
            ReportedByStaffId = reporter.Id,
            IncidentType = IncidentType.PropertyDamage,
            Severity = IncidentSeverity.Medium,
            Title = "Updated title",
            Description = "Updated description.",
            IncidentDateTime = new DateTime(2026, 8, 30, 11, 0, 0, DateTimeKind.Utc),
            Status = IncidentStatus.Draft,
            QscReportingStatus = QscReportingStatus.NotRequired,
            FamilyNotified = false,
            SupportCoordinatorNotified = false,
            Witnesses = new List<CreateIncidentWitnessDto>
            {
                new() { Id = existing.Id, WitnessUserId = witness1.Id, WitnessName = witness1.FullName },
                new() { WitnessUserId = witness2.Id, WitnessName = witness2.FullName }, // no Id — newly added
            },
        };

        var updateResult = await controller.Update(incident.Id, updateDto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updateResult.Result);
        var all = await db.IncidentWitnesses.Where(w => w.IncidentReportId == incident.Id).ToListAsync();
        Assert.Equal(2, all.Count);
        var added = Assert.Single(all, w => w.WitnessUserId == witness2.Id);
        Assert.Equal(WitnessStatus.Pending, added.WitnessStatus);
        Assert.NotNull(added.WitnessRequestedAt);
    }
}
