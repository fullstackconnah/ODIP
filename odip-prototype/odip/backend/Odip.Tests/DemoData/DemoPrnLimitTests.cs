using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// Third independent review R4: the app refuses an as-needed dose that breaks the medication's minimum interval or daily maximum against the doses already recorded (unless
/// the worker acknowledges the breach), and a row the top-up writes carries no acknowledgement. Both scripts judged their dose by its own id alone, so a dose a presenter
/// recorded in the portal 50 minutes before the live set's 10:20 paracetamol, or an hour from a history day's, was followed by one the app could not have produced. The
/// top-up now asks the same question the recorder asks, and <see cref="ThePrnRule_GivesTheRecordersAnswer"/> holds the two to one answer through the recorder itself.
/// </summary>
public class DemoPrnLimitTests
{
    private static readonly Guid Paracetamol = MedicationCatalog.Paracetamol;                              // Sophie: at most 4 in 24 hours, 240 minutes apart

    private static DateTimeOffset Utc(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static DateTime GivenAt(int hour, int minute) => ProviderLocalTime.LocalToUtc(At(Friday, hour, minute), Zone());

    /// <summary>A dose a worker recorded in the portal: random id, the worker's own key, no breach acknowledged.</summary>
    private static async Task<Guid> AddGivenAsync(DemoTestEnv env, DateTime givenUtc, MedicationAdministrationStatus status = MedicationAdministrationStatus.Administered,
        Guid? supersededBy = null)
    {
        await using var db = env.AdminDb();
        var med = await db.ParticipantMedications.SingleAsync(m => m.Id == Paracetamol);
        var row = new MedicationAdministration
        {
            Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, ParticipantMedicationId = Paracetamol, ParticipantId = med.ParticipantId, AdministeredAt = givenUtc,
            AdministeredAtTimeZone = Zone().Id, Status = status, DoseGiven = "2 tablets (1000mg)", PrnReason = "Headache", Reason = status == MedicationAdministrationStatus.Administered ? null : "Declined.",
            RecordedByName = "A worker", RecordedByUserId = DemoFixture.StaffId("james"), WitnessStatus = WitnessStatus.NotRequired, IdempotencyKey = Guid.NewGuid().ToString("N"),
            SupersededByAdministrationId = supersededBy, CreatedAt = givenUtc.AddMinutes(1), UpdatedAt = givenUtc.AddMinutes(1),
        };
        db.MedicationAdministrations.Add(row);
        await db.SaveChangesAsync();
        return row.Id;
    }

    private static async Task<List<MedicationAdministration>> ParacetamolGivenOnAsync(DemoTestEnv env, DateOnly date)
    {
        var from = ProviderLocalTime.LocalToUtc(date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified), Zone());
        var until = from.AddDays(1);
        await using var db = env.AdminDb();
        return (await db.MedicationAdministrations.Where(a => a.ParticipantMedicationId == Paracetamol && a.Status == MedicationAdministrationStatus.Administered).ToListAsync())
            .Where(a => a.AdministeredAt >= from && a.AdministeredAt < until).OrderBy(a => a.AdministeredAt).ToList();
    }

