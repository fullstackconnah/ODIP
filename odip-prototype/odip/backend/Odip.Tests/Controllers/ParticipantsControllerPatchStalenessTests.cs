using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>PATCH /participants/{id} refuses a save from a section that moved since the editor opened it (EF InMemory).</summary>
public class ParticipantsControllerPatchStalenessTests
{
    private static ParticipantsController Controller(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

    private static async Task<Guid> SeedAsync(string db, Action<Participant>? edit = null, params (string Key, int Revision)[] rows)
    {
        await using var ctx = TestDb.Create(db);
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", Region = "North", MedicalSummary = "old", Goals = "old goal" };
        edit?.Invoke(p);
        ctx.Participants.Add(p);
        foreach (var (key, rev) in rows)
            ctx.ParticipantGroupRevisions.Add(new ParticipantGroupRevision { ParticipantId = p.Id, GroupKey = key, Revision = rev, UpdatedAt = DateTime.UtcNow });
        await ctx.SaveChangesAsync();
        return p.Id;
    }

    private static async Task<int> RevisionAsync(string db, Guid id, string key)
    {
        await using var ctx = TestDb.Create(db);
        return await ctx.ParticipantGroupRevisions.Where(r => r.ParticipantId == id && r.GroupKey == key).Select(r => r.Revision).SingleOrDefaultAsync();
    }

    private static async Task<string?> MedicalSummaryAsync(string db, Guid id)
    {
        await using var ctx = TestDb.Create(db);
        return (await ctx.Participants.SingleAsync(p => p.Id == id)).MedicalSummary;
    }

    private static async Task<IActionResult> PatchAsync(string db, Guid id, PatchParticipantDto dto)
    {
        await using var ctx = TestDb.Create(db);
        return (await Controller(ctx).Patch(id, dto, default)).Result!;
    }

    private static PatchParticipantDto Medical(string summary, Dictionary<string, int>? expected) =>
        new() { Medical = new PatchMedicalDto { MedicalSummary = summary }, ExpectedRevisions = expected };

    [Fact]
    public async Task Get_returns_group_revisions_all_zero()
    {
        var db = nameof(Get_returns_group_revisions_all_zero);
        var id = await SeedAsync(db);
        await using var ctx = TestDb.Create(db);
        var ok = Assert.IsType<OkObjectResult>((await Controller(ctx).GetById(id, default)).Result);
        var dto = Assert.IsType<ApiResponse<ParticipantDetailDto>>(ok.Value).Data!;
        Assert.Equal(16, dto.GroupRevisions!.Count);
        Assert.All(dto.GroupRevisions.Values, v => Assert.Equal(0, v));
    }

    [Fact]
    public async Task Patch_bumps_only_the_changed_sent_groups()
    {
        var db = nameof(Patch_bumps_only_the_changed_sent_groups);
        var id = await SeedAsync(db);
        var result = await PatchAsync(db, id, new PatchParticipantDto
        {
            Medical = new PatchMedicalDto { MedicalSummary = "new" },
            AboutMe = new PatchAboutMeDto { Goals = "new goal" },
        });
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result).Value).Data!;
        Assert.Equal(1, body.GroupRevisions!["medical"]);
        Assert.Equal(1, body.GroupRevisions["aboutMe"]);
        Assert.Equal(14, body.GroupRevisions.Values.Count(v => v == 0));
    }

    [Fact]
    public async Task Patch_with_stale_expected_is_409_and_writes_nothing()
    {
        var db = nameof(Patch_with_stale_expected_is_409_and_writes_nothing);
        var id = await SeedAsync(db, null, ("medical", 2));
        var result = await PatchAsync(db, id, Medical("new", new() { ["medical"] = 1 }));
        var conflict = Assert.IsType<ConflictObjectResult>(result);
        var body = Assert.IsType<ApiResponse<ParticipantSectionChangedDto>>(conflict.Value);
        Assert.Equal("participant-section-changed", body.Code);
        Assert.Equal(2, body.Data!.GroupRevisions["medical"]);
        Assert.Equal("Someone else saved this section since you opened it.", body.Errors[0]);
        Assert.Equal("old", await MedicalSummaryAsync(db, id));
        Assert.Equal(2, await RevisionAsync(db, id, "medical"));
    }

    [Fact]
    public async Task Patch_with_identical_values_does_not_bump()
    {
        var db = nameof(Patch_with_identical_values_does_not_bump);
        var id = await SeedAsync(db);
        var result = await PatchAsync(db, id, new PatchParticipantDto
        {
            AboutMe = new PatchAboutMeDto { Goals = "old goal" },
            ServiceProfile = new PatchServiceProfileDto { Region = "North" },
            Medical = new PatchMedicalDto { MedicalSummary = "old" },
            ExpectedRevisions = new() { ["aboutMe"] = 0, ["serviceProfile"] = 0, ["medical"] = 0 },
        });
        Assert.IsType<OkObjectResult>(result);
        foreach (var key in new[] { "aboutMe", "serviceProfile", "medical" })
            Assert.Equal(0, await RevisionAsync(db, id, key));
    }

    [Fact]
    public async Task Patch_without_expected_is_not_checked()
    {
        var db = nameof(Patch_without_expected_is_not_checked);
        var id = await SeedAsync(db, null, ("medical", 5));
        Assert.IsType<OkObjectResult>(await PatchAsync(db, id, Medical("new", null)));
        Assert.Equal("new", await MedicalSummaryAsync(db, id));
        Assert.Equal(6, await RevisionAsync(db, id, "medical"));
    }

    [Fact]
    public async Task Mixed_body_with_one_stale_group_refuses_everything()
    {
        var db = nameof(Mixed_body_with_one_stale_group_refuses_everything);
        var id = await SeedAsync(db, null, ("aboutMe", 1));
        var result = await PatchAsync(db, id, new PatchParticipantDto
        {
            AboutMe = new PatchAboutMeDto { Goals = "new goal" },
            Medical = new PatchMedicalDto { MedicalSummary = "new" },
            ExpectedRevisions = new() { ["aboutMe"] = 0, ["medical"] = 0 },
        });
        Assert.IsType<ConflictObjectResult>(result);
        Assert.Equal("old", await MedicalSummaryAsync(db, id));
        Assert.Equal(0, await RevisionAsync(db, id, "medical"));
    }

    [Fact]
    public async Task Unknown_expected_key_is_400()
    {
        var db = nameof(Unknown_expected_key_is_400);
        var id = await SeedAsync(db);
        var bad = Assert.IsType<BadRequestObjectResult>(await PatchAsync(db, id, Medical("new", new() { ["medicl"] = 0 })));
        Assert.Contains("medicl", Assert.IsType<ApiResponse<ParticipantDetailDto>>(bad.Value).Errors[0]);
    }

    [Fact]
    public async Task First_save_with_expected_zero_creates_the_row_at_one()
    {
        var db = nameof(First_save_with_expected_zero_creates_the_row_at_one);
        var id = await SeedAsync(db);
        Assert.IsType<OkObjectResult>(await PatchAsync(db, id, Medical("new", new() { ["medical"] = 0 })));
        Assert.Equal(1, await RevisionAsync(db, id, "medical"));
    }

    [Fact]
    public async Task Expected_keys_for_unsent_groups_are_ignored()
    {
        var db = nameof(Expected_keys_for_unsent_groups_are_ignored);
        var id = await SeedAsync(db, null, ("aboutMe", 4));
        Assert.IsType<OkObjectResult>(await PatchAsync(db, id, Medical("new", new() { ["medical"] = 0, ["aboutMe"] = 1 })));
    }
}
