using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The Completions queue pages on PostgreSQL (review #266 S4): the dashboard now reads the whole queue page by page, and PostgreSQL gives no stable order
/// for rows that tie on every sort key across separate OFFSET/LIMIT queries. Several workers' 09:00 shifts on one day tie on outlier, date and start time.
/// Round 3 (PR #275): the read is keyset-paged, so a row decided between two page requests cannot move another across the page edge.
/// </summary>
public class CompletionsPagingPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public CompletionsPagingPostgresTests(PostgresFixture pg) => _pg = pg;

    private static Guid IdOf(int n) => new($"00000000-0000-0000-0000-{n:D12}");

    /// <summary>Shifts whose ids ascend 1..9 (or the numbers given), stored out of order, all clean and tied on date and start time unless an outlier is named.</summary>
    private static async Task SeedAsync(OdipDbContext db, int[] storedAs, ISet<int>? outliers = null)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        foreach (var n in storedAs)
        {
            var staff = new User
            {
                Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(), FirstName = "Worker", LastName = n.ToString(),
                Role = UserRole.SupportWorker, IsActive = true,
            };
            var shift = new Shift
            {
                Id = IdOf(n), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = new DateOnly(2026, 9, 8),
                StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.PendingReview,
            };
            db.Users.Add(staff);
            db.Shifts.Add(shift);
            db.ShiftCompletions.Add(new ShiftCompletion
            {
                Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), ActualEnd = new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc),
                TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id, StartedAt = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc),
                SubmittedAt = new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc), IsActive = true, VarianceMinutesEnd = outliers?.Contains(n) == true ? 90 : 0,
            });
            await db.SaveChangesAsync();   // one at a time: the heap holds them in the stored-as order
        }
    }

    /// <summary>A migrated scratch database of its own (the shift ids here are fixed, so tests must not share rows), and a context for a new tenant in it.</summary>
    private async Task<(OdipDbContext Db, string ConnectionString)> NewDatabaseAsync()
    {
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var (db, _) = await _pg.NewTenantContextAsync(cs);
        return (db, cs);
    }

    private static RosteringController Rostering(OdipDbContext db) => new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    private static async Task<PagedResult<CompletionQueueItemDto>> ReadAsync(RosteringController rostering, int page, int size, string? after = null) =>
        Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(
            Assert.IsType<OkObjectResult>((await rostering.GetCompletions(null, null, null, page, size, default, after)).Result).Value).Data!;

    [SkippableFact]
    public async Task RowsTiedOnEverySortKey_PageInShiftIdOrder_SoNoRowIsSkippedOrRepeatedAtAPageEdge()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, _) = await NewDatabaseAsync();
        await using var _db = db;
        await SeedAsync(db, [5, 2, 8, 1, 9, 3, 7, 4, 6]);

        var rostering = Rostering(db);
        var seen = new List<Guid>();
        for (var page = 1; page <= 5; page++) seen.AddRange((await ReadAsync(rostering, page, 2)).Items.Select(i => i.ShiftId));

        Assert.Equal(Enumerable.Range(1, 9).Select(IdOf), seen);
    }

    [SkippableFact]
    public async Task AKeysetRead_KeepsEveryRowWhenAnotherReviewerDecidesAPageOneRowBetweenPages_OutliersFirst()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, _) = await NewDatabaseAsync();
        await using var _db = db;
        // Two outliers (ids 8 and 9) sort first, then the clean rows 1..7.
        await SeedAsync(db, [5, 2, 8, 1, 9, 3, 7, 4, 6], new HashSet<int> { 8, 9 });

        var rostering = Rostering(db);
        var first = await ReadAsync(rostering, 1, 3);
        Assert.Equal(new[] { 8, 9, 1 }.Select(IdOf), first.Items.Select(i => i.ShiftId));
        Assert.Equal(9, first.TotalCount);

        // Another reviewer approves row 8, which was on page one. With OFFSET paging row 2 would now slide up to offset 2 and be missed by page two.
        await db.Shifts.Where(s => s.Id == IdOf(8)).ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, ShiftStatus.Completed));

        var seen = first.Items.Select(i => i.ShiftId).ToList();
        var cursor = first.NextCursor;
        while (cursor is not null)
        {
            var next = await ReadAsync(rostering, 1, 3, cursor);
            seen.AddRange(next.Items.Select(i => i.ShiftId));
            cursor = next.Items.Count < 3 ? null : next.NextCursor;
        }

        Assert.Equal(new[] { 8, 9, 1, 2, 3, 4, 5, 6, 7 }.Select(IdOf), seen);   // every pending row once, and the one decided meanwhile only from page one
    }

    [SkippableFact]
    public async Task AKeysetRead_CrossesFromTheLastOutlierToTheFirstCleanRow_WhenAPageEndsOnAnOutlier()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, _) = await NewDatabaseAsync();
        await using var _db = db;
        // Page size 2: page one is {8, 9}, both outliers, so the cursor is an outlier and only the outlier-to-clean branch of the window reads the clean rows.
        await SeedAsync(db, [5, 2, 8, 1, 9, 3, 7, 4, 6], new HashSet<int> { 8, 9 });

        var rostering = Rostering(db);
        var page = await ReadAsync(rostering, 1, 2);
        var seen = page.Items.Select(i => i.ShiftId).ToList();
        while (page.Items.Count == 2)
        {
            page = await ReadAsync(rostering, 1, 2, page.NextCursor);
            seen.AddRange(page.Items.Select(i => i.ShiftId));
        }

        Assert.Equal(new[] { 8, 9, 1, 2, 3, 4, 5, 6, 7 }.Select(IdOf), seen);
    }

    [SkippableFact]
    public async Task TheStatusRead_SaysWhatBecameOfEachShift_AndNeverAnotherTenantsShift()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, cs) = await NewDatabaseAsync();
        await using var _db = db;
        await SeedAsync(db, [1, 2]);
        await db.Shifts.Where(s => s.Id == IdOf(2)).ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, ShiftStatus.Completed));
        var (other, _) = await _pg.NewTenantContextAsync(cs);
        await using var _other = other;
        await SeedAsync(other, [3]);

        var result = Assert.IsType<ApiResponse<List<CompletionStatusDto>>>(Assert.IsType<OkObjectResult>(
            (await Rostering(db).GetCompletionStatuses([IdOf(1), IdOf(2), IdOf(3), IdOf(99)])).Result).Value).Data!;

        Assert.Equal(new[] { (IdOf(1), ShiftStatus.PendingReview), (IdOf(2), ShiftStatus.Completed) }, result.OrderBy(r => r.ShiftId).Select(r => (r.ShiftId, r.Status)));
    }
}
