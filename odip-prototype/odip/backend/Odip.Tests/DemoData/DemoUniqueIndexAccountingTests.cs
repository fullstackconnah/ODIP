using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The review of PR 2 found the top-up deciding "is my row already there?" by its own deterministic id on tables where the app holds the row to a natural key
/// (finding H1), and asked for every such check to be swept, not just the three that failed. This is the sweep made permanent: every unique index (and every
/// key but the id) of every table the packs may write, which is <see cref="DemoTenantGuard.AdditionTypes"/> and <see cref="DemoTenantGuard.NonTenantParents"/>,
/// has to be accounted for below, with the way the packs stay clear of it. A later pack that writes a new table, or a migration that adds an index to one the
/// packs already write, fails this test until somebody has read the pack against the index and said how it behaves when a person's row is already there.
/// </summary>
public class DemoUniqueIndexAccountingTests
{
    private sealed record Account(string How, params string[] Tests);

    /// <summary>"Entity|index": how the packs stay clear of it, and the tests ("Class.Method") that show it. The tests are looked up, so the evidence cannot dangle.</summary>
    private static readonly Dictionary<string, Account> Accounted = new(StringComparer.Ordinal)
    {
        ["HandoverAcknowledgement|IX_HandoverAcknowledgements_SourceCompletionId_UserId"] = new(
            "Looked up by (source completion, reader), not by id, in the live set (AlreadyThereAsync) and in the history pack (DemoQueries.HandoverAcksOf).",
            "DemoHumanRowsTests.APresenterWhoReadsTodaysEveningHandoverBeforeTheScript_LeavesOneAcknowledgement_AndTheLiveSetGoesOn",
            "DemoShiftPackageHistoryTests.APersonsOwnAcknowledgement_OfTheHandoverTheHistoryWouldHaveReadForThem_IsKept_AndThePackGoesOn",
            "DemoDataPostgresTests.Postgres_H1_APersonsOwnRowForAKeyTheScriptWrites_IsKept_AndNeitherPackRollsBackOnTheDuplicate"),

        ["ShiftBreak|IX_ShiftBreaks_ShiftCompletionId_Running"] = new(
            "Only the live set writes a running break, and it asks for the completion's running break first (DemoQueries.RunningBreaksOf); the history pack writes ended breaks only " +
            "(PackageRows.BreakBetween), which the index does not hold.",
            "DemoHumanRowsTests.APresenterWhoStartsABreakBeforeTheScript_LeavesOneRunningBreak_WhichTheShiftsEndThenEnds",
            "DemoDataPostgresTests.Postgres_H1_APersonsOwnRowForAKeyTheScriptWrites_IsKept_AndNeitherPackRollsBackOnTheDuplicate"),

        ["ShiftRoutineCheck|IX_ShiftRoutineChecks_Completion_Routine_ScheduledAt"] = new(
            "Looked up by (completion, routine, occurrence), not by id, in the live set and in the history pack (DemoQueries.RoutineTicksOf).",
            "DemoHumanRowsTests.APresenterWhoTicksTheMorningRoutineBeforeTheScript_LeavesOneTick_AndTheLiveSetGoesOn",
            "DemoShiftPackageHistoryTests.APersonsOwnTick_OfARoutineTheHistoryWouldHaveTicked_IsKept_AndThePackGoesOn",
            "DemoDataPostgresTests.Postgres_H1_APersonsOwnRowForAKeyTheScriptWrites_IsKept_AndNeitherPackRollsBackOnTheDuplicate"),

        ["ShiftRoutineCheck|IX_ShiftRoutineChecks_Completion_Routine_Untimed"] = new(
            "The same lookup: the key carries the occurrence, and an untimed tick is the key with no occurrence. The packs only write timed ticks (the routine's own times).",
            "DemoHumanRowsTests.APresenterWhoTicksTheMorningRoutineBeforeTheScript_LeavesOneTick_AndTheLiveSetGoesOn"),

        ["ShiftCompletion|IX_ShiftCompletions_ShiftId_Active"] = new(
            "Every writer looks the shift's completion up by shift first: the live set (ActiveCompletionsOf), and the roster pack, which writes a completion only with a shift it has " +
            "just created or for a Published shift that has none at all (CompletionsOf).",
            "DemoHumanRowsTests.APresenterWhoStartsTheShiftThemselves_LeavesOneActiveCompletion_AndTheScriptWorksTheShiftOnIt"),

        ["StaffParticipantCompatibility|IX_StaffParticipantCompatibility_TenantId_UserId_ParticipantId"] = new(
            "The compatibility pack skips a pair that has a cell, by id or by (user, participant): the owner's cell wins.",
            "DemoStaticPacksTests.Compatibility_NeverOverwritesAnExistingCell_AndNeverAddsADuplicate"),

        ["MedicationAdministration|IX_MedicationAdministrations_TenantId_IdempotencyKey"] = new(
            "The packs' key is demo-v1:{id} (PackageRows.Dose), so it can only collide with the pack's own row, which is found by id; a person's key is the recorder's own. " +
            "(The slot a dose is for has no unique index, only the recorder's slot lock, so the packs read the slot itself: DemoQueries.SlotsRecorded.)",
            "DemoRecordedSlotTests.APresenterWhoRecordsTheLunchtimeDoseAsGiven_BeforeTheShiftsEnd_LeavesOneActiveRecordOfTheSlot_TheirOwn",
            "DemoRecordedSlotTests.APresenterWhoRecordsTheLunchtimeDoseAsRefused_BeforeTheShiftsEnd_LeavesOneActiveRecordOfTheSlot_TheirOwn",
            "DemoRecordedSlotTests.APresenterWhoRecordsADoseTheScriptWouldWriteWhileTheShiftRuns_LeavesOneActiveRecordOfTheSlot_TheirOwn"),

        ["BookingTask|IX_BookingTask_SourceKey"] = new(
            "Every pack task's SourceKey is built from the id of the row it belongs to (flagged-note:{note}, med-witness:{dose}, incident-qsc:{incident}) and is written in the same " +
            "save as that row, so a person cannot hold the key first; leave coverage asks for the keys it wants first (DemoQueries.ExistingTaskKeys) and raises through the app's own " +
            "IObligationTaskService.EnsureAsync."),
    };

