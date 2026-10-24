using System.Net;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Integrations;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Medications;
using Xunit;
using static Odip.Tests.Integrations.EhLeaveFixture;

namespace Odip.Tests.Integrations;

/// <summary>The leave sender: scan, change check, send, cancel, retry and never send twice. EH is always the stub.</summary>
public class EmploymentHeroLeaveSyncTests
{
    private static int Count(StubHttpHandler eh, HttpMethod method, string path) =>
        eh.Requests.Count(r => r.Method == method && r.RequestUri!.AbsolutePath == path);

    private static Task<List<EmploymentHeroOutbox>> RowsAsync(Odip.Infrastructure.Data.OdipDbContext db, EmploymentHeroOutboxKind kind) =>
        db.EmploymentHeroOutbox.IgnoreQueryFilters().Where(r => r.Kind == kind).ToListAsync();

    // ── Sending ──────────────────────────────────────────────────────

    [Fact]
    public async Task The_first_send_posts_once_and_records_EHs_id_on_the_row_and_the_leave()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        var eh = Eh();

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Equal(1, Count(eh, HttpMethod.Post, Requests42));
        Assert.Contains(EmploymentHeroLeave.Marker(leave.Id), eh.Bodies.Single(b => b is not null));
        var row = Assert.Single(await RowsAsync(db, EmploymentHeroOutboxKind.Leave));
        Assert.Equal((EmploymentHeroOutboxStatus.Sent, "9001", "42", 0), (row.Status, row.ExternalId, row.ExternalEmployeeId, row.Attempts));
        Assert.NotNull(row.PayloadHash);
        Assert.Equal(clock.GetUtcNow().UtcDateTime, row.SentAt);
        Assert.Equal("9001", (await db.LeaveRequests.SingleAsync()).ExternalLeaveId);
    }

    [Fact]
    public async Task The_hours_and_their_basis_are_recorded_on_the_leave()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        await Sync(Eh(7.2m), clock).RunAsync(db, tenant, false, default);
        var first = await db.LeaveRequests.SingleAsync();
        Assert.Equal((36.0m, false), (first.SentHours, first.SentHoursDefaulted));

        var (db2, tenant2, _, clock2, worker2, monday2) = await OrgAsync();
        await using var _2 = db2;
        await ApprovedLeaveAsync(db2, tenant2, worker2, monday2, monday2.AddDays(4));
        await Sync(Eh(null), clock2).RunAsync(db2, tenant2, false, default);
        var second = await db2.LeaveRequests.SingleAsync();
        Assert.Equal((38.0m, true), (second.SentHours, second.SentHoursDefaulted));
    }

    [Fact]
    public async Task A_pending_answer_is_approved_once()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        await ApprovedLeaveAsync(db, tenant, worker, monday, monday);
        var eh = Eh().On(HttpMethod.Post, Requests42, HttpStatusCode.OK, new { id = 9001, employeeId = 42, status = "Pending" });

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Equal(1, Count(eh, HttpMethod.Post, Requests42));
        Assert.Equal(1, Count(eh, HttpMethod.Post, Requests42 + "/9001/approve"));
    }

    [Fact]
    public async Task A_weekend_only_leave_needs_attention_and_posts_nothing()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        await ApprovedLeaveAsync(db, tenant, worker, monday.AddDays(5), monday.AddDays(6));
        var eh = Eh();

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Equal(0, Count(eh, HttpMethod.Post, Requests42));
        var row = Assert.Single(await RowsAsync(db, EmploymentHeroOutboxKind.Leave));
        Assert.Equal((EmploymentHeroOutboxStatus.NeedsAttention, EmploymentHeroLeave.WeekendMessage), (row.Status, row.LastError));
    }

    // ── Changes ──────────────────────────────────────────────────────

    [Fact]
    public async Task An_edited_leave_is_put_to_the_same_request()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        var eh = Eh();
        var sync = Sync(eh, clock);
        await sync.RunAsync(db, tenant, false, default);

        leave.EndDate = monday.AddDays(3);
        await db.SaveChangesAsync();
        await sync.RunAsync(db, tenant, false, default);

        Assert.Equal(1, Count(eh, HttpMethod.Post, Requests42));
        Assert.Equal(1, Count(eh, HttpMethod.Put, Requests42 + "/9001"));
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, Assert.Single(await RowsAsync(db, EmploymentHeroOutboxKind.Leave)).Status);
    }

    [Fact]
    public async Task An_unchanged_row_is_not_resent()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        var eh = Eh();
        var sync = Sync(eh, clock);
        await sync.RunAsync(db, tenant, false, default);
        var before = eh.Requests.Count;

        await sync.RunAsync(db, tenant, false, default);

        Assert.Equal(before, eh.Requests.Count);
    }

    [Fact]
    public async Task A_changed_row_clears_when_the_dates_move_back_before_the_drain()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        var eh = Eh();
        var sync = Sync(eh, clock);
        await sync.RunAsync(db, tenant, false, default);
        var before = eh.Requests.Count;
        var row = Assert.Single(await RowsAsync(db, EmploymentHeroOutboxKind.Leave));
        row.Status = EmploymentHeroOutboxStatus.NeedsAttention;
        row.LastError = EmploymentHeroTimesheets.FinalisedMessage;
        await db.SaveChangesAsync();

        await sync.RunAsync(db, tenant, false, default);

        Assert.Equal(before, eh.Requests.Count);
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, (await RowsAsync(db, EmploymentHeroOutboxKind.Leave)).Single().Status);
    }

    // ── Never twice ──────────────────────────────────────────────────

    [Fact]
    public async Task A_lost_create_is_found_by_its_marker_and_put()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        var now = clock.GetUtcNow().UtcDateTime;
        var row = EmploymentHeroLeave.NewRow(tenant, EmploymentHeroOutboxKind.Leave, leave.Id, now);
        row.Attempts = 1;
        row.NextAttemptAt = now.AddMinutes(-1);
        db.EmploymentHeroOutbox.Add(row);
        await db.SaveChangesAsync();
        var eh = Eh().On(HttpMethod.Get, ListPath(monday, monday.AddDays(4)), HttpStatusCode.OK, new[]
        {
            new { id = 9001, employeeId = 42, leaveCategoryId = 5, fromDate = monday.ToString("yyyy-MM-dd") + "T00:00:00", toDate = monday.AddDays(4).ToString("yyyy-MM-dd") + "T00:00:00", status = "Approved", notes = EmploymentHeroLeave.Marker(leave.Id) },
        });

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Equal(0, Count(eh, HttpMethod.Post, Requests42));
        Assert.Equal(1, Count(eh, HttpMethod.Put, Requests42 + "/9001"));
        Assert.Equal("9001", (await RowsAsync(db, EmploymentHeroOutboxKind.Leave)).Single().ExternalId);
    }

    [Fact]
    public async Task A_retry_never_adopts_an_EH_request_marked_for_another_leave()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var first = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        first.ExternalLeaveId = "9001";
        var second = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        var now = clock.GetUtcNow().UtcDateTime;
        var row = EmploymentHeroLeave.NewRow(tenant, EmploymentHeroOutboxKind.Leave, second.Id, now);
        row.Attempts = 1;
        row.NextAttemptAt = now.AddMinutes(-1);
        db.EmploymentHeroOutbox.Add(row);
        await db.SaveChangesAsync();
        var eh = Eh().On(HttpMethod.Get, ListPath(monday, monday.AddDays(4)), HttpStatusCode.OK, new[]
        {
            new { id = 9001, employeeId = 42, leaveCategoryId = 5, fromDate = monday.ToString("yyyy-MM-dd") + "T00:00:00", toDate = monday.AddDays(4).ToString("yyyy-MM-dd") + "T00:00:00", status = "Approved", notes = EmploymentHeroLeave.Marker(first.Id) },
        });

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Equal(1, Count(eh, HttpMethod.Post, Requests42));
        Assert.Equal(0, Count(eh, HttpMethod.Put, Requests42 + "/9001"));
    }

    [Fact]
    public async Task A_leave_cancelled_with_its_send_still_queued_is_never_posted()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        db.EmploymentHeroOutbox.Add(EmploymentHeroLeave.NewRow(tenant, EmploymentHeroOutboxKind.Leave, leave.Id, clock.GetUtcNow().UtcDateTime));
        await CancelledAsync(db, tenant, clock, leave);
        var eh = Eh();

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Equal(0, Count(eh, HttpMethod.Post, Requests42));
        Assert.Equal(0, (await RowsAsync(db, EmploymentHeroOutboxKind.Leave)).Single().Attempts);
    }

    // ── Retries, waiting, scan and isolation ─────────────────────────

    [Fact]
    public async Task A_429_holds_the_leave_batch_without_counting()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(1));
        await ApprovedLeaveAsync(db, tenant, worker, monday.AddDays(2), monday.AddDays(3));
        var eh = Eh().On(HttpMethod.Post, Requests42, HttpStatusCode.TooManyRequests, null, TimeSpan.FromSeconds(120));

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Equal(1, Count(eh, HttpMethod.Post, Requests42));
        var rows = await RowsAsync(db, EmploymentHeroOutboxKind.Leave);
        Assert.All(rows, r => Assert.Equal((EmploymentHeroOutboxStatus.Pending, 0, clock.GetUtcNow().UtcDateTime.AddSeconds(120)), (r.Status, r.Attempts, r.NextAttemptAt)));
        Assert.Contains(rows, r => r.LastError == EmploymentHeroTimesheets.BusyMessage);
    }

    [Fact]
    public async Task A_refused_first_create_in_a_finalised_pay_run_says_so()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        await ApprovedLeaveAsync(db, tenant, worker, monday, monday);
        var eh = Eh().On(HttpMethod.Post, Requests42, HttpStatusCode.BadRequest, new { detail = "The pay run has been finalised" });

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        var row = Assert.Single(await RowsAsync(db, EmploymentHeroOutboxKind.Leave));
        Assert.Equal((EmploymentHeroOutboxStatus.NeedsAttention, EmploymentHeroLeave.CreateFinalisedMessage), (row.Status, row.LastError));
        Assert.Single(await db.NotificationOutbox.ToListAsync());
    }

    [Fact]
    public async Task An_unmapped_type_waits_until_its_category_is_chosen()
    {
        var (db, tenant, conn, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        conn.LeaveCategoryAnnual = null;
        await db.SaveChangesAsync();
        await ApprovedLeaveAsync(db, tenant, worker, monday, monday);
        var eh = Eh();

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Empty(eh.Requests);
        var row = Assert.Single(await RowsAsync(db, EmploymentHeroOutboxKind.Leave));
        Assert.True(EmploymentHeroLeave.IsWaiting(row.LastError));
        conn.LeaveCategoryAnnual = "5";
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(31));
        await Sync(eh, clock).RunAsync(db, tenant, false, default);
        Assert.Equal(1, Count(eh, HttpMethod.Post, Requests42));
    }

    [Fact]
    public async Task Leave_decided_before_the_cutoff_is_not_sent_and_leave_after_it_is()
    {
        var (db, tenant, conn, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var early = await ApprovedLeaveAsync(db, tenant, worker, monday, monday);
        early.DecidedAt = EmploymentHeroLeave.Cutoff(conn.ConnectedAt).AddDays(-1);
        await db.SaveChangesAsync();
        var eh = Eh();

        await Sync(eh, clock).RunAsync(db, tenant, false, default);
        Assert.Empty(eh.Requests);
        Assert.Empty(await RowsAsync(db, EmploymentHeroOutboxKind.Leave));

        await ApprovedLeaveAsync(db, tenant, worker, monday.AddDays(1), monday.AddDays(1));
        await Sync(eh, clock).RunAsync(db, tenant, false, default);
        Assert.Equal(1, Count(eh, HttpMethod.Post, Requests42));
    }

    [Fact]
    public async Task The_scan_skips_leave_that_ended_over_62_days_ago()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        await ApprovedLeaveAsync(db, tenant, worker, monday.AddDays(-80), monday.AddDays(-75));
        var eh = Eh();

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Empty(eh.Requests);
        Assert.Empty(await RowsAsync(db, EmploymentHeroOutboxKind.Leave));
    }

    [Fact]
    public async Task Another_organisations_leave_is_never_scanned_or_sent()
    {
        var name = Guid.NewGuid().ToString();
        var (db, tenant, _, clock, worker, monday) = await OrgAsync(name);
        await using var _ = db;
        var other = Guid.NewGuid();
        await using var otherDb = EhFixture.Db(name, other);
        await EhFixture.ConnectAsync(otherDb, other);
        var stranger = await EhTimesheetFixture.WorkerAsync(otherDb, other, "42");
        await ApprovedLeaveAsync(otherDb, other, stranger, monday, monday);
        var mine = await ApprovedLeaveAsync(db, tenant, worker, monday.AddDays(1), monday.AddDays(1));
        var eh = Eh();

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        var row = Assert.Single(await db.EmploymentHeroOutbox.IgnoreQueryFilters().ToListAsync());
        Assert.Equal((tenant, mine.Id), (row.TenantId, row.EntityId));
        Assert.Equal(1, Count(eh, HttpMethod.Post, Requests42));
    }

    // ── Cancel (LeaveCancel rows) ────────────────────────────────────

    private static async Task<LeaveRequest> CancelledAsync(Odip.Infrastructure.Data.OdipDbContext db, Guid tenant, FakeClock clock, LeaveRequest leave)
    {
        leave.Status = LeaveStatus.Cancelled;
        db.EmploymentHeroOutbox.Add(EmploymentHeroLeave.NewRow(tenant, EmploymentHeroOutboxKind.LeaveCancel, leave.Id, clock.GetUtcNow().UtcDateTime));
        await db.SaveChangesAsync();
        return leave;
    }

    [Fact]
    public async Task A_cancel_of_a_sent_leave_deletes_it_in_EH()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        var eh = Eh();
        var sync = Sync(eh, clock);
        await sync.RunAsync(db, tenant, false, default);
        await CancelledAsync(db, tenant, clock, leave);

        await sync.RunAsync(db, tenant, false, default);

        Assert.Equal(1, Count(eh, HttpMethod.Delete, Requests42 + "/9001"));
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, Assert.Single(await RowsAsync(db, EmploymentHeroOutboxKind.LeaveCancel)).Status);
    }

    [Fact]
    public async Task Cancelling_an_adopted_leave_deletes_it_in_EH()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday);
        leave.ExternalLeaveId = "9050";
        await CancelledAsync(db, tenant, clock, leave);
        var eh = Eh().On(HttpMethod.Delete, Requests42 + "/9050", HttpStatusCode.OK);

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Equal(1, Count(eh, HttpMethod.Delete, Requests42 + "/9050"));
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, Assert.Single(await RowsAsync(db, EmploymentHeroOutboxKind.LeaveCancel)).Status);
    }

    [Fact]
    public async Task A_cancel_of_a_never_tried_leave_calls_nobody()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday);
        db.EmploymentHeroOutbox.Add(EmploymentHeroLeave.NewRow(tenant, EmploymentHeroOutboxKind.Leave, leave.Id, clock.GetUtcNow().UtcDateTime));
        await CancelledAsync(db, tenant, clock, leave);
        var eh = Eh();

        await Sync(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Empty(eh.Requests);
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, Assert.Single(await RowsAsync(db, EmploymentHeroOutboxKind.LeaveCancel)).Status);
    }

    [Fact]
    public async Task A_refused_cancel_needs_attention_with_the_finalised_words()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        var eh = Eh();
        var sync = Sync(eh, clock);
        await sync.RunAsync(db, tenant, false, default);
        await CancelledAsync(db, tenant, clock, leave);
        eh.On(HttpMethod.Delete, Requests42 + "/9001", HttpStatusCode.BadRequest, new { detail = "Leave has been paid in a processed pay run" });

        await sync.RunAsync(db, tenant, false, default);

        var row = Assert.Single(await RowsAsync(db, EmploymentHeroOutboxKind.LeaveCancel));
        Assert.Equal((EmploymentHeroOutboxStatus.NeedsAttention, EmploymentHeroLeave.CancelFinalisedMessage), (row.Status, row.LastError));
        Assert.Single(await db.NotificationOutbox.Where(n => n.EventType == NotificationEventType.IntegrationDegraded).ToListAsync());
    }
}
