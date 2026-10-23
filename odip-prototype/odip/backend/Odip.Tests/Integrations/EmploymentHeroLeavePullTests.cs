using System.Net;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Rostering;
using Odip.Tests.Medications;
using Xunit;
using static Odip.Tests.Integrations.EhLeaveFixture;

namespace Odip.Tests.Integrations;

/// <summary>The pull: EH's decisions come in one way, EH-entered leave comes in read-only, ODIP's own sends are never imported.</summary>
public class EmploymentHeroLeavePullTests
{
    private const string ListRoute = "/api/v2/business/777/leaverequest";

    private static object Req(int id, int employee, int category, DateOnly from, DateOnly to, string status = "Approved", string? notes = null) => new
    {
        id, employeeId = employee, leaveCategoryId = category, fromDate = from.ToString("yyyy-MM-dd") + "T00:00:00", toDate = to.ToString("yyyy-MM-dd") + "T00:00:00", status, notes,
    };

    private static StubHttpHandler Listing(params object[] requests) => Eh().OnAnyQuery(ListRoute, HttpStatusCode.OK, requests);

    private static int Gets(StubHttpHandler eh) =>
        eh.Requests.Count(r => r.Method == HttpMethod.Get && r.RequestUri!.AbsolutePath.Contains("/leaverequest/", StringComparison.Ordinal));

    private static Task Pull(StubHttpHandler eh, FakeClock clock, OdipDbContext db, Guid tenant) => Sync(eh, clock).RunAsync(db, tenant, true, default);

    private static async Task<LeaveRequest> SentAsync(OdipDbContext db, Guid tenant, User worker, DateOnly from, DateOnly to, string id = "9001", string employee = "42")
    {
        var leave = await ApprovedLeaveAsync(db, tenant, worker, from, to);
        leave.ExternalLeaveId = id;
        var row = EmploymentHeroLeave.NewRow(tenant, EmploymentHeroOutboxKind.Leave, leave.Id, DateTime.UtcNow);
        (row.Status, row.ExternalId, row.ExternalEmployeeId) = (EmploymentHeroOutboxStatus.Sent, id, employee);
        row.PayloadHash = EmploymentHeroLeave.Build(leave, worker.ExternalPayrollId, await EmploymentHeroLeave.MappingAsync(db, tenant, default)).Line is { } line ? EmploymentHeroLeave.Hash(line) : "unmapped";
        db.EmploymentHeroOutbox.Add(row);
        await db.SaveChangesAsync();
        return leave;
    }

    [Fact]
    public async Task Approved_EH_leave_comes_in_as_read_only_approved_leave_and_shows_on_the_roster()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var eh = Listing(Req(9100, 42, 5, monday, monday.AddDays(4), notes: "Dentist"));

        await Pull(eh, clock, db, tenant);

