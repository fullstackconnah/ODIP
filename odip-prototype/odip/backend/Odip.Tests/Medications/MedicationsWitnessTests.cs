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

namespace Odip.Tests.Medications;

/// <summary>
/// Coverage for the staff-witness workflow added to MedicationsController.RecordAdministration:
/// selecting a witness user puts the record into WitnessStatus.Pending (instead of the legacy
/// free-text-only path), a user can't witness their own administration, and the pre-existing
/// "high-risk requires a witness" rule still holds either way. Post staff/user unification, the
/// witness IS a User directly (no separate Staff row to link) — same EF InMemory +
/// Moq&lt;ICurrentTenant&gt; pattern as MedicationsControllerTests/PortalControllerTests.
/// </summary>
public class MedicationsWitnessTests
{
    /// <param name="competentRecorder">Recording a dose needs a current Medication Competency credential (the D3
    /// gate). Tests that don't set up their own administering identity pass true to record as a competent user.</param>
    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb(Guid? viewAsUserId = null, bool competentRecorder = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        tenant.Setup(t => t.ViewAsUserId).Returns(viewAsUserId);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        var db = new OdipDbContext(options, tenant.Object);
        if (competentRecorder && viewAsUserId is null)
            tenant.Setup(t => t.ViewAsUserId).Returns(MedicationTestIdentities.SeedCompetentUser(db).Id);
        return (db, tenant);
    }

    private static Participant SeedParticipant(OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static ParticipantMedication SeedHighRiskMed(OdipDbContext db, Guid participantId)
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

    private static User SeedUser(OdipDbContext db, string firstName, string lastName)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = firstName, LastName = lastName, Role = UserRole.SupportWorker, IsActive = true,
            IsMedicationCompetent = true, MedicationCompetencyExpiryDate = new DateOnly(2099, 1, 1),
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task RecordAdministration_HighRiskWithWitnessStaffId_SetsPendingAndPopulatesWitnessName()
    {
        var (db, tenant) = CreateDb(competentRecorder: true);
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var witness = SeedUser(db, "Rachel", "Thompson");
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessStaffId = witness.Id };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Rachel Thompson", body.Data!.WitnessName);
        Assert.Equal(witness.Id, body.Data.WitnessStaffId);
        Assert.Equal(WitnessStatus.Pending, body.Data.WitnessStatus);

        var saved = await db.MedicationAdministrations.SingleAsync();
        Assert.Equal(WitnessStatus.Pending, saved.WitnessStatus);
        Assert.NotNull(saved.WitnessRequestedAt);
    }

    /// <summary>NotificationEventType.WitnessRequested trigger — only when a staff witness was nominated. docs/specs/2026-09-08-notifications-design.md §5.</summary>
    [Fact]
    public async Task RecordAdministration_HighRiskWithWitnessStaffId_RaisesWitnessRequestedForTheWitness()
    {
        var (db, tenant) = CreateDb(competentRecorder: true);
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var witness = SeedUser(db, "Rachel", "Thompson");
        var controller = new MedicationsController(db, tenant.Object);

        await controller.RecordAdministration(
            med.Id, new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessStaffId = witness.Id },
            CancellationToken.None);

