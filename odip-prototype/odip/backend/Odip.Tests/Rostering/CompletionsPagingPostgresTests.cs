using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The Completions queue pages on PostgreSQL (review #266 S4): the dashboard now reads the whole queue page by page, and PostgreSQL gives no stable order
/// for rows that tie on every sort key across separate OFFSET/LIMIT queries. Several workers' 09:00 shifts on one day tie on outlier, date and start time.
/// </summary>
public class CompletionsPagingPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public CompletionsPagingPostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task RowsTiedOnEverySortKey_PageInShiftIdOrder_SoNoRowIsSkippedOrRepeatedAtAPageEdge()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, _) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);

        // Nine clean completions on one day at one start time: every sort key ties. Their shift ids ascend 1..9 but are stored out of order, so the
        // table's physical order is not the id order, and only an ORDER BY on the id can put them in it.
        var storedAs = new[] { 5, 2, 8, 1, 9, 3, 7, 4, 6 };
        foreach (var n in storedAs)
        {
            var staff = new User
            {
                Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(), FirstName = "Worker", LastName = n.ToString(),
                Role = UserRole.SupportWorker, IsActive = true,
            };
            var shift = new Shift
            {
                Id = new Guid($"00000000-0000-0000-0000-{n:D12}"), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = new DateOnly(2026, 9, 8),
                StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.PendingReview,
            };
            db.Users.Add(staff);
            db.Shifts.Add(shift);
            db.ShiftCompletions.Add(new ShiftCompletion
            {
                Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), ActualEnd = new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc),
                TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id, StartedAt = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc),
                SubmittedAt = new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc), IsActive = true,
            });
            await db.SaveChangesAsync();   // one at a time: the heap holds them in the stored-as order
        }

        var rostering = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var seen = new List<Guid>();
        for (var page = 1; page <= 5; page++)
        {
            var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(
                Assert.IsType<OkObjectResult>((await rostering.GetCompletions(null, null, null, page, 2, default)).Result).Value);
            seen.AddRange(body.Data!.Items.Select(i => i.ShiftId));
        }

        Assert.Equal(Enumerable.Range(1, 9).Select(n => new Guid($"00000000-0000-0000-0000-{n:D12}")), seen);
    }
}
