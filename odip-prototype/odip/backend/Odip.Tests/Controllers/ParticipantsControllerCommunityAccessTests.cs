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
/// INTAKE-03/04 — coverage for the Community Access checklist grid and CA flat fields as
/// submitted transactionally alongside a participant create/update
/// (ParticipantsController.UpsertChecklistItemsAsync, Create, Update), plus the extended
/// HidpaSupportCategory flags and the IsDraft partial-save path. Same EF InMemory +
/// Moq&lt;ICurrentTenant&gt; pattern as ParticipantsControllerTests.
/// </summary>
public class ParticipantsControllerCommunityAccessTests
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

    private static async Task<ParticipantDetailDto> GetByIdData(ParticipantsController controller, Guid id)
    {
        var result = await controller.GetById(id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        return body.Data!;
    }

    /// <summary>Task 2 — Upsert, create mode: submitting a subset of checklist items on participant
    /// create persists exactly those rows; GET afterward shows those populated and the rest as
    /// unanswered placeholders.</summary>
    [Fact]
    public async Task Create_ChecklistItemsSubset_PersistsOnlyThoseRows_RestAreUnansweredPlaceholders()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

        var dto = MinimalCreateDto() with
        {
            ChecklistItems = new List<CreateParticipantChecklistItemDto>
            {
                new() { ItemType = ChecklistItemType.UsesWheelchair, Value = ChecklistItemValue.Yes, Notes = "Power wheelchair." },
                new() { ItemType = ChecklistItemType.HarmToSelf, Value = ChecklistItemValue.No },
                new() { ItemType = ChecklistItemType.SensorySensitivities, Value = ChecklistItemValue.Yes, Notes = "Avoid crowded venues." },
            },
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var detail = await GetByIdData(controller, createdBody.Data!.Id);

        Assert.Equal(21, detail.ChecklistItems.Count);
        var wheelchair = detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.UsesWheelchair);
        var harmToSelf = detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.HarmToSelf);
        var sensory = detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.SensorySensitivities);
        Assert.Equal(ChecklistItemValue.Yes, wheelchair.Value);
        Assert.Equal("Power wheelchair.", wheelchair.Notes);
        Assert.Equal(ChecklistItemValue.No, harmToSelf.Value);
        Assert.Equal(ChecklistItemValue.Yes, sensory.Value);
        Assert.Equal("Avoid crowded venues.", sensory.Notes);

        var untouched = detail.ChecklistItems.Where(c =>
            c.ItemType != ChecklistItemType.UsesWheelchair &&
            c.ItemType != ChecklistItemType.HarmToSelf &&
            c.ItemType != ChecklistItemType.SensorySensitivities).ToList();
        Assert.Equal(18, untouched.Count);
        Assert.All(untouched, c => Assert.Null(c.Value));
        Assert.All(untouched, c => Assert.Null(c.Id));
    }

    /// <summary>Task 4 — Upsert, leave-alone mode: an Update payload that omits a previously-set
    /// checklist item leaves that item's existing row untouched (not cleared, not deleted).
    /// Confirmed by reading UpsertChecklistItemsAsync/ParticipantsController.cs: it iterates only
    /// the submitted list and upserts by type, so an item type absent from that list is simply
    /// never touched — same behaviour as UpsertAdlAssessmentsAsync/UpsertHealthConditionsAsync.
    /// This is distinct from the load-bearing empty/null-list guard (which covers a caller that
    /// never mentions ChecklistItems at all) — here the submitted list is non-empty but still omits
    /// one previously-set item.</summary>
    [Fact]
    public async Task Update_ChecklistItemsPartialPayload_LeavesOmittedPreviouslySetItemUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

        var createDto = MinimalCreateDto() with
        {
            ChecklistItems = new List<CreateParticipantChecklistItemDto>
            {
                new() { ItemType = ChecklistItemType.UsesWheelchair, Value = ChecklistItemValue.Yes, Notes = "Power wheelchair." },
                new() { ItemType = ChecklistItemType.HarmToSelf, Value = ChecklistItemValue.No, Notes = "No current self-harm behaviours." },
            },
        };
        var createResult = await controller.Create(createDto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);
        var participantId = createdBody.Data!.Id;

        // Update submits a non-empty ChecklistItems list that mentions only UsesWheelchair —
        // HarmToSelf is omitted entirely from this payload.
        var updateDto = new UpdateParticipantDto
        {
            FirstName = createDto.FirstName, LastName = createDto.LastName, IsActive = true,
            PlanType = createDto.PlanType, OvernightSupport = createDto.OvernightSupport,
            OvernightRatio = createDto.OvernightRatio, SupportRatio = createDto.SupportRatio,
            ChecklistItems = new List<CreateParticipantChecklistItemDto>
            {
                new() { ItemType = ChecklistItemType.UsesWheelchair, Value = ChecklistItemValue.NotApplicable, Notes = "Reassessed — no longer wheelchair-dependent." },
            },
        };
        await controller.Update(participantId, updateDto, CancellationToken.None);

        var detail = await GetByIdData(controller, participantId);
        var wheelchair = detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.UsesWheelchair);
        var harmToSelf = detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.HarmToSelf);

        Assert.Equal(ChecklistItemValue.NotApplicable, wheelchair.Value);
        Assert.Equal("Reassessed — no longer wheelchair-dependent.", wheelchair.Notes);

        // HarmToSelf survives untouched — not cleared, not deleted.
        Assert.NotNull(harmToSelf.Id);
        Assert.Equal(ChecklistItemValue.No, harmToSelf.Value);
        Assert.Equal("No current self-harm behaviours.", harmToSelf.Notes);
    }

    /// <summary>Task 8 — a draft participant with only some CA fields set saves successfully; the
    /// untouched CA fields are null/absent, not defaulted to something else.</summary>
    [Fact]
    public async Task Create_DraftWithPartialCommunityAccessFields_SavesSuccessfully_UntouchedFieldsStayNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

        var dto = MinimalCreateDto() with
        {
            IsDraft = true,
            ServiceStreams = ServiceStreams.CommunityAccessDailyLiving,
            SignsHappyAndSettled = "Relaxed posture, humming while painting.",
            BocTriggers = "Sudden loud noises.",
            ChecklistItems = new List<CreateParticipantChecklistItemDto>
            {
                new() { ItemType = ChecklistItemType.FallsRisk, Value = ChecklistItemValue.Yes, Notes = "Supervise on stairs." },
            },
            // No AdlAssessments HowToHelpNotes, no HidpaNotes, and every other CA flat field left unset.
        };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);
        Assert.True(createdBody.Data!.IsDraft);

        var detail = await GetByIdData(controller, createdBody.Data.Id);

        Assert.True(detail.IsDraft);
        Assert.Equal("Relaxed posture, humming while painting.", detail.SignsHappyAndSettled);
        Assert.Equal("Sudden loud noises.", detail.BocTriggers);
        var fallsRisk = detail.ChecklistItems.Single(c => c.ItemType == ChecklistItemType.FallsRisk);
        Assert.Equal(ChecklistItemValue.Yes, fallsRisk.Value);

        // Untouched CA fields stay null, not defaulted to empty string or anything else.
        Assert.Null(detail.WhatHelpsMeCalmDown);
        Assert.Null(detail.BocEarlyWarningSigns);
        Assert.Null(detail.BocDeEscalationStrategies);
        Assert.Null(detail.BocWhatNotToDo);
        Assert.Null(detail.SupportsLookLikeMorning);
        Assert.Null(detail.SupportsLookLikeDay);
        Assert.Null(detail.SupportsLookLikeAfternoonEvening);
        Assert.Null(detail.SupportsLookLikeOvernight);
        Assert.Null(detail.HidpaNotes);
        Assert.All(detail.AdlAssessments, a => Assert.Null(a.HowToHelpNotes));

        // The other 20 checklist items are still unanswered placeholders, not defaulted rows.
        var untouchedChecklistItems = detail.ChecklistItems.Where(c => c.ItemType != ChecklistItemType.FallsRisk).ToList();
        Assert.Equal(20, untouchedChecklistItems.Count);
        Assert.All(untouchedChecklistItems, c => Assert.Null(c.Value));
        Assert.All(untouchedChecklistItems, c => Assert.Null(c.Id));
    }

    /// <summary>Task 9 — HIDPA extended categories round-trip: a combination including at least one
    /// of the 5 new members plus one pre-existing member persists and reloads with the exact flag
    /// combination (bitwise combination correctly stored/read, no truncation).</summary>
    [Fact]
    public async Task Create_HidpaSupportCategoriesExtendedFlagCombination_RoundTripsThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db));

        var combination = HidpaSupportCategory.PressureCare | HidpaSupportCategory.DiabetesManagementInsulin | HidpaSupportCategory.EpilepsyManagement;
        var dto = MinimalCreateDto() with { HidpaSupportCategories = combination };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var detail = await GetByIdData(controller, createdBody.Data!.Id);

        Assert.Equal(combination, detail.HidpaSupportCategories);
        Assert.True(detail.HidpaSupportCategories.HasFlag(HidpaSupportCategory.PressureCare));
        Assert.True(detail.HidpaSupportCategories.HasFlag(HidpaSupportCategory.DiabetesManagementInsulin));
        Assert.True(detail.HidpaSupportCategories.HasFlag(HidpaSupportCategory.EpilepsyManagement));
        // Flags not in the combination — including other new members — must not be set.
        Assert.False(detail.HidpaSupportCategories.HasFlag(HidpaSupportCategory.StomaColostomyCare));
        Assert.False(detail.HidpaSupportCategories.HasFlag(HidpaSupportCategory.HighIntensityBehaviourSupport));
        Assert.False(detail.HidpaSupportCategories.HasFlag(HidpaSupportCategory.ComplexMedicationAdministration));
        Assert.False(detail.HidpaSupportCategories.HasFlag(HidpaSupportCategory.ComplexBowelCare));

        // Also confirmed directly against the stored entity, bypassing DTO round-trip.
        var stored = await db.Participants.IgnoreQueryFilters().SingleAsync(p => p.Id == createdBody.Data.Id);
        Assert.Equal(combination, stored.HidpaSupportCategories);
    }
}
