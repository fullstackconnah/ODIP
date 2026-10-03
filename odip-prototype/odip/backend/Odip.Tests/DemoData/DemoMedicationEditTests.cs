using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;
using static Odip.Tests.DemoData.DemoAudit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// "A medication edited" (plan 4.4: one of the history panels' narrative entries). Mia's fluoxetine was ceased and Olivia's melatonin put on hold, so
/// each was first prescribed Active and the change is a save of its own, by the coordinator, at nine in the morning on the day it was made, in the same
/// tick that adds the medication. The times are written out by hand against the plan's example day (Fri 2 Oct 2026, AEST +10; March and June 2026 were
/// before and after the end of daylight saving) and against both clock changes.
/// </summary>
public class DemoMedicationEditTests
{
    private static readonly DateTimeOffset FirstRun = new(2026, 10, 2, 0, 30, 0, TimeSpan.Zero);

    private static DateTime Utc(string s) => DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);

    private static async Task<List<AuditLog>> HistoryAsync(DemoTestEnv env, string key)
    {
        await using var db = env.AdminDb();
        var id = MedicationCatalog.IdOf(key);
        return (await db.AuditLogs.Where(a => a.EntityId == id).ToListAsync()).OrderBy(a => a.ChangedAt).ToList();
    }

    [Fact]
    public async Task ACeasedMedicationAndOneOnHold_AreFiledActive_ThenChangedByTheCoordinator_AtNineOnTheDay()
    {
        var env = await TickAsync(FirstRun);

        var ceased = await HistoryAsync(env, "mia-fluoxetine");
        Assert.Equal(new[] { AuditAction.Created, AuditAction.Updated }, ceased.Select(h => h.Action));
        Assert.Equal(Utc("2026-03-15T22:00:00Z"), ceased[0].ChangedAt.UtcDateTime);                 // prescribed Mon 16 Mar, 200 days before, 09:00 in daylight time (+11)
        Assert.Equal(DemoAuditActors.SystemName, ceased[0].ChangedByName);
        Assert.Equal(Utc("2026-09-11T23:00:00Z"), ceased[1].ChangedAt.UtcDateTime);                 // ceased Sat 12 Sep, 20 days before, 09:00 AEST (+10)
        Assert.Equal("Sarah Mitchell", ceased[1].ChangedByName);
        Assert.Equal(DemoFixture.StaffId("sarah"), ceased[1].ChangedById);
        Assert.True(Says(ceased[0], "Status", null, "Active"), ceased[0].Changes);
        Assert.False(Mentions(ceased[0], "EndDate") || Mentions(ceased[0], "Notes"), ceased[0].Changes);                         // filed with nothing yet to say about why it stopped
        Assert.True(Says(ceased[1], "Status", "Active", "Ceased") && Mentions(ceased[1], "EndDate") && Mentions(ceased[1], "Notes"), ceased[1].Changes);

        var onHold = await HistoryAsync(env, "olivia-melatonin");
        Assert.Equal(new[] { AuditAction.Created, AuditAction.Updated }, onHold.Select(h => h.Action));
        Assert.Equal(Utc("2026-06-23T23:00:00Z"), onHold[0].ChangedAt.UtcDateTime);                 // prescribed Wed 24 Jun, 100 days before, 09:00 AEST
        Assert.Equal(Utc("2026-09-21T23:00:00Z"), onHold[1].ChangedAt.UtcDateTime);                 // put on hold Tue 22 Sep, 10 days before
        Assert.Equal("Sarah Mitchell", onHold[1].ChangedByName);
        Assert.True(Says(onHold[0], "Status", null, "Active") && !Mentions(onHold[0], "Notes"), onHold[0].Changes);
        Assert.True(Says(onHold[1], "Status", "Active", "OnHold") && Mentions(onHold[1], "Notes") && !Mentions(onHold[1], "EndDate"), onHold[1].Changes);

        await using var db = env.AdminDb();
        var fluoxetine = await db.ParticipantMedications.SingleAsync(m => m.Id == MedicationCatalog.IdOf("mia-fluoxetine"));
        Assert.Equal((MedicationStatus.Ceased, new DateTime(2026, 9, 12), "Ceased by the prescriber; replaced by sertraline."), (fluoxetine.Status, fluoxetine.EndDate, fluoxetine.Notes));
        Assert.Equal(Utc("2026-09-11T23:00:00Z"), fluoxetine.UpdatedAt);
        var melatonin = await db.ParticipantMedications.SingleAsync(m => m.Id == MedicationCatalog.IdOf("olivia-melatonin"));
        Assert.Equal(MedicationStatus.OnHold, melatonin.Status);
        Assert.Equal(Utc("2026-09-21T23:00:00Z"), melatonin.UpdatedAt);
    }

    [Fact]
    public async Task TheOtherSevenAreOnlyEverCreated_BySystem_AtNineOnTheirStartDay()
    {
        var env = await TickAsync(FirstRun);

        foreach (var spec in MedicationCatalog.New.Where(s => s.ChangedOffset is null))
        {
            var history = await HistoryAsync(env, spec.Key);
            var entry = Assert.Single(history);
            Assert.Equal(AuditAction.Created, entry.Action);
            Assert.Equal(DemoAuditActors.SystemName, entry.ChangedByName);
            Assert.Equal(Odip.Domain.Rostering.ProviderLocalTime.LocalToUtc(At(Friday.AddDays(spec.StartOffset), 9, 0), Zone()), entry.ChangedAt.UtcDateTime);
        }
        Assert.Equal(7, MedicationCatalog.New.Count(s => s.ChangedOffset is null));
    }

    // The day of the change is counted from the first run, so with the first run on the right day it falls on a clock-change day: 09:00 is then in the
    // new time (+11 and +10:30 in the south-east, +10 in Queensland, which keeps one clock), and 4 April 2027 puts it back.
    [Theory]
    [InlineData("NSW", "2026-10-23T23:35:00Z", "mia-fluoxetine", "2026-10-03T22:00:00Z")]       // first run Sat 24 Oct: 20 days before is Sun 4 Oct, 09:00 AEDT
    [InlineData("SA", "2026-10-23T23:35:00Z", "mia-fluoxetine", "2026-10-03T22:30:00Z")]        // 09:00 ACDT
    [InlineData("QLD", "2026-10-23T23:35:00Z", "mia-fluoxetine", "2026-10-03T23:00:00Z")]       // 09:00 AEST
    [InlineData("NSW", "2026-10-13T23:35:00Z", "olivia-melatonin", "2026-10-03T22:00:00Z")]     // first run Wed 14 Oct: 10 days before is Sun 4 Oct
    [InlineData("SA", "2026-10-13T23:35:00Z", "olivia-melatonin", "2026-10-03T22:30:00Z")]
    [InlineData("QLD", "2026-10-13T23:35:00Z", "olivia-melatonin", "2026-10-03T23:00:00Z")]
    [InlineData("NSW", "2027-04-24T00:35:00Z", "mia-fluoxetine", "2027-04-03T23:00:00Z")]       // first run Sat 24 Apr 2027: 20 days before is Sun 4 Apr, 09:00 AEST after the clocks went back
    [InlineData("SA", "2027-04-24T00:35:00Z", "mia-fluoxetine", "2027-04-03T23:30:00Z")]        // 09:00 ACST
    public async Task TheChangeIsAtNineOnTheDayOnTheProvidersClock_OnTheDaysTheClocksChange(string state, string tick, string key, string expectedUtc)
    {
        var env = await TickAsync(new DateTimeOffset(Utc(tick), TimeSpan.Zero), state);

        var history = await HistoryAsync(env, key);

        Assert.Equal(new[] { AuditAction.Created, AuditAction.Updated }, history.Select(h => h.Action));
        Assert.Equal(Utc(expectedUtc), history[1].ChangedAt.UtcDateTime);
        await using var db = env.AdminDb();
        Assert.Equal(Utc(expectedUtc), (await db.ParticipantMedications.SingleAsync(m => m.Id == MedicationCatalog.IdOf(key))).UpdatedAt);
    }

    [Fact]
    public async Task TheChangeIsMadeOnlyWhenTheMedicationIsAdded_SoAnOwnersLaterEditIsNeverReplayedOver()
    {
        var env = await TickAsync(FirstRun);
        await using (var db = env.AdminDb())
        {
            var melatonin = await db.ParticipantMedications.SingleAsync(m => m.Id == MedicationCatalog.IdOf("olivia-melatonin"));
            melatonin.Status = MedicationStatus.Active;
            melatonin.Notes = "Restarted after the sleep review.";
            await db.SaveChangesAsync();
        }

        var later = await RunAsync(env, new DateTimeOffset(2026, 11, 20, 0, 30, 0, TimeSpan.Zero));

        Assert.DoesNotContain(later.RowsChanged.Keys, k => k.StartsWith("medications/", StringComparison.Ordinal));
        Assert.DoesNotContain(later.RowsAdded.Keys, k => k.StartsWith("medications/", StringComparison.Ordinal));
        await using var check = env.AdminDb();
        var kept = await check.ParticipantMedications.SingleAsync(m => m.Id == MedicationCatalog.IdOf("olivia-melatonin"));
        Assert.Equal((MedicationStatus.Active, "Restarted after the sleep review."), (kept.Status, kept.Notes));
    }

    [Fact]
    public async Task WithoutTheCoordinator_TheChangeIsStillMade_AndTheHistoryNamesTheSystem()
    {
        var env = new DemoTestEnv(FirstRun);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        await using (var db = env.AdminDb())
        {
            db.Users.Remove(await db.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("sarah")));
            await db.SaveChangesAsync();
        }

        await RunAsync(env, FirstRun);

        var history = await HistoryAsync(env, "mia-fluoxetine");
        Assert.Equal(new[] { AuditAction.Created, AuditAction.Updated }, history.Select(h => h.Action));
        Assert.Equal(DemoAuditActors.SystemName, history[1].ChangedByName);
        Assert.Null(history[1].ChangedById);
        await using var check = env.AdminDb();
        Assert.Equal(MedicationStatus.Ceased, (await check.ParticipantMedications.SingleAsync(m => m.Id == MedicationCatalog.IdOf("mia-fluoxetine"))).Status);
    }
}
