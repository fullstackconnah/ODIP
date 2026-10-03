using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.Notifications;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// Every query the top-up makes (<see cref="DemoQueries"/>) is translated to SQL by the Npgsql provider here, with no server: EF InMemory, which
/// runs the rest of the demo tests, quietly evaluates in memory what the real provider cannot translate (a method call, an unsupported
/// shape), and a query that fails to translate is only noticed as a failed tick on the host. <c>ToQueryString()</c> compiles the query
/// without executing it, so a shape that does not translate throws here, and the SQL's essential fragments (a primary-key probe is
/// <c>= ANY(@ids)</c>, not a scan; a status and a date are filtered in SQL) are asserted.
/// </summary>
public class DemoQueryTranslationTests
{
    private static readonly Guid TenantId = Guid.Parse("b0000000-0000-0000-0000-000000000001");

    private static OdipDbContext NpgsqlDb() => new(
        new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql("Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x").Options,
        new ScopedTenantOverride { TenantId = TenantId });

    private static readonly List<Guid> Ids = new() { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };
    private static readonly DateOnly Today = new(2026, 10, 2);

    public static IEnumerable<object[]> Queries()
    {
        static object[] Q(string name, Func<OdipDbContext, IQueryable> query, params string[] fragments) => new object[] { name, query, fragments };

        yield return Q(nameof(DemoQueries.ExistingIds), db => DemoQueries.ExistingIds<Shift>(db, Ids.ToArray()), "WHERE s.\"Id\" = ANY (");
        yield return Q(nameof(DemoQueries.DemoTenantCandidates), DemoQueries.DemoTenantCandidates, "\"Name\" =");
        yield return Q(nameof(DemoQueries.ProviderState), DemoQueries.ProviderState, "\"State\"");
        yield return Q(nameof(DemoQueries.Participants), DemoQueries.Participants, "\"NdisNumber\"", "\"IsDraft\"");
        yield return Q(nameof(DemoQueries.UsersByEmail), db => DemoQueries.UsersByEmail(db, new List<string> { "a@b.c" }), "\"Email\" = ANY (");
        yield return Q(nameof(DemoQueries.CompatibilityCellsOf), db => DemoQueries.CompatibilityCellsOf(db, Ids), "\"UserId\" = ANY (");
        yield return Q(nameof(DemoQueries.ActiveEmergencyContacts), db => DemoQueries.ActiveEmergencyContacts(db, Ids), "\"ParticipantId\" = ANY (", "\"RoleType\" =", "\"Status\" =");
        yield return Q(nameof(DemoQueries.PatternsByIds), db => DemoQueries.PatternsByIds(db, Ids), "\"Id\" = ANY (");
        yield return Q(nameof(DemoQueries.OpenShifts), db => DemoQueries.OpenShifts(db, Today, Ids), "\"ServiceDate\" <=", "\"ShiftPatternId\" IS NULL OR", "\"ShiftPatternId\" = ANY (", "\"Status\"");
        yield return Q(nameof(DemoQueries.CompletionsOf), db => DemoQueries.CompletionsOf(db, Ids), "\"ShiftId\" = ANY (");
        yield return Q(nameof(DemoQueries.LapsedLeave), db => DemoQueries.LapsedLeave(db, Today), "\"Status\" =", "\"StartDate\" <");
        yield return Q(nameof(DemoQueries.LapsedRules), db => DemoQueries.LapsedRules(db, Today), "\"Status\" =", "\"EffectiveFrom\" <");
        yield return Q(nameof(DemoQueries.ApprovedLeaveNotYetOver), db => DemoQueries.ApprovedLeaveNotYetOver(db, Today), "\"Status\" =", "\"EndDate\" >=");
        yield return Q(nameof(DemoQueries.PublishedShiftsOf), db => DemoQueries.PublishedShiftsOf(db, Ids, Today), "\"UserId\" = ANY (", "INNER JOIN (", "FROM \"Participants\"");
        yield return Q(nameof(DemoQueries.ExistingTaskKeys), db => DemoQueries.ExistingTaskKeys(db, new List<string> { "k" }), "\"SourceKey\" = ANY (");
        yield return Q(nameof(DemoQueries.OpenCoverageTasks), DemoQueries.OpenCoverageTasks, "\"TaskType\" =", "\"LeaveRequestId\" IS NOT NULL", "\"SourceKey\"");
        yield return Q(nameof(DemoQueries.WorkedShiftIds), db => DemoQueries.WorkedShiftIds(db, Ids), "\"Id\" = ANY (");

        // PR 2: the live set, the medication chart and the shift package.
        yield return Q(nameof(DemoQueries.UsersByIds), db => DemoQueries.UsersByIds(db, Ids), "\"Id\" = ANY (");
        yield return Q(nameof(DemoQueries.WeekShifts), db => DemoQueries.WeekShifts(db, Today, Today.AddDays(6)), "\"ServiceDate\" >=", "\"ServiceDate\" <=");
        yield return Q(nameof(DemoQueries.CompatibilityLevels), db => DemoQueries.CompatibilityLevels(db, Ids), "\"UserId\" = ANY (");
        yield return Q(nameof(DemoQueries.HolidaysOf), db => DemoQueries.HolidaysOf(db, "NSW", Today, Today.AddDays(6)), "\"Date\" >=", "\"State\"");
        yield return Q(nameof(DemoQueries.TripAssignmentsOf), db => DemoQueries.TripAssignmentsOf(db, Ids, Today, Today.AddDays(6)), "\"UserId\" = ANY (", "\"Status\" <>");
        yield return Q(nameof(DemoQueries.ParticipantsByIds), db => DemoQueries.ParticipantsByIds(db, Ids), "\"Id\" = ANY (");
        yield return Q(nameof(DemoQueries.ShiftsByIds), db => DemoQueries.ShiftsByIds(db, Ids), "\"Id\" = ANY (");
        yield return Q(nameof(DemoQueries.ActiveCompletionsOf), db => DemoQueries.ActiveCompletionsOf(db, Ids), "\"ShiftId\" = ANY (", "\"IsActive\"");
        yield return Q(nameof(DemoQueries.UnfinishedShifts), db => DemoQueries.UnfinishedShifts(db, Today, Ids), "\"ShiftPatternId\" IS NULL", "\"ServiceDate\" <", "\"ParticipantId\" = ANY (", "\"Status\"");
        yield return Q(nameof(DemoQueries.UnreviewedShifts), db => DemoQueries.UnreviewedShifts(db, Today, Ids), "\"ShiftPatternId\" IS NULL", "\"ServiceDate\" <=", "\"ParticipantId\" = ANY (", "\"Status\" =");
        yield return Q(nameof(DemoQueries.PendingWitnessDoses), db => DemoQueries.PendingWitnessDoses(db), "\"WitnessStatus\" =", "LIKE 'demo-v1:%'");
        yield return Q(nameof(DemoQueries.OpenTasksByKeys), db => DemoQueries.OpenTasksByKeys(db, new List<string> { "k" }), "\"SourceKey\" = ANY (", "\"Status\"");
        yield return Q(nameof(DemoQueries.MedicationsByIds), db => DemoQueries.MedicationsByIds(db, Ids), "\"Id\" = ANY (");
        yield return Q(nameof(DemoQueries.ActiveMedicationsOf), db => DemoQueries.ActiveMedicationsOf(db, Ids), "\"ParticipantId\" = ANY (", "\"Status\" =");
        yield return Q(nameof(DemoQueries.RoutinesByIds), db => DemoQueries.RoutinesByIds(db, Ids), "\"Id\" = ANY (");
        yield return Q(nameof(DemoQueries.AdministrationsByIds), db => DemoQueries.AdministrationsByIds(db, Ids), "\"Id\" = ANY (");
        yield return Q(nameof(DemoQueries.RunningBreaksOf), db => DemoQueries.RunningBreaksOf(db, Ids), "\"ShiftCompletionId\" = ANY (", "\"EndedAt\" IS NULL");
        yield return Q(nameof(DemoQueries.HandoverAcksOf), db => DemoQueries.HandoverAcksOf(db, Ids, Ids), "\"SourceCompletionId\" = ANY (", "\"UserId\" = ANY (");
        yield return Q(nameof(DemoQueries.RoutineTicksOf), db => DemoQueries.RoutineTicksOf(db, Ids), "\"ShiftCompletionId\" = ANY (", "\"ScheduledAt\"");
        yield return Q(nameof(DemoQueries.NotesOf), db => DemoQueries.NotesOf(db, Ids), "\"ShiftId\" = ANY (");
        yield return Q(nameof(DemoQueries.IncidentsByIds), db => DemoQueries.IncidentsByIds(db, Ids), "\"Id\" = ANY (");
        yield return Q(nameof(DemoQueries.WitnessedDosesBetween), db => DemoQueries.WitnessedDosesBetween(db, new DateTime(2026, 10, 1), new DateTime(2026, 10, 3)), "\"WitnessUserId\" IS NOT NULL", "LIKE 'demo-v1:%'", "\"CreatedAt\" >=", "\"CreatedAt\" <");
        yield return Q(nameof(DemoQueries.SubmittedCompletionsOf), db => DemoQueries.SubmittedCompletionsOf(db, Ids), "\"ShiftId\" = ANY (", "\"IsActive\"", "\"SubmittedAt\" IS NOT NULL");
        yield return Q(nameof(DemoQueries.AgingIncidents), db => DemoQueries.AgingIncidents(db, Ids, new DateTime(2026, 8, 1)), "\"ReportedByUserId\" = ANY (", "\"IsActive\"", "\"CreatedAt\" >=", "\"QscReportingStatus\"");
        yield return Q(nameof(DemoQueries.ClosedCompletions), db => DemoQueries.ClosedCompletions(db, Today), "INNER JOIN", "\"IsActive\"", "\"SubmittedAt\" IS NOT NULL", "\"ServiceDate\" >=", "\"Status\"");
        yield return Q(nameof(DemoQueries.ActiveRoutinesOf), db => DemoQueries.ActiveRoutinesOf(db, Ids), "\"ParticipantId\" = ANY (", "\"IsActive\"");
        yield return Q(nameof(DemoQueries.SlotsRecorded), db => DemoQueries.SlotsRecorded(db, Ids, new DateTime(2026, 9, 25), new DateTime(2026, 10, 3)), "\"ParticipantMedicationId\" = ANY (", "\"ScheduledAt\" >=", "\"ScheduledAt\" <", "\"SupersededByAdministrationId\" IS NULL");
        yield return Q(nameof(DemoQueries.PrnDosesAwaitingOutcome), db => DemoQueries.PrnDosesAwaitingOutcome(db, Ids, DateTime.UtcNow), "\"ParticipantMedicationId\" = ANY (", "\"PrnOutcome\" IS NULL", "LIKE 'demo-v1:%'");
    }