    private static MethodInfo? Find(string reference)
    {
        var (className, method) = (reference[..reference.IndexOf('.', StringComparison.Ordinal)], reference[(reference.IndexOf('.', StringComparison.Ordinal) + 1)..]);
        return typeof(DemoUniqueIndexAccountingTests).Assembly.GetTypes().FirstOrDefault(t => t.Name == className)?.GetMethod(method);
    }

    private static IEnumerable<(string Key, IEntityType Type)> KeysOfTablesThePacksWrite(IModel model)
    {
        var types = DemoTenantGuard.AdditionTypes.Concat(DemoTenantGuard.NonTenantParents.Keys).Distinct().OrderBy(t => t.Name, StringComparer.Ordinal);
        foreach (var type in types)
        {
            var entity = model.FindEntityType(type) ?? throw new InvalidOperationException($"{type.Name} is not in the model");
            foreach (var index in entity.GetIndexes().Where(i => i.IsUnique)) yield return ($"{type.Name}|{UniqueIndexEmulator.NameOf(index)}", entity);
            foreach (var key in entity.GetKeys().Where(k => !k.IsPrimaryKey())) yield return ($"{type.Name}|alternate key {string.Join("+", key.Properties.Select(p => p.Name))}", entity);

            var primary = entity.FindPrimaryKey()!.Properties;
            if (primary.Count != 1 || primary[0].Name != "Id") yield return ($"{type.Name}|primary key {string.Join("+", primary.Select(p => p.Name))}", entity);
        }
    }

    [Fact]
    public async Task EveryUniqueIndexOfATableThePacksWrite_IsAccountedFor_AndNoEntryIsStale()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await using var db = env.AdminDb();
        var found = KeysOfTablesThePacksWrite(db.Model).Select(k => k.Key).ToList();

        var missing = found.Where(k => !Accounted.ContainsKey(k)).ToList();
        Assert.True(missing.Count == 0, "unaccounted: " + string.Join("", missing.Select(k => $"\n        [\"{k}\"] = \"...\",")));
        var stale = Accounted.Keys.Where(k => !found.Contains(k, StringComparer.Ordinal)).ToList();
        Assert.True(stale.Count == 0, "stale entries (the index is gone or renamed): " + string.Join("; ", stale));
        Assert.All(Accounted.Values, account => Assert.False(string.IsNullOrWhiteSpace(account.How)));

        var dangling = Accounted.Values.SelectMany(a => a.Tests).Where(t => Find(t) is null).ToList();
        Assert.True(dangling.Count == 0, "tests named as evidence that do not exist: " + string.Join("; ", dangling));
    }
}
