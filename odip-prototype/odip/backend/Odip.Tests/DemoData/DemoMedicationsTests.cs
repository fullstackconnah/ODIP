using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The nine medications (plan 3a): what the register shows, that they are made once and left alone, and the plan 4.5 rule that the top-up never
/// writes the first row of a table the old seed guards with Any(). The old seed's own medications are stood in for by one row with a fixed id.
/// </summary>
public class DemoMedicationsTests
{
    private static readonly DateOnly D0 = new(2026, 10, 2);   // Fri 10:30 AEST

    private static async Task<DemoTestEnv> EnvWithTheOldSeedsRegisterAsync(bool oldSeedPresent = true)
    {
        var env = DemoTestEnv.At(2026, 10, 2, 0, 30);
        await DemoFixture.SeedPeopleAsync(env, oldSeedMedications: oldSeedPresent);
        return env;
    }

    private static Task<DemoTickResult> RunAsync(DemoTestEnv env) => env.RunAsync(new IDemoPack[] { new MedicationsPack() });

    private static async Task<List<ParticipantMedication>> NewMedicationsAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        var ids = MedicationCatalog.New.Select(s => MedicationCatalog.IdOf(s.Key)).ToList();
        return await db.ParticipantMedications.Where(m => ids.Contains(m.Id)).ToListAsync();
    }

    [Fact]
    public async Task TheNineMedications_AreAdded_SevenActiveOneOnHoldOneCeased()
    {
        var env = await EnvWithTheOldSeedsRegisterAsync();

        var result = await RunAsync(env);

        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.Empty(result.Failures);
        var meds = await NewMedicationsAsync(env);
        Assert.Equal(9, meds.Count);
        Assert.Equal(7, meds.Count(m => m.Status == MedicationStatus.Active));
        Assert.Equal(1, meds.Count(m => m.Status == MedicationStatus.OnHold));
        Assert.Equal(1, meds.Count(m => m.Status == MedicationStatus.Ceased));
        Assert.All(meds, m => Assert.Equal(DemoTestEnv.DemoTenantId, m.TenantId));
    }

    [Fact]
    public async Task TheSchedules_AreRealSlots_WithOneSpecificDaysAndOnePrnWithAMinimumInterval()
    {
        var env = await EnvWithTheOldSeedsRegisterAsync();
        await RunAsync(env);
        var meds = await NewMedicationsAsync(env);

        foreach (var m in meds.Where(m => m.Type == MedicationType.Regular))
        {
            Assert.True(MedicationSlotCalculator.TryParseTimesOfDay(m.TimesOfDay, out var times), $"{m.Name}: '{m.TimesOfDay}' is not a schedule");
            Assert.NotEmpty(times);
        }
        var weekdays = Assert.Single(meds, m => m.Frequency == MedicationFrequency.SpecificDays);
        Assert.Equal(Weekdays.Tuesday | Weekdays.Friday, weekdays.DaysOfWeek);
        var prn = Assert.Single(meds, m => m.Type == MedicationType.Prn);
        Assert.Equal((3, 360), (prn.PrnMaxDosesPer24h, prn.PrnMinIntervalMinutes));
        Assert.Null(prn.TimesOfDay);
        // Sophie's Omeprazole, Clobazam (two slots), Liam's Baclofen (three): the register shows one to three slots a day.
        Assert.Equal(new[] { "10:00", "12:00,20:00", "08:00,14:00,20:00" },
            new[] { "sophie-omeprazole", "sophie-clobazam", "liam-baclofen" }.Select(k => meds.Single(m => m.Id == MedicationCatalog.IdOf(k)).TimesOfDay!).ToArray());
    }

    [Fact]
    public async Task TheDates_AreTypedMidnightsRelativeToTheFirstRunDay_NeverUtcOrShifted()
    {
        var env = await EnvWithTheOldSeedsRegisterAsync();
        await RunAsync(env);
        var meds = await NewMedicationsAsync(env);

        var omeprazole = meds.Single(m => m.Id == MedicationCatalog.IdOf("sophie-omeprazole"));
        Assert.Equal(new DateTime(2026, 8, 3), omeprazole.StartDate);                        // D0 - 60 days, midnight, as typed
        Assert.Equal(DateTimeKind.Unspecified, omeprazole.StartDate.Kind);
        Assert.Equal(new DateTime(2026, 11, 1), omeprazole.NextReviewDue);                   // D0 + 30
        var ceased = meds.Single(m => m.Status == MedicationStatus.Ceased);
        Assert.Equal(new DateTime(2026, 9, 12), ceased.EndDate);                             // D0 - 20
        Assert.All(meds, m => Assert.True(m.StartDate.Date <= D0.ToDateTime(TimeOnly.MinValue)));
        // The row's own creation time is an instant: nine in the morning on its start date, Sydney time (AEST in early August is +10:00).
        Assert.Equal(new DateTime(2026, 8, 2, 23, 0, 0, DateTimeKind.Utc), omeprazole.CreatedAt);
    }

    [Fact]
    public async Task WithNoMedicationOfTheOldSeedsThere_NothingIsWritten_ItWouldBeTheFirstRowOfAGuardedTable()
    {
        var env = await EnvWithTheOldSeedsRegisterAsync(oldSeedPresent: false);

        var result = await RunAsync(env);

        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.Empty(result.Failures);
        await using var db = env.AdminDb();
        Assert.Equal(0, await db.ParticipantMedications.CountAsync());
        Assert.Contains(result.SkippedStories, s => s.Contains("medications") && s.Contains("first row"));
    }

    [Fact]
    public async Task ASecondRun_ChangesNothing_AndAnOwnersEditToAMedicationSurvives()
    {
        var env = await EnvWithTheOldSeedsRegisterAsync();
        await RunAsync(env);
        await using (var db = env.AdminDb())
        {
            var med = await db.ParticipantMedications.SingleAsync(m => m.Id == MedicationCatalog.IdOf("harrison-metformin"));
            med.DoseDescription = "2 tablets (1000mg)";
            med.Status = MedicationStatus.OnHold;
            await db.SaveChangesAsync();
        }
        env.Clock.Set(new DateTimeOffset(2026, 11, 20, 0, 30, 0, TimeSpan.Zero));

        var second = await RunAsync(env);

        Assert.Equal(0, second.RowsAdded.Values.Sum() + second.RowsChanged.Values.Sum());
        var meds = await NewMedicationsAsync(env);
        var edited = meds.Single(m => m.Id == MedicationCatalog.IdOf("harrison-metformin"));
        Assert.Equal(("2 tablets (1000mg)", MedicationStatus.OnHold), (edited.DoseDescription, edited.Status));
        Assert.Equal(9, meds.Count);
    }

    [Fact]
    public async Task AMissingParticipant_SkipsOnlyTheirMedications()
    {
        var env = await EnvWithTheOldSeedsRegisterAsync();
        await using (var db = env.AdminDb())
        {
            var olivia = await db.Participants.SingleAsync(p => p.Id == DemoFixture.ParticipantId("olivia"));
            olivia.IsActive = false;                                       // the directory skips a participant who is not active
            await db.SaveChangesAsync();
        }

        var result = await RunAsync(env);

        Assert.Empty(result.Failures);
        var meds = await NewMedicationsAsync(env);
        Assert.Equal(7, meds.Count);                                       // Olivia's vitamin D and melatonin are the two that are skipped
        Assert.DoesNotContain(meds, m => m.Name is "Vitamin D3" or "Melatonin");
        Assert.Equal(2, result.SkippedStories.Count(s => s.Contains("participant is missing")));
    }
}
