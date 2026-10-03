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
            "Every writer looks the shift's completion up by shift first: the live set (ActiveCompletionsOf), which also leaves alone a shift whose active completion is a person's " +
            "or that a coordinator returned (the returned completion is inactive but keeps its id, which a start would insert a second time), and the roster pack, which writes a " +
            "completion only with a shift it has just created or for a Published shift that was never returned and has none at all (CompletionsOf).",
            "DemoHumanRowsTests.APresenterWhoStartsTheShiftThemselves_LeavesOneActiveCompletion_AndTheScriptLeavesTheirShiftAlone",
            "DemoHumanRowsTests.ALiveShiftACoordinatorReturnedForCorrection_IsLeftToTheWorkerAgain_AndNoLaterTickFails"),

        ["StaffParticipantCompatibility|IX_StaffParticipantCompatibility_TenantId_UserId_ParticipantId"] = new(
            "The compatibility pack skips a pair that has a cell, by id or by (user, participant): the owner's cell wins.",
            "DemoStaticPacksTests.Compatibility_NeverOverwritesAnExistingCell_AndNeverAddsADuplicate"),

        ["MedicationAdministration|IX_MedicationAdministrations_TenantId_IdempotencyKey"] = new(
            "The packs' key is demo-v1:{id} (PackageRows.Dose), so it can only collide with the pack's own row, which is found by id; a person's key is the recorder's own. " +
            "(The slot a dose is for has no unique index, only the recorder's slot lock, so the packs read the slot itself: DemoQueries.SlotsRecorded.)",
            "DemoRecordedSlotTests.APresenterWhoRecordsTheLunchtimeDoseAsGiven_BeforeTheShiftsEnd_LeavesOneActiveRecordOfTheSlot_TheirOwn",
            "DemoRecordedSlotTests.APresenterWhoRecordsTheLunchtimeDoseAsRefused_BeforeTheShiftsEnd_LeavesOneActiveRecordOfTheSlot_TheirOwn",
            "DemoRecordedSlotTests.APresenterWhoRecordsADoseTheScriptWouldWriteWhileTheShiftRuns_LeavesOneActiveRecordOfTheSlot_TheirOwn"),

        ["ShiftPattern|IX_ShiftPatterns_SourceDraft_Block_Day_Slot"] = new(
            "The index (plan builder phase D) is partial: it holds only a pattern an approved agreement revision made (SourceDraftId set). The pack's patterns are written by id with no source, " +
            "so they are outside it, and a pattern a person's approval makes has a random id the pack never writes.",
            "PlanApprovalSchemaTests.A_pattern_made_by_an_approval_is_unique_by_revision_block_weekday_and_worker_slot_and_a_hand_made_pattern_is_outside_the_index"),

        ["BookingTask|IX_BookingTask_SourceKey"] = new(
            "Every pack task's SourceKey is built from the id of the row it belongs to (flagged-note:{note}, med-witness:{dose}, incident-qsc:{incident}) and is written in the same " +
            "save as that row, so a person cannot hold the key first; leave coverage asks for the keys it wants first (DemoQueries.ExistingTaskKeys) and raises through the app's own " +
            "IObligationTaskService.EnsureAsync."),
    };

    /// <summary>
    /// The audit of PR 1's packs, which are live: the keys of their tables that the app holds by a rule of its own and not by an index (the model has no index on these, and
    /// no migration creates one by raw SQL), and the way the packs stay clear of each. Not found by reflection: a new controller rule is found by reading, as this was.
    /// </summary>
    private static readonly Dictionary<string, Account> AppRules = new(StringComparer.Ordinal)
    {
        ["LeaveRequest|(staff member, type, first day, last day) among those not cancelled or declined (LeaveController.HasDuplicateLeaveAsync, PortalController.CreateMyLeaveRequest)"] = new(
            "The leave pack asks for the keys of the staff members it would write for (DemoQueries.ActiveLeaveKeysOf) and writes no request whose key a person's holds; a request of its own that is " +
            "cancelled or declined is outside the key and is written as ever.",
            "DemoPr1HumanRowsTests.APriyaAnnualLeaveRequestAPersonMadeFirst_HoldsTheKeyUnlessItIsCancelledOrDeclined",
            "DemoPr1HumanRowsTests.APendingRequestAPersonMade_IdenticalToTheTopUpsDeclinedOne_DoesNotStopItBeingWritten"),

        ["RecurringUnavailability|(staff member, day, start, end, effective from, effective to) among those not cancelled or declined (LeaveController.HasDuplicateUnavailabilityAsync, PortalController)"] = new(
            "The same lookup (DemoQueries.ActiveRuleKeysOf).",
            "DemoPr1HumanRowsTests.AnEmilyTuesdayRuleAPersonMadeFirst_HoldsTheKeyUnlessItIsCancelledOrDeclined"),

        ["Shift|(pattern, date) (RosterShiftGenerator, which the Generate button, an approval and the daily top-up all use, skips a date that already carries a shift of the pattern, whatever its status)"] = new(
            "The roster pack asks for the dates its pattern shifts would land on (DemoQueries.PatternDatesOf) and places none where a shift of the pattern stands, and moves forward only the shifts it made.",
            "DemoRosterBesideAppShiftsTests.ADraftTheAppGeneratedForADemoPatternBeyondTheWindow_IsNotDoubledWhenTheWindowReachesIt",
            "DemoRosterBesideAppShiftsTests.APastDraftTheAppGeneratedForADemoPattern_IsNotCancelledByTheTopUp"),

        ["ProviderSettings|one row per tenant (the settings page makes the row when there is none, every reader takes the first)"] = new(
            "The pack writes only when the tenant has no row, and asks for its id under any tenant as well.",
            "DemoStaticPacksTests.ProviderSettings_NeverChangeAnExistingRow_AndAddNoSecondOne",
            "DemoStaticPacksEdgeTests.ProviderSettings_ARowAnotherTenantHoldsTheIdOf_IsNotInsertedAgain_AndTheTickRunsClean"),

        ["ParticipantContactRole|at most one active Plan Manager and one primary Next of Kin per participant (ContactRoleRules.ValidateUniqueness)"] = new(
            "The pack writes Emergency Contact roles only, which the rule does not govern, and leaves a participant who already has an active one alone, whoever made it.",
            "DemoStaticPacksTests.EmergencyContacts_LeaveAParticipantWhoAlreadyHasOneAlone"),

        ["ShiftCompletion|one active completion per shift: the index, and the app's Return (inactive, counted) and Start (a new one under a random id)"] = new(
            "The roster pack writes a completion only with a shift it has just made, or for a Published shift that was never returned and has no completion at all, active or not (CompletionsOf).",
            "DemoPr1HumanRowsTests.ARosterShiftWithACompletionAPersonMade_IsNotClosedOutByTheTopUp_AndTheDayRollRunsClean"),

        ["BookingTask|one task per source key: the index, and the app's own EnsureAsync"] = new(
            "The coverage pack asks for the keys it wants first (DemoQueries.ExistingTaskKeys) and raises through the app's own service.",
            "DemoPr1HumanRowsTests.ACoverageTaskAPersonsActionRaised_ForAKeyTheTopUpWouldRaise_IsKept_AndNoSecondTaskIsWritten"),

        ["StaffParticipantCompatibility|one cell per staff member and participant: the index; the app's UpsertCompatibility finds a cell by that pair"] = new(
            "The compatibility pack skips a pair that has a cell, by id or by pair, and does not put back an auto-linked cell beside a pick that moved.",
            "DemoStaticPacksTests.Compatibility_NeverOverwritesAnExistingCell_AndNeverAddsADuplicate",
            "DemoStaticPacksEdgeTests.Compatibility_AnAutoLinkedCellTheAppRemovedWhenThePreferredStaffMoved_IsNotPutBack"),

        ["StaffAvailability|none: the app allows identical rows (VehiclesStaffController.Create)"] = new("Written by id; nothing holds a row back."),
        ["ShiftPattern|none: CreatePattern checks nothing"] = new("Written by id; nothing holds a row back."),
        ["Person|none: a person is free-form, and an emergency contact brings its own"] = new("Written by id, with its role."),
        ["User|not inserted: the staff credentials pack changes the credential columns of existing users, and the guard refuses every other column (Email and Username carry the only unique indexes)"] = new(
            "No insert, and no key column is written.", "DemoStaticPacksTests.Credentials_NeverTouchIdentityEmailRoleOrFlags"),
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

        var dangling = Accounted.Values.Concat(AppRules.Values).SelectMany(a => a.Tests).Where(t => Find(t) is null).ToList();
        Assert.True(dangling.Count == 0, "tests named as evidence that do not exist: " + string.Join("; ", dangling));
        Assert.All(AppRules.Values, account => Assert.False(string.IsNullOrWhiteSpace(account.How)));
    }
}
