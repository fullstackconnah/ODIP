using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
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
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// PUT /participants/{id}/intake: what the Intake wizard calls to save or complete an intake it is RESUMING. It is a scoped
/// write. The wizard owns the intake fields (<see cref="ParticipantIntakeSnapshotService.IntakeScopeFieldNames"/>) and nothing
/// else, so a resumed intake used to wipe gender, middle name, diagnoses, allergies and every key identifier by going through
/// the full-record PUT (code review round 2: L2-03 = L1-08), and the contacts and risks the coordinator added while resuming
/// were dropped without a word (L2-10).
/// </summary>
public class ParticipantIntakeControllerTests
{
    private static readonly JsonSerializerOptions WireJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() },
    };

    private static (OdipDbContext Db, ParticipantsController Controller) Create(Guid tenantId, string? database = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(x => x.TenantId).Returns(tenantId);
        tenant.Setup(x => x.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(database ?? Guid.NewGuid().ToString()).Options, tenant.Object);
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "coordinator-1")], "Test")),
        };
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db))
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };
        return (db, controller);
    }

    /// <summary>The body the wizard sends on a resume ("Save as draft" or "Complete Intake"): its own keys, serialised as the browser does.</summary>
    private static CreateParticipantDto WizardBody(string extraJson = "", string firstName = "Jamie", bool complete = false, string? requestId = null) =>
        JsonSerializer.Deserialize<CreateParticipantDto>($$"""
        {
          "firstName": "{{firstName}}", "lastName": "Rivers", "preferredName": "Jay", "dateOfBirth": "1990-05-17",
          "phone": "0400123456", "email": "jay@example.test",
          "addressStreet": "9 Wizard Way", "addressSuburb": "Brisbane", "addressState": "QLD", "addressPostcode": "4000",
          "livingArrangement": "Family", "mainSupportPersonName": "Pat Rivers", "mainSupportPersonRelationship": "Parent",
          "othersLivingInAccommodation": null, "residentialInfo": null, "livesWithOthers": false, "whoLivesWith": null,
          "silProviderName": null, "silProviderContactPhone": null, "accommodationType": null, "onSiteSupportHours": null, "livingArrangementNotes": "Quiet street",
          "ndisNumber": "430000007", "planStartDate": "2026-01-01", "planEndDate": "2026-12-31", "planType": "PlanManaged", "fundingSource": "Ndis",
          "fundingOrganisation": null, "region": "QLD", "isRepeatClient": true, "serviceStreams": "Trip",
          "isCald": true, "isLgbtqi": null, "isFamilyCommunity": false, "isAboriginalOrTorresStraitIslander": null,
          "receivedRightsAndResponsibilitiesInfo": true, "receivedPrivacyAndConfidentialityInfo": true, "receivedFeedbackInfo": true,
          "receivedBeingSafeInfo": true, "receivedAdvocacyInfo": true,
          "mobilityAidWheelchair": true, "mobilityAidWalker": false, "isHighSupport": true, "isIntensiveSupport": false,
          "overnightSupport": "None", "overnightRatio": "OneToOne", "requiresHiLoBed": false, "requiresHoist": false,
          "requiresShowerChair": false, "requiresCommode": false, "requiresStandingMachine": false, "supportRatio": "SharedSupport",
          "medicalSummary": "Wizard medical summary", "hidpaNotes": null, "behavioursOfConcernCurrent": true, "behavioursOfConcernFiveYearHistory": null,
          "expressiveSkills": "Uses short sentences", "behaviourRiskSummary": "Wizard risk summary", "notes": "Wizard notes",
          "isDraft": true, "completeIntake": {{(complete ? "true" : "false")}}{{(requestId == null ? "" : $", \"completionRequestId\": \"{requestId}\"")}}{{extraJson}}
        }
        """, WireJson)!;

    private static Participant DraftWithProfileData(Guid tenantId) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Jamie", LastName = "Rivers", IsDraft = true, IsActive = false,
        // Everything the Profile wizard (or a caregiver submission) records and the Intake wizard never shows or sends.
        MiddleName = "Lee", Gender = Gender.NonBinary, GenderSelfDescription = "Non-binary", PlaceOfBirth = "Cairns", Country = "Australia",
        IsDsoa = true, PrimaryDiagnosis = "Epilepsy", OtherDiagnoses = ["Asthma", "Anxiety"], MobilityNotes = "Frame indoors",
        EquipmentRequirements = "Shower chair", TransportRequirements = "Ramp", PreferredUserId = Guid.NewGuid(),
        PensionCardNumber = "P123", MedicareNumber = "M456", CompanionCardNumber = "C789", PrivateHealthFund = "Fund", TaxiCardNumber = "T1",
        HairColour = "Brown", EyeColour = "Green", WeightKg = 70.5m, HeightCm = 172m, PersonalInterests = "Swimming",
        ChoiceControlNotes = "Likes choices", AllergiesDetail = "Peanuts", IsAnaphylaxisRisk = true, AllergyManagementNotes = "EpiPen",
        FallsRiskRating = RiskRatingLevel.High, Memory = MemoryLevel.Fair, MealAssistanceDetail = "Cut food", Goals = "Swim weekly",
        StrengthsFears = "Brave", SignsHappyAndSettled = "Humming",
        Phone = "0411111111", Email = "old@example.test", NdisNumber = "431234567", PlanType = PlanType.SelfManaged,
    };

    private static T Ok<T>(ActionResult<ApiResponse<T>> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<ApiResponse<T>>(ok.Value).Data!;
    }

    private static string BadRequest<T>(ActionResult<ApiResponse<T>> result) =>
        Assert.Single(Assert.IsType<ApiResponse<T>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors!);

    [Fact]
    public async Task SaveIntake_WizardPayload_KeepsEveryProfileOnlyField_AndWritesTheIntakeFields()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        Ok(await controller.SaveIntake(participant.Id, WizardBody(), CancellationToken.None));

        var saved = await db.Participants.SingleAsync();
        // Intake-owned: written.
        Assert.Equal("Jay", saved.PreferredName);
        Assert.Equal("0400123456", saved.Phone);
        Assert.Equal("430000007", saved.NdisNumber);
        Assert.Equal(PlanType.PlanManaged, saved.PlanType);
        Assert.Equal("Wizard medical summary", saved.MedicalSummary);
        Assert.Equal(true, saved.IsCald);
        // Profile-owned: untouched. Each of these was nulled by the full-record PUT this endpoint replaces.
        Assert.Equal("Lee", saved.MiddleName);
        Assert.Equal(Gender.NonBinary, saved.Gender);
        Assert.Equal("Non-binary", saved.GenderSelfDescription);
        Assert.Equal("Cairns", saved.PlaceOfBirth);
        Assert.Equal("Epilepsy", saved.PrimaryDiagnosis);
        Assert.Equal(["Asthma", "Anxiety"], saved.OtherDiagnoses);
        Assert.Equal("Frame indoors", saved.MobilityNotes);
        Assert.Equal(participant.PreferredUserId, saved.PreferredUserId);
        Assert.Equal("P123", saved.PensionCardNumber);
        Assert.Equal("M456", saved.MedicareNumber);
        Assert.Equal(70.5m, saved.WeightKg);
        Assert.Equal("Peanuts", saved.AllergiesDetail);
        Assert.Equal(true, saved.IsAnaphylaxisRisk);
        Assert.Equal("EpiPen", saved.AllergyManagementNotes);
        Assert.Equal(RiskRatingLevel.High, saved.FallsRiskRating);
        Assert.Equal("Swim weekly", saved.Goals);
        Assert.True(saved.IsDsoa);
    }

    private static readonly string[] NeverWrittenByIntake = ["IsDraft", "IsActive", "IntakeCompletedAt"];

    /// <summary>A value that differs from <see cref="Baseline"/> for the same property, so a write shows up as a change.</summary>
    private static object? Different(Type type, string name)
    {
        var t = Nullable.GetUnderlyingType(type) ?? type;
        if (name == nameof(Participant.Phone)) return "0400999888";
        if (name == nameof(Participant.Email)) return "different@example.test";
        if (name == nameof(Participant.AddressPostcode)) return "4001";
        if (name == nameof(Participant.LivingArrangement)) return LivingArrangement.Family;
        if (name == nameof(Participant.FundingSource)) return ParticipantFundingSource.Other;
        if (name == nameof(Participant.FundingOrganisation)) return "Different fund";
        if (t == typeof(string)) return $"dto-{name}";
        if (t == typeof(bool)) return true;
        if (t.IsEnum) return Enum.GetValues(t).Cast<object>().Distinct().Skip(1).First();
        if (t == typeof(DateOnly)) return new DateOnly(2001, 2, 3);
        if (t == typeof(decimal)) return 20m;
        if (t == typeof(int)) return 2;
        if (t == typeof(List<string>)) return new List<string> { "dto" };
        return null;
    }

    private static object? Baseline(Type type, string name)
    {
        var t = Nullable.GetUnderlyingType(type) ?? type;
        if (name == nameof(Participant.Phone)) return "0411111111";
        if (name == nameof(Participant.Email)) return "base@example.test";
        if (name == nameof(Participant.AddressPostcode)) return "4000";
        if (name == nameof(Participant.LivingArrangement)) return LivingArrangement.Independent;
        if (name == nameof(Participant.FundingSource)) return ParticipantFundingSource.Ndis;
        if (t == typeof(string)) return $"base-{name}";
        if (t == typeof(bool)) return false;
        if (t.IsEnum) return Enum.GetValues(t).Cast<object>().Distinct().First();
        if (t == typeof(DateOnly)) return new DateOnly(2000, 1, 1);
        if (t == typeof(decimal)) return 10m;
        if (t == typeof(int)) return 1;
        if (t == typeof(List<string>)) return new List<string> { "base" };
        return null;
    }

    private static Dictionary<string, string?> Scalars(Participant p) =>
        typeof(Participant).GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(pi => pi.CanRead && pi.CanWrite && pi.GetIndexParameters().Length == 0)
            .Where(pi => { var t = Nullable.GetUnderlyingType(pi.PropertyType) ?? pi.PropertyType; return t.IsPrimitive || t.IsEnum || t == typeof(string) || t == typeof(decimal) || t == typeof(DateTime) || t == typeof(DateOnly) || t == typeof(Guid) || t == typeof(List<string>); })
            .ToDictionary(pi => pi.Name, pi => pi.GetValue(p) switch { null => null, List<string> l => string.Join("|", l), DateTime d => d.ToString("O"), var v => v.ToString() });

    /// <summary>
    /// The drift guard. Every CreateParticipantDto field that is also a participant column is sent with a value that differs from
    /// what the participant holds; the columns that change must be exactly the intake scope (the list the immutable intake
    /// evidence is built from). A new field added to the apply but not to the scope, or the reverse, fails here by name.
    /// </summary>
    [Fact]
    public async Task SaveIntake_WritesExactlyTheIntakeScope_AndNothingElse()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Base", LastName = "Person", IsDraft = true };
        var dto = new CreateParticipantDto { FirstName = "Dto", LastName = "DtoLast", IsDraft = true, PlanType = PlanType.AgencyManaged };
        foreach (var dtoProp in typeof(CreateParticipantDto).GetProperties())
        {
            var entityProp = typeof(Participant).GetProperty(dtoProp.Name);
            if (entityProp is null || !entityProp.CanWrite || !dtoProp.CanWrite || NeverWrittenByIntake.Contains(dtoProp.Name)) continue;
            if (dtoProp.Name is nameof(CreateParticipantDto.FirstName) or nameof(CreateParticipantDto.LastName) or nameof(CreateParticipantDto.PlanType)) continue;
            var baseline = Baseline(entityProp.PropertyType, dtoProp.Name);
            var different = Different(dtoProp.PropertyType, dtoProp.Name);
            if (baseline is null || different is null) continue;
            entityProp.SetValue(participant, baseline);
            dtoProp.SetValue(dto, different);
        }
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        var before = Scalars(participant);

        Ok(await controller.SaveIntake(participant.Id, dto, CancellationToken.None));

        var after = Scalars(await db.Participants.SingleAsync());
        var changed = after.Keys.Where(k => before[k] != after[k]).Except(["UpdatedAt"]).OrderBy(k => k).ToList();
        var scope = ParticipantIntakeSnapshotService.IntakeScopeFieldNames.OrderBy(k => k).ToList();
        Assert.Empty(changed.Except(scope));      // nothing outside the intake scope was written
        Assert.Empty(scope.Except(changed));      // and every field in it was
    }

    [Theory]
    [InlineData(true, false)]   // finalised and active (a legacy participant)
    [InlineData(false, false)]  // finalised and archived
    [InlineData(false, true)]   // a draft
    public async Task SaveIntake_NeverChangesWhetherAParticipantIsADraftOrActive(bool isActive, bool isDraft)
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        participant.IsActive = isActive; participant.IsDraft = isDraft;
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        // The wizard always sends isDraft: true. For a finalised participant the old full PUT answered 400 "A finalised
        // participant cannot be reverted to draft."; a scoped write simply never reads the flag.
        var result = Ok(await controller.SaveIntake(participant.Id, WizardBody(complete: true, requestId: "req-lifecycle"), CancellationToken.None));

        var saved = await db.Participants.SingleAsync();
        Assert.Equal(isActive, saved.IsActive);
        Assert.Equal(isDraft, saved.IsDraft);
        Assert.Equal(isActive, result.IsActive);
        Assert.Equal(isDraft, result.IsDraft);
    }

    [Fact]
    public async Task SaveIntake_CreatesTheContactsAndRiskEntriesAddedWhileResuming()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        var body = WizardBody("""
            , "contactRoles": [
                { "newPersonFirstName": "Pat", "newPersonLastName": "Planner", "roleType": "PlanManager", "isPrimary": false, "status": "Active" },
                { "newPersonFirstName": "Gail", "newPersonLastName": "Guardian", "roleType": "Guardian", "relationshipToParticipant": "Mother", "isPrimary": false, "status": "Active" }
              ],
              "riskEntries": [
                { "atRiskParty": "Participant", "description": "Wanders at night", "mitigationNotes": "Door alarm", "isActive": true }
              ]
            """);

        Ok(await controller.SaveIntake(participant.Id, body, CancellationToken.None));

        var roles = await db.ParticipantContactRoles.Include(r => r.Person).OrderBy(r => r.RoleType).ToListAsync();
        Assert.Equal(2, roles.Count);
        Assert.All(roles, r => Assert.Equal(participant.Id, r.ParticipantId));
        Assert.Contains(roles, r => r.RoleType == ContactRoleType.PlanManager && r.Person!.FullName == "Pat Planner");
        Assert.Contains(roles, r => r.RoleType == ContactRoleType.Guardian && r.RelationshipToParticipant == "Mother");
        var risk = Assert.Single(await db.ParticipantRiskEntries.ToListAsync());
        Assert.Equal(participant.Id, risk.ParticipantId);
        Assert.Equal("Wanders at night", risk.Description);
        Assert.Equal("Door alarm", risk.MitigationNotes);
    }

    [Fact]
    public async Task SaveIntake_SkipsContactsAndRisksThatAlreadyExist_SoARetryNeverDuplicatesThem()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        var body = WizardBody("""
            , "contactRoles": [ { "newPersonFirstName": "Pat", "newPersonLastName": "Planner", "roleType": "PlanManager", "isPrimary": false, "status": "Active" } ],
              "riskEntries": [ { "atRiskParty": "Participant", "description": "Wanders at night", "isActive": true } ]
            """);

        Ok(await controller.SaveIntake(participant.Id, body, CancellationToken.None));
        // The response was lost, so the browser sends the very same body again (a plan manager twice would otherwise be a 400).
        Ok(await controller.SaveIntake(participant.Id, body, CancellationToken.None));

        Assert.Single(await db.ParticipantContactRoles.ToListAsync());
        Assert.Single(await db.ParticipantRiskEntries.ToListAsync());
        Assert.Single(await db.People.ToListAsync());
    }

    // ── Review F-2: "already recorded" means an ACTIVE match. A match against an inactive row must not drop what was typed. ──

    [Fact]
    public async Task SaveIntake_AContactThatMatchesAnExpiredRole_IsCreated_NotSilentlyDropped()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        var pat = new Person { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Pat", LastName = "Parent" };
        db.AddRange(participant, pat, new ParticipantContactRole
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, PersonId = pat.Id,
            RoleType = ContactRoleType.NextOfKin, Status = ContactRoleStatus.Expired,
        });
        await db.SaveChangesAsync();
        // The coordinator adds Pat Parent again, as a CURRENT next of kin: the old, expired row says nothing about that.
        var body = WizardBody("""
            , "contactRoles": [ { "newPersonFirstName": "Pat", "newPersonLastName": "Parent", "roleType": "NextOfKin", "isPrimary": false, "status": "Active" } ]
            """);

        Ok(await controller.SaveIntake(participant.Id, body, CancellationToken.None));

        var roles = await db.ParticipantContactRoles.OrderBy(r => r.Status).ToListAsync();
        Assert.Equal([ContactRoleStatus.Active, ContactRoleStatus.Expired], roles.Select(r => r.Status).ToList());
    }

    [Fact]
    public async Task SaveIntake_AContactGivenByPersonId_IsCreated_WhenTheExistingRoleForThatPersonIsSuperseded()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        var pat = new Person { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Pat", LastName = "Parent" };
        db.AddRange(participant, pat, new ParticipantContactRole
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, PersonId = pat.Id,
            RoleType = ContactRoleType.Guardian, Status = ContactRoleStatus.Superseded,
        });
        await db.SaveChangesAsync();
        var body = WizardBody($$"""
            , "contactRoles": [ { "personId": "{{pat.Id}}", "roleType": "Guardian", "isPrimary": false, "status": "Active" } ]
            """);

        Ok(await controller.SaveIntake(participant.Id, body, CancellationToken.None));

        Assert.Equal(2, await db.ParticipantContactRoles.CountAsync());
        Assert.Single(await db.ParticipantContactRoles.Where(r => r.Status == ContactRoleStatus.Active).ToListAsync());
    }

    [Fact]
    public async Task SaveIntake_ARiskThatMatchesAnInactiveRisk_IsCreated_NotSilentlyDropped()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.AddRange(participant, new ParticipantRiskEntry
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, AtRiskParty = AtRiskParty.Participant,
            Description = "Wanders at night", IsActive = false,
        });
        await db.SaveChangesAsync();
        var body = WizardBody("""
            , "riskEntries": [ { "atRiskParty": "Participant", "description": "wanders at night", "isActive": true } ]
            """);

        Ok(await controller.SaveIntake(participant.Id, body, CancellationToken.None));

        var risks = await db.ParticipantRiskEntries.OrderBy(r => r.IsActive).ToListAsync();
        Assert.Equal([false, true], risks.Select(r => r.IsActive).ToList());
    }

    // ── Review F-3: the auto safety notes this endpoint creates belong to the PARTICIPANT's tenant. ──

    [Fact]
    public async Task SaveIntake_CreatesTheAutoSafetyNotesInTheParticipantsTenant_EvenWhenASuperAdminWithAnotherHomeTenantSavesIt()
    {
        var participantTenant = Guid.NewGuid();
        var adminHomeTenant = Guid.NewGuid();
        // A SuperAdmin sees every tenant (the query filter is open for them) but SaveChanges stamps a default TenantId with THEIR home tenant.
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(x => x.TenantId).Returns(adminHomeTenant);
        tenant.Setup(x => x.IsSuperAdmin).Returns(true);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var http = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "super-1")], "Test")) };
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db))
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };
        var participant = DraftWithProfileData(participantTenant);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        // The wizard body carries behavioursOfConcernCurrent and a risks summary, so both safety notes are created by the save.
        var body = WizardBody("""
            , "riskEntries": [ { "atRiskParty": "Participant", "description": "Wanders at night", "isActive": true } ]
            """);

        Ok(await controller.SaveIntake(participant.Id, body, CancellationToken.None));

        var notes = await db.ParticipantNotes.ToListAsync();
        Assert.Contains(notes, n => n.SourceKey == "safety:behavioursOfConcern");
        Assert.Contains(notes, n => n.SourceKey == "safety:risksHazards");
        Assert.All(notes, n => Assert.Equal(participantTenant, n.TenantId));
        // And everything else the save created is in the same tenant (the stamping the contacts and risks already had).
        Assert.All(await db.ParticipantRiskEntries.ToListAsync(), r => Assert.Equal(participantTenant, r.TenantId));
    }

    [Fact]
    public async Task SaveIntake_ARejectedContact_SavesNothingAtAll()
    {
        var tenantId = Guid.NewGuid();
        var database = Guid.NewGuid().ToString();
        var (db, controller) = Create(tenantId, database);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        // The payload says SelfManaged, and a plan manager is only available to plan-managed participants.
        var body = WizardBody("""
            , "planType": "SelfManaged",
              "contactRoles": [ { "newPersonFirstName": "Pat", "newPersonLastName": "Planner", "roleType": "PlanManager", "isPrimary": false, "status": "Active" } ],
              "riskEntries": [ { "atRiskParty": "Participant", "description": "Wanders at night", "isActive": true } ]
            """);

        var message = BadRequest(await controller.SaveIntake(participant.Id, body, CancellationToken.None));

        Assert.Equal("Plan Manager contacts are only available for plan-managed participants.", message);
        // A fresh context over the same store: nothing the rejected request touched was saved.
        var (verify, _2) = Create(tenantId, database);
        using var __ = verify;
        Assert.Empty(await verify.ParticipantContactRoles.ToListAsync());
        Assert.Empty(await verify.ParticipantRiskEntries.ToListAsync());
        Assert.Equal("old@example.test", (await verify.Participants.SingleAsync()).Email);
    }

    [Fact]
    public async Task SaveIntake_Complete_StampsIntakeCompletedAtOnce_WithOneSnapshotAndOneOnboardingRow_AndARetryIsIdempotent()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var first = Ok(await controller.SaveIntake(participant.Id, WizardBody(complete: true, requestId: "req-1"), CancellationToken.None));
        var retry = Ok(await controller.SaveIntake(participant.Id, WizardBody(complete: true, requestId: "req-1"), CancellationToken.None));

        Assert.NotNull(first.IntakeCompletedAt);
        Assert.Equal(first.IntakeCompletedAt, retry.IntakeCompletedAt);
        Assert.Single(await db.ParticipantIntakeSnapshots.ToListAsync());
        Assert.Single(await db.ParticipantOnboardings.ToListAsync());
        Assert.Equal(first.Id, retry.Id);
    }

    [Fact]
    public async Task SaveIntake_Complete_WithANewRequestId_IsADeliberateSecondRevision_AndKeepsTheFirstCompletionTime()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var first = Ok(await controller.SaveIntake(participant.Id, WizardBody(complete: true, requestId: "req-1"), CancellationToken.None));
        Ok(await controller.SaveIntake(participant.Id, WizardBody(complete: true, requestId: "req-2"), CancellationToken.None));

        Assert.Equal([1, 2], (await db.ParticipantIntakeSnapshots.OrderBy(s => s.Revision).Select(s => s.Revision).ToListAsync()));
        Assert.Single(await db.ParticipantOnboardings.ToListAsync());
        Assert.Equal(first.IntakeCompletedAt, (await db.Participants.SingleAsync()).IntakeCompletedAt);
    }

    [Fact]
    public async Task SaveIntake_Draft_DoesNotStampTheCompletionTime_OrCreateAnOnboardingRow()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var result = Ok(await controller.SaveIntake(participant.Id, WizardBody(), CancellationToken.None));

        Assert.Null(result.IntakeCompletedAt);
        Assert.Empty(await db.ParticipantIntakeSnapshots.ToListAsync());
        Assert.Empty(await db.ParticipantOnboardings.ToListAsync());
    }

    [Fact]
    public async Task SaveIntake_Complete_PutsTheContactsAddedInTheSameSaveIntoTheImmutableEvidence()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        var body = WizardBody("""
            , "contactRoles": [ { "newPersonFirstName": "Pat", "newPersonLastName": "Planner", "roleType": "PlanManager", "isPrimary": false, "status": "Active" } ]
            """, complete: true, requestId: "req-evidence");

        Ok(await controller.SaveIntake(participant.Id, body, CancellationToken.None));

        var snapshot = await db.ParticipantIntakeSnapshots.SingleAsync();
        Assert.Contains("Pat Planner", snapshot.SnapshotJson);
    }

    [Fact]
    public async Task SaveIntake_IdentityCorrection_InvalidatesTheProfileAttestation_ButAnUnchangedResaveDoesNot()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        participant.NdisNumber = "430000007"; participant.DateOfBirth = new DateOnly(1990, 5, 17); participant.FundingSource = ParticipantFundingSource.Ndis;
        var onboarding = new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, ProfileComplete = true, ProfileCompletedAt = DateTime.UtcNow, ProfileCompletedBy = "tester" };
        db.AddRange(participant, onboarding);
        await db.SaveChangesAsync();

        Ok(await controller.SaveIntake(participant.Id, WizardBody(), CancellationToken.None));
        Assert.True(onboarding.ProfileComplete);

        Ok(await controller.SaveIntake(participant.Id, WizardBody(firstName: "Corrected"), CancellationToken.None));
        Assert.False(onboarding.ProfileComplete);
        Assert.Null(onboarding.ProfileCompletedAt);
    }

    [Theory]
    [InlineData("""
        , "phone": "not a phone"
        """, "Please provide a valid phone number.")]
    [InlineData("""
        , "addressPostcode": "40"
        """, "Postcode must be exactly 4 digits.")]
    [InlineData("""
        , "fundingSource": "Other", "fundingOrganisation": null
        """, "Please specify the funding organisation.")]
    [InlineData("""
        , "email": "nope"
        """, "Please provide a valid email address.")]
    public async Task SaveIntake_ValidationFailures_Return400WithTheServersMessage_AndChangeNothing(string overrideJson, string expected)
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        // Later keys win in System.Text.Json, so the override replaces the wizard body's own value.
        var message = BadRequest(await controller.SaveIntake(participant.Id, WizardBody(overrideJson), CancellationToken.None));

        Assert.Equal(expected, message);
        // Nothing was saved: this context never ran SaveChanges for the rejected request.
        Assert.False(db.ChangeTracker.HasChanges());
    }

    [Fact]
    public async Task SaveIntake_ADraftWithNoNameAtAll_Returns400()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        var body = WizardBody() with { FirstName = "", LastName = "" };

        var message = BadRequest(await controller.SaveIntake(participant.Id, body, CancellationToken.None));

        Assert.Equal("Provide at least a first or last name to save a draft.", message);
    }

    [Fact]
    public async Task SaveIntake_UnknownParticipant_Returns404()
    {
        var (db, controller) = Create(Guid.NewGuid());
        using var _ = db;

        var result = await controller.SaveIntake(Guid.NewGuid(), WizardBody(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task SaveIntake_ForeignTenantParticipant_ReturnsNotFoundAndDoesNotModifyRow()
    {
        var ownerTenant = Guid.NewGuid();
        var database = Guid.NewGuid().ToString();
        Guid participantId;
        var (ownerDb, _) = Create(ownerTenant, database);
        using (ownerDb)
        {
            var participant = DraftWithProfileData(ownerTenant);
            participantId = participant.Id;
            ownerDb.Participants.Add(participant);
            await ownerDb.SaveChangesAsync();
        }
        var (callerDb, caller) = Create(Guid.NewGuid(), database);
        using var __ = callerDb;

        var result = await caller.SaveIntake(participantId, WizardBody(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var (verifyDb, _2) = Create(ownerTenant, database);
        using var ___ = verifyDb;
        Assert.Equal("old@example.test", (await verifyDb.Participants.SingleAsync()).Email);
    }

    [Fact]
    public async Task SaveIntake_KeepsTheLinkedEnquiryInStepWithTheParticipantsNameAndContactDetails()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var participant = DraftWithProfileData(tenantId);
        var linked = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, FirstName = "Jamie", LastName = "Rivers", Phone = "old", Email = "old@example.test", Source = "Web", Provenance = "Dr Patel" };
        var other = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Someone", LastName = "Else", Phone = "keep", Source = "Phone" };
        db.AddRange(participant, linked, other);
        await db.SaveChangesAsync();

        Ok(await controller.SaveIntake(participant.Id, WizardBody(firstName: "Corrected"), CancellationToken.None));

        Assert.Equal("Corrected", linked.FirstName);
        Assert.Equal("0400123456", linked.Phone);
        Assert.Equal("jay@example.test", linked.Email);
        // Where it came from is the enquiry's own record: an intake save does not touch it.
        Assert.Equal("Web", linked.Source);
        Assert.Equal("Dr Patel", linked.Provenance);
        Assert.Equal("keep", other.Phone);
    }

    // ── POST /participants: a retried Complete Intake does not create a second participant ──

    [Fact]
    public async Task Create_CompleteIntake_ReplayedWithTheSameRequestId_ReturnsTheFirstParticipant_AndCreatesNothingElse()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;
        var body = WizardBody(complete: true, requestId: "req-create-1");

        var first = Assert.IsType<CreatedAtActionResult>((await controller.Create(body, CancellationToken.None)).Result);
        var firstId = Assert.IsType<ApiResponse<ParticipantDetailDto>>(first.Value).Data!.Id;
        // The response was lost (a 502, a dropped connection), so the wizard sends the same body with the same key again.
        var replay = Assert.IsType<OkObjectResult>((await controller.Create(body, CancellationToken.None)).Result);
        var replayData = Assert.IsType<ApiResponse<ParticipantDetailDto>>(replay.Value).Data!;

        Assert.Equal(firstId, replayData.Id);
        Assert.Equal("Jay Rivers", replayData.FullName);
        Assert.NotNull(replayData.IntakeCompletedAt);
        Assert.Single(await db.Participants.ToListAsync());
        Assert.Single(await db.ParticipantIntakeSnapshots.ToListAsync());
        Assert.Single(await db.ParticipantOnboardings.ToListAsync());
    }

    [Fact]
    public async Task Create_CompleteIntake_WithADifferentRequestId_IsANewParticipant()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;

        Assert.IsType<CreatedAtActionResult>((await controller.Create(WizardBody(complete: true, requestId: "req-a"), CancellationToken.None)).Result);
        Assert.IsType<CreatedAtActionResult>((await controller.Create(WizardBody(complete: true, requestId: "req-b"), CancellationToken.None)).Result);

        Assert.Equal(2, await db.Participants.CountAsync());
    }

    [Fact]
    public async Task Create_CompleteIntake_ReplayInAnotherTenant_IsNotMistakenForTheFirst()
    {
        var database = Guid.NewGuid().ToString();
        var (firstDb, first) = Create(Guid.NewGuid(), database);
        using var _ = firstDb;
        var (secondDb, second) = Create(Guid.NewGuid(), database);
        using var __ = secondDb;

        Assert.IsType<CreatedAtActionResult>((await first.Create(WizardBody(complete: true, requestId: "req-shared"), CancellationToken.None)).Result);
        var other = await second.Create(WizardBody(complete: true, requestId: "req-shared"), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(other.Result);
        Assert.Equal(2, await firstDb.Participants.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task Create_WithoutACompletionRequestId_IsNeverTreatedAsAReplay()
    {
        var tenantId = Guid.NewGuid();
        var (db, controller) = Create(tenantId);
        using var _ = db;

        Assert.IsType<CreatedAtActionResult>((await controller.Create(WizardBody(), CancellationToken.None)).Result);
        Assert.IsType<CreatedAtActionResult>((await controller.Create(WizardBody(), CancellationToken.None)).Result);

        Assert.Equal(2, await db.Participants.CountAsync());
    }
}