    /// <summary>Every query the catalogue offers is in the list above: a new one that is not translated here is a failed tick nobody saw coming.</summary>
    [Fact]
    public void EveryQueryInTheCatalogue_HasAnEntryInTheTranslationList()
    {
        var covered = Queries().Select(q => (string)q[0]).ToHashSet();
        var offered = typeof(DemoQueries).GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
            .Where(m => typeof(IQueryable).IsAssignableFrom(m.ReturnType)).Select(m => m.Name).Distinct().ToList();
        Assert.True(offered.Count >= 30, $"only {offered.Count} queries found by reflection");
        var missing = offered.Where(name => !covered.Contains(name)).ToList();
        Assert.True(missing.Count == 0, "queries with no translation test: " + string.Join(", ", missing));
    }

    [Theory]
    [MemberData(nameof(Queries))]
    public void EveryQuery_TranslatesToSql_OnNpgsql(string name, Func<OdipDbContext, IQueryable> query, string[] fragments)
    {
        using var db = NpgsqlDb();

        var sql = query(db).ToQueryString();

        foreach (var fragment in fragments)
            Assert.True(sql.Contains(fragment, StringComparison.Ordinal), $"{name}: expected '{fragment}' in:\n{sql}");
    }

    [Fact]
    public void ThePrimaryKeyProbe_IsOneParameterArray_NotAnOrChainOrAScan()
    {
        using var db = NpgsqlDb();

        var sql = DemoQueries.ExistingIds<ShiftCompletion>(db, Ids.ToArray()).ToQueryString();

        Assert.Contains("= ANY (", sql);
        Assert.DoesNotContain(" OR ", sql);
    }

    [Fact]
    public void NoQueryTheTopUpMakes_SendsAnIdListThatGrowsWithTheWeeks()
    {
        // The queries that look for "rows of this top-up that need moving" ask SQL for a status and a date only (OpenShifts also names the 13 patterns);
        // the id sets, one entry per pack week since the top-up began, are matched in memory.
        using var db = NpgsqlDb();

        foreach (var sql in new[]
        {
            DemoQueries.LapsedLeave(db, Today).ToQueryString(),
            DemoQueries.LapsedRules(db, Today).ToQueryString(),
            DemoQueries.ApprovedLeaveNotYetOver(db, Today).ToQueryString(),
            DemoQueries.OpenCoverageTasks(db).ToQueryString(),
        })
        {
            Assert.DoesNotContain("ANY (", sql);
        }
    }
}