        var leave = await db.LeaveRequests.SingleAsync();
        Assert.Equal((LeaveSource.EmploymentHero, LeaveStatus.Approved, "9100", LeaveType.Annual, monday, monday.AddDays(4)), (leave.Source, leave.Status, leave.ExternalLeaveId, leave.LeaveType, leave.StartDate, leave.EndDate));
        Assert.Equal((worker.Id, null, null), (leave.RequestedByUserId, leave.DecidedByUserId, leave.Reason));
        var windows = await new StaffUnavailabilityQuery(db).GetWindowsAsync([worker.Id], monday, monday.AddDays(4), default);
        Assert.NotEmpty(windows);
        Assert.Contains(await db.AuditLogs.Where(a => a.EntityId == leave.Id).ToListAsync(), a => a.ChangedByName == EmploymentHeroStaffSync.ActorName);
    }

    [Fact]
    public async Task Pending_EH_leave_and_unlinked_employees_are_left_out()
    {
        var (db, tenant, _, clock, _, monday) = await OrgAsync();
        await using var _ = db;
        var eh = Listing(Req(9100, 42, 5, monday, monday, "Pending"), Req(9101, 99, 5, monday, monday));

        await Pull(eh, clock, db, tenant);

        Assert.Empty(await db.LeaveRequests.ToListAsync());
    }

    [Fact]
    public async Task EH_changes_to_imported_leave_follow_on_the_next_pull()
    {
        var (db, tenant, _, clock, _, monday) = await OrgAsync();
        await using var _ = db;
        await Pull(Listing(Req(9100, 42, 5, monday, monday.AddDays(4))), clock, db, tenant);

        await Pull(Listing(Req(9100, 42, 8, monday, monday.AddDays(2))), clock, db, tenant);
        var moved = await db.LeaveRequests.SingleAsync();
        Assert.Equal((monday.AddDays(2), LeaveType.Other), (moved.EndDate, moved.LeaveType));

        await Pull(Listing(Req(9100, 42, 8, monday, monday.AddDays(2), "Rejected")), clock, db, tenant);
        var declined = await db.LeaveRequests.SingleAsync();
        Assert.Equal((LeaveStatus.Declined, "Changed in Employment Hero"), (declined.Status, declined.DecisionNote));
    }

    [Theory]
    [InlineData("Rejected", LeaveStatus.Declined)]
    [InlineData("Cancelled", LeaveStatus.Cancelled)]
    public async Task EHs_decision_on_an_ODIP_leave_wins_and_never_comes_back(string status, LeaveStatus expected)
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await SentAsync(db, tenant, worker, monday, monday.AddDays(4));

        await Pull(Listing(Req(9001, 42, 5, monday, monday.AddDays(4), status)), clock, db, tenant);
        Assert.Equal(expected, (await db.LeaveRequests.SingleAsync()).Status);

        await Pull(Listing(Req(9001, 42, 5, monday, monday.AddDays(4), "Approved")), clock, db, tenant);
        Assert.Equal(expected, (await db.LeaveRequests.SingleAsync()).Status);
        Assert.Equal(leave.Id, (await db.LeaveRequests.SingleAsync()).Id);
    }

    [Fact]
    public async Task A_missing_ODIP_leave_is_cancelled_on_a_404_or_a_cancelled_answer()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        await SentAsync(db, tenant, worker, monday, monday, "9001");
        await SentAsync(db, tenant, worker, monday.AddDays(1), monday.AddDays(1), "9002");
        var eh = Listing().On(HttpMethod.Get, Requests42 + "/9002", HttpStatusCode.OK, new { id = 9002, employeeId = 42, status = "Cancelled" });

        await Pull(eh, clock, db, tenant);

        Assert.All(await db.LeaveRequests.ToListAsync(), l => Assert.Equal(LeaveStatus.Cancelled, l.Status));
        Assert.Equal(2, Gets(eh));
    }

    [Fact]
    public async Task An_ODIP_cancel_wins_over_EHs_approved_until_the_delete_lands()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await SentAsync(db, tenant, worker, monday, monday.AddDays(4));
        leave.Status = LeaveStatus.Cancelled;
        var cancel = EmploymentHeroLeave.NewRow(tenant, EmploymentHeroOutboxKind.LeaveCancel, leave.Id, clock.GetUtcNow().UtcDateTime.AddDays(1));
        db.EmploymentHeroOutbox.Add(cancel);
        await db.SaveChangesAsync();

        await Pull(Listing(Req(9001, 42, 5, monday, monday.AddDays(4))), clock, db, tenant);

        Assert.Equal(LeaveStatus.Cancelled, (await db.LeaveRequests.SingleAsync()).Status);
        Assert.Equal(EmploymentHeroOutboxStatus.Pending, (await db.EmploymentHeroOutbox.SingleAsync(r => r.Kind == EmploymentHeroOutboxKind.LeaveCancel)).Status);
    }

    [Fact]
    public async Task ODIPs_own_sends_are_linked_by_marker_and_never_imported()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));

        await Pull(Listing(Req(9001, 42, 5, monday, monday.AddDays(4), notes: EmploymentHeroLeave.Marker(leave.Id))), clock, db, tenant);

        Assert.Equal("9001", (await db.LeaveRequests.SingleAsync()).ExternalLeaveId);
    }

    [Fact]
    public async Task An_exact_ODIP_match_is_adopted_not_duplicated_but_not_while_a_send_is_queued()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var adopted = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        adopted.DecidedAt = adopted.DecidedAt!.Value.AddDays(-3);   // decided before the cutoff, so never queued
        var queued = await ApprovedLeaveAsync(db, tenant, worker, monday.AddDays(7), monday.AddDays(11));
        var held = EmploymentHeroLeave.NewRow(tenant, EmploymentHeroOutboxKind.Leave, queued.Id, clock.GetUtcNow().UtcDateTime);
        held.NextAttemptAt = held.NextAttemptAt.AddDays(1);   // not due: the drain leaves it alone
        db.EmploymentHeroOutbox.Add(held);
        await db.SaveChangesAsync();

        await Pull(Listing(Req(9200, 42, 5, monday, monday.AddDays(4)), Req(9201, 42, 5, monday.AddDays(7), monday.AddDays(11))), clock, db, tenant);

        var all = await db.LeaveRequests.ToListAsync();
        Assert.Equal("9200", all.Single(l => l.Id == adopted.Id).ExternalLeaveId);
        Assert.Null(all.Single(l => l.Id == queued.Id).ExternalLeaveId);
        Assert.Equal(3, all.Count);   // the queued one's twin comes in as EH leave (its send is not in flight)
    }

    [Fact]
    public async Task A_lost_create_whose_notes_EH_strips_is_linked_not_imported()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await ApprovedLeaveAsync(db, tenant, worker, monday, monday.AddDays(4));
        var row = EmploymentHeroLeave.NewRow(tenant, EmploymentHeroOutboxKind.Leave, leave.Id, clock.GetUtcNow().UtcDateTime);
        (row.Attempts, row.NextAttemptAt) = (1, row.NextAttemptAt.AddMinutes(10));   // a send in flight
        db.EmploymentHeroOutbox.Add(row);
        await db.SaveChangesAsync();

        await Pull(Listing(Req(9001, 42, 5, monday, monday.AddDays(4))), clock, db, tenant);

        var only = await db.LeaveRequests.SingleAsync();
        Assert.Equal("9001", only.ExternalLeaveId);
    }

    [Fact]
    public async Task The_pull_never_touches_another_organisations_leave()
    {
        var name = Guid.NewGuid().ToString();
        var (db, tenant, _, clock, _, monday) = await OrgAsync(name);
        await using var _ = db;
        var other = Guid.NewGuid();
        await using var otherDb = EhFixture.Db(name, other);
        await EhFixture.ConnectAsync(otherDb, other);
        var stranger = await EhTimesheetFixture.WorkerAsync(otherDb, other, "42");
        var theirs = await SentAsync(otherDb, other, stranger, monday, monday, "9100");

        await Pull(Listing(Req(9100, 42, 5, monday, monday.AddDays(4))), clock, db, tenant);

        var all = await db.LeaveRequests.IgnoreQueryFilters().ToListAsync();
        Assert.Equal(2, all.Count);
        Assert.Equal((LeaveStatus.Approved, monday), (all.Single(l => l.Id == theirs.Id).Status, all.Single(l => l.Id == theirs.Id).StartDate));
        Assert.Equal(tenant, all.Single(l => l.Id != theirs.Id).TenantId);
    }

    [Fact]
    public async Task A_missing_known_leave_is_checked_at_most_ten_a_pull()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        for (var i = 0; i < 12; i++) await SentAsync(db, tenant, worker, monday.AddDays(i), monday.AddDays(i), (9300 + i).ToString());
        var eh = Listing();

        await Pull(eh, clock, db, tenant);

        Assert.Equal(10, Gets(eh));
    }

    [Fact]
    public async Task A_missing_leave_is_fetched_under_the_employee_it_was_sent_for_and_a_failed_list_makes_no_gets()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        await SentAsync(db, tenant, worker, monday, monday);
        worker.ExternalPayrollId = "42";
        var eh = Listing().On(HttpMethod.Get, Requests42 + "/9001", HttpStatusCode.OK, new { id = 9001, employeeId = 42, status = "Rejected" });
        await Pull(eh, clock, db, tenant);
        Assert.Equal(LeaveStatus.Declined, (await db.LeaveRequests.SingleAsync()).Status);

        var (db2, tenant2, _, clock2, worker2, monday2) = await OrgAsync();
        await using var _2 = db2;
        await SentAsync(db2, tenant2, worker2, monday2, monday2);
        var broken = Listing().OnAnyQuery(ListRoute, HttpStatusCode.InternalServerError);
        await Pull(broken, clock2, db2, tenant2);
        Assert.Equal(0, Gets(broken));
        Assert.Equal(LeaveStatus.Approved, (await db2.LeaveRequests.SingleAsync()).Status);
    }

    [Fact]
    public async Task A_leave_in_the_relink_window_is_left_alone()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        await SentAsync(db, tenant, worker, monday, monday, "9001", "41");   // sent under 41; the worker is now 42
        var eh = Listing();

        await Pull(eh, clock, db, tenant);

        Assert.Equal(0, Gets(eh));
        Assert.Equal(LeaveStatus.Approved, (await db.LeaveRequests.SingleAsync()).Status);
    }

    [Fact]
    public async Task EH_rejects_a_leave_whose_row_has_failed()
    {
        var (db, tenant, _, clock, worker, monday) = await OrgAsync();
        await using var _ = db;
        var leave = await SentAsync(db, tenant, worker, monday, monday);
        var row = await db.EmploymentHeroOutbox.SingleAsync();
        row.Status = EmploymentHeroOutboxStatus.Failed;
        await db.SaveChangesAsync();

        await Pull(Listing(Req(9001, 42, 5, monday, monday, "Rejected")), clock, db, tenant);

        Assert.Equal(LeaveStatus.Declined, (await db.LeaveRequests.SingleAsync(l => l.Id == leave.Id)).Status);
    }

    [Fact]
    public async Task The_pull_does_not_overwrite_a_leave_decided_meanwhile()
    {
        var name = Guid.NewGuid().ToString();
        var (db, tenant, _, clock, worker, monday) = await OrgAsync(name);
        await using var _ = db;
        await SentAsync(db, tenant, worker, monday, monday);
        var eh = Listing(Req(9001, 42, 5, monday, monday, "Rejected"));
        eh.BeforeAnswer = r =>
        {
            if (r.RequestUri!.AbsolutePath != ListRoute) return;
            using var other = EhFixture.Db(name, tenant);
            other.LeaveRequests.Single().Status = LeaveStatus.Cancelled;
            other.SaveChanges();
        };

        await Pull(eh, clock, db, tenant);

        Assert.Equal(LeaveStatus.Cancelled, (await db.LeaveRequests.AsNoTracking().SingleAsync()).Status);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_reconnect_or_disconnect_during_the_pull_drops_its_batch(bool disconnect)
    {
        var name = Guid.NewGuid().ToString();
        var (db, tenant, _, clock, _, monday) = await OrgAsync(name);
        await using var _ = db;
        var eh = Listing(Req(9100, 42, 5, monday, monday));
        eh.BeforeAnswer = r =>
        {
            if (r.RequestUri!.AbsolutePath != ListRoute) return;
            using var other = EhFixture.Db(name, tenant);
            var conn = other.EmploymentHeroConnections.Single();
            if (disconnect) other.EmploymentHeroConnections.Remove(conn); else conn.BusinessId = "888";
            other.SaveChanges();
        };

        await Pull(eh, clock, db, tenant);

        Assert.Empty(await db.LeaveRequests.ToListAsync());
    }
}
