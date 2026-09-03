using System.Reflection;
using Microsoft.AspNetCore.Authorization;
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
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// CORE-02 — coverage for PATCH /api/v1/participants/{id} (ParticipantsController.Patch). Same EF
/// InMemory + Moq&lt;ICurrentTenant&gt; pattern as ParticipantsControllerCommunityAccessTests/
/// ParticipantsControllerTests. The load-bearing behaviours under test: group-level atomicity (a
/// present group is a mini full-submit; an absent group is never touched), the four collection
/// groups' upsert-by-key/leave-alone-on-omission contract (verbatim reuse of Create/Update's own
/// Upsert*Async helpers — no new destructive delete-on-omission logic), tenant isolation, the role
/// gate, and that cross-field validation still fires per present group.
/// </summary>
public class ParticipantsControllerPatchTests
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

    private static CreateParticipantDto MinimalCreateDto(string firstName = "Sophie", string lastName = "Brown") => new()
    {
        FirstName = firstName,
        LastName = lastName,
        PlanType = PlanType.SelfManaged,
        OvernightSupport = OvernightSupportType.None,
        OvernightRatio = SupportRatio.OneToOne,
        SupportRatio = SupportRatio.OneToOne,
    };

    private static async Task<Guid> CreateFullyPopulatedParticipantAsync(ParticipantsController controller)
    {
        var dto = MinimalCreateDto() with
        {
            MiddleName = "Jane",
            PreferredName = "Soph",
            NdisNumber = "NDIS12345",
            PlanType = PlanType.SelfManaged,
            FundingSource = ParticipantFundingSource.Ndis,
            AddressStreet = "1 Example St",
            AddressSuburb = "Sampleville",
            AddressState = "QLD",
            AddressPostcode = "4000",
            WeightKg = 60m,
            HeightCm = 165m,
            PrimaryDiagnosis = "Epilepsy",
            MedicalSummary = "Stable.",
            Consents = new List<CreateParticipantConsentDto>
            {
                new() { ConsentType = ConsentType.Privacy, Granted = true, SignedByName = "Guardian" },
            },
            HealthConditions = new List<CreateParticipantHealthConditionDto>
            {
                new() { ConditionType = HealthConditionType.Epilepsy, Has = true, Severity = "Moderate" },
            },
            AdlAssessments = new List<CreateParticipantAdlAssessmentDto>
            {
                new() { AdlType = AdlType.Dressing, Level = AdlLevel.Supervision, Notes = "Needs prompting." },
            },
            ChecklistItems = new List<CreateParticipantChecklistItemDto>
            {
                new() { ItemType = ChecklistItemType.UsesWheelchair, Value = ChecklistItemValue.Yes, Notes = "Power wheelchair." },
                new() { ItemType = ChecklistItemType.FallsRisk, Value = ChecklistItemValue.No },
            },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);
        return createdBody.Data!.Id;
    }

    private static async Task<ParticipantDetailDto> GetByIdData(ParticipantsController controller, Guid id)
    {
        var result = await controller.GetById(id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        return body.Data!;
    }

    // ── Role gate ────────────────────────────────────────────────────────

    [Fact]
    public void Patch_IsRoleGated_AdminCoordinatorSuperAdminOnly()
    {
        var method = typeof(ParticipantsController).GetMethod(nameof(ParticipantsController.Patch));
        var authorizeAttr = method!.GetCustomAttributes(typeof(AuthorizeAttribute), false)
            .Cast<AuthorizeAttribute>()
            .Single();
        Assert.Equal("Admin,Coordinator,SuperAdmin", authorizeAttr.Roles);
    }

    /// <summary>Compile-time proof, not a runtime one: PatchParticipantDto structurally cannot carry IsDraft.</summary>
    [Fact]
    public void PatchParticipantDto_HasNoIsDraftMember()
    {
        var property = typeof(PatchParticipantDto).GetProperty("IsDraft");
        Assert.Null(property);
    }

    // ── Not found / tenant isolation ─────────────────────────────────────

    [Fact]
    public async Task Patch_MissingParticipant_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

        var result = await controller.Patch(Guid.NewGuid(), new PatchParticipantDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Patch_WrongTenantParticipant_ReturnsNotFound()
    {
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();
        var dbName = Guid.NewGuid().ToString();

        // Seed a Tenant B participant using a SuperAdmin-scoped context (bypasses filters on write).
        var superTenant = new Mock<ICurrentTenant>();
        superTenant.Setup(t => t.TenantId).Returns((Guid?)null);
        superTenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var seedOptions = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        using (var seedDb = new OdipDbContext(seedOptions, superTenant.Object))
        {
            seedDb.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantBId, FirstName = "Foreign", LastName = "Participant", IsActive = true });
            await seedDb.SaveChangesAsync();
        }

        // A Tenant A-scoped caller must not be able to PATCH Tenant B's participant.
        var tenantAMock = new Mock<ICurrentTenant>();
        tenantAMock.Setup(t => t.TenantId).Returns(tenantAId);
        tenantAMock.Setup(t => t.IsSuperAdmin).Returns(false);
        var scopedOptions = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        using var scopedDb = new OdipDbContext(scopedOptions, tenantAMock.Object);
        var foreignParticipantId = await scopedDb.Participants.IgnoreQueryFilters().Select(p => p.Id).SingleAsync();

        var controller = new ParticipantsController(scopedDb, new StaffCompatibilityLinkService(scopedDb), new ParticipantDocumentService(scopedDb), new SafetyNoteSyncService(scopedDb));
        var patchDto = new PatchParticipantDto { PersonalDetails = new PatchPersonalDetailsDto { FirstName = "Hacked", LastName = "Name" } };

        var result = await controller.Patch(foreignParticipantId, patchDto, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var stored = await scopedDb.Participants.IgnoreQueryFilters().SingleAsync(p => p.Id == foreignParticipantId);
        Assert.Equal("Foreign", stored.FirstName);
    }

    // ── Group-level atomicity ─────────────────────────────────────────────

    [Fact]
    public async Task Patch_PersonalDetailsGroup_LeavesOtherGroupsUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            PersonalDetails = new PatchPersonalDetailsDto { FirstName = "Sophia", LastName = "Brown", MiddleName = "Jane" },
        };
        var result = await controller.Patch(id, patchDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(result.Result);

        var detail = await GetByIdData(controller, id);
        Assert.Equal("Sophia", detail.FirstName);

        // At least three other groups' fields survive untouched.
        Assert.Equal("NDIS12345", detail.NdisNumber); // ndisPlan
        Assert.Equal(60m, detail.WeightKg); // keyIdentifiers
        Assert.Equal("Epilepsy", detail.PrimaryDiagnosis); // medical
        Assert.Equal("1 Example St", detail.AddressStreet); // address
        Assert.Single(detail.Consents, c => c.ConsentType == ConsentType.Privacy && c.Granted == true); // consents collection
    }

    [Fact]
    public async Task Patch_AbsentGroup_IsNotClearedToNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        // Patch only KeyIdentifiers — every other group (including PersonalDetails' MiddleName/
        // PreferredName, NdisPlan, Address, Medical) must survive exactly as created, not be
        // cleared to null just because this call never mentioned them.
        var patchDto = new PatchParticipantDto
        {
            KeyIdentifiers = new PatchKeyIdentifiersDto { WeightKg = 62m, HeightCm = 165m },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        Assert.Equal(62m, detail.WeightKg);
        Assert.Equal("Jane", detail.MiddleName);
        Assert.Equal("Soph", detail.PreferredName);
        Assert.Equal("NDIS12345", detail.NdisNumber);
        Assert.Equal("1 Example St", detail.AddressStreet);
        Assert.Equal("Epilepsy", detail.PrimaryDiagnosis);
        Assert.Equal("Stable.", detail.MedicalSummary);
    }

    [Fact]
    public async Task Patch_PresentGroupWithNullMember_ClearsThatField()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        // PersonalDetails is present, but MiddleName/PreferredName are omitted (null) from this
        // submission — group-level atomicity means they're cleared, not left alone.
        var patchDto = new PatchParticipantDto
        {
            PersonalDetails = new PatchPersonalDetailsDto { FirstName = "Sophie", LastName = "Brown", MiddleName = null, PreferredName = null },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        Assert.Null(detail.MiddleName);
        Assert.Null(detail.PreferredName);
        // Unrelated groups still untouched.
        Assert.Equal("NDIS12345", detail.NdisNumber);
    }

    [Fact]
    public async Task Patch_SupportNeedsMobility_NeverTouchesChecklistItems()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            SupportNeedsMobility = new PatchSupportNeedsMobilityDto
            {
                SupportRatio = SupportRatio.OneToTwo,
                OvernightSupport = OvernightSupportType.None,
                OvernightRatio = SupportRatio.OneToOne,
                MobilityNotes = "Updated notes.",
            },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        Assert.Equal(SupportRatio.OneToTwo, detail.SupportRatio);
        Assert.Equal("Updated notes.", detail.MobilityNotes);
        var wheelchair = detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.UsesWheelchair);
        Assert.Equal(ChecklistItemValue.Yes, wheelchair.Value);
        Assert.Equal("Power wheelchair.", wheelchair.Notes);
    }

    // ── Cross-field validation still fires per present group ──────────────

    [Fact]
    public async Task Patch_NdisPlanGroup_FundingSourceOtherWithoutOrganisation_Returns400()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            NdisPlan = new PatchNdisPlanDto { PlanType = PlanType.SelfManaged, FundingSource = ParticipantFundingSource.Other, FundingOrganisation = null },
        };
        var result = await controller.Patch(id, patchDto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("funding organisation", body.Errors![0], StringComparison.OrdinalIgnoreCase);

        // Confirm nothing was mutated on a rejected patch.
        var detail = await GetByIdData(controller, id);
        Assert.Equal(ParticipantFundingSource.Ndis, detail.FundingSource);
    }

    [Fact]
    public async Task Patch_LivingArrangementGroup_FamilyWithoutMainSupportPerson_Returns400()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            LivingArrangement = new PatchLivingArrangementDto { LivingArrangement = Domain.Enums.LivingArrangement.Family, MainSupportPersonName = null },
        };
        var result = await controller.Patch(id, patchDto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("main support person", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Patch_PersonalDetailsGroup_BlankNames_Returns400()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        // PatchParticipantDto has no IsDraft — a Patch is always fully validated, never relaxed
        // to "at least one of first/last" the way a draft Create/Update can be.
        var patchDto = new PatchParticipantDto { PersonalDetails = new PatchPersonalDetailsDto { FirstName = "", LastName = "" } };
        var result = await controller.Patch(id, patchDto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // ── Role/input gates ────────────────────────────────────────────────

    [Fact]
    public async Task Patch_InvalidMobilitySupportOption_Returns400()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            SupportNeedsMobility = new PatchSupportNeedsMobilityDto
            {
                SupportRatio = SupportRatio.OneToOne,
                OvernightSupport = OvernightSupportType.None,
                OvernightRatio = SupportRatio.OneToOne,
                MobilitySupportOptions = new List<string> { "Not a real option" },
            },
        };
        var result = await controller.Patch(id, patchDto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // ── PreferredStaff isolation / compatibility-link sync gating ─────────

    [Fact]
    public async Task Patch_PreferredStaffAbsent_NeverTriggersCompatibilityLinkSync()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

        var staff = new User
        {
            Id = Guid.NewGuid(), FirstName = "Pat", LastName = "Preferred", Username = Guid.NewGuid().ToString(),
            Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var createDto = MinimalCreateDto() with { PreferredStaffId = staff.Id };
        var createResult = await controller.Create(createDto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var id = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value).Data!.Id;

        Assert.Equal(1, await db.StaffParticipantCompatibilities.CountAsync(c => c.ParticipantId == id));

        // Patch a different group entirely — PreferredStaff is absent, so the sync must never run,
        // and the existing compatibility row must survive untouched.
        var patchDto = new PatchParticipantDto { KeyIdentifiers = new PatchKeyIdentifiersDto { HairColour = "Brown" } };
        await controller.Patch(id, patchDto, CancellationToken.None);

        Assert.Equal(1, await db.StaffParticipantCompatibilities.CountAsync(c => c.ParticipantId == id && c.UserId == staff.Id));
        var detail = await GetByIdData(controller, id);
        Assert.Equal(staff.Id, detail.PreferredStaffId);
    }

    // ── Consents collection group: add, update, omitted-survives, present-with-null clears ──

    [Fact]
    public async Task Patch_ConsentsGroup_AddsUpdatesAndLeavesOmittedTypeUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller); // seeds Privacy=true

        var patchDto = new PatchParticipantDto
        {
            Consents = new List<CreateParticipantConsentDto>
            {
                new() { ConsentType = ConsentType.Privacy, Granted = false, SignedByName = "Updated Guardian" }, // update
                new() { ConsentType = ConsentType.Alcohol, Granted = true }, // add
                // TermsAndConditions, etc. are omitted entirely — must remain untouched placeholders.
            },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        var privacy = detail.Consents.Single(c => c.ConsentType == ConsentType.Privacy);
        Assert.False(privacy.Granted);
        Assert.Equal("Updated Guardian", privacy.SignedByName);

        var alcohol = detail.Consents.Single(c => c.ConsentType == ConsentType.Alcohol);
        Assert.True(alcohol.Granted);

        var terms = detail.Consents.Single(c => c.ConsentType == ConsentType.TermsAndConditions);
        Assert.Null(terms.Id);
        Assert.Null(terms.Granted);
    }

    [Fact]
    public async Task Patch_ConsentsGroup_PresentWithNullValues_ClearsExistingRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller); // seeds Privacy=true, SignedByName="Guardian"

        var patchDto = new PatchParticipantDto
        {
            Consents = new List<CreateParticipantConsentDto> { new() { ConsentType = ConsentType.Privacy, Granted = null, SignedByName = null, SignedDate = null } },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        var privacy = detail.Consents.Single(c => c.ConsentType == ConsentType.Privacy);
        Assert.NotNull(privacy.Id); // row still exists — cleared, not deleted
        Assert.Null(privacy.Granted);
        Assert.Null(privacy.SignedByName);
    }

    // ── HealthConditions collection group ──────────────────────────────

    [Fact]
    public async Task Patch_HealthConditionsGroup_AddsUpdatesAndLeavesOmittedTypeUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller); // seeds Epilepsy Has=true, Severity="Moderate"

        var patchDto = new PatchParticipantDto
        {
            HealthConditions = new List<CreateParticipantHealthConditionDto>
            {
                new() { ConditionType = HealthConditionType.Epilepsy, Has = true, Severity = "Severe" }, // update
                new() { ConditionType = HealthConditionType.Asthma, Has = true }, // add
            },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        Assert.Equal("Severe", detail.HealthConditions.Single(c => c.ConditionType == HealthConditionType.Epilepsy).Severity);
        Assert.True(detail.HealthConditions.Single(c => c.ConditionType == HealthConditionType.Asthma).Has);
        var untouched = detail.HealthConditions.Single(c => c.ConditionType == HealthConditionType.Diabetes);
        Assert.Null(untouched.Id);
    }

    [Fact]
    public async Task Patch_HealthConditionsGroup_PresentWithNullValues_ClearsExistingRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            HealthConditions = new List<CreateParticipantHealthConditionDto> { new() { ConditionType = HealthConditionType.Epilepsy, Has = null, Severity = null } },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        var epilepsy = detail.HealthConditions.Single(c => c.ConditionType == HealthConditionType.Epilepsy);
        Assert.NotNull(epilepsy.Id);
        Assert.Null(epilepsy.Has);
        Assert.Null(epilepsy.Severity);
    }

    // ── AdlAssessments collection group ─────────────────────────────────

    [Fact]
    public async Task Patch_AdlAssessmentsGroup_AddsUpdatesAndLeavesOmittedTypeUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller); // seeds Dressing/Supervision

        var patchDto = new PatchParticipantDto
        {
            AdlAssessments = new List<CreateParticipantAdlAssessmentDto>
            {
                new() { AdlType = AdlType.Dressing, Level = AdlLevel.Assistance, Notes = "Reassessed." }, // update
                new() { AdlType = AdlType.Bathing, Level = AdlLevel.FullSupport }, // add
            },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        Assert.Equal(AdlLevel.Assistance, detail.AdlAssessments.Single(a => a.AdlType == AdlType.Dressing).Level);
        Assert.Equal(AdlLevel.FullSupport, detail.AdlAssessments.Single(a => a.AdlType == AdlType.Bathing).Level);
        var untouched = detail.AdlAssessments.Single(a => a.AdlType == AdlType.Toileting);
        Assert.Null(untouched.Id);
    }

    [Fact]
    public async Task Patch_AdlAssessmentsGroup_PresentWithNullValues_ClearsExistingRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            AdlAssessments = new List<CreateParticipantAdlAssessmentDto> { new() { AdlType = AdlType.Dressing, Level = null, Notes = null } },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        var dressing = detail.AdlAssessments.Single(a => a.AdlType == AdlType.Dressing);
        Assert.NotNull(dressing.Id);
        Assert.Null(dressing.Level);
        Assert.Null(dressing.Notes);
    }

    // ── ChecklistItems collection group (the split-across-two-steps case) ─

    [Fact]
    public async Task Patch_ChecklistItemsGroup_AddsUpdatesAndLeavesOmittedTypeUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller); // seeds UsesWheelchair=Yes, FallsRisk=No

        // Simulates a step-5-scoped save: only its own item-types are sent; FallsRisk (which this
        // fixture also seeded) belongs to a different step's row range and is omitted entirely.
        var patchDto = new PatchParticipantDto
        {
            ChecklistItems = new List<CreateParticipantChecklistItemDto>
            {
                new() { ItemType = ChecklistItemType.UsesWheelchair, Value = ChecklistItemValue.NotApplicable, Notes = "Reassessed." }, // update
                new() { ItemType = ChecklistItemType.WalkingFrameOrAids, Value = ChecklistItemValue.Yes }, // add
            },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        Assert.Equal(ChecklistItemValue.NotApplicable, detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.UsesWheelchair).Value);
        Assert.Equal(ChecklistItemValue.Yes, detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.WalkingFrameOrAids).Value);

        // FallsRisk was omitted from this "other step's" patch — it survives exactly as seeded,
        // proving a step-scoped caller can safely omit rows it doesn't own.
        var fallsRisk = detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.FallsRisk);
        Assert.NotNull(fallsRisk.Id);
        Assert.Equal(ChecklistItemValue.No, fallsRisk.Value);
    }

    [Fact]
    public async Task Patch_ChecklistItemsGroup_PresentWithNullValues_ClearsExistingRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        // Sending the type WITH every field null clears the row — this is the sharp edge a
        // step-scoped caller must never hit for a type it doesn't own (see PatchParticipantDto's
        // ChecklistItems doc): here it's exercised deliberately, for the type the caller DOES own.
        var patchDto = new PatchParticipantDto
        {
            ChecklistItems = new List<CreateParticipantChecklistItemDto> { new() { ItemType = ChecklistItemType.UsesWheelchair, Value = null, Notes = null } },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        var wheelchair = detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.UsesWheelchair);
        Assert.NotNull(wheelchair.Id); // cleared, not deleted
        Assert.Null(wheelchair.Value);
        Assert.Null(wheelchair.Notes);

        // FallsRisk (a different type, entirely absent from this patch) is unaffected.
        var fallsRisk = detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.FallsRisk);
        Assert.Equal(ChecklistItemValue.No, fallsRisk.Value);
    }

    [Fact]
    public async Task Patch_NonCollectionGroup_LeavesAllFourCollectionsUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            PersonalDetails = new PatchPersonalDetailsDto { FirstName = "Sophie", LastName = "Brown" },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var detail = await GetByIdData(controller, id);
        Assert.True(detail.Consents.Single(c => c.ConsentType == ConsentType.Privacy).Granted);
        Assert.True(detail.HealthConditions.Single(c => c.ConditionType == HealthConditionType.Epilepsy).Has);
        Assert.Equal(AdlLevel.Supervision, detail.AdlAssessments.Single(a => a.AdlType == AdlType.Dressing).Level);
        Assert.Equal(ChecklistItemValue.Yes, detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.UsesWheelchair).Value);
    }

    // ── PF-10.4 (SPEC-05): communityAccessBehaviour also carries OverallCommunityAccessRiskRating ──

    [Fact]
    public async Task Patch_CommunityAccessBehaviourGroup_SetsOverallCommunityAccessRiskRating_WithoutTouchingTheRiskItemsCollection()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        // Seed a risk-item row directly (the Profile wizard's Community Access section saves this
        // 22-row collection via its own nested-CRUD endpoint, not this PATCH group — see
        // PatchCommunityAccessBehaviourDto's doc).
        db.ParticipantCommunityAccessRiskItems.Add(new ParticipantCommunityAccessRiskItem
        {
            Id = Guid.NewGuid(), ParticipantId = id, ItemType = CommunityAccessRiskItemType.GeneralRoadAwareness,
            Rating = RiskRatingLevel.High, StrategyNotes = "Always accompanied near roads.",
        });
        await db.SaveChangesAsync();

        var patchDto = new PatchParticipantDto
        {
            CommunityAccessBehaviour = new PatchCommunityAccessBehaviourDto
            {
                SignsHappyAndSettled = "Humming quietly.",
                OverallCommunityAccessRiskRating = RiskRatingLevel.Medium,
            },
        };
        var result = await controller.Patch(id, patchDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(result.Result);

        var detail = await GetByIdData(controller, id);
        Assert.Equal("Humming quietly.", detail.SignsHappyAndSettled);
        Assert.Equal(RiskRatingLevel.Medium, detail.OverallCommunityAccessRiskRating);
        // The nested-CRUD-owned risk-items collection is untouched by this PATCH group.
        var roadAwareness = detail.CommunityAccessRiskItems.Single(r => r.ItemType == CommunityAccessRiskItemType.GeneralRoadAwareness);
        Assert.Equal(RiskRatingLevel.High, roadAwareness.Rating);
        Assert.Equal("Always accompanied near roads.", roadAwareness.StrategyNotes);
    }

    // ── PD-5 item 5c: the 4 safety-critical partial-save groups sync the auto-note ──────────

    [Fact]
    public async Task Patch_MedicalGroup_SyncsAllergiesSafetyAutoNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);
        Assert.False(await db.ParticipantNotes.AnyAsync(n => n.SourceKey == "safety:allergies"));

        var patchDto = new PatchParticipantDto
        {
            Medical = new PatchMedicalDto { PrimaryDiagnosis = "Epilepsy", AllergiesDetail = "Penicillin", MedicalSummary = "Stable." },
        };
        var result = await controller.Patch(id, patchDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(result.Result);

        var note = await db.ParticipantNotes.SingleAsync(n => n.ParticipantId == id && n.SourceKey == "safety:allergies");
        Assert.Contains("Penicillin", note.Description);
    }

    [Fact]
    public async Task Patch_BehaviourCommunicationGroup_SyncsBehavioursOfConcernSafetyAutoNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            BehaviourCommunication = new PatchBehaviourCommunicationDto { BehavioursOfConcernCurrent = true },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        Assert.True(await db.ParticipantNotes.AnyAsync(n => n.ParticipantId == id && n.SourceKey == "safety:behavioursOfConcern"));
    }

    [Fact]
    public async Task Patch_RisksHazardsSummaryGroup_SyncsRisksHazardsSafetyAutoNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            RisksHazardsSummary = new PatchRisksHazardsSummaryDto { BehaviourRiskSummary = "Elopement risk near roads." },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var note = await db.ParticipantNotes.SingleAsync(n => n.ParticipantId == id && n.SourceKey == "safety:risksHazards");
        Assert.Contains("Elopement risk near roads.", note.Description);
    }

    [Fact]
    public async Task Patch_SupportNeedsMobilityGroup_SyncsFallsRiskSafetyAutoNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            SupportNeedsMobility = new PatchSupportNeedsMobilityDto { FallsRiskRating = RiskRatingLevel.High },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        var note = await db.ParticipantNotes.SingleAsync(n => n.ParticipantId == id && n.SourceKey == "safety:fallsRisk");
        Assert.Contains("High", note.Description);
    }

    [Fact]
    public async Task Patch_PersonalDetailsGroupOnly_DoesNotRunSafetyNoteSync()
    {
        // No safety-critical group present — the sync pass is skipped entirely (no note churn).
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        var id = await CreateFullyPopulatedParticipantAsync(controller);

        var patchDto = new PatchParticipantDto
        {
            PersonalDetails = new PatchPersonalDetailsDto { FirstName = "Renamed", LastName = "Brown" },
        };
        await controller.Patch(id, patchDto, CancellationToken.None);

        Assert.False(await db.ParticipantNotes.AnyAsync(n => n.ParticipantId == id && n.SourceKey != null));
    }
}
