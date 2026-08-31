using System.Security.Claims;
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
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Portal;

/// <summary>
/// Controller-level coverage for PortalController ("My Shifts") — the same EF InMemory +
/// Moq&lt;ICurrentTenant&gt; pattern as RosteringControllerTests/MedicationsControllerTests,
/// plus a ClaimsPrincipal set directly on ControllerContext.HttpContext.User (mirroring
/// RosteringAuditTests' approach), since PortalController resolves the caller's identity from
/// the JWT's NameIdentifier claim rather than from ICurrentTenant. Post staff/user unification a
/// staff member IS a User account directly — the "not linked" state from before the merge is only
/// reachable now when the caller's identity can't be resolved to any User row at all (no claim,
/// or a claim pointing at a user id that doesn't exist).
/// </summary>
public class PortalControllerTests
{
    private static readonly DateOnly ServiceDate = new(2026, 8, 24);

    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb(Guid? viewAsUserId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        tenant.Setup(t => t.ViewAsUserId).Returns(viewAsUserId);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    /// <summary>Builds a controller whose caller identity resolves to <paramref name="callerUserId"/> via the NameIdentifier claim.</summary>
    private static PortalController MakeController(OdipDbContext db, ICurrentTenant tenant, Guid callerUserId)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString())], "Test");
        return new PortalController(db, tenant)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }

    private static User SeedUser(OdipDbContext db, string firstName = "Ben", string lastName = "Turner", UserRole role = UserRole.SupportWorker)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = firstName, LastName = lastName, Role = role, IsActive = true
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static Participant SeedParticipant(OdipDbContext db, string firstName = "Amy", string lastName = "Ng")
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true, IsHighSupport = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static Shift SeedShift(OdipDbContext db, Guid participantId, Guid? staffId, DateOnly? serviceDate = null) =>
        SeedShiftInternal(db, participantId, staffId, serviceDate ?? ServiceDate);

    private static Shift SeedShiftInternal(OdipDbContext db, Guid participantId, Guid? staffId, DateOnly serviceDate)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, UserId = staffId, ServiceDate = serviceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published
        };
        db.Shifts.Add(shift);
        db.SaveChanges();
        return shift;
    }

    // ══════════════════════════════════════════════════════════════
    // NOT LINKED
    // ══════════════════════════════════════════════════════════════

    [Fact]
    public async Task GetMyShifts_CallerUserRowNotFound_ReturnsEmptyShiftList_Never500()
    {
        var (db, tenant) = CreateDb();
        // Caller identity resolves to a user id that was never seeded — mirrors the old
        // "unlinked" state, since every seeded User now IS its own staff identity. There is no
        // longer a separate "not linked" payload — this simply degrades to empty lists.
        var controller = MakeController(db, tenant.Object, Guid.NewGuid());

        var result = await controller.GetMyShifts(null, null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftsResponseDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Empty(body.Data!.Shifts);
        Assert.Empty(body.Data.TripAssignments);
    }

    [Fact]
    public async Task GetShiftDetail_CallerUserRowNotFound_Returns404NotLinked()
    {
        var (db, tenant) = CreateDb();
        var controller = MakeController(db, tenant.Object, Guid.NewGuid());

        var result = await controller.GetShiftDetail(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetMyShifts_UnresolvableCallerIdentity_ReturnsEmptyShiftList_Never500()
    {
        // No NameIdentifier claim at all (e.g. a malformed/unexpected token shape) — must still
        // degrade to empty lists rather than throwing.
        var (db, tenant) = CreateDb();
        var controller = new PortalController(db, tenant.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity()) }
            }
        };

        var result = await controller.GetMyShifts(null, null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftsResponseDto>>(ok.Value);
        Assert.Empty(body.Data!.Shifts);
    }

    // ══════════════════════════════════════════════════════════════
    // ISOLATION — own shifts only
    // ══════════════════════════════════════════════════════════════

    [Fact]
    public async Task GetMyShifts_ReturnsOnlyCallersOwnShifts()
    {
        var (db, tenant) = CreateDb();
        var myUser = SeedUser(db, "Ben", "Turner");
        var otherUser = SeedUser(db, "Cara", "Lee");
        var participant = SeedParticipant(db);
        var myShift = SeedShift(db, participant.Id, myUser.Id);
        SeedShift(db, participant.Id, otherUser.Id); // belongs to someone else — must not appear

        var controller = MakeController(db, tenant.Object, myUser.Id);

        var result = await controller.GetMyShifts(ServiceDate.AddDays(-1), ServiceDate.AddDays(1), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftsResponseDto>>(ok.Value);
        var shift = Assert.Single(body.Data!.Shifts);
        Assert.Equal(myShift.Id, shift.Id);
    }

    [Fact]
    public async Task GetMyShifts_ValidUserWithNoShifts_ReturnsEmptyListNotSpecialPayload()
    {
        // Post staff/user unification there is no "not linked" concept any more — a real,
        // resolvable user who simply has no shifts scheduled gets an ordinary empty list, the
        // same shape as every other result, not a distinguished empty-state payload.
        var (db, tenant) = CreateDb();
        var user = SeedUser(db, "No", "Shifts");
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.GetMyShifts(ServiceDate, ServiceDate, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftsResponseDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Empty(body.Data!.Shifts);
        Assert.Empty(body.Data.TripAssignments);
    }

    [Fact]
    public async Task GetShiftDetail_OwnShift_ReturnsFullDetail()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        participant.MobilityAidWheelchair = true;
        participant.EquipmentRequirements = "Hoist required for transfers";
        db.SaveChanges();

        db.ParticipantRoutines.Add(new ParticipantRoutine
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Morning routine",
            Description = "Gentle wake, warm drink", Category = RoutineCategory.PersonalCare,
            IsCritical = true, IsActive = true,
        });
        // INTAKE-09: one active, one retired — only the active one should surface (same
        // active-only scoping as routines/medications above).
        db.ParticipantRiskEntries.Add(new ParticipantRiskEntry
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, AtRiskParty = AtRiskParty.Staff,
            Description = "Risk of aggression towards staff.", MitigationNotes = "Two-person support.", IsActive = true,
        });
        db.ParticipantRiskEntries.Add(new ParticipantRiskEntry
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, AtRiskParty = AtRiskParty.Participant,
            Description = "Retired risk, no longer applicable.", IsActive = false,
        });
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", Form = MedicationForm.Tablet,
            Route = MedicationRoute.Oral, Type = MedicationType.Regular, TimesOfDay = "08:00,20:00",
            Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Assist,
        });
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Retired med", Form = MedicationForm.Tablet,
            Route = MedicationRoute.Oral, Type = MedicationType.Regular, TimesOfDay = "08:00",
            Status = MedicationStatus.Ceased, SupportLevel = MedicationSupportLevel.Assist,
        });
        db.SaveChanges();

        var shift = SeedShift(db, participant.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.GetShiftDetail(shift.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
        Assert.True(body.Success);
        var dto = body.Data!;
        Assert.Equal(shift.Id, dto.Id);
        Assert.Equal(participant.Id, dto.Participant.Id);
        Assert.True(dto.Participant.MobilityAidWheelchair);
        Assert.Equal("Hoist required for transfers", dto.Participant.EquipmentRequirements);
        var routine = Assert.Single(dto.Routines);
        Assert.Equal("Morning routine", routine.Title);
        var riskEntry = Assert.Single(dto.RiskEntries); // Retired risk entry excluded
        Assert.Equal(AtRiskParty.Staff, riskEntry.AtRiskParty);
        Assert.Equal("Risk of aggression towards staff.", riskEntry.Description);
        var med = Assert.Single(dto.Medications); // Ceased med excluded
        Assert.Equal("Paracetamol", med.Name);
    }

    [Fact]
    public async Task GetShiftDetail_ForeignShift_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var myUser = SeedUser(db, "Ben", "Turner");
        var otherUser = SeedUser(db, "Cara", "Lee");
        var participant = SeedParticipant(db);
        var foreignShift = SeedShift(db, participant.Id, otherUser.Id);

        var controller = MakeController(db, tenant.Object, myUser.Id);

        var result = await controller.GetShiftDetail(foreignShift.Id, CancellationToken.None);

        // 404, not 403 — must be indistinguishable from a nonexistent shift id.
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetShiftDetail_NonexistentShiftId_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.GetShiftDetail(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetShiftDetail_UnfilledShift_NotVisibleToAnyStaff()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var unfilledShift = SeedShift(db, participant.Id, staffId: null);

        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.GetShiftDetail(unfilledShift.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // ══════════════════════════════════════════════════════════════
    // VIEW-AS RESOLUTION
    // ══════════════════════════════════════════════════════════════

    [Fact]
    public async Task GetMyShifts_ViewAsUser_ResolvesViewedUsersShiftsNotCallers()
    {
        var (db, _) = CreateDb();

        var viewedUser = SeedUser(db, "Dana", "Reyes");
        var participant = SeedParticipant(db);
        var viewedShift = SeedShift(db, participant.Id, viewedUser.Id);

        var superAdminUser = SeedUser(db, "Super", "Admin", UserRole.SuperAdmin);

        // A tenant mock with ViewAsUserId pointing at the viewed user, paired with a controller
        // whose JWT identity is the SuperAdmin's own id — the resolution must prefer
        // ViewAsUserId over that JWT subject.
        var tenantWithViewAs = new Mock<ICurrentTenant>();
        tenantWithViewAs.Setup(t => t.TenantId).Returns((Guid?)null);
        tenantWithViewAs.Setup(t => t.IsSuperAdmin).Returns(true);
        tenantWithViewAs.Setup(t => t.ViewAsUserId).Returns(viewedUser.Id);

        var controller = MakeController(db, tenantWithViewAs.Object, superAdminUser.Id);

        var result = await controller.GetMyShifts(ServiceDate.AddDays(-1), ServiceDate.AddDays(1), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftsResponseDto>>(ok.Value);
        var shift = Assert.Single(body.Data!.Shifts);
        Assert.Equal(viewedShift.Id, shift.Id);
    }

    // ══════════════════════════════════════════════════════════════
    // SHIFT NOTES (NOTES-01)
    // ══════════════════════════════════════════════════════════════

    private static PortalController MakeControllerWithName(OdipDbContext db, ICurrentTenant tenant, Guid callerUserId, string fullName)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString()), new Claim("fullName", fullName)], "Test");
        return new PortalController(db, tenant)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }

    [Fact]
    public async Task CreateShiftNote_OwnShift_CreatesNoteStampedWithCallerIdentity()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id);
        var controller = MakeControllerWithName(db, tenant.Object, user.Id, "Ben Turner");

        var result = await controller.CreateShiftNote(shift.Id, new CreateShiftNoteDto { Body = "Quiet shift, no concerns." }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftNoteDto>>(ok.Value);
        Assert.True(body.Success);
        var dto = body.Data!;
        Assert.Equal(shift.Id, dto.ShiftId);
        Assert.Equal(user.Id, dto.AuthorUserId);
        Assert.Equal("Ben Turner", dto.AuthorName);
        Assert.Equal("Quiet shift, no concerns.", dto.Body);

        var stored = Assert.Single(db.ShiftNotes.IgnoreQueryFilters());
        Assert.Equal(shift.Id, stored.ShiftId);
    }

    [Fact]
    public async Task CreateShiftNote_ForeignShift_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var myUser = SeedUser(db, "Ben", "Turner");
        var otherUser = SeedUser(db, "Cara", "Lee");
        var participant = SeedParticipant(db);
        var foreignShift = SeedShift(db, participant.Id, otherUser.Id);
        var controller = MakeController(db, tenant.Object, myUser.Id);

        var result = await controller.CreateShiftNote(foreignShift.Id, new CreateShiftNoteDto { Body = "Should not be created." }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Empty(db.ShiftNotes.IgnoreQueryFilters());
    }

    [Fact]
    public async Task CreateShiftNote_NonexistentShift_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateShiftNote(Guid.NewGuid(), new CreateShiftNoteDto { Body = "Should not be created." }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetShiftNotes_OwnShift_ReturnsNotesNewestFirst()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id);
        db.ShiftNotes.AddRange(
            new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = user.Id, AuthorName = "Ben Turner", Body = "First note", CreatedAt = DateTime.UtcNow.AddHours(-2) },
            new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = user.Id, AuthorName = "Ben Turner", Body = "Second note", CreatedAt = DateTime.UtcNow.AddHours(-1) });
        db.SaveChanges();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.GetShiftNotes(shift.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<ShiftNoteDto>>>(ok.Value);
        Assert.Equal(2, body.Data!.Count);
        Assert.Equal("Second note", body.Data[0].Body); // newest first
    }

    [Fact]
    public async Task GetShiftNotes_ForeignShift_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var myUser = SeedUser(db, "Ben", "Turner");
        var otherUser = SeedUser(db, "Cara", "Lee");
        var participant = SeedParticipant(db);
        var foreignShift = SeedShift(db, participant.Id, otherUser.Id);
        db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), ShiftId = foreignShift.Id, AuthorUserId = otherUser.Id, AuthorName = "Cara Lee", Body = "Not yours to read." });
        db.SaveChanges();
        var controller = MakeController(db, tenant.Object, myUser.Id);

        var result = await controller.GetShiftNotes(foreignShift.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task UpdateShiftNote_Author_UpdatesBody()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id);
        var note = new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = user.Id, AuthorName = "Ben Turner", Body = "Original body." };
        db.ShiftNotes.Add(note);
        db.SaveChanges();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.UpdateShiftNote(note.Id, new UpdateShiftNoteDto { Body = "Corrected body." }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftNoteDto>>(ok.Value);
        Assert.Equal("Corrected body.", body.Data!.Body);
        Assert.Equal("Corrected body.", db.ShiftNotes.IgnoreQueryFilters().Single(n => n.Id == note.Id).Body);
    }

    [Fact]
    public async Task UpdateShiftNote_NotTheAuthor_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var author = SeedUser(db, "Ben", "Turner");
        var otherUser = SeedUser(db, "Cara", "Lee");
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, author.Id);
        var note = new ShiftNote { Id = Guid.NewGuid(), ShiftId = shift.Id, AuthorUserId = author.Id, AuthorName = "Ben Turner", Body = "Original body." };
        db.ShiftNotes.Add(note);
        db.SaveChanges();
        // The other user is on a different shift entirely (isn't even the assigned worker on
        // this one) — the point under test is edit is author-scoped, not shift-ownership-scoped.
        var controller = MakeController(db, tenant.Object, otherUser.Id);

        var result = await controller.UpdateShiftNote(note.Id, new UpdateShiftNoteDto { Body = "Attempted tamper." }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal("Original body.", db.ShiftNotes.IgnoreQueryFilters().Single(n => n.Id == note.Id).Body);
    }

    [Fact]
    public async Task UpdateShiftNote_NonexistentNote_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.UpdateShiftNote(Guid.NewGuid(), new UpdateShiftNoteDto { Body = "Doesn't matter." }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }
}
