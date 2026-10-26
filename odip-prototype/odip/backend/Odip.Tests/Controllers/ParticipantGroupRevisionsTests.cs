using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>The per-section revision helper every participant writer goes through (EF InMemory, which enforces concurrency tokens).</summary>
public class ParticipantGroupRevisionsTests
{
    private static readonly string[] Collections = ["Consents", "HealthConditions", "AdlAssessments", "ChecklistItems"];

    private static IEnumerable<System.Reflection.PropertyInfo> ScalarGroupProps() =>
        typeof(PatchParticipantDto).GetProperties()
            .Where(p => p.Name != nameof(PatchParticipantDto.ExpectedRevisions) && !Collections.Contains(p.Name));

    private static async Task<Guid> SeedAsync(string db, Action<Participant>? edit = null, params (string Key, int Revision)[] rows)
    {
        await using var ctx = TestDb.Create(db);
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", Region = "North" };
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
        return await ctx.ParticipantGroupRevisions.Where(r => r.ParticipantId == id && r.GroupKey == key).Select(r => r.Revision).SingleAsync();
    }

    [Fact]
    public void Keys_match_the_patch_dto_scalar_groups()
    {
        var groups = ScalarGroupProps().Select(p => char.ToLowerInvariant(p.Name[0]) + p.Name[1..]).ToHashSet();
        Assert.Equal(16, groups.Count);
        Assert.True(groups.SetEquals(ParticipantGroupRevisions.Keys));

        var props = ScalarGroupProps().ToList();
        var dtoType = typeof(PatchParticipantDto);
        var all = new PatchParticipantDto();
        object boxed = all;
        foreach (var prop in props)
            dtoType.GetProperty(prop.Name)!.SetValue(boxed, Activator.CreateInstance(Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType));
        Assert.Equal(16, ParticipantGroupRevisions.SentGroups((PatchParticipantDto)boxed).Count());
        Assert.Empty(ParticipantGroupRevisions.SentGroups(new PatchParticipantDto()));
        var some = new PatchParticipantDto { Medical = new PatchMedicalDto(), AboutMe = new PatchAboutMeDto() };
        Assert.Equal(["aboutMe", "medical"], ParticipantGroupRevisions.SentGroups(some).Order());
    }

    [Fact]
    public void Every_participant_column_is_in_one_group_or_listed()
    {
        using var ctx = TestDb.Create();
        var scalars = ctx.Model.FindEntityType(typeof(Participant))!.GetProperties().Select(p => p.Name).ToHashSet();
        var listed = ParticipantGroupRevisions.Groups.SelectMany(g => g.Columns).Concat(ParticipantGroupRevisions.NotGroupColumns).ToList();
        Assert.Empty(listed.GroupBy(c => c).Where(g => g.Count() > 1).Select(g => g.Key));
        Assert.Empty(listed.Where(c => !scalars.Contains(c)));
        Assert.Empty(scalars.Where(c => !listed.Contains(c)));
    }

    [Fact]
    public async Task Bump_moves_only_groups_with_a_changed_value()
    {
        var db = nameof(Bump_moves_only_groups_with_a_changed_value);
        var id = await SeedAsync(db, p => p.MobilitySupportOptions = ["cane"]);
        await using (var ctx = TestDb.Create(db))
        {
            var p = await ctx.Participants.SingleAsync(x => x.Id == id);
            p.MedicalSummary = "Changed.";
            p.Region = "North";
            p.MobilitySupportOptions = ["cane"];
            await ParticipantGroupRevisions.BumpChangedAsync(ctx, p, null, default);
            await ctx.SaveChangesAsync();
        }
        await using var check = TestDb.Create(db);
        var read = await ParticipantGroupRevisions.ReadAsync(check, id, default);
        Assert.Equal(1, read["medical"]);
        Assert.Equal(0, read["serviceProfile"]);
        Assert.Equal(0, read["supportNeedsMobility"]);
    }

    [Fact]
    public async Task Bump_with_a_stale_opened_revision_throws_on_save()
    {
        var db = nameof(Bump_with_a_stale_opened_revision_throws_on_save);
        var id = await SeedAsync(db, null, ("medical", 2));
        await using (var ctx = TestDb.Create(db))
        {
            var p = await ctx.Participants.SingleAsync(x => x.Id == id);
            p.MedicalSummary = "Mine.";
            await ParticipantGroupRevisions.BumpChangedAsync(ctx, p, new Dictionary<string, int> { ["medical"] = 1 }, default);
            var ex = await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => ctx.SaveChangesAsync());
            Assert.True(ParticipantGroupRevisions.IsLostRace(ex));
        }
        Assert.Equal(2, await RevisionAsync(db, id, "medical"));
    }

    [Fact]
    public async Task Read_returns_all_16_keys_with_zero_for_missing_rows()
    {
        var db = nameof(Read_returns_all_16_keys_with_zero_for_missing_rows);
        var id = await SeedAsync(db, null, ("aboutMe", 3));
        await using var ctx = TestDb.Create(db);
        var read = await ParticipantGroupRevisions.ReadAsync(ctx, id, default);
        Assert.Equal(16, read.Count);
        Assert.Equal(3, read["aboutMe"]);
        Assert.Equal(15, read.Values.Count(v => v == 0));
    }

    [Fact]
    public async Task Stale_when_expected_is_above_current()
    {
        var db = nameof(Stale_when_expected_is_above_current);
        var id = await SeedAsync(db, null, ("medical", 2));
        await using var ctx = TestDb.Create(db);
        var stale = await ParticipantGroupRevisions.StaleAsync(ctx, id, new Dictionary<string, int> { ["medical"] = 5 }, ["medical"], default);
        Assert.NotNull(stale);
        Assert.Equal(2, stale!["medical"]);
        Assert.Null(await ParticipantGroupRevisions.StaleAsync(ctx, id, new Dictionary<string, int> { ["medical"] = 2 }, ["medical"], default));
    }

    [Fact]
    public async Task Save_bumping_retries_once_after_a_lost_race()
    {
        var db = nameof(Save_bumping_retries_once_after_a_lost_race);
        var id = await SeedAsync(db, null, ("medical", 1));
        await using (var a = TestDb.Create(db))
        {
            var p = await a.Participants.SingleAsync(x => x.Id == id);
            await a.ParticipantGroupRevisions.Where(r => r.ParticipantId == id).LoadAsync();
            await using (var b = TestDb.Create(db))
            {
                var row = await b.ParticipantGroupRevisions.SingleAsync(r => r.ParticipantId == id);
                row.Revision = 2;
                await b.SaveChangesAsync();
            }
            p.MedicalSummary = "A value";
            await ParticipantGroupRevisions.BumpChangedAsync(a, p, null, default);
            await ParticipantGroupRevisions.SaveBumpingAsync(a, default);
        }
        Assert.Equal(3, await RevisionAsync(db, id, "medical"));
        await using var check = TestDb.Create(db);
        Assert.Equal("A value", (await check.Participants.SingleAsync(x => x.Id == id)).MedicalSummary);
    }
}