    public static IEnumerable<object[]> Scenarios()
    {
        // Minutes from the dose being judged to each Administered record beside it (negative: before it); true when the app refuses the dose.
        yield return new object[] { "nothing beside it", new int[0], false };
        yield return new object[] { "239 minutes before", new[] { -239 }, true };
        yield return new object[] { "240 minutes before", new[] { -240 }, false };
        yield return new object[] { "239 minutes after", new[] { 239 }, true };
        yield return new object[] { "240 minutes after", new[] { 240 }, false };
        yield return new object[] { "four in the 24 hours before", new[] { -1380, -1020, -660, -300 }, true };
        yield return new object[] { "three in the 24 hours before", new[] { -1020, -660, -300 }, false };
        yield return new object[] { "four spread over both sides, none within the interval", new[] { -700, -300, 300, 700 }, true };
        yield return new object[] { "two a day away, outside the 24 hours", new[] { -1500, 1500 }, false };
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task ThePrnRule_GivesTheRecordersAnswer(string scenario, int[] minutesFromTheDose, bool refused)
    {
        var dose = GivenAt(12, 0);
        var env = new DemoTestEnv(new DateTimeOffset(dose.AddDays(2), TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        foreach (var minutes in minutesFromTheDose) await AddGivenAsync(env, dose.AddMinutes(minutes));

        // A superseded record, and one that says the dose was not given, are not doses given: they hold nothing back.
        await AddGivenAsync(env, dose.AddMinutes(10), supersededBy: Guid.NewGuid());
        await AddGivenAsync(env, dose.AddMinutes(-10), MedicationAdministrationStatus.Refused);

        await using var db = env.DemoTenantDb();
        var worker = await db.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("james"));
        var med = await db.ParticipantMedications.SingleAsync(m => m.Id == Paracetamol);
        var result = await new MedicationAdministrationRecorder(db, clock: env.Clock).RecordAsync(new RecordAdministrationRequest(Paracetamol, new CreateAdministrationDto
        {
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = dose, DoseGiven = "2 tablets (1000mg)", PrnReason = "Headache", IdempotencyKey = Guid.NewGuid().ToString("N"),
        }, worker.Id, worker.FullName, med.ParticipantId), CancellationToken.None);

        var message = result.Message ?? string.Empty;
        var recorderRefused = result.Outcome == RecordAdministrationOutcome.Invalid
            && (message.Contains("doses in 24 hours", StringComparison.Ordinal) || message.Contains("Minimum interval", StringComparison.Ordinal) || message.Contains("minutes before the dose", StringComparison.Ordinal));
        Assert.True(recorderRefused || result.Outcome == RecordAdministrationOutcome.Created, $"{scenario}: the recorder said {result.Outcome}: {message}");
        Assert.Equal(refused, recorderRefused);                                                              // the table is the recorder's answer ...

        await using var check = env.AdminDb();
        var given = (await check.MedicationAdministrations.Where(a => a.ParticipantMedicationId == Paracetamol && a.Status == MedicationAdministrationStatus.Administered
                                                                       && a.SupersededByAdministrationId == null && a.AdministeredAt != null)
            .Select(a => a.AdministeredAt!.Value).ToListAsync()).Where(t => t != dose).ToList();             // (the one the recorder just made is the dose itself)
        Assert.Equal(refused, PrnLimits.WouldBreach(med, dose, given));                                       // ... and so is the top-up's
    }

    [Fact]
    public async Task APresenterWhoRecordsAParacetamolBeforeTheScriptsTenTwenty_LeavesOneDoseOfTheDay_TheirOwn()
    {
        var env = await TickAsync(Utc("2026-10-01T23:40:00Z"));                                              // Fri 09:40: Sophie has been on shift since 06:58
        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        Guid theirs;
        await using (var db = env.DemoTenantDb())                                                            // a portal request: tenant-scoped, so the row is the Demo tenant's
        {
            var result = await new MedicationAdministrationRecorder(db, clock: env.Clock).RecordAsync(new RecordAdministrationRequest(Paracetamol, new CreateAdministrationDto
            {
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = GivenAt(9, 30), DoseGiven = "2 tablets (1000mg)", PrnReason = "Headache",
                IdempotencyKey = Guid.NewGuid().ToString("N"),
            }, morning.Worker.Id, morning.Worker.FullName, morning.Shift.ParticipantId), CancellationToken.None);
            Assert.Equal(RecordAdministrationOutcome.Created, result.Outcome);
            theirs = result.Administration!.Id;
        }

        await RunAsync(env, Utc("2026-10-02T00:30:00Z"));                                                    // Fri 10:30: the script's 10:20 is due, 50 minutes after theirs
        await RunAsync(env, Utc("2026-10-02T04:30:00Z"));                                                    // Fri 14:30: the shift has been finished

        Assert.Equal(theirs, Assert.Single(await ParacetamolGivenOnAsync(env, Friday)).Id);                  // the app would have refused the second
    }

    [Fact]
    public async Task ADoseAPresenterRecordedAfterTheScriptsTenTwenty_IsNotFollowedByOneTheAppWouldRefuse_WhenTheHostCameBackLate()
    {
        var env = new DemoTestEnv(Utc("2026-10-02T01:05:00Z"));                                              // Fri 11:05: the host was down, and the first tick is now
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var theirs = await AddGivenAsync(env, GivenAt(11, 0));                                               // a worker's dose at 11:00, there before the first tick

        await RunAsync(env, Utc("2026-10-02T01:05:00Z"));                                                    // the script's 10:20 would be 40 minutes before theirs

        Assert.Equal(theirs, Assert.Single(await ParacetamolGivenOnAsync(env, Friday)).Id);
    }

    [Fact]
    public async Task ARefusedDose_AndASupersededOne_BesideTheScriptsTenTwenty_HoldNothingBack()
    {
        var env = new DemoTestEnv(Utc("2026-10-02T01:05:00Z"));                                              // Fri 11:05: the first tick
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        await AddGivenAsync(env, GivenAt(10, 0), MedicationAdministrationStatus.Refused);                    // not a dose given
        var replaced = await AddGivenAsync(env, GivenAt(10, 0), supersededBy: Guid.NewGuid());               // given, and since replaced by another record

        await RunAsync(env, Utc("2026-10-02T01:05:00Z"));

        var friday = await ParacetamolGivenOnAsync(env, Friday);
        var given = Assert.Single(friday, d => d.Id != replaced);
        Assert.StartsWith("demo-v1:", given.IdempotencyKey, StringComparison.Ordinal);                       // the script's own 10:20, which neither of them stops
    }

    [Fact]
    public async Task AHistoryDaysParacetamol_IsNotWrittenBesideADoseAPersonRecordedAnHourLater_AndTheOtherDaysAre()
    {
        var utc = Utc("2026-10-02T00:30:00Z");                                                               // Fri 10:30

        // The week's history, as it comes out when nobody else has recorded anything: the days on which the history gives Sophie a paracetamol.
        var control = await TickAsync(utc);
        List<MedicationAdministration> history;
        await using (var db = control.AdminDb())
            history = (await db.MedicationAdministrations.Where(a => a.ParticipantMedicationId == Paracetamol && a.Status == MedicationAdministrationStatus.Administered).ToListAsync())
                .Where(a => a.IdempotencyKey != null && a.IdempotencyKey.StartsWith("demo-v1:", StringComparison.Ordinal) && Local(a.AdministeredAt!.Value) < At(Friday.AddDays(-1), 0, 0))
                .OrderBy(a => a.AdministeredAt).ToList();
        Assert.NotEmpty(history);                                                                            // the formula gives this medication at least one day in the week
        var day = history[0];

        // The same week, with a dose an hour after that one that a worker recorded before the first run: the history leaves that day alone.
        var env = new DemoTestEnv(utc);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var theirs = await AddGivenAsync(env, day.AdministeredAt!.Value.AddMinutes(60));
        await RunAsync(env, utc);

        await using var check = env.AdminDb();
        var now = (await check.MedicationAdministrations.Where(a => a.ParticipantMedicationId == Paracetamol && a.Status == MedicationAdministrationStatus.Administered).ToListAsync())
            .Where(a => a.IdempotencyKey != null && a.IdempotencyKey.StartsWith("demo-v1:", StringComparison.Ordinal) && Local(a.AdministeredAt!.Value) < At(Friday.AddDays(-1), 0, 0)).ToList();
        Assert.DoesNotContain(now, a => a.Id == day.Id);                                                     // not beside theirs
        Assert.Equal(history.Count - 1, now.Count);                                                          // and nothing else was held back
        Assert.NotNull(await check.MedicationAdministrations.SingleAsync(a => a.Id == theirs));
    }
}
