using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// Third independent review Q5 and Q6, the two places a static pack's "already there?" did not match what the database or the app holds: the provider settings row (an id
/// another tenant's row holds, which the pack's tenant-filtered check does not see) and the one auto-linked compatibility cell (which the app removes when the participant's
/// preferred staff moves away, and the pack put back).
/// </summary>
public class DemoStaticPacksEdgeTests
{
    private static async Task<DemoTestEnv> EnvWithPeopleAsync()
    {
        var env = DemoTestEnv.At(2026, 10, 2, 0, 30);
        await DemoFixture.SeedPeopleAsync(env);
        return env;
    }

    [Fact]
    public async Task ProviderSettings_ARowAnotherTenantHoldsTheIdOf_IsNotInsertedAgain_AndTheTickRunsClean()
    {
        var env = await EnvWithPeopleAsync();
        await using (var db = env.AdminDb())                                                         // the old Demo tenant's row, which a recreated tenant leaves behind
        {
            db.ProviderSettings.Add(new ProviderSettings { Id = DemoIds.For("provider-settings"), TenantId = Guid.NewGuid(), State = "NSW", OrganisationName = "The old Demo tenant", ABN = "00 000 000 000" });
            await db.SaveChangesAsync();
        }

        var result = await env.RunAsync(new IDemoPack[] { new ProviderSettingsPack() });

        Assert.Empty(result.Failures);                                                               // the primary key the old row holds is not inserted again
        Assert.Contains(result.SkippedStories, s => s.Contains("provider settings", StringComparison.OrdinalIgnoreCase));
        await using var check = env.AdminDb();
        Assert.Equal(1, await check.ProviderSettings.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task Compatibility_AnAutoLinkedCellTheAppRemovedWhenThePreferredStaffMoved_IsNotPutBack()
    {
        var env = await EnvWithPeopleAsync();
        await env.RunAsync(new IDemoPack[] { new CompatibilityPack() });
        var james = DemoFixture.StaffId("james");
        var marcus = DemoFixture.StaffId("marcus");
        var liam = DemoFixture.ParticipantId("liam");
        await using (var db = env.AdminDb())
        {
            // Liam's preferred staff moves from James to Marcus: the app removes James' auto-linked cell and makes Marcus' (StaffCompatibilityLinkService).
            var cell = await db.StaffParticipantCompatibilities.SingleAsync(c => c.UserId == james && c.ParticipantId == liam);
            Assert.True(cell.AutoLinked);
            db.StaffParticipantCompatibilities.Remove(cell);
            db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, UserId = marcus, ParticipantId = liam, Level = CompatibilityLevel.Preferred,
                Reason = "Auto-linked from the participant's preferred-staff selection.", AutoLinked = true, UpdatedAt = DateTime.UtcNow,
            });
            (await db.Participants.SingleAsync(p => p.Id == liam)).PreferredUserId = marcus;
            await db.SaveChangesAsync();
        }

        await env.RunAsync(new IDemoPack[] { new CompatibilityPack() });

        await using var check = env.AdminDb();
        Assert.False(await check.StaffParticipantCompatibilities.AnyAsync(c => c.UserId == james && c.ParticipantId == liam));      // not put back beside a pick that points elsewhere
        Assert.Equal(1, await check.StaffParticipantCompatibilities.CountAsync(c => c.ParticipantId == liam && c.AutoLinked));          // the one pick has the one auto-linked cell
    }

    [Fact]
    public async Task Compatibility_TheAutoLinkedCellIsPutBackWhenThePreferredStaffIsStillThatPerson()
    {
        var env = await EnvWithPeopleAsync();
        await env.RunAsync(new IDemoPack[] { new CompatibilityPack() });
        var james = DemoFixture.StaffId("james");
        var liam = DemoFixture.ParticipantId("liam");
        await using (var db = env.AdminDb())                                                         // the cell is deleted (the owner's choice) while the pick is still James
        {
            db.StaffParticipantCompatibilities.Remove(await db.StaffParticipantCompatibilities.SingleAsync(c => c.UserId == james && c.ParticipantId == liam));
            (await db.Participants.SingleAsync(p => p.Id == liam)).PreferredUserId = james;
            await db.SaveChangesAsync();
        }

        await env.RunAsync(new IDemoPack[] { new CompatibilityPack() });

        await using var check = env.AdminDb();
        Assert.True((await check.StaffParticipantCompatibilities.SingleAsync(c => c.UserId == james && c.ParticipantId == liam)).AutoLinked);
    }
}
