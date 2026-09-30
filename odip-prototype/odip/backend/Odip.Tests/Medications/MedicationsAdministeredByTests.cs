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
/// Coverage for MED-04: the administering identity on a recorded MAR dose derives from the
/// authenticated caller server-side (never client-supplied), honouring the SuperAdmin "view as"
/// mechanism the same way <see cref="MedicationsWitnessTests"/> already exercises for the
/// self-witness check — plus the client-local administration timestamp/timezone round-trip and
/// its no-JS-timestamp fallback.
/// </summary>
public class MedicationsAdministeredByTests
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

    private static Participant SeedParticipant(OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static ParticipantMedication SeedMed(OdipDbContext db, Guid participantId, bool isHighRisk = false)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Regular, TimesOfDay = "08:00", IsHighRisk = isHighRisk, Status = MedicationStatus.Active,
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

    private static void AttachJwtIdentity(MedicationsController controller, Guid userId)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "Test");
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) },
        };
    }

    [Fact]
    public async Task RecordAdministration_ViewAsUser_DerivesRecordedByFromViewedUser()
    {
        // A SuperAdmin viewing-as another user records a dose — the saved record must attribute
        // it to the VIEWED user (ViewAsUserId), not any raw JWT identity, exactly as the
        // self-witness check already resolves it (§4.3).
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMed(db, participant.Id);
        var administeringUser = SeedUser(db, "Jamie", "Lee");
        tenant.Setup(t => t.ViewAsUserId).Returns(administeringUser.Id);
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, DoseGiven = "2 tablets" };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Jamie Lee", body.Data!.RecordedByName);

        var saved = await db.MedicationAdministrations.SingleAsync();
        Assert.Equal(administeringUser.Id, saved.RecordedByUserId);
        Assert.Equal("Jamie Lee", saved.RecordedByName);
    }

    [Fact]
    public async Task RecordAdministration_NoViewAs_DerivesRecordedByFromOwnJwtIdentity()
    {
        // No ViewAsUserId override — falls back to the caller's own JWT NameIdentifier claim,
        // mirroring RecordAdministration_SelfWitness_ResolvedByNameIdentifierClaim.
        var (db, tenant) = CreateDb(); // ViewAsUserId stays null
        var participant = SeedParticipant(db);
        var med = SeedMed(db, participant.Id);
        var administeringUser = SeedUser(db, "Alex", "Field");

        var controller = new MedicationsController(db, tenant.Object);
        AttachJwtIdentity(controller, administeringUser.Id);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.Equal(administeringUser.Id, body.Data!.RecordedByUserId);
        Assert.Equal("Alex Field", body.Data.RecordedByName);
    }

    [Fact]
    public async Task RecordAdministration_UnresolvableIdentity_IsRefusedBecauseCompetencyCannotBeVerified()
    {
        // No ControllerContext and no ViewAsUserId: no staff user can be resolved, so the Medication
        // Competency gate cannot be evaluated. A dose is never recorded against an identity we cannot
        // check (this used to fall back to the JWT claim name; the gate now comes first).
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMed(db, participant.Id);
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var forbidden = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, forbidden.StatusCode);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(forbidden.Value);
        Assert.Equal("MEDICATION_COMPETENCY_UNVERIFIABLE", body.Code);
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task RecordAdministration_SelfWitnessRejection_StillAppliesToViewAsDerivedUser()
    {
        // Guards against a regression where refactoring RecordedByUserId resolution breaks the
        // pre-existing self-witness rejection (both now share one resolved administeringUserId).
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMed(db, participant.Id, isHighRisk: true);
        var administeringUser = SeedUser(db, "Alex", "Field");
        tenant.Setup(t => t.ViewAsUserId).Returns(administeringUser.Id);
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, WitnessStaffId = administeringUser.Id };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(badRequest.Value);
        Assert.Contains("cannot witness their own", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task RecordAdministration_ClientTimestampAndTimeZone_RoundTrip()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMed(db, participant.Id);
        tenant.Setup(t => t.ViewAsUserId).Returns(SeedUser(db, "Casey", "Recorder").Id);
        var controller = new MedicationsController(db, tenant.Object);

        var clientInstant = new DateTime(2026, 8, 30, 21, 15, 0, DateTimeKind.Utc);
        var dto = new CreateAdministrationDto
        {
            Status = MedicationAdministrationStatus.Administered,
            AdministeredAt = clientInstant,
            AdministeredAtTimeZone = "Australia/Sydney",
        };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.Equal(clientInstant, body.Data!.AdministeredAt);
        Assert.Equal("Australia/Sydney", body.Data.AdministeredAtTimeZone);

        var saved = await db.MedicationAdministrations.SingleAsync();
        Assert.Equal(clientInstant, saved.AdministeredAt);
        Assert.Equal("Australia/Sydney", saved.AdministeredAtTimeZone);
    }

    [Fact]
    public async Task RecordAdministration_NoClientTimestamp_FallsBackToServerTimeWithNullTimeZone()
    {
        // No-JS-timestamp fallback: AdministeredAt/AdministeredAtTimeZone both absent from the
        // request — server stamps its own UtcNow and leaves the zone null (display falls back to
        // the viewer's local zone; see RecordAdministrationModal/formatAdministrationTime).
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMed(db, participant.Id);
        tenant.Setup(t => t.ViewAsUserId).Returns(SeedUser(db, "Casey", "Recorder").Id);
        var controller = new MedicationsController(db, tenant.Object);

        var before = DateTime.UtcNow;
        var dto = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered };
        var result = await controller.RecordAdministration(med.Id, dto, CancellationToken.None);
        var after = DateTime.UtcNow;

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(ok.Value);
        Assert.NotNull(body.Data!.AdministeredAt);
        Assert.InRange(body.Data.AdministeredAt!.Value, before, after);
        Assert.Null(body.Data.AdministeredAtTimeZone);
    }

    [Fact]
    public async Task UpdateAdministration_TimeZoneSupplied_Overwrites()
    {
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMed(db, participant.Id);
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow,
            AdministeredAtTimeZone = "Australia/Sydney", RecordedByName = "Test",
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new UpdateAdministrationDto
        {
            Status = MedicationAdministrationStatus.Administered,
            AdministeredAt = admin.AdministeredAt,
            AdministeredAtTimeZone = "Pacific/Auckland",
        };
        await controller.UpdateAdministration(admin.Id, dto, CancellationToken.None);

        var saved = await db.MedicationAdministrations.SingleAsync();
        Assert.Equal("Pacific/Auckland", saved.AdministeredAtTimeZone);
    }

    [Fact]
    public async Task UpdateAdministration_TimeZoneOmitted_PreservesExistingValue()
    {
        // An amend that doesn't touch the recorded instant (the common case — see
        // RecordAdministrationModal.buildAmendFields) shouldn't wipe out the originally-recorded
        // zone by sending null.
        var (db, tenant) = CreateDb();
        var participant = SeedParticipant(db);
        var med = SeedMed(db, participant.Id);
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow,
            AdministeredAtTimeZone = "Australia/Sydney", RecordedByName = "Test",
        };
        db.MedicationAdministrations.Add(admin);
        db.SaveChanges();
        var controller = new MedicationsController(db, tenant.Object);

        var dto = new UpdateAdministrationDto
        {
            Status = MedicationAdministrationStatus.Administered,
            AdministeredAt = admin.AdministeredAt,
            AdministeredAtTimeZone = null,
        };
        await controller.UpdateAdministration(admin.Id, dto, CancellationToken.None);

        var saved = await db.MedicationAdministrations.SingleAsync();
        Assert.Equal("Australia/Sydney", saved.AdministeredAtTimeZone);
    }
}
