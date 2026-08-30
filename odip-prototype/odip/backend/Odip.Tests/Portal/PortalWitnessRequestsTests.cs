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
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Portal;

/// <summary>
/// Coverage for PortalController's witness-approval endpoints: only the named witness staff
/// member (resolved the same way as GetMyShifts/GetShiftDetail — via User.StaffId, ViewAsUserId
/// taking priority) can list/approve/decline their own pending requests; a foreign or
/// already-responded request 404s/400s rather than ever leaking another staff member's data.
/// Same EF InMemory + Moq&lt;ICurrentTenant&gt; + ClaimsPrincipal pattern as PortalControllerTests.
/// </summary>
public class PortalWitnessRequestsTests
{
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

    private static PortalController MakeController(OdipDbContext db, ICurrentTenant tenant, Guid? callerUserId = null)
    {
        var controller = new PortalController(db, tenant);
        if (callerUserId.HasValue)
        {
            var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, callerUserId.Value.ToString())], "Test");
            controller.ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            };
        }
        return controller;
    }

    private static Staff SeedStaff(OdipDbContext db, string firstName, string lastName)
    {
        var staff = new Staff { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, Role = StaffRole.SupportWorker, IsActive = true };
        db.Staff.Add(staff);
        db.SaveChanges();
        return staff;
    }

    private static Participant SeedParticipant(OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static User SeedUser(OdipDbContext db, Guid? staffId)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = "Test", LastName = "User", Role = UserRole.SupportWorker, StaffId = staffId, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static ParticipantMedication SeedMedication(OdipDbContext db, Guid participantId)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = "Insulin", DoseDescription = "18 units",
            Type = MedicationType.Regular, TimesOfDay = "08:00", IsHighRisk = true, Status = MedicationStatus.Active,
            StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();
        return med;
    }

    private static MedicationAdministration SeedPendingWitnessRequest(OdipDbContext db, Guid participantId, Guid medicationId, Guid witnessStaffId)
    {
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = medicationId, ParticipantId = participantId,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow,
            RecordedByName = "Jordan Lee", WitnessStaffId = witnessStaffId, WitnessName = "Placeholder",
            WitnessStatus = WitnessStatus.Pending, WitnessRequestedAt = DateTime.UtcNow,
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();
        return admin;
    }

    [Fact]
    public async Task GetWitnessRequests_ReturnsOnlyCallersOwnPendingRequests()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id);
        var witness = SeedStaff(db, "Rachel", "Thompson");
        var otherStaff = SeedStaff(db, "Someone", "Else");
        var witnessUser = SeedUser(db, witness.Id);
        SeedPendingWitnessRequest(db, participant.Id, med.Id, witness.Id);
        SeedPendingWitnessRequest(db, participant.Id, med.Id, otherStaff.Id); // not the caller's

        var controller = MakeController(db, tenant.Object, witnessUser.Id);
        var result = await controller.GetWitnessRequests(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<PortalWitnessRequestDto>>>(ok.Value);
        var request = Assert.Single(body.Data!);
        Assert.Equal(med.Name, request.MedicationName);
    }

    [Fact]
    public async Task GetWitnessRequests_UnlinkedAccount_ReturnsEmptyList()
    {
        var (db, tenant) = CreateDb();
        var unlinkedUser = SeedUser(db, staffId: null);

        var controller = MakeController(db, tenant.Object, unlinkedUser.Id);
        var result = await controller.GetWitnessRequests(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<PortalWitnessRequestDto>>>(ok.Value);
        Assert.Empty(body.Data!);
    }

    [Fact]
    public async Task ApproveWitnessRequest_ByNamedWitness_SetsApprovedAndRespondedAt()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id);
        var witness = SeedStaff(db, "Rachel", "Thompson");
        var witnessUser = SeedUser(db, witness.Id);
        var admin = SeedPendingWitnessRequest(db, participant.Id, med.Id, witness.Id);

        var controller = MakeController(db, tenant.Object, witnessUser.Id);
        var result = await controller.ApproveWitnessRequest(admin.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalWitnessRequestDto>>(ok.Value);
        Assert.Equal(WitnessStatus.Approved, body.Data!.WitnessStatus);
        Assert.NotNull(body.Data.WitnessRespondedAt);

        var saved = await db.MedicationAdministrations.SingleAsync(a => a.Id == admin.Id);
        Assert.Equal(WitnessStatus.Approved, saved.WitnessStatus);
    }

    [Fact]
    public async Task DeclineWitnessRequest_ByNamedWitness_SetsDeclined()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id);
        var witness = SeedStaff(db, "Rachel", "Thompson");
        var witnessUser = SeedUser(db, witness.Id);
        var admin = SeedPendingWitnessRequest(db, participant.Id, med.Id, witness.Id);

        var controller = MakeController(db, tenant.Object, witnessUser.Id);
        var result = await controller.DeclineWitnessRequest(admin.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalWitnessRequestDto>>(ok.Value);
        Assert.Equal(WitnessStatus.Declined, body.Data!.WitnessStatus);
    }

    [Fact]
    public async Task ApproveWitnessRequest_BelongingToAnotherStaffMember_ReturnsNotFound()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id);
        var actualWitness = SeedStaff(db, "Rachel", "Thompson");
        var impersonator = SeedStaff(db, "Someone", "Else");
        var impersonatorUser = SeedUser(db, impersonator.Id);
        var admin = SeedPendingWitnessRequest(db, participant.Id, med.Id, actualWitness.Id);

        var controller = MakeController(db, tenant.Object, impersonatorUser.Id);
        var result = await controller.ApproveWitnessRequest(admin.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var saved = await db.MedicationAdministrations.SingleAsync(a => a.Id == admin.Id);
        Assert.Equal(WitnessStatus.Pending, saved.WitnessStatus); // unchanged
    }

    [Fact]
    public async Task ApproveWitnessRequest_UnknownId_ReturnsNotFound()
    {
        var (db, tenant) = CreateDb();
        var witness = SeedStaff(db, "Rachel", "Thompson");
        var witnessUser = SeedUser(db, witness.Id);

        var controller = MakeController(db, tenant.Object, witnessUser.Id);
        var result = await controller.ApproveWitnessRequest(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task ApproveWitnessRequest_UnlinkedCaller_ReturnsNotFound()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id);
        var witness = SeedStaff(db, "Rachel", "Thompson");
        var admin = SeedPendingWitnessRequest(db, participant.Id, med.Id, witness.Id);
        var unlinkedUser = SeedUser(db, staffId: null);

        var controller = MakeController(db, tenant.Object, unlinkedUser.Id);
        var result = await controller.ApproveWitnessRequest(admin.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task ApproveWitnessRequest_AlreadyResponded_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id);
        var witness = SeedStaff(db, "Rachel", "Thompson");
        var witnessUser = SeedUser(db, witness.Id);
        var admin = SeedPendingWitnessRequest(db, participant.Id, med.Id, witness.Id);
        admin.WitnessStatus = WitnessStatus.Approved;
        admin.WitnessRespondedAt = DateTime.UtcNow;
        db.SaveChanges();

        var controller = MakeController(db, tenant.Object, witnessUser.Id);
        var result = await controller.DeclineWitnessRequest(admin.Id, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }
}
