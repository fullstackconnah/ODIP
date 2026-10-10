using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Security;

/// <summary>
/// SupportProfile, ParticipantBooking, IncidentReport and AuditLog have no organisation column and no query filter. A participant's support profile and bookings, an incident's
/// update and delete, and an entity's audit history are read or written by a bare id; each now starts from a tenant-filtered parent, and another organisation's row is "not found".
/// </summary>
public class CrossTenantParticipantIncidentTests
{
    private static ParticipantsController Participants(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

    private static SupportProfile PlantSupportProfile(OdipDbContext db, Participant participant)
    {
        var profile = new SupportProfile { Id = Guid.NewGuid(), ParticipantId = participant.Id, BehaviourSupportNotes = "private behaviour notes" };
        db.SupportProfiles.Add(profile);
        db.SaveChanges();
        return profile;
    }

    private static ParticipantBooking PlantBooking(OdipDbContext db, Guid tenantId, out Participant participant, out TripInstance trip)
    {
        participant = Participant(db, tenantId);
        trip = Trip(db, tenantId);
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) };
        db.ParticipantBookings.Add(booking);
        db.SaveChanges();
        return booking;
    }

    private static IncidentReport PlantIncident(OdipDbContext db, Guid tenantId, out User reporter)
    {
        reporter = User(db, tenantId);
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), ReportedByUserId = reporter.Id, IncidentType = IncidentType.Other, OtherTypeSpecify = "x", Severity = IncidentSeverity.Low,
            Status = IncidentStatus.Draft, Title = "Original", Description = "Original", IncidentDateTime = new DateTime(2026, 8, 30, 9, 0, 0, DateTimeKind.Utc),
        };
        db.IncidentReports.Add(incident);
        db.SaveChanges();
        return incident;
    }

    // ── participants/{id}/bookings and /support-profile ────────────────────────────────────────

    [Fact]
    public async Task ParticipantBookings_ParticipantOfAnotherTenant_ReturnsNotFound()
    {
        using var db = Db();
        PlantBooking(db, B, out var foreign, out _);

        var result = await Participants(db).GetBookings(foreign.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task ParticipantBookings_OwnParticipant_ReturnsTheirBookings()
    {
        using var db = Db();
        var booking = PlantBooking(db, A, out var own, out _);

        var result = await Participants(db).GetBookings(own.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<BookingListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(booking.Id, Assert.Single(body.Data!).Id);
    }

    [Fact]
    public async Task SupportProfileGet_ParticipantOfAnotherTenant_ReturnsNotFound()
    {
        using var db = Db();
        var foreign = Participant(db, B);
        PlantSupportProfile(db, foreign);

        var result = await Participants(db).GetSupportProfile(foreign.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task SupportProfilePut_ParticipantOfAnotherTenant_ReturnsNotFound_AndWritesNothing()
    {
        using var db = Db();
        var foreign = Participant(db, B);
        var existing = PlantSupportProfile(db, foreign);
        var withoutProfile = Participant(db, B);

        var overwrite = await Participants(db).UpdateSupportProfile(foreign.Id, new UpdateSupportProfileDto { BehaviourSupportNotes = "hijacked" }, CancellationToken.None);
        var create = await Participants(db).UpdateSupportProfile(withoutProfile.Id, new UpdateSupportProfileDto { BehaviourSupportNotes = "planted" }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(overwrite.Result);
        Assert.IsType<NotFoundObjectResult>(create.Result);
        Assert.Equal("private behaviour notes", (await db.SupportProfiles.AsNoTracking().SingleAsync(s => s.Id == existing.Id)).BehaviourSupportNotes);
        Assert.Single(await db.SupportProfiles.ToListAsync());
    }

    [Fact]
    public async Task SupportProfile_OwnParticipant_StillReadsAndWrites()
    {
        using var db = Db();
        var own = Participant(db, A);
        var controller = Participants(db);

        Assert.IsType<OkObjectResult>((await controller.UpdateSupportProfile(own.Id, new UpdateSupportProfileDto { BehaviourSupportNotes = "notes" }, CancellationToken.None)).Result);

        var body = Assert.IsType<ApiResponse<SupportProfileDto>>(Assert.IsType<OkObjectResult>((await controller.GetSupportProfile(own.Id, CancellationToken.None)).Result).Value);
        Assert.Equal("notes", body.Data!.BehaviourSupportNotes);
    }

    // ── incidents ──────────────────────────────────────────────────────────────────────────────

    private static UpdateIncidentDto IncidentUpdate(Guid reporterId, Guid? participantId = null, Guid? bookingId = null) => new()
    {
        ReportedByStaffId = reporterId, IncidentType = IncidentType.Other, OtherTypeSpecify = "x", Severity = IncidentSeverity.Low, Title = "Hijacked", Description = "Hijacked",
        IncidentDateTime = new DateTime(2026, 8, 30, 11, 0, 0, DateTimeKind.Utc), Status = IncidentStatus.Draft, InvolvedParticipantId = participantId, ParticipantBookingId = bookingId,
    };

    [Fact]
    public async Task IncidentUpdate_IncidentOfAnotherTenant_ReturnsNotFound_AndChangesNothing()
    {
        using var db = Db();
        var foreign = PlantIncident(db, B, out var foreignReporter);
        var ownReporter = User(db, A);

        var result = await new IncidentsController(db).Update(foreign.Id, IncidentUpdate(ownReporter.Id), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal(("Original", foreignReporter.Id), ((await db.IncidentReports.AsNoTracking().SingleAsync(i => i.Id == foreign.Id)) is var s ? (s.Title, s.ReportedByUserId) : default));
    }

    [Fact]
    public async Task IncidentDelete_IncidentOfAnotherTenant_ReturnsNotFound_AndArchivesNothing()
    {
        using var db = Db();
        var foreign = PlantIncident(db, B, out _);

        var result = await new IncidentsController(db).Delete(foreign.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal(IncidentStatus.Draft, (await db.IncidentReports.AsNoTracking().SingleAsync(i => i.Id == foreign.Id)).Status);
    }

    [Fact]
    public async Task IncidentReads_IncidentOfAnotherTenant_AreNotFoundOrEmpty()
    {
        using var db = Db();
        var foreign = PlantIncident(db, B, out _);
        var controller = new IncidentsController(db);

        Assert.IsType<NotFoundObjectResult>((await controller.GetById(foreign.Id, CancellationToken.None)).Result);
        var all = Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetAll(null, null, null, null, null, null, null, null, 1, 50, CancellationToken.None)).Result).Value);
        Assert.Empty(all.Data!.Items);
    }

    [Fact]
    public async Task IncidentUpdateAndCreate_ParticipantOrBookingOfAnotherTenant_AreRefused()
    {
        using var db = Db();
        var own = PlantIncident(db, A, out var reporter);
        var foreignBooking = PlantBooking(db, B, out var foreignParticipant, out _);
        var controller = new IncidentsController(db);

        var withParticipant = await controller.Update(own.Id, IncidentUpdate(reporter.Id, participantId: foreignParticipant.Id), CancellationToken.None);
        var withBooking = await controller.Update(own.Id, IncidentUpdate(reporter.Id, bookingId: foreignBooking.Id), CancellationToken.None);
        var created = await controller.Create(new CreateIncidentDto
        {
            ReportedByStaffId = reporter.Id, IncidentType = IncidentType.Other, OtherTypeSpecify = "x", Severity = IncidentSeverity.Low, Title = "t", Description = "d",
            IncidentDateTime = new DateTime(2026, 8, 30, 11, 0, 0, DateTimeKind.Utc), InvolvedParticipantId = foreignParticipant.Id,
        }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(withParticipant.Result);
        Assert.IsType<BadRequestObjectResult>(withBooking.Result);
        Assert.IsType<BadRequestObjectResult>(created.Result);
        Assert.Single(await db.IncidentReports.ToListAsync());
    }

    [Fact]
    public async Task Incident_OwnRows_StillUpdateAndArchive()
    {
        using var db = Db();
        var own = PlantIncident(db, A, out var reporter);
        var participant = Participant(db, A);
        var controller = new IncidentsController(db);

        Assert.IsType<OkObjectResult>((await controller.Update(own.Id, IncidentUpdate(reporter.Id, participantId: participant.Id), CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.Delete(own.Id, CancellationToken.None)).Result);
        Assert.Equal(IncidentStatus.Closed, (await db.IncidentReports.AsNoTracking().SingleAsync(i => i.Id == own.Id)).Status);
    }

    // ── audit/{entityType}/{entityId} ──────────────────────────────────────────────────────────

    private static Guid PlantAuditedEntity(OdipDbContext db, string entityType, Guid tenantId)
    {
        Guid id;
        switch (entityType)
        {
            case "TripInstance": id = Trip(db, tenantId).Id; break;
            case "Participant": id = Participant(db, tenantId).Id; break;
            case "ParticipantBooking": id = PlantBooking(db, tenantId, out _, out _).Id; break;
            case "IncidentReport": id = PlantIncident(db, tenantId, out _).Id; break;
            case "Staff": id = User(db, tenantId).Id; break;
            case "StaffAssignment":
                var trip = Trip(db, tenantId);
                var assignment = new StaffAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = User(db, tenantId).Id };
                db.StaffAssignments.Add(assignment);
                id = assignment.Id;
                break;
            case "VehicleAssignment":
                var assignedTrip = Trip(db, tenantId);
                var vehicleAssignment = new VehicleAssignment { Id = Guid.NewGuid(), TripInstanceId = assignedTrip.Id, VehicleId = Vehicle(db, tenantId).Id };
                db.VehicleAssignments.Add(vehicleAssignment);
                id = vehicleAssignment.Id;
                break;
            case "ParticipantNote":
                var note = new ParticipantNote { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = Participant(db, tenantId).Id, Title = "n", Description = "d", CreatedByName = "x" };
                db.ParticipantNotes.Add(note);
                id = note.Id;
                break;
            default: throw new ArgumentOutOfRangeException(nameof(entityType));
        }
        db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = entityType, EntityId = id, Action = AuditAction.Updated, ChangedAt = DateTimeOffset.UtcNow, Changes = "[]" });
        db.SaveChanges();
        return id;
    }

    public static TheoryData<string> AuditedTypes => new()
    {
        "TripInstance", "Participant", "ParticipantBooking", "IncidentReport", "Staff", "StaffAssignment", "VehicleAssignment", "ParticipantNote",
    };

    [Theory]
    [MemberData(nameof(AuditedTypes))]
    public async Task AuditHistory_EntityOfAnotherTenant_ReturnsNotFound(string entityType)
    {
        using var db = Db();
        var foreignId = PlantAuditedEntity(db, entityType, B);

        var result = await new AuditController(db, NullLogger<AuditController>.Instance).GetAuditHistory(entityType, foreignId, ct: CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Theory]
    [MemberData(nameof(AuditedTypes))]
    public async Task AuditHistory_OwnEntity_StillReturnsItsEntries(string entityType)
    {
        using var db = Db();
        var ownId = PlantAuditedEntity(db, entityType, A);

        var result = await new AuditController(db, NullLogger<AuditController>.Instance).GetAuditHistory(entityType, ownId, ct: CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
    }
}
