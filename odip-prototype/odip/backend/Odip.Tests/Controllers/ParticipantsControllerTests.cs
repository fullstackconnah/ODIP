using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Covers <see cref="Participant.HasRestrictivePracticeFlag"/>'s derived-on-read semantics
/// (task 5): the flag is no longer independently writable via create/update — it is computed as
/// true iff the participant has any active <see cref="Domain.Entities.RestrictivePractice"/>
/// register row. Same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as
/// ParticipantRoutinesControllerTests.
/// </summary>
public class ParticipantsControllerTests
{
    private static readonly JsonSerializerOptions ApiJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() }
    };

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
        PlanType = Domain.Enums.PlanType.SelfManaged,
        OvernightSupport = Domain.Enums.OvernightSupportType.None,
        OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
        SupportRatio = Domain.Enums.SupportRatio.OneToOne,
    };

    [Fact]
    public async Task GetById_NoRegisterRows_HasRestrictivePracticeFlagIsFalse()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetById(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.False(body.Data!.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task GetById_HasActiveRegisterRow_HasRestrictivePracticeFlagIsTrue()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.RestrictivePractices.Add(new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "Seclusion room", IsActive = true,
        });
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetById(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task GetById_OnlyInactiveRegisterRows_HasRestrictivePracticeFlagIsFalse()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.RestrictivePractices.Add(new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "Retired restraint", IsActive = false,
        });
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetById(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.False(body.Data!.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task GetAll_ProjectsDerivedFlagPerParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var withFlag = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var withoutFlag = new Participant { Id = Guid.NewGuid(), FirstName = "Harrison", LastName = "Lee", IsActive = true };
        db.Participants.AddRange(withFlag, withoutFlag);
        db.RestrictivePractices.Add(new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = withFlag.Id, Description = "Active restraint", IsActive = true,
        });
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetAll(null, null, null, null, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.Items.Single(p => p.Id == withFlag.Id).HasRestrictivePracticeFlag);
        Assert.False(body.Data.Items.Single(p => p.Id == withoutFlag.Id).HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task Create_ServiceStreamsFlags_RoundTripThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { ServiceStreams = Domain.Enums.ServiceStreams.STA | Domain.Enums.ServiceStreams.Trip };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Equal(Domain.Enums.ServiceStreams.STA | Domain.Enums.ServiceStreams.Trip, body.Data!.ServiceStreams);
        Assert.True(body.Data.ServiceStreams.HasFlag(Domain.Enums.ServiceStreams.STA));
        Assert.True(body.Data.ServiceStreams.HasFlag(Domain.Enums.ServiceStreams.Trip));
        Assert.False(body.Data.ServiceStreams.HasFlag(Domain.Enums.ServiceStreams.BSP));
    }

    [Fact]
    public async Task Create_GenderAndPlanDates_RoundTripThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            Gender = Domain.Enums.Gender.NonBinary,
            PlanStartDate = new DateOnly(2026, 1, 1),
            PlanEndDate = new DateOnly(2026, 12, 31),
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Equal(Domain.Enums.Gender.NonBinary, body.Data!.Gender);
        Assert.Equal(new DateOnly(2026, 1, 1), body.Data.PlanStartDate);
        Assert.Equal(new DateOnly(2026, 12, 31), body.Data.PlanEndDate);
    }

    [Fact]
    public async Task Create_GenderOtherWithoutSelfDescription_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { Gender = Domain.Enums.Gender.Other, GenderSelfDescription = null };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("self-description", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_GenderOtherWithSelfDescription_Succeeds()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { Gender = Domain.Enums.Gender.Other, GenderSelfDescription = "Genderfluid" };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal("Genderfluid", body.Data!.GenderSelfDescription);
    }

    [Fact]
    public async Task Update_ServiceStreamsFlags_RoundTripThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            ServiceStreams = Domain.Enums.ServiceStreams.BSP | Domain.Enums.ServiceStreams.CommunityNursing,
        };

        var updateResult = await controller.Update(participant.Id, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        var getResult = await controller.GetById(participant.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal(Domain.Enums.ServiceStreams.BSP | Domain.Enums.ServiceStreams.CommunityNursing, body.Data!.ServiceStreams);
    }

    [Fact]
    public void ParticipantListDto_CombinedServiceStreams_SerialisesAsCommaSeparatedString()
    {
        // Proves the actual wire format the frontend receives: JsonStringEnumConverter (registered
        // globally in Program.cs — see ApiJsonOptions here) natively serialises a combined [Flags]
        // value as a comma-separated list of member names, and Enum.Parse/JsonStringEnumConverter
        // read that same format back on input — no custom List<string> conversion needed.
        var dto = new ParticipantListDto
        {
            Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", FullName = "Sophie Brown",
            ServiceStreams = Domain.Enums.ServiceStreams.STA | Domain.Enums.ServiceStreams.Trip,
        };

        var json = JsonSerializer.Serialize(dto, ApiJsonOptions);
        using var doc = JsonDocument.Parse(json);
        var value = doc.RootElement.GetProperty("serviceStreams").GetString();

        Assert.Equal("STA, Trip", value);

        var roundTripped = JsonSerializer.Deserialize<ParticipantListDto>(json, ApiJsonOptions);
        Assert.Equal(Domain.Enums.ServiceStreams.STA | Domain.Enums.ServiceStreams.Trip, roundTripped!.ServiceStreams);
    }

    [Fact]
    public void ParticipantListDto_NoServiceStreams_SerialisesAsNone()
    {
        var dto = new ParticipantListDto { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", FullName = "Sophie Brown" };

        var json = JsonSerializer.Serialize(dto, ApiJsonOptions);
        using var doc = JsonDocument.Parse(json);

        Assert.Equal("None", doc.RootElement.GetProperty("serviceStreams").GetString());
    }

    [Fact]
    public async Task Create_DefaultServiceStreams_IsNone()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var createResult = await controller.Create(MinimalCreateDto(), CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var saved = await db.Participants.SingleAsync(p => p.Id == createdBody.Data!.Id);
        Assert.Equal(Domain.Enums.ServiceStreams.None, saved.ServiceStreams);
    }

    // ── INTAKE-09: risk entries created transactionally with the participant ───────

    [Fact]
    public async Task Create_WithRiskEntries_CreatesThemTransactionallyWithParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            RiskEntries = new()
            {
                new CreateParticipantRiskEntryDto { AtRiskParty = Domain.Enums.AtRiskParty.Participant, Description = "Risk of falls.", MitigationNotes = "Use the hoist." },
                new CreateParticipantRiskEntryDto { AtRiskParty = Domain.Enums.AtRiskParty.Staff, Description = "Risk of aggression towards staff." },
            },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var saved = await db.ParticipantRiskEntries.Where(r => r.ParticipantId == createdBody.Data!.Id).ToListAsync();
        Assert.Equal(2, saved.Count);
        Assert.Contains(saved, r => r.AtRiskParty == Domain.Enums.AtRiskParty.Participant && r.Description == "Risk of falls." && r.MitigationNotes == "Use the hoist.");
        Assert.Contains(saved, r => r.AtRiskParty == Domain.Enums.AtRiskParty.Staff && r.Description == "Risk of aggression towards staff." && r.MitigationNotes == null);
    }

    [Fact]
    public async Task Create_WithRiskEntries_TenantScoped_RiskEntriesGetSameTenantIdAsParticipant()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options, tenant.Object);
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            RiskEntries = new() { new CreateParticipantRiskEntryDto { AtRiskParty = Domain.Enums.AtRiskParty.Public, Description = "Risk to the public in community outings." } },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var savedEntry = await db.ParticipantRiskEntries.IgnoreQueryFilters().SingleAsync(r => r.ParticipantId == createdBody.Data!.Id);
        Assert.Equal(tenantId, savedEntry.TenantId);
    }

    [Fact]
    public async Task Create_NoRiskEntries_CreatesParticipantWithNoRiskEntries()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var createResult = await controller.Create(MinimalCreateDto(), CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        Assert.False(await db.ParticipantRiskEntries.AnyAsync(r => r.ParticipantId == createdBody.Data!.Id));
    }

    // ── INTAKE sub-wave B: consent rows upserted transactionally with the participant ───

    [Fact]
    public async Task Create_WithConsents_CreatesThemTransactionallyWithParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            Consents = new()
            {
                new CreateParticipantConsentDto { ConsentType = Domain.Enums.ConsentType.PhotoVideo, Granted = true, SignedByName = "Sophie Brown", SignedDate = new DateOnly(2026, 1, 1) },
                new CreateParticipantConsentDto { ConsentType = Domain.Enums.ConsentType.Alcohol, Granted = false },
            },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var saved = await db.ParticipantConsents.Where(c => c.ParticipantId == createdBody.Data!.Id).ToListAsync();
        Assert.Equal(2, saved.Count);
        Assert.Contains(saved, c => c.ConsentType == Domain.Enums.ConsentType.PhotoVideo && c.Granted == true && c.SignedByName == "Sophie Brown");
        Assert.Contains(saved, c => c.ConsentType == Domain.Enums.ConsentType.Alcohol && c.Granted == false && c.SignedByName == null);
    }

    [Fact]
    public async Task Create_DraftWithPartialConsents_Succeeds()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            IsDraft = true,
            Consents = new() { new CreateParticipantConsentDto { ConsentType = Domain.Enums.ConsentType.Privacy, Granted = true } },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        Assert.Equal(1, await db.ParticipantConsents.CountAsync(c => c.ParticipantId == createdBody.Data!.Id));
    }

    [Fact]
    public async Task Create_GrantedFalseVsNull_RoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            Consents = new() { new CreateParticipantConsentDto { ConsentType = Domain.Enums.ConsentType.TravelInsurance, Granted = false } },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Equal(7, body.Data!.Consents.Count);
        var travelInsurance = body.Data.Consents.Single(c => c.ConsentType == Domain.Enums.ConsentType.TravelInsurance);
        Assert.False(travelInsurance.Granted); // explicitly declined, not merely absent
        var neverAnswered = body.Data.Consents.Single(c => c.ConsentType == Domain.Enums.ConsentType.PhotoVideo);
        Assert.Null(neverAnswered.Granted); // not yet answered
    }

    [Fact]
    public async Task GetById_NoConsentRows_StillReturnsAllSevenAsSynthesizedPlaceholders()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetById(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(7, body.Data!.Consents.Count);
        Assert.All(body.Data.Consents, c => Assert.Null(c.Id));
    }

    [Fact]
    public async Task Update_WithConsents_UpsertsSameRows_DoesNotDuplicate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            Consents = new() { new CreateParticipantConsentDto { ConsentType = Domain.Enums.ConsentType.Privacy, Granted = false } },
        };

        await controller.Update(participant.Id, updateDto, CancellationToken.None);
        await controller.Update(participant.Id, updateDto with
        {
            Consents = new() { new CreateParticipantConsentDto { ConsentType = Domain.Enums.ConsentType.Privacy, Granted = true, SignedByName = "Sophie Brown" } },
        }, CancellationToken.None);

        var saved = await db.ParticipantConsents.Where(c => c.ParticipantId == participant.Id).ToListAsync();
        var single = Assert.Single(saved);
        Assert.True(single.Granted);
        Assert.Equal("Sophie Brown", single.SignedByName);
    }

    [Fact]
    public async Task Create_WithConsents_TenantScoped_ConsentsGetSameTenantIdAsParticipant()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options, tenant.Object);
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            Consents = new() { new CreateParticipantConsentDto { ConsentType = Domain.Enums.ConsentType.Privacy, Granted = true } },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var savedConsent = await db.ParticipantConsents.IgnoreQueryFilters().SingleAsync(c => c.ParticipantId == createdBody.Data!.Id);
        Assert.Equal(tenantId, savedConsent.TenantId);
    }

    /// <summary>
    /// Review-round polish: the exact scenario UpsertConsentsAsync's early-return guard defends —
    /// a caller (e.g. ParticipantsPage's isActive-only toggle) that PUTs an UpdateParticipantDto
    /// without ever touching Consents (defaults to an empty list) must not wipe/no-op away the
    /// participant's already-answered consent rows just because this particular save didn't
    /// mention them.
    /// </summary>
    [Fact]
    public async Task Update_WithoutConsentsField_LeavesExistingConsentRowsUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var withConsent = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            Consents = new() { new CreateParticipantConsentDto { ConsentType = Domain.Enums.ConsentType.Privacy, Granted = true, SignedByName = "Sophie Brown" } },
        };
        await controller.Update(participant.Id, withConsent, CancellationToken.None);

        // A later, unrelated save (e.g. an isActive toggle from the participants list) that never
        // mentions Consents at all — same shape as any DTO caller built before this field existed.
        var toggleOnly = withConsent with { Consents = new(), IsActive = false };
        await controller.Update(participant.Id, toggleOnly, CancellationToken.None);

        var saved = await db.ParticipantConsents.Where(c => c.ParticipantId == participant.Id).ToListAsync();
        var single = Assert.Single(saved);
        Assert.True(single.Granted);
        Assert.Equal("Sophie Brown", single.SignedByName);
    }

    /// <summary>
    /// Proves the null-guard added alongside the empty-list guard above: System.Text.Json
    /// overwrites CreateParticipantDto.Consents' `= new()` initializer with an explicit null when
    /// a raw request body includes `"consents": null` (present-but-null, unlike an omitted
    /// property) — UpsertConsentsAsync must treat that the same as "don't touch consents", not NRE.
    /// </summary>
    [Fact]
    public async Task Update_ConsentsExplicitlyNull_DoesNotThrow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var dto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            Consents = null!,
        };

        var result = await controller.Update(participant.Id, dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.False(await db.ParticipantConsents.AnyAsync(c => c.ParticipantId == participant.Id));
    }

    // ── INTAKE sub-wave C1: health-condition grid rows upserted transactionally with the participant ───

    [Fact]
    public async Task Create_WithHealthConditions_CreatesThemTransactionallyWithParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            HealthConditions = new()
            {
                new CreateParticipantHealthConditionDto { ConditionType = Domain.Enums.HealthConditionType.Epilepsy, Has = true, Severity = "GrandMal", PlanProvided = true, TrainingRequired = true },
                new CreateParticipantHealthConditionDto { ConditionType = Domain.Enums.HealthConditionType.Asthma, Has = false },
            },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var saved = await db.ParticipantHealthConditions.Where(c => c.ParticipantId == createdBody.Data!.Id).ToListAsync();
        Assert.Equal(2, saved.Count);
        Assert.Contains(saved, c => c.ConditionType == Domain.Enums.HealthConditionType.Epilepsy && c.Has == true && c.Severity == "GrandMal" && c.PlanProvided == true && c.TrainingRequired == true);
        Assert.Contains(saved, c => c.ConditionType == Domain.Enums.HealthConditionType.Asthma && c.Has == false);
    }

    [Fact]
    public async Task GetById_NoHealthConditionRows_StillReturnsAllTenAsSynthesizedPlaceholders()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetById(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(10, body.Data!.HealthConditions.Count);
        Assert.All(body.Data.HealthConditions, c => Assert.Null(c.Id));
        Assert.Equal(Enum.GetValues<Domain.Enums.HealthConditionType>().ToHashSet(), body.Data.HealthConditions.Select(c => c.ConditionType).ToHashSet());
    }

    [Fact]
    public async Task Update_WithHealthConditions_UpsertsSameRows_DoesNotDuplicate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            HealthConditions = new() { new CreateParticipantHealthConditionDto { ConditionType = Domain.Enums.HealthConditionType.Diabetes, Has = false } },
        };

        await controller.Update(participant.Id, updateDto, CancellationToken.None);
        await controller.Update(participant.Id, updateDto with
        {
            HealthConditions = new() { new CreateParticipantHealthConditionDto { ConditionType = Domain.Enums.HealthConditionType.Diabetes, Has = true, Severity = "Type2", PlanProvided = true } },
        }, CancellationToken.None);

        var saved = await db.ParticipantHealthConditions.Where(c => c.ParticipantId == participant.Id).ToListAsync();
        var single = Assert.Single(saved);
        Assert.True(single.Has);
        Assert.Equal("Type2", single.Severity);
        Assert.True(single.PlanProvided);
    }

    /// <summary>
    /// Mirrors Update_WithoutConsentsField_LeavesExistingConsentRowsUntouched — the same
    /// load-bearing empty/null guard copied onto UpsertHealthConditionsAsync (this PR's brief).
    /// </summary>
    [Fact]
    public async Task Update_WithoutHealthConditionsField_LeavesExistingRowsUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var withCondition = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            HealthConditions = new() { new CreateParticipantHealthConditionDto { ConditionType = Domain.Enums.HealthConditionType.Epilepsy, Has = true, PlanProvided = true } },
        };
        await controller.Update(participant.Id, withCondition, CancellationToken.None);

        // A later, unrelated save (e.g. an isActive toggle) that never mentions HealthConditions at
        // all — same shape as any DTO caller built before this field existed.
        var toggleOnly = withCondition with { HealthConditions = new(), IsActive = false };
        await controller.Update(participant.Id, toggleOnly, CancellationToken.None);

        var saved = await db.ParticipantHealthConditions.Where(c => c.ParticipantId == participant.Id).ToListAsync();
        var single = Assert.Single(saved);
        Assert.True(single.Has);
        Assert.True(single.PlanProvided);
    }

    /// <summary>Mirrors Update_ConsentsExplicitlyNull_DoesNotThrow for the health-conditions guard.</summary>
    [Fact]
    public async Task Update_HealthConditionsExplicitlyNull_DoesNotThrow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var dto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            HealthConditions = null!,
        };

        var result = await controller.Update(participant.Id, dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.False(await db.ParticipantHealthConditions.AnyAsync(c => c.ParticipantId == participant.Id));
    }

    [Fact]
    public async Task Create_WithHealthConditions_TenantScoped_RowsGetSameTenantIdAsParticipant()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options, tenant.Object);
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            HealthConditions = new() { new CreateParticipantHealthConditionDto { ConditionType = Domain.Enums.HealthConditionType.Asthma, Has = true } },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var savedRow = await db.ParticipantHealthConditions.IgnoreQueryFilters().SingleAsync(c => c.ParticipantId == createdBody.Data!.Id);
        Assert.Equal(tenantId, savedRow.TenantId);
    }

    [Fact]
    public async Task Create_DraftWithPartialHealthConditions_Succeeds()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            IsDraft = true,
            HealthConditions = new() { new CreateParticipantHealthConditionDto { ConditionType = Domain.Enums.HealthConditionType.MentalHealth, Has = true } },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        Assert.Equal(1, await db.ParticipantHealthConditions.CountAsync(c => c.ParticipantId == createdBody.Data!.Id));
    }

    /// <summary>
    /// Covers the new flat Mobility &amp; Functional / Behaviour &amp; Communication / Allergies
    /// columns' round-trip through Create -&gt; GetById, including a value from each of the new
    /// enums (AmbulantStatus/FallsRiskRating/LevelOfPersonalCare/Memory/BehaviourRiskRating).
    /// </summary>
    [Fact]
    public async Task Create_WithClinicalEnrichmentFields_RoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            AllergiesDetail = "Peanuts", IsAnaphylaxisRisk = true, AllergyManagementNotes = "EpiPen in bag",
            AmbulantStatus = Domain.Enums.AmbulantStatus.Frame,
            FallsRiskRating = Domain.Enums.RiskRatingLevel.High,
            UnevenGroundFlag = true,
            LevelOfPersonalCare = Domain.Enums.PersonalCareLevel.OnePerson,
            Orthotics = "AFO both feet",
            ContinenceSupportDetail = "Pads, prompted",
            BowelCareDetail = "Colostomy, staff-trained",
            MenstruationSupport = "Verbal prompting",
            SkinIntegrity = "Pressure area on left heel",
            Memory = Domain.Enums.MemoryLevel.Fair,
            MemoryAids = true,
            ImpairedUnderstanding = false,
            ImpairedJudgementReasoning = false,
            BehavioursOfConcernCurrent = true,
            BehavioursOfConcernFiveYearHistory = true,
            BehaviourRiskRating = Domain.Enums.RiskRatingLevel.Medium,
            RidsLogged = true, BspPlanProvided = true, BocChartProvided = false,
            ExpressiveSkills = "High, verbal",
            ReceptiveSkills = "High",
            ReadingAbility = "Good",
            CommunicationAids = "None",
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Equal("Peanuts", body.Data!.AllergiesDetail);
        Assert.True(body.Data.IsAnaphylaxisRisk);
        Assert.Equal(Domain.Enums.AmbulantStatus.Frame, body.Data.AmbulantStatus);
        Assert.Equal(Domain.Enums.RiskRatingLevel.High, body.Data.FallsRiskRating);
        Assert.True(body.Data.UnevenGroundFlag);
        Assert.Equal(Domain.Enums.PersonalCareLevel.OnePerson, body.Data.LevelOfPersonalCare);
        Assert.Equal(Domain.Enums.MemoryLevel.Fair, body.Data.Memory);
        Assert.Equal(Domain.Enums.RiskRatingLevel.Medium, body.Data.BehaviourRiskRating);
        Assert.True(body.Data.RidsLogged);
        Assert.Equal("None", body.Data.CommunicationAids);
    }

    // ── INTAKE sub-wave C2: ADL-assessment grid rows upserted transactionally with the participant ───

    [Fact]
    public async Task Create_WithAdlAssessments_CreatesThemTransactionallyWithParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            AdlAssessments = new()
            {
                new CreateParticipantAdlAssessmentDto { AdlType = Domain.Enums.AdlType.Dressing, Level = Domain.Enums.AdlLevel.Independent },
                new CreateParticipantAdlAssessmentDto { AdlType = Domain.Enums.AdlType.CommunityAccess, Level = Domain.Enums.AdlLevel.Assistance, Notes = "1:1 supervision" },
            },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var saved = await db.ParticipantAdlAssessments.Where(a => a.ParticipantId == createdBody.Data!.Id).ToListAsync();
        Assert.Equal(2, saved.Count);
        Assert.Contains(saved, a => a.AdlType == Domain.Enums.AdlType.Dressing && a.Level == Domain.Enums.AdlLevel.Independent);
        Assert.Contains(saved, a => a.AdlType == Domain.Enums.AdlType.CommunityAccess && a.Level == Domain.Enums.AdlLevel.Assistance && a.Notes == "1:1 supervision");
    }

    [Fact]
    public async Task GetById_NoAdlAssessmentRows_StillReturnsAllTwentyAsSynthesizedPlaceholders()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetById(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(20, body.Data!.AdlAssessments.Count);
        Assert.All(body.Data.AdlAssessments, a => Assert.Null(a.Id));
        Assert.Equal(Enum.GetValues<Domain.Enums.AdlType>().ToHashSet(), body.Data.AdlAssessments.Select(a => a.AdlType).ToHashSet());
    }

    [Fact]
    public async Task Update_WithAdlAssessments_UpsertsSameRows_DoesNotDuplicate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            AdlAssessments = new() { new CreateParticipantAdlAssessmentDto { AdlType = Domain.Enums.AdlType.Kitchen, Level = Domain.Enums.AdlLevel.Independent } },
        };

        await controller.Update(participant.Id, updateDto, CancellationToken.None);
        await controller.Update(participant.Id, updateDto with
        {
            AdlAssessments = new() { new CreateParticipantAdlAssessmentDto { AdlType = Domain.Enums.AdlType.Kitchen, Level = Domain.Enums.AdlLevel.Assistance, Notes = "Reassessed" } },
        }, CancellationToken.None);

        var saved = await db.ParticipantAdlAssessments.Where(a => a.ParticipantId == participant.Id).ToListAsync();
        var single = Assert.Single(saved);
        Assert.Equal(Domain.Enums.AdlLevel.Assistance, single.Level);
        Assert.Equal("Reassessed", single.Notes);
    }

    /// <summary>Mirrors Update_WithoutHealthConditionsField_LeavesExistingRowsUntouched — the same load-bearing empty/null guard copied onto UpsertAdlAssessmentsAsync (this PR's brief).</summary>
    [Fact]
    public async Task Update_WithoutAdlAssessmentsField_LeavesExistingRowsUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var withAssessment = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            AdlAssessments = new() { new CreateParticipantAdlAssessmentDto { AdlType = Domain.Enums.AdlType.Bathing, Level = Domain.Enums.AdlLevel.Supervision } },
        };
        await controller.Update(participant.Id, withAssessment, CancellationToken.None);

        // A later, unrelated save (e.g. an isActive toggle) that never mentions AdlAssessments at
        // all — same shape as any DTO caller built before this field existed.
        var toggleOnly = withAssessment with { AdlAssessments = new(), IsActive = false };
        await controller.Update(participant.Id, toggleOnly, CancellationToken.None);

        var saved = await db.ParticipantAdlAssessments.Where(a => a.ParticipantId == participant.Id).ToListAsync();
        var single = Assert.Single(saved);
        Assert.Equal(Domain.Enums.AdlLevel.Supervision, single.Level);
    }

    /// <summary>Mirrors Update_HealthConditionsExplicitlyNull_DoesNotThrow for the ADL-assessment guard.</summary>
    [Fact]
    public async Task Update_AdlAssessmentsExplicitlyNull_DoesNotThrow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var dto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            AdlAssessments = null!,
        };

        var result = await controller.Update(participant.Id, dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.False(await db.ParticipantAdlAssessments.AnyAsync(a => a.ParticipantId == participant.Id));
    }

    [Fact]
    public async Task Create_WithAdlAssessments_TenantScoped_RowsGetSameTenantIdAsParticipant()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options, tenant.Object);
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            AdlAssessments = new() { new CreateParticipantAdlAssessmentDto { AdlType = Domain.Enums.AdlType.Shopping, Level = Domain.Enums.AdlLevel.Supervision } },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var savedRow = await db.ParticipantAdlAssessments.IgnoreQueryFilters().SingleAsync(a => a.ParticipantId == createdBody.Data!.Id);
        Assert.Equal(tenantId, savedRow.TenantId);
    }

    [Fact]
    public async Task Create_DraftWithPartialAdlAssessments_Succeeds()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            IsDraft = true,
            AdlAssessments = new() { new CreateParticipantAdlAssessmentDto { AdlType = Domain.Enums.AdlType.Toileting, Level = Domain.Enums.AdlLevel.FullSupport } },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        Assert.Equal(1, await db.ParticipantAdlAssessments.CountAsync(a => a.ParticipantId == createdBody.Data!.Id));
    }

    // ── Review-round fix: the wizard's REAL contract is the full fixed 20-row AdlAssessments
    // array on every save (see CreateParticipantAdlAssessmentDto's doc and
    // ParticipantCreatePage.test.tsx's "fixed-length arrays that are ALWAYS submitted in full"
    // assertion), with hidden/unanswered rows shaped as {Level: null, Notes: null,
    // HowToHelpNotes: null} — NOT a hand-picked subset like the tests above use.
    // UpsertAdlAssessmentsAsync must therefore skip creating a row for a null-answer item with no
    // existing row, rather than persisting all 20 as permanent unanswered rows (identical bug and
    // identical fix to UpsertChecklistItemsAsync). ──────────────────────────────────────────────

    private static List<CreateParticipantAdlAssessmentDto> FullNullAdlArray() =>
        Enum.GetValues<Domain.Enums.AdlType>()
            .Select(t => new CreateParticipantAdlAssessmentDto { AdlType = t, Level = null, Notes = null, HowToHelpNotes = null })
            .ToList();

    [Fact]
    public async Task Create_FullAdlAssessmentsArrayAllNull_PersistsZeroRows()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { AdlAssessments = FullNullAdlArray() };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        Assert.Equal(0, await db.ParticipantAdlAssessments.CountAsync(a => a.ParticipantId == createdBody.Data!.Id));
    }

    [Fact]
    public async Task Create_FullAdlAssessmentsArrayWithTwoAnswered_PersistsExactlyTwoRows()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var items = FullNullAdlArray();
        var dressingIdx = items.FindIndex(i => i.AdlType == Domain.Enums.AdlType.Dressing);
        var communityAccessIdx = items.FindIndex(i => i.AdlType == Domain.Enums.AdlType.CommunityAccess);
        items[dressingIdx] = items[dressingIdx] with { Level = Domain.Enums.AdlLevel.Independent };
        items[communityAccessIdx] = items[communityAccessIdx] with { Level = Domain.Enums.AdlLevel.Assistance, Notes = "1:1 supervision" };

        var dto = MinimalCreateDto() with { AdlAssessments = items };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var saved = await db.ParticipantAdlAssessments.Where(a => a.ParticipantId == createdBody.Data!.Id).ToListAsync();
        Assert.Equal(2, saved.Count);
        Assert.Contains(saved, a => a.AdlType == Domain.Enums.AdlType.Dressing && a.Level == Domain.Enums.AdlLevel.Independent);
        Assert.Contains(saved, a => a.AdlType == Domain.Enums.AdlType.CommunityAccess && a.Level == Domain.Enums.AdlLevel.Assistance && a.Notes == "1:1 supervision");
    }

    /// <summary>The clear-to-null-keeps-the-row half of the ruling, mirrored from the checklist-item
    /// coverage — once a row exists, a later full all-null array applies the incoming null values
    /// but does NOT delete the rows.</summary>
    [Fact]
    public async Task Update_FullAdlAssessmentsArrayAllNullAfterRowsExist_RowsRemainClearedToNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var withAssessments = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            AdlAssessments = new()
            {
                new CreateParticipantAdlAssessmentDto { AdlType = Domain.Enums.AdlType.Kitchen, Level = Domain.Enums.AdlLevel.Independent },
                new CreateParticipantAdlAssessmentDto { AdlType = Domain.Enums.AdlType.Bathing, Level = Domain.Enums.AdlLevel.Supervision },
            },
        };
        await controller.Update(participant.Id, withAssessments, CancellationToken.None);

        await controller.Update(participant.Id, withAssessments with { AdlAssessments = FullNullAdlArray() }, CancellationToken.None);

        var saved = await db.ParticipantAdlAssessments.Where(a => a.ParticipantId == participant.Id).ToListAsync();
        Assert.Equal(2, saved.Count);
        Assert.All(saved, a => Assert.Null(a.Level));
        Assert.All(saved, a => Assert.Null(a.Notes));
    }

    /// <summary>
    /// Covers the new flat Meals &amp; Diet / About Me columns' round-trip through
    /// Create -&gt; GetById (research spec §4.9/§5, INTAKE sub-wave C2).
    /// </summary>
    [Fact]
    public async Task Create_WithDailyLivingFields_RoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            MealAssistanceDetail = "Independent",
            ChokingRiskMealDetail = "No known risk",
            ModifiedDietDetail = "Minced and moist",
            PegRegimeMealDetail = "N/A",
            SpecialUtensilsDetail = "Built-up handle spoon",
            SpecialDietaryNeedsDetail = "Halal",
            FavouriteBreakfast = "Eggs on toast", FavouriteLunch = "Chicken wrap", FavouriteDinner = "Roast dinner",
            MedicationTricks = "With yoghurt",
            FoodsAlwaysEaten = "Fresh fruit",
            Goals = "Build independence with meal prep",
            SupportAreas = "Meal prep, community access",
            StrengthsFears = "Strength: social. Fear: crowds.",
            ThingsToKnow = "Prefers advance notice of changes",
            WhoIsImportant = "Family",
            LikesDislikes = "Likes the beach, dislikes being rushed",
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Equal("Independent", body.Data!.MealAssistanceDetail);
        Assert.Equal("Minced and moist", body.Data.ModifiedDietDetail);
        Assert.Equal("Eggs on toast", body.Data.FavouriteBreakfast);
        Assert.Equal("With yoghurt", body.Data.MedicationTricks);
        Assert.Equal("Build independence with meal prep", body.Data.Goals);
        Assert.Equal("Meal prep, community access", body.Data.SupportAreas);
        Assert.Equal("Strength: social. Fear: crowds.", body.Data.StrengthsFears);
        Assert.Equal("Prefers advance notice of changes", body.Data.ThingsToKnow);
        Assert.Equal("Family", body.Data.WhoIsImportant);
        Assert.Equal("Likes the beach, dislikes being rushed", body.Data.LikesDislikes);
    }

    // ── CONTACT-01/02/03: contact roles created transactionally with the participant ────

    [Fact]
    public async Task Create_WithNewPersonContactRole_CreatesPersonAndRoleTransactionally()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            ContactRoles = new()
            {
                new CreateParticipantContactRoleDto
                {
                    NewPersonFirstName = "Karen", NewPersonLastName = "Johnson", NewPersonMobile = "0412 345 001",
                    RoleType = Domain.Enums.ContactRoleType.NextOfKin, RelationshipToParticipant = "Mother", IsPrimary = true,
                },
            },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var savedRole = await db.ParticipantContactRoles.Include(r => r.Person).SingleAsync(r => r.ParticipantId == createdBody.Data!.Id);
        Assert.Equal(Domain.Enums.ContactRoleType.NextOfKin, savedRole.RoleType);
        Assert.True(savedRole.IsPrimary);
        Assert.Equal("Mother", savedRole.RelationshipToParticipant);
        Assert.NotNull(savedRole.Person);
        Assert.Equal("Karen", savedRole.Person!.FirstName);
        Assert.Equal("0412 345 001", savedRole.Person.Mobile);
    }

    [Fact]
    public async Task Create_WithExistingPersonContactRole_ReusesThePersonRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson" };
        db.People.Add(person);
        db.SaveChanges();
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            ContactRoles = new()
            {
                new CreateParticipantContactRoleDto { PersonId = person.Id, RoleType = Domain.Enums.ContactRoleType.EmergencyContact, PriorityOrder = 1 },
            },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        Assert.Equal(1, await db.People.CountAsync());
        var savedRole = await db.ParticipantContactRoles.SingleAsync(r => r.ParticipantId == createdBody.Data!.Id);
        Assert.Equal(person.Id, savedRole.PersonId);
    }

    [Fact]
    public async Task Create_PlanManagerRoleForSelfManagedParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        // MinimalCreateDto defaults PlanType to SelfManaged — CONTACT-02: Plan Manager is only
        // available for plan-managed participants (ContactRoleRules.Validate).
        var dto = MinimalCreateDto() with
        {
            ContactRoles = new()
            {
                new CreateParticipantContactRoleDto { NewPersonFirstName = "Diane", NewPersonLastName = "Cooper", RoleType = Domain.Enums.ContactRoleType.PlanManager },
            },
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("plan-managed", body.Errors[0], StringComparison.OrdinalIgnoreCase);
        Assert.False(await db.Participants.AnyAsync());
    }

    [Fact]
    public async Task Create_PlanNomineeRoleForUnder18Participant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            DateOfBirth = DateOnly.FromDateTime(DateTime.UtcNow.AddYears(-10)),
            ContactRoles = new()
            {
                new CreateParticipantContactRoleDto { NewPersonFirstName = "Denise", NewPersonLastName = "Wilson", RoleType = Domain.Enums.ContactRoleType.PlanNominee },
            },
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("under 18", body.Errors[0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_TwoActivePrimaryNextOfKinRoles_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            ContactRoles = new()
            {
                new CreateParticipantContactRoleDto { NewPersonFirstName = "Karen", NewPersonLastName = "Johnson", RoleType = Domain.Enums.ContactRoleType.NextOfKin, IsPrimary = true },
                new CreateParticipantContactRoleDto { NewPersonFirstName = "David", NewPersonLastName = "Johnson", RoleType = Domain.Enums.ContactRoleType.NextOfKin, IsPrimary = true },
            },
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("primary Next of Kin", body.Errors[0]);
    }

    [Fact]
    public async Task Create_WithContactRoles_TenantScoped_RolesAndPersonGetSameTenantIdAsParticipant()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options, tenant.Object);
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            ContactRoles = new()
            {
                new CreateParticipantContactRoleDto { NewPersonFirstName = "Karen", NewPersonLastName = "Johnson", RoleType = Domain.Enums.ContactRoleType.NextOfKin },
            },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var savedRole = await db.ParticipantContactRoles.IgnoreQueryFilters().SingleAsync(r => r.ParticipantId == createdBody.Data!.Id);
        Assert.Equal(tenantId, savedRole.TenantId);
        var savedPerson = await db.People.IgnoreQueryFilters().SingleAsync(p => p.Id == savedRole.PersonId);
        Assert.Equal(tenantId, savedPerson.TenantId);
    }

    // ── DIAG-01/02: diagnoses (primary + other) and HIDPA support categories ────────

    [Fact]
    public async Task Create_DiagnosesAndHidpa_RoundTripThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            PrimaryDiagnosis = "Epilepsy",
            OtherDiagnoses = new() { "Acquired Brain Injury", "Custom diagnosis via Other — specify" },
            HidpaSupportCategories = Domain.Enums.HidpaSupportCategory.EpilepsyManagement | Domain.Enums.HidpaSupportCategory.ComplexWoundCare,
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Equal("Epilepsy", body.Data!.PrimaryDiagnosis);
        Assert.Equal(new[] { "Acquired Brain Injury", "Custom diagnosis via Other — specify" }, body.Data.OtherDiagnoses);
        Assert.True(body.Data.HidpaSupportCategories.HasFlag(Domain.Enums.HidpaSupportCategory.EpilepsyManagement));
        Assert.True(body.Data.HidpaSupportCategories.HasFlag(Domain.Enums.HidpaSupportCategory.ComplexWoundCare));
        Assert.False(body.Data.HidpaSupportCategories.HasFlag(Domain.Enums.HidpaSupportCategory.EnteralFeeding));
    }

    [Fact]
    public async Task Create_DefaultDiagnosesAndHidpa_AreEmptyAndNone()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var createResult = await controller.Create(MinimalCreateDto(), CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var saved = await db.Participants.SingleAsync(p => p.Id == createdBody.Data!.Id);
        Assert.Null(saved.PrimaryDiagnosis);
        Assert.Empty(saved.OtherDiagnoses);
        Assert.Equal(Domain.Enums.HidpaSupportCategory.None, saved.HidpaSupportCategories);
    }

    [Fact]
    public async Task Update_DiagnosesAndHidpa_RoundTripThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            PrimaryDiagnosis = "Cerebral Palsy",
            OtherDiagnoses = new() { "Epilepsy" },
            HidpaSupportCategories = Domain.Enums.HidpaSupportCategory.EnteralFeeding,
        };

        var updateResult = await controller.Update(participant.Id, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        var getResult = await controller.GetById(participant.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal("Cerebral Palsy", body.Data!.PrimaryDiagnosis);
        Assert.Equal(new[] { "Epilepsy" }, body.Data.OtherDiagnoses);
        Assert.Equal(Domain.Enums.HidpaSupportCategory.EnteralFeeding, body.Data.HidpaSupportCategories);
    }

    [Fact]
    public async Task Create_BlankPrimaryDiagnosis_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { PrimaryDiagnosis = "   " };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("Primary diagnosis", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_BlankOtherDiagnosisEntry_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { OtherDiagnoses = new() { "Epilepsy", "  " } };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("blank", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_OtherDiagnosisEntryTooLong_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { OtherDiagnoses = new() { new string('x', 201) } };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("200 characters", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Update_BlankOtherDiagnosisEntry_ReturnsBadRequest()
    {
        // Fix-round regression coverage: Update() previously omitted the ValidateDiagnoses call
        // that Create() had, so a PUT with a blank OtherDiagnoses entry persisted silently where
        // POST correctly 400s. Same dual-wiring as ValidateGender/ValidateFundingSource/
        // ValidateLivingArrangement/ValidateAddressPostcode.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            OtherDiagnoses = new() { "Epilepsy", "   " },
        };

        var result = await controller.Update(participant.Id, updateDto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("blank", body.Errors![0], StringComparison.OrdinalIgnoreCase);

        // Confirms it never persisted — the row is untouched by the rejected update.
        var unchanged = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.Empty(unchanged.OtherDiagnoses);
    }

    [Fact]
    public async Task Create_DiagnosesWithPaddingWhitespace_AreStoredTrimmed()
    {
        // A raw API caller sending " Epilepsy" (leading/trailing whitespace) must still persist
        // as the exact "Epilepsy" string — otherwise it silently defeats the frontend's
        // exact-string epilepsy-derivation match (primaryDiagnosis === 'Epilepsy' /
        // otherDiagnoses.includes('Epilepsy')).
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            PrimaryDiagnosis = "  Cerebral Palsy  ",
            OtherDiagnoses = new() { " Epilepsy", "Down Syndrome \t" },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var saved = await db.Participants.SingleAsync(p => p.Id == createdBody.Data!.Id);
        Assert.Equal("Cerebral Palsy", saved.PrimaryDiagnosis);
        Assert.Equal(new[] { "Epilepsy", "Down Syndrome" }, saved.OtherDiagnoses);
    }

    [Fact]
    public async Task Update_DiagnosesWithPaddingWhitespace_AreStoredTrimmed()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            PrimaryDiagnosis = " Epilepsy ",
            OtherDiagnoses = new() { " Acquired Brain Injury " },
        };

        var updateResult = await controller.Update(participant.Id, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        var saved = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.Equal("Epilepsy", saved.PrimaryDiagnosis);
        Assert.Equal(new[] { "Acquired Brain Injury" }, saved.OtherDiagnoses);
    }

    [Fact]
    public void ParticipantDetailDto_CombinedHidpaSupportCategories_SerialisesAsCommaSeparatedString()
    {
        // Same JsonStringEnumConverter flags-serialisation contract as ServiceStreams (see
        // ParticipantListDto_CombinedServiceStreams_SerialisesAsCommaSeparatedString above) —
        // HidpaSupportCategories lives on ParticipantDetailDto (mirrors MobilitySupportOptions'
        // placement), not ParticipantListDto.
        var dto = new ParticipantDetailDto
        {
            Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", FullName = "Sophie Brown",
            HidpaSupportCategories = Domain.Enums.HidpaSupportCategory.EpilepsyManagement | Domain.Enums.HidpaSupportCategory.ComplexBowelCare,
        };

        var json = JsonSerializer.Serialize(dto, ApiJsonOptions);
        using var doc = JsonDocument.Parse(json);
        var value = doc.RootElement.GetProperty("hidpaSupportCategories").GetString();

        Assert.Equal("ComplexBowelCare, EpilepsyManagement", value);

        var roundTripped = JsonSerializer.Deserialize<ParticipantDetailDto>(json, ApiJsonOptions);
        Assert.Equal(
            Domain.Enums.HidpaSupportCategory.EpilepsyManagement | Domain.Enums.HidpaSupportCategory.ComplexBowelCare,
            roundTripped!.HidpaSupportCategories);
    }

    [Fact]
    public async Task GetAll_ProjectsHasActiveMedicationsPerParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var withActiveMed = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var withOnlyCeasedMed = new Participant { Id = Guid.NewGuid(), FirstName = "Harrison", LastName = "Lee", IsActive = true };
        var withNoMeds = new Participant { Id = Guid.NewGuid(), FirstName = "Jamie", LastName = "Kim", IsActive = true };
        db.Participants.AddRange(withActiveMed, withOnlyCeasedMed, withNoMeds);
        db.ParticipantMedications.Add(new Domain.Entities.ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = withActiveMed.Id, Name = "Paracetamol",
            Type = Domain.Enums.MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = Domain.Enums.MedicationStatus.Active, StartDate = DateTime.UtcNow,
        });
        db.ParticipantMedications.Add(new Domain.Entities.ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = withOnlyCeasedMed.Id, Name = "Ibuprofen",
            Type = Domain.Enums.MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = Domain.Enums.MedicationStatus.Ceased, StartDate = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetAll(null, null, null, null, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.Items.Single(p => p.Id == withActiveMed.Id).HasActiveMedications);
        Assert.False(body.Data.Items.Single(p => p.Id == withOnlyCeasedMed.Id).HasActiveMedications);
        Assert.False(body.Data.Items.Single(p => p.Id == withNoMeds.Id).HasActiveMedications);
    }

    [Fact]
    public async Task Create_DoesNotExposeHasRestrictivePracticeFlagOnWriteDto()
    {
        // Compile-time guard: CreateParticipantDto/UpdateParticipantDto no longer carry
        // HasRestrictivePracticeFlag — this test exists so a future re-add would need to touch
        // this file (and its accompanying comment) rather than slipping back in silently.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var result = await controller.Create(MinimalCreateDto(), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        var saved = await db.Participants.SingleAsync();
        Assert.False(saved.HasRestrictivePracticeFlag); // never set independently — stays at the type default
    }

    // ── Task 6d: preferred-staff <-> compatibility matrix linkage ─────────

    [Fact]
    public async Task Create_WithPreferredStaffId_UpsertsAutoLinkedPreferredCompatibilityRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = new Domain.Entities.User { Id = Guid.NewGuid(), FirstName = "Alex", LastName = "Rivera", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = Domain.Enums.UserRole.SupportWorker, IsActive = true };
        db.Users.Add(staff);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var dto = MinimalCreateDto() with { PreferredStaffId = staff.Id };

        var result = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var row = await db.StaffParticipantCompatibilities
            .SingleAsync(c => c.UserId == staff.Id && c.ParticipantId == createdBody.Data!.Id);
        Assert.Equal(Domain.Rostering.CompatibilityLevel.Preferred, row.Level);
        Assert.True(row.AutoLinked);
    }

    [Fact]
    public async Task Update_ChangesPreferredStaffId_RemovesOldAutoLinkedRow_CreatesNewOne()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var oldStaff = new Domain.Entities.User { Id = Guid.NewGuid(), FirstName = "Old", LastName = "Staff", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = Domain.Enums.UserRole.SupportWorker, IsActive = true };
        var newStaff = new Domain.Entities.User { Id = Guid.NewGuid(), FirstName = "New", LastName = "Staff", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = Domain.Enums.UserRole.SupportWorker, IsActive = true };
        db.Users.AddRange(oldStaff, newStaff);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var createDto = MinimalCreateDto() with { PreferredStaffId = oldStaff.Id };
        var created = await controller.Create(createDto, CancellationToken.None);
        var participantId = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<CreatedAtActionResult>(created.Result).Value).Data!.Id;

        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true, PreferredStaffId = newStaff.Id,
        };
        var updateResult = await controller.Update(participantId, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        Assert.False(await db.StaffParticipantCompatibilities.AnyAsync(c => c.UserId == oldStaff.Id && c.ParticipantId == participantId));
        var newRow = await db.StaffParticipantCompatibilities.SingleAsync(c => c.UserId == newStaff.Id && c.ParticipantId == participantId);
        Assert.Equal(Domain.Rostering.CompatibilityLevel.Preferred, newRow.Level);
        Assert.True(newRow.AutoLinked);
    }

    [Fact]
    public async Task Update_ClearsPreferredStaffId_RemovesAutoLinkedCompatibilityRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = new Domain.Entities.User { Id = Guid.NewGuid(), FirstName = "Alex", LastName = "Rivera", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = Domain.Enums.UserRole.SupportWorker, IsActive = true };
        db.Users.Add(staff);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var createDto = MinimalCreateDto() with { PreferredStaffId = staff.Id };
        var created = await controller.Create(createDto, CancellationToken.None);
        var participantId = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<CreatedAtActionResult>(created.Result).Value).Data!.Id;
        Assert.True(await db.StaffParticipantCompatibilities.AnyAsync(c => c.UserId == staff.Id && c.ParticipantId == participantId));

        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true, PreferredStaffId = null,
        };
        var updateResult = await controller.Update(participantId, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        Assert.False(await db.StaffParticipantCompatibilities.AnyAsync(c => c.UserId == staff.Id && c.ParticipantId == participantId));
    }

    [Fact]
    public async Task Update_ChangesPreferredStaffId_HumanManagedOldRow_IsNotDeleted()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var oldStaff = new Domain.Entities.User { Id = Guid.NewGuid(), FirstName = "Old", LastName = "Staff", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = Domain.Enums.UserRole.SupportWorker, IsActive = true };
        var newStaff = new Domain.Entities.User { Id = Guid.NewGuid(), FirstName = "New", LastName = "Staff", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = Domain.Enums.UserRole.SupportWorker, IsActive = true };
        db.Users.AddRange(oldStaff, newStaff);
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true, PreferredUserId = oldStaff.Id };
        db.Participants.Add(participant);
        db.StaffParticipantCompatibilities.Add(new Domain.Rostering.StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), UserId = oldStaff.Id, ParticipantId = participant.Id,
            Level = Domain.Rostering.CompatibilityLevel.Preferred, AutoLinked = false, Reason = "Set by coordinator", UpdatedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true, PreferredStaffId = newStaff.Id,
        };
        var updateResult = await controller.Update(participant.Id, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        var oldRow = await db.StaffParticipantCompatibilities.SingleAsync(c => c.UserId == oldStaff.Id && c.ParticipantId == participant.Id);
        Assert.Equal(Domain.Rostering.CompatibilityLevel.Preferred, oldRow.Level);
        Assert.Equal("Set by coordinator", oldRow.Reason);
    }

    // ── FUND-02: funding source (NDIS vs Other) ────────────────────────

    [Fact]
    public async Task Create_DefaultFundingSource_IsNdis()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var result = await controller.Create(MinimalCreateDto(), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        var saved = await db.Participants.SingleAsync();
        Assert.Equal(Domain.Enums.ParticipantFundingSource.Ndis, saved.FundingSource);
        Assert.Null(saved.FundingOrganisation);
    }

    [Fact]
    public async Task Create_FundingSourceOtherWithoutSpecify_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { FundingSource = Domain.Enums.ParticipantFundingSource.Other, FundingOrganisation = null };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("funding organisation", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_FundingSourceOtherWithSpecify_Succeeds_RoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { FundingSource = Domain.Enums.ParticipantFundingSource.Other, FundingOrganisation = "Self-funded" };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal(Domain.Enums.ParticipantFundingSource.Other, body.Data!.FundingSource);
        Assert.Equal("Self-funded", body.Data.FundingOrganisation);
    }

    [Fact]
    public async Task Create_FundingSourceNdis_IgnoresAndClearsStrayFundingOrganisation()
    {
        // Server-side defence in depth: even if a client sends FundingOrganisation text alongside
        // FundingSource = Ndis (e.g. a stale value left over from switching Other -> Ndis
        // client-side before the INTAKE-07 engine's payload exclusion kicks in), the server never
        // persists it — Ndis ignores the field entirely, mirroring the frontend's exclusion rule.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { FundingSource = Domain.Enums.ParticipantFundingSource.Ndis, FundingOrganisation = "Stray Plan Manager" };
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        var saved = await db.Participants.SingleAsync();
        Assert.Equal(Domain.Enums.ParticipantFundingSource.Ndis, saved.FundingSource);
        Assert.Null(saved.FundingOrganisation);
    }

    [Fact]
    public async Task Update_FundingSourceOtherWithoutSpecify_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            FundingSource = Domain.Enums.ParticipantFundingSource.Other, FundingOrganisation = "   ",
        };

        var result = await controller.Update(participant.Id, updateDto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("funding organisation", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Update_SwitchFromOtherToNdis_ClearsFundingOrganisation()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true,
            FundingSource = Domain.Enums.ParticipantFundingSource.Other, FundingOrganisation = "Maple Plan Management",
        };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            FundingSource = Domain.Enums.ParticipantFundingSource.Ndis, FundingOrganisation = "Maple Plan Management",
        };

        var updateResult = await controller.Update(participant.Id, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        var saved = await db.Participants.SingleAsync();
        Assert.Equal(Domain.Enums.ParticipantFundingSource.Ndis, saved.FundingSource);
        Assert.Null(saved.FundingOrganisation);
    }

    // ── LIVING-01/02/03/04: living arrangements ─────────────────────────

    [Fact]
    public async Task Create_DefaultLivingArrangement_IsNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var result = await controller.Create(MinimalCreateDto(), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        var saved = await db.Participants.SingleAsync();
        Assert.Null(saved.LivingArrangement);
        Assert.Null(saved.LivingArrangementNotes);
    }

    [Fact]
    public async Task Create_LivingArrangementFamilyWithoutSupportPersonName_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { LivingArrangement = Domain.Enums.LivingArrangement.Family, MainSupportPersonName = null };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("main support person", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_LivingArrangementFamily_Succeeds_RoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            LivingArrangement = Domain.Enums.LivingArrangement.Family,
            MainSupportPersonName = "Jane Citizen",
            MainSupportPersonRelationship = "Mother",
            OthersLivingInAccommodation = "One sibling",
            ResidentialInfo = "Single-storey house, wheelchair accessible",
            LivingArrangementNotes = "Prefers routine kept stable.",
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal(Domain.Enums.LivingArrangement.Family, body.Data!.LivingArrangement);
        Assert.Equal("Jane Citizen", body.Data.MainSupportPersonName);
        Assert.Equal("Mother", body.Data.MainSupportPersonRelationship);
        Assert.Equal("One sibling", body.Data.OthersLivingInAccommodation);
        Assert.Equal("Single-storey house, wheelchair accessible", body.Data.ResidentialInfo);
        Assert.Equal("Prefers routine kept stable.", body.Data.LivingArrangementNotes);
    }

    [Fact]
    public async Task Create_LivingArrangementFamily_ClearsIndependentAndSupportedAccommodationFields()
    {
        // Defence in depth (mirrors FundingOrganisation): a stray payload carrying fields for
        // OTHER arrangement types alongside Family must not persist them.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            LivingArrangement = Domain.Enums.LivingArrangement.Family,
            MainSupportPersonName = "Jane Citizen",
            LivesWithOthers = true,
            WhoLivesWith = "Stray housemate text",
            SilProviderName = "Stray SIL Provider",
            SilProviderContactPhone = "0400 000 000",
            AccommodationType = "Stray type",
            OnSiteSupportHours = "Stray hours",
        };
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        var saved = await db.Participants.SingleAsync();
        Assert.Null(saved.LivesWithOthers);
        Assert.Null(saved.WhoLivesWith);
        Assert.Null(saved.SilProviderName);
        Assert.Null(saved.SilProviderContactPhone);
        Assert.Null(saved.AccommodationType);
        Assert.Null(saved.OnSiteSupportHours);
    }

    [Fact]
    public async Task Create_LivingArrangementIndependentLivesWithOthersWithoutWho_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            LivingArrangement = Domain.Enums.LivingArrangement.Independent,
            LivesWithOthers = true,
            WhoLivesWith = null,
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("lives with", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_LivingArrangementIndependentNotLivingWithOthers_Succeeds_WhoLivesWithNotRequired()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            LivingArrangement = Domain.Enums.LivingArrangement.Independent,
            LivesWithOthers = false,
            // Stray value — LivesWithOthers is false, so this must be cleared server-side.
            WhoLivesWith = "Stray text",
        };
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        var saved = await db.Participants.SingleAsync();
        Assert.Equal(Domain.Enums.LivingArrangement.Independent, saved.LivingArrangement);
        Assert.False(saved.LivesWithOthers);
        Assert.Null(saved.WhoLivesWith);
    }

    [Fact]
    public async Task Create_LivingArrangementIndependentLivesWithOthers_Succeeds_RoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            LivingArrangement = Domain.Enums.LivingArrangement.Independent,
            LivesWithOthers = true,
            WhoLivesWith = "Two housemates",
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal(Domain.Enums.LivingArrangement.Independent, body.Data!.LivingArrangement);
        Assert.True(body.Data.LivesWithOthers);
        Assert.Equal("Two housemates", body.Data.WhoLivesWith);
    }

    [Fact]
    public async Task Create_LivingArrangementSupportedAccommodationWithoutSilProviderName_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { LivingArrangement = Domain.Enums.LivingArrangement.SupportedAccommodation, SilProviderName = null };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("sil provider", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_LivingArrangementSupportedAccommodation_Succeeds_RoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            LivingArrangement = Domain.Enums.LivingArrangement.SupportedAccommodation,
            SilProviderName = "Sunrise SIL Services",
            SilProviderContactPhone = "0400 111 222",
            AccommodationType = "Group home",
            OnSiteSupportHours = "24/7",
            LivingArrangementNotes = "Two other residents on-site.",
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal(Domain.Enums.LivingArrangement.SupportedAccommodation, body.Data!.LivingArrangement);
        Assert.Equal("Sunrise SIL Services", body.Data.SilProviderName);
        Assert.Equal("0400 111 222", body.Data.SilProviderContactPhone);
        Assert.Equal("Group home", body.Data.AccommodationType);
        Assert.Equal("24/7", body.Data.OnSiteSupportHours);
        Assert.Equal("Two other residents on-site.", body.Data.LivingArrangementNotes);
    }

    [Fact]
    public async Task Update_SwitchFamilyToIndependent_ClearsFamilyFields()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true,
            LivingArrangement = Domain.Enums.LivingArrangement.Family,
            MainSupportPersonName = "Jane Citizen", MainSupportPersonRelationship = "Mother",
        };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            LivingArrangement = Domain.Enums.LivingArrangement.Independent, LivesWithOthers = false,
            // Stray Family-era values a client might still be holding — must be cleared.
            MainSupportPersonName = "Jane Citizen", MainSupportPersonRelationship = "Mother",
        };

        var updateResult = await controller.Update(participant.Id, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        var saved = await db.Participants.SingleAsync();
        Assert.Equal(Domain.Enums.LivingArrangement.Independent, saved.LivingArrangement);
        Assert.Null(saved.MainSupportPersonName);
        Assert.Null(saved.MainSupportPersonRelationship);
    }

    // ── INTAKE-06: structured address ───────────────────────────────────

    [Theory]
    [InlineData("123")]
    [InlineData("12345")]
    [InlineData("abcd")]
    public async Task Create_AddressPostcodeNotFourDigits_ReturnsBadRequest(string postcode)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { AddressPostcode = postcode };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("4 digits", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_AddressPostcodeBlank_Succeeds()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var result = await controller.Create(MinimalCreateDto(), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    // ── INTAKE sub-wave A: the participant's own Phone/Email ─────────────

    [Theory]
    [InlineData("not a phone")]
    [InlineData("abc123")]
    [InlineData("123")]
    public async Task Create_InvalidPhone_ReturnsBadRequest(string phone)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { Phone = phone };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("phone", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("0400 000 000")]
    [InlineData("+61 400 000 000")]
    [InlineData("(07) 3123 4567")]
    [InlineData("07 3123 4567")]
    public async Task Create_AuTolerantPhoneFormats_Succeed(string phone)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { Phone = phone };
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Theory]
    [InlineData("not-an-email")]
    [InlineData("missing-at-sign.com")]
    [InlineData("no-domain@")]
    public async Task Create_InvalidEmail_ReturnsBadRequest(string email)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { Email = email };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("email", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_PhoneAndEmailBlank_Succeeds()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var result = await controller.Create(MinimalCreateDto(), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task Create_DraftWithInvalidEmail_StillReturnsBadRequest()
    {
        // Format checks on whatever WAS provided are never relaxed for a draft — same doctrine
        // as Create_DraftWithInvalidPostcode_StillReturnsBadRequest.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = new CreateParticipantDto { FirstName = "Priya", IsDraft = true, Email = "not-an-email" };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("email", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Participants.ToListAsync());
    }

    [Fact]
    public async Task Create_DraftWithInvalidPhone_StillReturnsBadRequest()
    {
        // Format checks on whatever WAS provided are never relaxed for a draft — same doctrine
        // as Create_DraftWithInvalidEmail_StillReturnsBadRequest/Create_DraftWithInvalidPostcode_StillReturnsBadRequest.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = new CreateParticipantDto { FirstName = "Priya", IsDraft = true, Phone = "not a phone" };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("phone", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Participants.ToListAsync());
    }

    [Fact]
    public async Task Create_DraftWithBlankPhoneAndEmail_Succeeds()
    {
        // Absence of the new optional fields never blocks a draft — matches every other
        // optional field's draft behaviour.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = new CreateParticipantDto { FirstName = "Priya", IsDraft = true };
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task Create_DraftWithPartiallyFilledKeyIdentifiers_Succeeds_PersistsPartialData()
    {
        // A draft may fill in only SOME of the Key Identifiers step's fields — the rest stay
        // null, and nothing about that partial fill blocks the save.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = new CreateParticipantDto
        {
            FirstName = "Priya", IsDraft = true,
            MedicareNumber = "2951 12345 1", HairColour = "Brown",
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal("2951 12345 1", body.Data!.MedicareNumber);
        Assert.Equal("Brown", body.Data.HairColour);
        Assert.Null(body.Data.PensionCardNumber);
        Assert.Null(body.Data.WeightKg);
    }

    [Fact]
    public async Task Create_RealWeightAndHeight_RoundTripThroughGetById()
    {
        // The stays-null case is covered above (Create_DraftWithPartiallyFilledKeyIdentifiers...)
        // — this covers the other half: a real, non-null decimal value actually persists and
        // reads back exactly, not just "doesn't error."
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { WeightKg = 78.5m, HeightCm = 179m };
        var result = await controller.Create(dto, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal(78.5m, body.Data!.WeightKg);
        Assert.Equal(179m, body.Data.HeightCm);
    }

    [Fact]
    public async Task Update_RealWeightAndHeight_RoundTripThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            WeightKg = 62.25m, HeightCm = 165.5m,
        };

        var updateResult = await controller.Update(participant.Id, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        var getResult = await controller.GetById(participant.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal(62.25m, body.Data!.WeightKg);
        Assert.Equal(165.5m, body.Data.HeightCm);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(1000)]
    public async Task Create_WeightOutOfRange_ReturnsBadRequest(decimal weight)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { WeightKg = weight };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("weight", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Participants.ToListAsync());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(1000)]
    public async Task Create_HeightOutOfRange_ReturnsBadRequest(decimal height)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { HeightCm = height };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("height", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Participants.ToListAsync());
    }

    [Fact]
    public async Task Create_WeightAndHeightAtUpperBound_Succeeds()
    {
        // 999.99 is the exact numeric(5,2) ceiling — must be accepted, not rejected off-by-one.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { WeightKg = 999.99m, HeightCm = 999.99m };
        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    // ── INTAKE-08: draft saves ───────────────────────────────────────────

    [Fact]
    public async Task Create_DraftWithOnlyFirstName_Succeeds_PersistsPartialData()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        // Deliberately bare: no LastName, no PlanType/OvernightSupport/OvernightRatio/
        // SupportRatio — none of MinimalCreateDto's usual minimums. A draft must persist
        // whatever is filled in, which here is just a first name.
        var dto = new CreateParticipantDto { FirstName = "Priya", IsDraft = true };

        var result = await controller.Create(dto, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);
        Assert.True(createdBody.Data!.IsDraft);

        var getResult = await controller.GetById(createdBody.Data.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal("Priya", body.Data!.FirstName);
        Assert.Equal(string.Empty, body.Data.LastName);
        Assert.True(body.Data.IsDraft);
    }

    [Fact]
    public async Task Create_DraftWithBothNamesBlank_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = new CreateParticipantDto { IsDraft = true };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("first or last name", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Participants.ToListAsync());
    }

    [Fact]
    public async Task Create_NonDraftWithBlankLastName_ReturnsBadRequest()
    {
        // IsDraft=false (the default, including a final wizard submission) keeps requiring
        // both names — same floor [Required] used to enforce.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with { LastName = "  " };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("Last name", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_DraftWithInvalidPostcode_StillReturnsBadRequest()
    {
        // Format/consistency checks on whatever WAS provided are never relaxed for a draft —
        // only the FirstName/LastName floor is.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = new CreateParticipantDto { FirstName = "Priya", IsDraft = true, AddressPostcode = "12" };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("Postcode", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Participants.ToListAsync());
    }

    [Fact]
    public async Task Create_DraftWithFundingSourceOtherButNoOrganisation_StillReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = new CreateParticipantDto
        {
            FirstName = "Priya", IsDraft = true,
            FundingSource = Domain.Enums.ParticipantFundingSource.Other,
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("funding organisation", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    // ── INTAKE-08 fix round 2 (Finding 1): drafts with an empty/abandoned contact row ────

    [Fact]
    public async Task Create_DraftWithEmptyContactRow_Succeeds()
    {
        // The exact regression scenario: the wizard's Contacts step lets a caller click
        // "Add contact" and then abandon it (no person picked/typed) before "Save as draft" —
        // that row must be silently dropped rather than 400ing the whole draft save.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = new CreateParticipantDto
        {
            FirstName = "Priya", IsDraft = true,
            ContactRoles = new() { new CreateParticipantContactRoleDto { RoleType = Domain.Enums.ContactRoleType.NextOfKin } },
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);
        Assert.False(await db.ParticipantContactRoles.AnyAsync(r => r.ParticipantId == createdBody.Data!.Id));
    }

    [Fact]
    public async Task Create_DraftWithEmptyAndFullyValidContactRows_PersistsOnlyTheValidRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = new CreateParticipantDto
        {
            FirstName = "Priya", IsDraft = true,
            ContactRoles = new()
            {
                new CreateParticipantContactRoleDto { RoleType = Domain.Enums.ContactRoleType.NextOfKin }, // wholly empty — skipped
                new CreateParticipantContactRoleDto
                {
                    NewPersonFirstName = "Karen", NewPersonLastName = "Johnson",
                    RoleType = Domain.Enums.ContactRoleType.NextOfKin, RelationshipToParticipant = "Mother",
                },
            },
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);
        var savedRole = await db.ParticipantContactRoles.Include(r => r.Person)
            .SingleAsync(r => r.ParticipantId == createdBody.Data!.Id);
        Assert.Equal("Karen", savedRole.Person!.FirstName);
        Assert.Equal("Mother", savedRole.RelationshipToParticipant);
    }

    [Fact]
    public async Task Create_NonDraftWithEmptyContactRow_StillReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            ContactRoles = new() { new CreateParticipantContactRoleDto { RoleType = Domain.Enums.ContactRoleType.NextOfKin } },
        };
        var result = await controller.Create(dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("existing person or a new person", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.False(await db.Participants.AnyAsync());
    }

    [Fact]
    public async Task Update_FinalSubmissionFromDraft_ClearsIsDraft()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.Add(draft);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var finalDto = new UpdateParticipantDto
        {
            FirstName = "Priya", LastName = "Sharma", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true, IsDraft = false,
        };

        var updateResult = await controller.Update(draft.Id, finalDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        var getResult = await controller.GetById(draft.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.False(body.Data!.IsDraft);
        Assert.Equal("Sharma", body.Data.LastName);
    }

    [Fact]
    public async Task Update_FinalisedParticipant_CannotBeRevertedToDraft()
    {
        // INTAKE-08 fix round 1 (Finding 1b, controller ruling): un-finalising is not a product
        // capability — a stored IsDraft=false participant must reject any Update whose payload
        // sets IsDraft=true, leaving the stored row untouched.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var finalised = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true, IsDraft = false };
        db.Participants.Add(finalised);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var dto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true, IsDraft = true,
        };

        var result = await controller.Update(finalised.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(badRequest.Value);
        Assert.Contains("cannot be reverted to draft", body.Errors![0], StringComparison.OrdinalIgnoreCase);

        var reloaded = await db.Participants.SingleAsync(p => p.Id == finalised.Id);
        Assert.False(reloaded.IsDraft);
    }

    [Fact]
    public async Task Update_SaveAsDraftAgain_KeepsIsDraftTrue_PartialDataPersists()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.Add(draft);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        // Still no LastName — a later wizard step's draft save, still missing required fields.
        var updateDto = new UpdateParticipantDto { FirstName = "Priya", Region = "South East QLD", IsDraft = true, IsActive = true };

        var updateResult = await controller.Update(draft.Id, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        var getResult = await controller.GetById(draft.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.True(body.Data!.IsDraft);
        Assert.Equal("South East QLD", body.Data.Region);
    }

    [Fact]
    public async Task GetAll_IsDraftFilter_true_ReturnsOnlyDrafts()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var normal = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.AddRange(normal, draft);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetAll(null, null, null, null, null, true, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var item = Assert.Single(body.Data!.Items);
        Assert.Equal(draft.Id, item.Id);
        Assert.True(item.IsDraft);
    }

    [Fact]
    public async Task GetAll_IsDraftFilter_false_ExcludesDrafts()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var normal = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.AddRange(normal, draft);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetAll(null, null, null, null, null, false, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var item = Assert.Single(body.Data!.Items);
        Assert.Equal(normal.Id, item.Id);
    }

    [Fact]
    public async Task GetAll_NoIsDraftFilter_IncludesDraftsWithBadgeData()
    {
        // The plain participants list defaults to unfiltered — drafts show up alongside
        // normal participants (badged client-side off IsDraft), not hidden.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var normal = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.AddRange(normal, draft);
        db.SaveChanges();

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));
        var result = await controller.GetAll(null, null, null, null, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(2, body.Data!.Items.Count);
        Assert.True(body.Data.Items.Single(p => p.Id == draft.Id).IsDraft);
        Assert.False(body.Data.Items.Single(p => p.Id == normal.Id).IsDraft);
    }

    [Fact]
    public async Task Create_AddressFields_Succeeds_RoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db));

        var dto = MinimalCreateDto() with
        {
            AddressStreet = "12 Example Street", AddressSuburb = "Fortitude Valley",
            AddressState = "QLD", AddressPostcode = "4006",
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal("12 Example Street", body.Data!.AddressStreet);
        Assert.Equal("Fortitude Valley", body.Data.AddressSuburb);
        Assert.Equal("QLD", body.Data.AddressState);
        Assert.Equal("4006", body.Data.AddressPostcode);
    }
}
