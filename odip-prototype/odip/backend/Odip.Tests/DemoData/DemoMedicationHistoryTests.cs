using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// The medication chart's history (plan 3a): the week before the first run and today, as the medication slot service, the participant alert
/// rules and the guard see it. The deterministic outcomes are checked as bands and as invariants (every flag explained, every superseded
/// record replaced, every high-risk dose witnessed), and the time rules with the same instants as the live set's.
/// </summary>
public class DemoMedicationHistoryTests
{
    private static async Task<List<MedicationAdministration>> DemoRecordsAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        return (await db.MedicationAdministrations.ToListAsync()).Where(a => a.IdempotencyKey is { } key && key.StartsWith("demo-v1:", StringComparison.Ordinal)).ToList();
    }

    // ── no gaps on the chart ──

    [Fact]
    public async Task EveryScheduledDoseUpToNow_HasARecord_ExceptTheLiveSetsOwnStories()
    {
        var env = await TickAsync(new DateTimeOffset(2026, 10, 2, 8, 30, 0, TimeSpan.Zero));                 // Fri 18:30 AEST: the day's doses are all in the past but the evening ones
        await using var db = env.AdminDb();
        var zone = Zone();
        var slots = new MedicationSlotService(db, env.Clock);
        var participants = await db.Participants.Where(p => p.NdisNumber != null).ToListAsync();
        var gaps = new List<string>();
        var checkedSlots = 0;

        foreach (var participant in participants)
        {
            for (var date = Friday.AddDays(-7); date <= Friday; date = date.AddDays(1))
            {
                var window = await slots.GetWindowAsync(At(date, 0, 0), At(date.AddDays(1), 0, 0), participant.Id, zone, includePrn: false, CancellationToken.None);
                foreach (var slot in window.Slots)
                {
                    if (ProviderLocalTime.LocalToUtc(slot.ScheduledAt, zone) > env.Clock.GetUtcNow().UtcDateTime) continue;
                    checkedSlots++;
                    if (slot.Administration is null) gaps.Add($"{participant.FirstName} {slot.Medication.Name} {slot.ScheduledAt:MM-dd HH:mm}");
                }
            }
        }

        Assert.True(checkedSlots > 100, $"only {checkedSlots} slots were checked");
        // Sophie's 12:00 Clobazam on the live day is the one dose the live set never scripts while the shift runs, and the shift is over (it is
        // written when the shift is finished), so on this evening nothing is missing at all.
        Assert.True(gaps.Count == 0, "slots with no record: " + string.Join(", ", gaps.Take(10)));
    }

    [Fact]
    public async Task ASlotInsideALiveShiftsWindow_IsLeftToTheLiveSet_NotRecordedByTheHistory()
    {
        var env = await TickAsync(new DateTimeOffset(2026, 10, 2, 3, 5, 0, TimeSpan.Zero));                  // Fri 13:05 AEST: Sophie's 12:00 Clobazam is overdue (the shift is not finished before 13:14)
        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);

        Assert.Null(morning.Slot(MedicationCatalog.IdOf("sophie-clobazam"), 12, 0));
        await using var db = env.AdminDb();
        var provider = await ProviderTimeZoneResolver.ResolveAsync(db, CancellationToken.None);
        var doses = await new ShiftPackageService(db, new MedicationSlotService(db, env.Clock)).GetDosesAsync(morning.Shift, provider, includePrn: false, CancellationToken.None);
        Assert.Equal(Odip.Application.DTOs.PortalDoseState.Overdue, doses.Slots.Single(s => s.MedicationName == "Clobazam" && s.ScheduledAt == At(Friday, 12, 0)).State);
        // But Sophie's evening dose yesterday, outside any window, is on the chart.
        var yesterday = await db.MedicationAdministrations.Where(a => a.ParticipantMedicationId == MedicationCatalog.Levetiracetam && a.ScheduledAt == At(Friday.AddDays(-1), 20, 0)).ToListAsync();
        Assert.Single(yesterday);
    }

    // ── the plan's mix ──

    [Fact]
    public async Task TheWeek_HasThePlansMix_OfGivenRefusedWithheldMissedAndOneWrongMedication()
    {
        var env = await TickAsync(Friday1030);
        var records = await DemoRecordsAsync(env);
        int Count(MedicationAdministrationStatus s) => records.Count(r => r.Status == s);

        Assert.True(records.Count is >= 100 and <= 160, $"{records.Count} records");
        Assert.InRange(Count(MedicationAdministrationStatus.Refused), 4, 10);
        Assert.InRange(Count(MedicationAdministrationStatus.Withheld), 2, 8);
        Assert.InRange(Count(MedicationAdministrationStatus.Missed), 3, 10);
        Assert.Equal(1, Count(MedicationAdministrationStatus.WrongMedication));
        Assert.True(Count(MedicationAdministrationStatus.Administered) >= records.Count * 0.8, "most doses were given");

        // Every record that is not a given dose says why; a given one says what was given, and the zone it was given in.
        foreach (var r in records)
        {
            if (r.Status is MedicationAdministrationStatus.Refused or MedicationAdministrationStatus.Withheld or MedicationAdministrationStatus.Missed)
            {
                Assert.False(string.IsNullOrWhiteSpace(r.Reason), $"{r.Status} without a reason");
                Assert.Null(r.AdministeredAt);
            }
            else
            {
                Assert.False(string.IsNullOrWhiteSpace(r.DoseGiven));
                Assert.NotNull(r.AdministeredAt);
                Assert.Equal("Australia/Sydney", r.AdministeredAtTimeZone);
            }
            Assert.Equal($"demo-v1:{r.Id:D}", r.IdempotencyKey);
        }
    }

    [Fact]
    public async Task TheWrongMedicationRecord_IsMiasSertralineOnTheDayBeforeTheFirstRun_ByDaniel()
    {
        var env = await TickAsync(Friday1030);
        var wrong = Assert.Single(await DemoRecordsAsync(env), r => r.Status == MedicationAdministrationStatus.WrongMedication);

        Assert.Equal(MedicationCatalog.MiaSertraline, wrong.ParticipantMedicationId);
        Assert.Equal(At(Friday.AddDays(-1), 8, 0), wrong.ScheduledAt);
        Assert.Equal(DemoFixture.StaffId("daniel"), wrong.RecordedByUserId);
        Assert.False(string.IsNullOrWhiteSpace(wrong.Notes));                              // the recorder demands a note for this status
        Assert.True(wrong.Notes!.Length <= 1000);
        Assert.Equal(At(Friday.AddDays(-1), 8, 9), Local(wrong.AdministeredAt));                // given at 08:09, written down at 08:12
        Assert.Equal(At(Friday.AddDays(-1), 8, 12), Local(wrong.CreatedAt));
    }

    [Fact]
    public async Task EveryFlaggedRecord_WasWrittenBySomebodyWithoutACurrentCompetency_AndOnlyEmilyOrPriya()
    {
        var env = await TickAsync(Friday1030);
        var records = await DemoRecordsAsync(env);
        await using var db = env.AdminDb();
        var users = await db.Users.ToDictionaryAsync(u => u.Id);

        foreach (var r in records)
        {
            var current = MedicationCompetencyGate.Evaluate(users[r.RecordedByUserId!.Value], DateOnly.FromDateTime(Local(r.CreatedAt))).IsCurrent;
            Assert.Equal(!current, r.RecordedWithoutCompetency);
        }
        var flagged = records.Where(r => r.RecordedWithoutCompetency).ToList();
        Assert.InRange(flagged.Count, 2, 6);
        Assert.All(flagged, r => Assert.Contains(r.RecordedByName, new[] { "Emily Nguyen", "Priya Sharma" }));
    }

    [Fact]
    public async Task ASuperseded_MissedRecord_IsKeptAsHistory_AndReplacedByAGivenOne()
    {
        var env = await TickAsync(Friday1030);
        var records = await DemoRecordsAsync(env);
        var superseded = records.Where(r => r.SupersededByAdministrationId is not null).ToList();

        Assert.NotEmpty(superseded);
        foreach (var old in superseded)
        {
            var replacement = records.Single(r => r.Id == old.SupersededByAdministrationId);
            Assert.Equal(MedicationAdministrationStatus.Missed, old.Status);
            Assert.Equal(MedicationAdministrationStatus.Administered, replacement.Status);
            Assert.Equal(old.ParticipantMedicationId, replacement.ParticipantMedicationId);
            Assert.Equal(old.ScheduledAt, replacement.ScheduledAt);
            Assert.True(replacement.CreatedAt > old.CreatedAt);
            Assert.Null(replacement.SupersededByAdministrationId);                                // the active record for its slot
        }
        // Exactly one ACTIVE record per scheduled slot.
        var active = records.Where(r => r.ScheduledAt is not null && r.SupersededByAdministrationId is null).GroupBy(r => (r.ParticipantMedicationId, r.ScheduledAt));
        Assert.All(active, g => Assert.Single(g));
    }

    // ── high-risk doses, witnesses and the obligation tasks ──

    [Fact]
    public async Task EveryGivenHighRiskDose_HasAStaffWitness_AnsweredTheNextMorning_ExceptTodaysAndTheLastDays()
    {
        var env = await TickAsync(Friday1030);
        var records = await DemoRecordsAsync(env);
        await using var db = env.AdminDb();
        var highRisk = (await db.ParticipantMedications.Where(m => m.IsHighRisk).ToListAsync()).Select(m => m.Id).ToHashSet();
        var tasks = await db.BookingTasks.Where(t => t.TaskType == TaskType.MedicationWitness).ToListAsync();

        var witnessed = records.Where(r => highRisk.Contains(r.ParticipantMedicationId) && r.Status == MedicationAdministrationStatus.Administered).ToList();
        Assert.True(witnessed.Count >= 7, $"only {witnessed.Count} high-risk doses");
        foreach (var dose in witnessed)
        {
            Assert.NotNull(dose.WitnessUserId);
            Assert.NotEqual(dose.RecordedByUserId, dose.WitnessUserId);
            Assert.Equal(dose.CreatedAt, dose.WitnessRequestedAt);
            var recordedOn = DateOnly.FromDateTime(Local(dose.CreatedAt));
            var task = tasks.Single(t => t.SourceKey == $"med-witness:{dose.Id}");
            Assert.Equal(recordedOn.AddDays(1), task.DueDate);

            if (recordedOn < Friday)
            {
                // Yesterday's and older: answered at 08:30 the next morning, the task closed the way the portal closes it.
                Assert.Equal(WitnessStatus.Approved, dose.WitnessStatus);
                Assert.Equal(At(recordedOn.AddDays(1), 8, 30), Local(dose.WitnessRespondedAt));
                Assert.Equal(TaskItemStatus.Completed, task.Status);
                Assert.Equal(recordedOn.AddDays(1), task.CompletedDate);
                Assert.Equal(dose.WitnessRespondedAt, task.AutoCompletedAt);
            }
            else
            {
                Assert.Equal(WitnessStatus.Pending, dose.WitnessStatus);                           // today's: waiting in the witness's portal
                Assert.Equal(TaskItemStatus.NotStarted, task.Status);
            }
        }
    }

    // ── as-needed doses ──

    [Fact]
    public async Task AsNeededDoses_HaveAReason_KeepToTheirLimits_AndMostHaveAnOutcome()
    {
        var env = await TickAsync(Friday1030);
        var records = (await DemoRecordsAsync(env)).Where(r => r.ScheduledAt is null).ToList();
        await using var db = env.AdminDb();
        var meds = await db.ParticipantMedications.Where(m => m.Type == MedicationType.Prn).ToDictionaryAsync(m => m.Id);

        Assert.InRange(records.Count, 6, 14);
        Assert.InRange(records.Count(r => r.PrnOutcome is not null), records.Count / 2, records.Count - 1);          // some are left for the viewer to notice
        foreach (var r in records)
        {
            var med = meds[r.ParticipantMedicationId];
            Assert.False(med.IsChemicalRestraint, "no restrictive medication in the history");
            Assert.False(string.IsNullOrWhiteSpace(r.PrnReason));
            Assert.Equal(MedicationAdministrationStatus.Administered, r.Status);
            if (r.PrnOutcome is not null) Assert.True(r.PrnOutcomeAt > r.AdministeredAt, "the outcome is written after the dose");
        }
        foreach (var group in records.GroupBy(r => r.ParticipantMedicationId))
        {
            var times = group.Select(r => r.AdministeredAt!.Value).OrderBy(t => t).ToList();
            var med = meds[group.Key];
            for (var i = 1; i < times.Count; i++)
                Assert.True((times[i] - times[i - 1]).TotalMinutes >= (med.PrnMinIntervalMinutes ?? 0), $"{med.Name} doses too close together");
            foreach (var t in times)
                Assert.True(times.Count(x => x > t.AddHours(-24) && x <= t) <= (med.PrnMaxDosesPer24h ?? int.MaxValue), $"{med.Name} above its 24 hour limit");
        }
    }

    [Fact]
    public async Task ThePrnPicture_ThatTheAppShows_IsWithinLimits_OnEveryDayOfTheWeek()
    {
        var env = await TickAsync(Friday1030);
        await using var db = env.AdminDb();
        var sophie = DemoFixture.ParticipantId("sophie");

        var window = await new MedicationSlotService(db, env.Clock).GetWindowAsync(At(Friday, 0, 0), At(Friday.AddDays(1), 0, 0), sophie, Zone(), includePrn: true, CancellationToken.None);

        var paracetamol = window.Prn.Single(p => p.Medication.Id == MedicationCatalog.Paracetamol);
        Assert.InRange(paracetamol.DosesInLast24h, 1, 4);                                            // today's headache, from the live set
        Assert.NotNull(paracetamol.OutcomePendingAdministration);                                    // and it has no outcome yet: "Record outcome"
    }

    // ── who recorded, and when ──

    [Fact]
    public async Task OnePerson_GivesAParticipantsDoses_ForAPartOfADay_UnlessTheRecordIsOneOfTheFlaggedFew()
    {
        var env = await TickAsync(Friday1030);
        var records = (await DemoRecordsAsync(env)).Where(r => !r.RecordedWithoutCompetency && r.ScheduledAt is not null).ToList();

        var groups = records.GroupBy(r => (r.ParticipantId, Date: DateOnly.FromDateTime(r.ScheduledAt!.Value), Part: r.ScheduledAt.Value.Hour < 12 ? 0 : r.ScheduledAt.Value.Hour < 17 ? 1 : 2))
            .Where(g => g.Count() > 1).ToList();

        Assert.NotEmpty(groups);
        Assert.All(groups.Where(g => g.All(r => r.SupersededByAdministrationId is null && !r.Notes?.StartsWith("Given late", StringComparison.Ordinal) == true)),
            g => Assert.Single(g.Select(r => r.RecordedByUserId).Distinct()));
    }

    [Fact]
    public async Task EveryRecord_IsWrittenInTheSameMinutesWhetherTheTicksWereEveryFifteenMinutesOrOneCatchUp()
    {
        var incremental = new DemoTestEnv(new DateTimeOffset(2026, 10, 1, 20, 0, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(incremental);
        await incremental.SetProviderStateAsync("NSW");
        for (var utc = new DateTimeOffset(2026, 10, 1, 20, 0, 0, TimeSpan.Zero); utc <= new DateTimeOffset(2026, 10, 2, 12, 55, 0, TimeSpan.Zero); utc = utc.AddMinutes(15))
            await RunAsync(incremental, utc);
        var oneGo = await TickAsync(new DateTimeOffset(2026, 10, 2, 12, 55, 0, TimeSpan.Zero));

        static List<string> Rows(DemoTestEnv env)
        {
            using var db = env.AdminDb();
            var snapshot = DemoSnapshot.Take(db);
            return snapshot.Keys.Where(k => DemoSnapshot.TypeOf(k) is nameof(MedicationAdministration)
                                            || (DemoSnapshot.TypeOf(k) == nameof(BookingTask) && snapshot.Row(k)!.GetValueOrDefault("SourceKey")?.StartsWith("med-witness:", StringComparison.Ordinal) == true))
                .OrderBy(k => k, StringComparer.Ordinal)
                .Select(k => k + "=" + string.Join(";", snapshot.Row(k)!.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => kv.Key + ":" + kv.Value))).ToList();
        }
        // The old seed's own rows are not in these databases, so every record is the top-up's.
        var expected = Rows(oneGo);
        Assert.True(expected.Count > 100, $"only {expected.Count} rows");
        Assert.Equal(expected, Rows(incremental));
    }

    [Fact]
    public async Task ASecondTick_AtTheSameClock_WritesNothingMore()
    {
        var env = await TickAsync(Friday1030);
        var before = (await DemoRecordsAsync(env)).Count;

        var again = await RunAsync(env, Friday1030);

        Assert.Equal(before, (await DemoRecordsAsync(env)).Count);
        Assert.DoesNotContain(again.RowsAdded.Keys, k => k.StartsWith("medication-history/", StringComparison.Ordinal));
    }

    // ── coexistence ──

    [Fact]
    public async Task ASlotThatAlreadyHasARecord_IsNeverGivenASecond()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var slot = At(Friday.AddDays(-3), 8, 0);
        await using (var db = env.AdminDb())
        {
            db.MedicationAdministrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000001"), TenantId = DemoTestEnv.DemoTenantId, ParticipantMedicationId = MedicationCatalog.Levetiracetam,
                ParticipantId = DemoFixture.ParticipantId("sophie"), ScheduledAt = slot, AdministeredAt = new DateTime(2026, 9, 29, 8, 3, 0, DateTimeKind.Utc),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (500mg)", RecordedByName = "Old Seed",
            });
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Friday1030);

        await using var check = env.AdminDb();
        Assert.Single(await check.MedicationAdministrations.Where(a => a.ParticipantMedicationId == MedicationCatalog.Levetiracetam && a.ScheduledAt == slot).ToListAsync());
    }

    [Fact]
    public async Task WithoutTheOldSeedsMedications_NothingIsWritten_AndNothingFails()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env, oldSeed: false);
        await env.SetProviderStateAsync("NSW");

        await RunAsync(env, Friday1030);

        await using var db = env.AdminDb();
        Assert.Empty(await db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task WhenTheFirstRunsYesterdayHasLeftTheWeek_TheWrongMedicationStoryIsNotMadeLate()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        // The first run happens without the history, then nine days pass before the history first runs.
        env.Clock.Set(Friday1030);
        var withoutHistory = DemoPacks.Default().Where(p => p.Name != "medication-history").ToList();
        Assert.Empty((await env.Maintainer(withoutHistory).RunAsync(env.Options, CancellationToken.None)).Failures);

        await RunAsync(env, Friday1030.AddDays(9));

        Assert.DoesNotContain(await DemoRecordsAsync(env), r => r.Status == MedicationAdministrationStatus.WrongMedication);
    }

    // ── the time rules ──

    // state, the tick (Sunday 12:00 on the provider's clock), the day.
    public static IEnumerable<object[]> ClockChangeNoons() => new[]
    {
        new object[] { "NSW", "2026-10-04T01:00:00Z", "2026-10-04" },     // forward: AEDT +11 (noon is 01:00Z)
        new object[] { "QLD", "2026-10-04T02:00:00Z", "2026-10-04" },
        new object[] { "SA", "2026-10-04T01:30:00Z", "2026-10-04" },      // ACDT +10:30
        new object[] { "NSW", "2027-04-04T02:00:00Z", "2027-04-04" },     // back: AEST +10
        new object[] { "SA", "2027-04-04T02:30:00Z", "2027-04-04" },      // ACST +9:30
    };

    [Theory]
    [MemberData(nameof(ClockChangeNoons))]
    public async Task OnTheDayTheClocksChange_AGivenDoseIsStillWithinMinutesOfItsWallClockSlot_InEveryZone(string state, string tick, string day)
    {
        var env = await TickAsync(DateTimeOffset.Parse(tick, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal), state);
        var date = DateOnly.ParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var records = (await DemoRecordsAsync(env)).Where(r => r.ScheduledAt is { } slot && DateOnly.FromDateTime(slot) == date
                                                                 && r.Status == MedicationAdministrationStatus.Administered).ToList();

        Assert.NotEmpty(records);
        foreach (var r in records)
        {
            var late = (Local(r.AdministeredAt, state)!.Value - r.ScheduledAt!.Value).TotalMinutes;
            Assert.InRange(late, 0, 41);                                                             // a fixed offset would put it an hour out
            Assert.InRange((Local(r.CreatedAt, state) - Local(r.AdministeredAt, state)!.Value).TotalMinutes, 1, 3);
            Assert.Equal(ProviderTimeZoneResolver.FromState(state).Id, r.AdministeredAtTimeZone);
        }
    }

    [Theory]
    [InlineData("NSW", "2026-10-04")]
    [InlineData("QLD", "2026-10-04")]
    [InlineData("SA", "2026-10-04")]
    [InlineData("NSW", "2027-04-04")]
    [InlineData("SA", "2027-04-04")]
    public async Task ARecordIsWritten_AtTwoMinutesPastItsRecordedTime_OnTheDayTheClocksChange(string state, string day)
    {
        var date = DateOnly.ParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var noon = new DateTimeOffset(ProviderLocalTime.LocalToUtc(At(date, 12, 0), Zone(state)), TimeSpan.Zero);
        var full = await TickAsync(noon, state);
        var movicol = (await DemoRecordsAsync(full)).Single(r => r.ParticipantMedicationId == MedicationCatalog.Movicol && r.ScheduledAt == At(date, 8, 0));
        var due = new DateTimeOffset(movicol.CreatedAt, TimeSpan.Zero).AddMinutes(2);

        var before = await TickAsync(due.AddSeconds(-1), state);
        var at = await TickAsync(due, state);

        Assert.DoesNotContain(await DemoRecordsAsync(before), r => r.Id == movicol.Id);
        Assert.Contains(await DemoRecordsAsync(at), r => r.Id == movicol.Id);
    }
}