        var row = await db.NotificationOutbox.SingleAsync();
        Assert.Equal(Odip.Domain.Notifications.NotificationEventType.WitnessRequested, row.EventType);
        Assert.Equal(witness.Id, row.RecipientUserId);
    }

    /// <summary>A free-text/external witness has nothing to approve — no outbox row at all.</summary>
    [Fact]
    public async Task RecordAdministration_LegacyWitnessNameOnly_RaisesNoWitnessNotification()
    {
        var (db, tenant) = CreateDb(competentRecorder: true);
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var controller = new MedicationsController(db, tenant.Object);

        await controller.RecordAdministration(
            med.Id, new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessName = "Someone External" },
            CancellationToken.None);

        Assert.Empty(await db.NotificationOutbox.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_LegacyWitnessNameOnly_StillSatisfiesHighRiskRequirement()
    {
        // Back-compat: a caller that only supplies free-text WitnessName (no staff selection)
        // still passes the high-risk gate, exactly as before this feature existed — no Pending
        // workflow is started since there's no staff record to approve/decline it.
        var (db, tenant) = CreateDb(competentRecorder: true);
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessName = "Rachel Thompson" };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.Equal("Rachel Thompson", body.Data!.WitnessName);
        Assert.Null(body.Data.WitnessStaffId);
        Assert.Equal(WitnessStatus.NotRequired, body.Data.WitnessStatus);
    }

    [Fact]
    public async Task RecordAdministration_HighRiskAdministeredWithoutAnyWitness_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(competentRecorder: true);
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("witness", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_WitnessStaffIdInactive_ReturnsBadRequest()
    {
        // §4.4: the witness ref must resolve to an ACTIVE user, not merely an existing one.
        var (db, tenant) = CreateDb(competentRecorder: true);
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var inactiveWitness = SeedUser(db, "Inactive", "Witness");
        inactiveWitness.IsActive = false;
        db.SaveChanges();
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessStaffId = inactiveWitness.Id };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("not found", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_WitnessStaffIdNotFound_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb(competentRecorder: true);
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessStaffId = Guid.NewGuid() };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("not found", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_SelfWitness_ReturnsBadRequest()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var administeringUser = SeedUser(db, "Alex", "Field");
        tenant.Setup(t => t.ViewAsUserId).Returns(administeringUser.Id);
        var controller = new MedicationsController(db, tenant.Object);

        // The caller (resolved via tenant.ViewAsUserId -> administeringUser) tries to select
        // themselves as the witness.
        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessStaffId = administeringUser.Id };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("cannot witness their own", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_SelfWitness_ResolvedByNameIdentifierClaim_ReturnsBadRequest()
    {
        // Complements RecordAdministration_SelfWitness_ReturnsBadRequest (which resolves the
        // caller via tenant.ViewAsUserId) by exercising the OTHER resolution path §4.3 describes:
        // the caller's own identity from the JWT's NameIdentifier claim, with no ViewAsUserId
        // override in play. Self-witnessing must be rejected by resolved user id either way.
        var (db, tenant) = CreateDb(); // ViewAsUserId stays null
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var administeringUser = SeedUser(db, "Alex", "Field");

        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, administeringUser.Id.ToString())], "Test");
        var controller = new MedicationsController(db, tenant.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessStaffId = administeringUser.Id };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("cannot witness their own", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_DifferentStaffWitness_NotBlockedBySelfWitnessCheck()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var administeringUser = SeedUser(db, "Alex", "Field");
        var witnessUser = SeedUser(db, "Rachel", "Thompson");
        tenant.Setup(t => t.ViewAsUserId).Returns(administeringUser.Id);
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessStaffId = witnessUser.Id };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(WitnessStatus.Pending, body.Data!.WitnessStatus);
    }

    // Amend (PUT) path: WitnessName mirrors the staff witness's name (see MedicationAdministration.WitnessName),
    // so a typed, blank or missing name must not replace it while a staff witness is recorded.
    [Theory]
    [InlineData("Someone Typed")]
    [InlineData("")]
    [InlineData(null)]
    public async Task UpdateAdministration_StaffWitnessed_KeepsStaffWitnessNameWhateverIsSent(string? typedName)
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var witness = SeedUser(db, "Rachel", "Thompson");
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
            WitnessUserId = witness.Id, WitnessName = "Rachel Thompson", WitnessStatus = WitnessStatus.Pending,
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new UpdateAdministrationDto
        {
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = admin.AdministeredAt,
            WitnessName = typedName, Notes = "Typo fixed",
        };
        var result = await controller.UpdateAdministration(admin.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.Equal("Rachel Thompson", body.Data!.WitnessName);
        var saved = await db.MedicationAdministrations.SingleAsync();
        Assert.Equal("Rachel Thompson", saved.WitnessName);
        Assert.Equal(witness.Id, saved.WitnessUserId);
        Assert.Equal(WitnessStatus.Pending, saved.WitnessStatus);
        Assert.Equal("Typo fixed", saved.Notes);
    }

    [Fact]
    public async Task UpdateAdministration_LegacyWitnessNameOnly_StillSavesTheTypedName()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
            WitnessName = "Old Typed Name",
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new UpdateAdministrationDto
        {
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = admin.AdministeredAt,
            WitnessName = "Corrected Name",
        };
        await controller.UpdateAdministration(admin.Id, dto, CancellationToken.None);

        var saved = await db.MedicationAdministrations.SingleAsync();
        Assert.Equal("Corrected Name", saved.WitnessName);
    }

    // The amend form sends no witness name once the dose is no longer a witnessed Administered one (e.g. changed to Refused);
    // that must not erase the typed witness already on the record.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task UpdateAdministration_LegacyWitnessNameOnly_KeptWhenTheRequestSendsNone(string? sentName)
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedHighRiskMed(db, participant.Id);
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow, RecordedByName = "Test",
            WitnessName = "Old Typed Name",
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new UpdateAdministrationDto { Status = MedicationAdministrationStatus.Refused, Reason = "Participant declined", WitnessName = sentName };
        await controller.UpdateAdministration(admin.Id, dto, CancellationToken.None);

        var saved = await db.MedicationAdministrations.SingleAsync();
        Assert.Equal(MedicationAdministrationStatus.Refused, saved.Status);
        Assert.Equal("Old Typed Name", saved.WitnessName);
    }
}
