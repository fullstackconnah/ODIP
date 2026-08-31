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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
        var result = await controller.GetAll(null, null, null, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.Items.Single(p => p.Id == withFlag.Id).HasRestrictivePracticeFlag);
        Assert.False(body.Data.Items.Single(p => p.Id == withoutFlag.Id).HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task Create_ServiceStreamsFlags_RoundTripThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

        var createResult = await controller.Create(MinimalCreateDto(), CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var saved = await db.Participants.SingleAsync(p => p.Id == createdBody.Data!.Id);
        Assert.Equal(Domain.Enums.ServiceStreams.None, saved.ServiceStreams);
    }

    // ── DIAG-01/02: diagnoses (primary + other) and HIDPA support categories ────────

    [Fact]
    public async Task Create_DiagnosesAndHidpa_RoundTripThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
        var result = await controller.GetAll(null, null, null, null, null, 1, 50, CancellationToken.None);

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));
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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

        var result = await controller.Create(MinimalCreateDto(), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task Create_AddressFields_Succeeds_RoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

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
