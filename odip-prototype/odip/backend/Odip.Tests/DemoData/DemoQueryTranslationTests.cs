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

        yield return Q("existing ids (primary-key probe)", db => DemoQueries.ExistingIds<Shift>(db, Ids.ToArray()), "WHERE s.\"Id\" = ANY (");
        yield return Q("demo tenant candidates", DemoQueries.DemoTenantCandidates, "\"Name\" =");
        yield return Q("provider state", DemoQueries.ProviderState, "\"State\"");
        yield return Q("participants", DemoQueries.Participants, "\"NdisNumber\"", "\"IsDraft\"");
        yield return Q("users by email", db => DemoQueries.UsersByEmail(db, new List<string> { "a@b.c" }), "\"Email\" = ANY (");
        yield return Q("compatibility cells of users", db => DemoQueries.CompatibilityCellsOf(db, Ids), "\"UserId\" = ANY (");
        yield return Q("active emergency contacts", db => DemoQueries.ActiveEmergencyContacts(db, Ids), "\"ParticipantId\" = ANY (", "\"RoleType\" =", "\"Status\" =");
        yield return Q("patterns by id", db => DemoQueries.PatternsByIds(db, Ids), "\"Id\" = ANY (");
        yield return Q("open shifts", db => DemoQueries.OpenShifts(db, Today, Ids), "\"ServiceDate\" <=", "\"ShiftPatternId\" IS NULL OR", "\"ShiftPatternId\" = ANY (", "\"Status\"");
        yield return Q("completions of shifts", db => DemoQueries.CompletionsOf(db, Ids), "\"ShiftId\" = ANY (");
        yield return Q("lapsed leave", db => DemoQueries.LapsedLeave(db, Today), "\"Status\" =", "\"StartDate\" <");
        yield return Q("lapsed recurring rules", db => DemoQueries.LapsedRules(db, Today), "\"Status\" =", "\"EffectiveFrom\" <");
        yield return Q("approved leave not yet over", db => DemoQueries.ApprovedLeaveNotYetOver(db, Today), "\"Status\" =", "\"EndDate\" >=");
        yield return Q("published shifts of users", db => DemoQueries.PublishedShiftsOf(db, Ids, Today), "\"UserId\" = ANY (", "INNER JOIN (", "FROM \"Participants\"");
        yield return Q("existing task keys", db => DemoQueries.ExistingTaskKeys(db, new List<string> { "k" }), "\"SourceKey\" = ANY (");
        yield return Q("open coverage tasks", DemoQueries.OpenCoverageTasks, "\"TaskType\" =", "\"LeaveRequestId\" IS NOT NULL", "\"SourceKey\"");
        yield return Q("worked shift ids", db => DemoQueries.WorkedShiftIds(db, Ids), "\"Id\" = ANY (");
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
