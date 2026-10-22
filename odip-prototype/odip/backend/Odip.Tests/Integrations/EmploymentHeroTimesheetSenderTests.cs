using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Notifications;
using Odip.Tests.Imports;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>The timesheet sender: queue, send, resend, retry and never send twice. EH is always the stub.</summary>
public class EmploymentHeroTimesheetSenderTests
{
    private const string Lines = "/api/v2/business/777/timesheet";
    private const string Create = Lines + "?enforceUniqueExternalId=true";
    private static readonly DateOnly Day = new(2026, 10, 14);
    private static readonly TimeOnly Nine = new(9, 0), Three = new(15, 0);

    private static string FindPath(Guid completionId) => $"{Lines}?$filter=ExternalId eq '{completionId:D}'";

    private static StubHttpHandler Eh() => new StubHttpHandler()
        .On(HttpMethod.Post, Create, HttpStatusCode.OK, new { id = 9001 })
        .On(HttpMethod.Get, $"{Lines}/9001", HttpStatusCode.OK, new { id = 9001, status = "Submitted" })
        .On(HttpMethod.Put, $"{Lines}/9001", HttpStatusCode.OK, new { id = 9001 })
        .On(HttpMethod.Delete, $"{Lines}/9001", HttpStatusCode.OK);

    private static EmploymentHeroTimesheetSender Sender(StubHttpHandler eh, FakeClock clock) =>
        new(StubHttpHandler.Client(eh), EhFixture.Keys, clock, NullLogger<EmploymentHeroTimesheetSender>.Instance, TimeSpan.Zero);

    /// <summary>A connected organisation with standard hours mapped to work type 7 and active nights to 8.</summary>
    private static async Task<(OdipDbContext Db, Guid Tenant, EmploymentHeroConnection Conn, FakeClock Clock)> OrgAsync(string? database = null, Guid? tenant = null)
    {
        var id = tenant ?? Guid.NewGuid();
        var db = EhFixture.Db(database ?? Guid.NewGuid().ToString(), id);
        var conn = await EhFixture.ConnectAsync(db, id);
        conn.WorkTypeStandard = "7";
        conn.WorkTypeActiveNight = "8";
        await db.SaveChangesAsync();
        return (db, id, conn, EhFixture.Clock());
    }

    private static Task<EmploymentHeroOutbox> RowAsync(OdipDbContext db) => db.EmploymentHeroOutbox.IgnoreQueryFilters().SingleAsync();

    private static JsonElement Body(StubHttpHandler eh, int index) => JsonDocument.Parse(eh.Bodies[index]!).RootElement;

    // ── Sending and resending ────────────────────────────────────────

    [Fact]
    public async Task The_first_send_posts_one_line_and_records_what_EH_returned()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (_, completion) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three, breaks: [(120, 30)]);
        var eh = Eh();

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        var post = Assert.Single(eh.Requests);
        Assert.Equal(HttpMethod.Post, post.Method);
        var body = Body(eh, 0);
        Assert.Equal(42, body.GetProperty("employeeId").GetInt32());
        Assert.Equal(7, body.GetProperty("workTypeId").GetInt32());
        Assert.Equal(completion.Id.ToString("D"), body.GetProperty("externalId").GetString());
        Assert.Equal("2026-10-14T09:00:00", body.GetProperty("startTime").GetString());
        Assert.Single(body.GetProperty("breaks").EnumerateArray());
        var row = await RowAsync(db);
        Assert.Equal((EmploymentHeroOutboxStatus.Sent, "9001", "42", 0, clock.GetUtcNow().UtcDateTime), (row.Status, row.ExternalId, row.ExternalEmployeeId, row.Attempts, row.SentAt));
        Assert.Equal(64, row.PayloadHash!.Length);
    }

    [Fact]
    public async Task An_unchanged_sent_row_is_not_resent()
    {
        var (db, tenant, conn, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (shift, _) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var sender = Sender(eh, clock);
        await sender.RunAsync(db, tenant, false, default);

        shift.Ratio = SupportRatio.OneToTwo;   // not part of the payload
        await db.SaveChangesAsync();
        await sender.RunAsync(db, tenant, true, default);
        Assert.Single(eh.Requests);

        // A shift older than the 62-day window is not looked at, whatever changed.
        var old = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day.AddDays(-63), Nine, Three);
        var map = new EmploymentHeroTimesheets.TimesheetMapping("7", "8", null, null);
        db.EmploymentHeroOutbox.Add(new EmploymentHeroOutbox
        {
            Id = Guid.NewGuid(), TenantId = tenant, Kind = EmploymentHeroOutboxKind.Timesheet, EntityId = old.Completion.Id, Status = EmploymentHeroOutboxStatus.Sent,
            ExternalId = "9002", ExternalEmployeeId = "42", PayloadHash = EmploymentHeroTimesheets.Build(old.Shift, old.Completion, [], "42", map, EhTimesheetFixture.Sydney).Hash, SentAt = clock.GetUtcNow().UtcDateTime,
            CreatedAt = clock.GetUtcNow().UtcDateTime, UpdatedAt = clock.GetUtcNow().UtcDateTime,
        });
        old.Shift.NightType = SleepoverType.ActiveNight;
        await db.SaveChangesAsync();
        await sender.RunAsync(db, tenant, true, default);
        Assert.Single(eh.Requests);
        Assert.Equal(2, await db.EmploymentHeroOutbox.CountAsync(r => r.Status == EmploymentHeroOutboxStatus.Sent));
    }

    [Fact]
    public async Task A_change_after_sending_is_resent_to_the_same_line()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (shift, _) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var sender = Sender(eh, clock);
        await sender.RunAsync(db, tenant, false, default);
        var firstHash = (await RowAsync(db)).PayloadHash;

        shift.NightType = SleepoverType.ActiveNight;
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);

        Assert.Equal([HttpMethod.Post, HttpMethod.Get, HttpMethod.Put], eh.Requests.Select(r => r.Method));
        Assert.Equal(9001, Body(eh, 2).GetProperty("id").GetInt32());
        Assert.Equal(8, Body(eh, 2).GetProperty("workTypeId").GetInt32());
        var row = await RowAsync(db);
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, row.Status);
        Assert.NotEqual(firstHash, row.PayloadHash);
    }

    [Fact]
    public async Task Changing_a_work_type_mapping_after_sending_neither_resends_nor_flags_the_line()
    {
        var (db, tenant, conn, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var sender = Sender(eh, clock);
        await sender.RunAsync(db, tenant, false, default);

        conn.WorkTypeStandard = "70";
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);

        Assert.Single(eh.Requests);   // nothing re-sent, so nothing can come back as "changed after the pay run was finalised"
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, (await RowAsync(db)).Status);

        // A later edit of the shift's own end time is still re-sent.
        var c = await db.ShiftCompletions.SingleAsync();
        c.ActualEnd = c.ActualEnd!.Value.AddHours(1);
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);
        Assert.Equal(70, Body(eh, 2).GetProperty("workTypeId").GetInt32());   // the edited line takes today's mapping
    }

    [Fact]
    public async Task A_relinked_worker_has_the_old_line_deleted_and_a_new_one_posted()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var sender = Sender(eh, clock);
        await sender.RunAsync(db, tenant, false, default);

        worker.ExternalPayrollId = "43";
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);

        Assert.Equal([HttpMethod.Post, HttpMethod.Get, HttpMethod.Delete, HttpMethod.Post], eh.Requests.Select(r => r.Method));
        Assert.Equal(43, Body(eh, 3).GetProperty("employeeId").GetInt32());
        Assert.Equal("43", (await RowAsync(db)).ExternalEmployeeId);
    }

    // ── Finalised lines ──────────────────────────────────────────────

    [Fact]
    public async Task A_line_in_a_finalised_pay_run_is_never_changed_and_Admins_hear_once()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (shift, _) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var sender = Sender(eh, clock);
        await sender.RunAsync(db, tenant, false, default);
        eh.On(HttpMethod.Get, $"{Lines}/9001", HttpStatusCode.OK, new { id = 9001, status = "Processed" });

        shift.NightType = SleepoverType.ActiveNight;
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);

        Assert.DoesNotContain(eh.Requests, r => r.Method == HttpMethod.Put || r.Method == HttpMethod.Delete);
        var row = await RowAsync(db);
        Assert.Equal((EmploymentHeroOutboxStatus.NeedsAttention, EmploymentHeroTimesheets.FinalisedMessage), (row.Status, row.LastError));
        var alert = await db.NotificationOutbox.SingleAsync();   // Ada is the one Admin; the second run said nothing more
        Assert.Equal(NotificationEventType.IntegrationDegraded, alert.EventType);
        Assert.DoesNotContain("Jane", alert.PayloadJson);
    }

    [Fact]
    public async Task A_finalised_refusal_is_Changed_even_when_the_status_word_differs()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (shift, _) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var sender = Sender(eh, clock);
        await sender.RunAsync(db, tenant, false, default);
        eh.On(HttpMethod.Get, $"{Lines}/9001", HttpStatusCode.OK, new { id = 9001, status = "Approved" })
          .On(HttpMethod.Put, $"{Lines}/9001", HttpStatusCode.BadRequest, new { detail = "You cannot modify a Processed timesheet line" });

        shift.NightType = SleepoverType.ActiveNight;
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);

        var row = await RowAsync(db);
        Assert.Equal((EmploymentHeroOutboxStatus.NeedsAttention, EmploymentHeroTimesheets.FinalisedMessage), (row.Status, row.LastError));
    }

    [Fact]
    public async Task A_Changed_row_clears_once_ODIP_matches_what_was_sent_again()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (shift, _) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var sender = Sender(eh, clock);
        await sender.RunAsync(db, tenant, false, default);
        eh.On(HttpMethod.Get, $"{Lines}/9001", HttpStatusCode.OK, new { id = 9001, status = "Processed" });
        shift.NightType = SleepoverType.ActiveNight;
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);
        Assert.Equal(EmploymentHeroOutboxStatus.NeedsAttention, (await RowAsync(db)).Status);

        shift.NightType = SleepoverType.None;
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);

        var row = await RowAsync(db);
        Assert.Equal((EmploymentHeroOutboxStatus.Sent, null), (row.Status, row.LastError));
    }

    // ── Retries and refusals ─────────────────────────────────────────

    [Fact]
    public async Task Failures_back_off_1_5_15_60_240_minutes_then_need_attention()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = new StubHttpHandler().On(HttpMethod.Post, Create, HttpStatusCode.ServiceUnavailable)
            .On(HttpMethod.Get, FindPath((await db.ShiftCompletions.SingleAsync()).Id), HttpStatusCode.OK, Array.Empty<object>());
        var sender = Sender(eh, clock);

        foreach (var minutes in new[] { 1, 5, 15, 60, 240 })
        {
            await sender.RunAsync(db, tenant, false, default);
            var row = await RowAsync(db);
            Assert.Equal(EmploymentHeroOutboxStatus.Failed, row.Status);
            Assert.Equal(clock.GetUtcNow().UtcDateTime.AddMinutes(minutes), row.NextAttemptAt);
            clock.Set(clock.GetUtcNow().AddMinutes(minutes));
        }
        await sender.RunAsync(db, tenant, false, default);

        var last = await RowAsync(db);
        Assert.Equal((EmploymentHeroOutboxStatus.NeedsAttention, EmploymentHeroTimesheets.GaveUpMessage, 6), (last.Status, last.LastError, last.Attempts));
        Assert.Single(await db.NotificationOutbox.ToListAsync());
    }

    [Fact]
    public async Task The_reason_on_screen_is_the_short_one()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        await Sender(new StubHttpHandler().On(HttpMethod.Post, Create, HttpStatusCode.ServiceUnavailable), clock).RunAsync(db, tenant, false, default);

        var status = EmploymentHeroTimesheets.StatusOf(await RowAsync(db), true, null, EhTimesheetFixture.Sydney);

        Assert.Equal((PayrollShiftStatus.Failed, "Employment Hero couldn't be reached. ODIP tries again at 12:01 pm."), (status.Status, status.Reason));
    }

    [Fact]
    public async Task A_429_waits_for_Retry_After_without_counting_and_stops_the_drain()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        for (var i = 0; i < 3; i++) await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = new StubHttpHandler().On(HttpMethod.Post, Create, HttpStatusCode.TooManyRequests, null, TimeSpan.FromSeconds(120));

        var log = await Sender(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Single(eh.Requests);
        var rows = await db.EmploymentHeroOutbox.IgnoreQueryFilters().ToListAsync();
        Assert.Equal(3, rows.Count);
        Assert.All(rows, r => Assert.Equal((EmploymentHeroOutboxStatus.Pending, 0, clock.GetUtcNow().UtcDateTime.AddSeconds(120)), (r.Status, r.Attempts, r.NextAttemptAt)));
        Assert.Contains(rows, r => r.LastError == EmploymentHeroTimesheets.BusyMessage);
        Assert.Equal("RateLimited", log!.ErrorClass);
    }

    [Fact]
    public async Task A_revoked_key_flags_nothing_and_emails_nobody()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        for (var i = 0; i < 10; i++) await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = new StubHttpHandler().On(HttpMethod.Post, Create, HttpStatusCode.Unauthorized);
        var sender = Sender(eh, clock);

        for (var run = 0; run < 40; run++)
        {
            await sender.RunAsync(db, tenant, false, default);
            clock.Set(clock.GetUtcNow().AddMinutes(1));
        }

        Assert.Equal(2, eh.Requests.Count);
        Assert.Equal(0, await db.EmploymentHeroOutbox.CountAsync(r => r.Status == EmploymentHeroOutboxStatus.NeedsAttention));
        Assert.Empty(await db.NotificationOutbox.ToListAsync());
        eh.On(HttpMethod.Post, Create, HttpStatusCode.OK, new { id = 9001 });
        clock.Set(clock.GetUtcNow().AddMinutes(31));
        await sender.RunAsync(db, tenant, false, default);
        Assert.Equal(10, await db.EmploymentHeroOutbox.CountAsync(r => r.Status == EmploymentHeroOutboxStatus.Sent));
    }

    [Fact]
    public async Task A_refusal_needs_attention_at_once_with_EH_words()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (_, completion) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = new StubHttpHandler().On(HttpMethod.Post, Create, HttpStatusCode.BadRequest, new { detail = "Employee is terminated" })
            .On(HttpMethod.Get, FindPath(completion.Id), HttpStatusCode.OK, Array.Empty<object>());

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        var row = await RowAsync(db);
        Assert.Equal((EmploymentHeroOutboxStatus.NeedsAttention, "Employment Hero refused it: Employee is terminated"), (row.Status, row.LastError));
    }

    [Fact]
    public async Task One_bad_row_does_not_stop_the_rest()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var posts = 0;
        eh.BeforeAnswer = r => { if (r.Method == HttpMethod.Post && posts++ == 0) throw new InvalidOperationException("boom"); };

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        var rows = await db.EmploymentHeroOutbox.IgnoreQueryFilters().ToListAsync();
        Assert.Equal(1, rows.Count(r => r.Status == EmploymentHeroOutboxStatus.Sent));
        var failed = Assert.Single(rows, r => r.Status == EmploymentHeroOutboxStatus.Failed);
        Assert.Equal(clock.GetUtcNow().UtcDateTime.AddMinutes(1), failed.NextAttemptAt);
    }

    // ── Never twice ──────────────────────────────────────────────────

    [Fact]
    public async Task A_lost_response_is_recovered_without_a_second_line()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (_, completion) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh().On(HttpMethod.Post, Create, HttpStatusCode.BadRequest, new { detail = "ExternalId must be unique" })
            .On(HttpMethod.Get, FindPath(completion.Id), HttpStatusCode.OK, new[] { new { id = 9001, workTypeId = "7" } });

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Equal(1, eh.Requests.Count(r => r.Method == HttpMethod.Post));
        Assert.Contains(eh.Requests, r => r.Method == HttpMethod.Put && r.RequestUri!.AbsolutePath.EndsWith("/9001"));
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, (await RowAsync(db)).Status);
    }

    [Fact]
    public async Task A_create_that_timed_out_is_found_not_posted_again()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (_, completion) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh().On(HttpMethod.Get, FindPath(completion.Id), HttpStatusCode.OK, new[] { new { id = 9001, workTypeId = "7" } });
        var posts = 0;
        eh.BeforeAnswer = r => { if (r.Method == HttpMethod.Post && posts++ == 0) throw new HttpRequestException("timed out"); };
        var sender = Sender(eh, clock);

        await sender.RunAsync(db, tenant, false, default);
        Assert.Equal(EmploymentHeroOutboxStatus.Failed, (await RowAsync(db)).Status);
        clock.Set(clock.GetUtcNow().AddMinutes(2));
        await sender.RunAsync(db, tenant, false, default);

        Assert.Equal(1, eh.Requests.Count(r => r.Method == HttpMethod.Post));
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, (await RowAsync(db)).Status);
    }

    [Fact]
    public async Task A_row_saved_Pending_after_a_try_that_may_have_reached_EH_is_looked_up_before_anything_is_posted()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (_, completion) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var now = clock.GetUtcNow().UtcDateTime;
        // The crash state: claimed (Attempts 1), lease expired, no EH id saved.
        var row = EmploymentHeroTimesheets.NewRow(tenant, completion.Id, now.AddMinutes(-20));
        row.Attempts = 1;
        row.NextAttemptAt = now.AddMinutes(-1);
        db.EmploymentHeroOutbox.Add(row);
        await db.SaveChangesAsync();
        var eh = Eh().On(HttpMethod.Get, FindPath(completion.Id), HttpStatusCode.OK, new[] { new { id = 9001, workTypeId = "7" } });

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Equal(0, eh.Requests.Count(r => r.Method == HttpMethod.Post));
        Assert.Equal(1, eh.Requests.Count(r => r.Method == HttpMethod.Put));
    }

    [Fact]
    public async Task A_claim_loses_to_one_saved_first()
    {
        var name = Guid.NewGuid().ToString();
        var (db1, tenant, _, clock) = await OrgAsync(name);
        await using var _1 = db1;
        var worker = await EhTimesheetFixture.WorkerAsync(db1, tenant);
        var (_, completion) = await EhTimesheetFixture.ApprovedShiftAsync(db1, tenant, worker, Day, Nine, Three);
        var now = clock.GetUtcNow().UtcDateTime;
        db1.EmploymentHeroOutbox.Add(EmploymentHeroTimesheets.NewRow(tenant, completion.Id, now));
        await db1.SaveChangesAsync();
        await using var db2 = EhFixture.Db(name, tenant);
        var first = await db1.EmploymentHeroOutbox.IgnoreQueryFilters().SingleAsync();
        var second = await db2.EmploymentHeroOutbox.IgnoreQueryFilters().SingleAsync();

        Assert.True(await EmploymentHeroTimesheetSender.ClaimAsync(db1, first, now, default));
        Assert.False(await EmploymentHeroTimesheetSender.ClaimAsync(db2, second, now, default));
    }

    // ── Waiting, scan and log ────────────────────────────────────────

    [Fact]
    public async Task An_unlinked_worker_waits_and_is_sent_after_linking()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant, payrollId: null);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var sender = Sender(eh, clock);

        await sender.RunAsync(db, tenant, false, default);
        Assert.Empty(eh.Requests);
        Assert.Equal(0, (await RowAsync(db)).Attempts);

        worker.ExternalPayrollId = "42";
        await db.SaveChangesAsync();
        await sender.RunAsync(db, tenant, false, default);
        Assert.Equal(HttpMethod.Post, Assert.Single(eh.Requests).Method);
    }

    [Fact]
    public async Task An_unmapped_night_kind_waits_until_the_work_type_is_chosen()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, new TimeOnly(22, 0), new TimeOnly(6, 0), SleepoverType.PassiveNight);
        var eh = Eh();

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Empty(eh.Requests);
        var row = await RowAsync(db);
        Assert.Equal("Choose the Employment Hero work type for passive nights in Settings → Integrations.", row.LastError);
        Assert.Equal(clock.GetUtcNow().UtcDateTime.AddMinutes(30), row.NextAttemptAt);
        Assert.Equal(0, row.Attempts);
    }

    [Fact]
    public async Task The_scan_queues_approved_shifts_with_no_row_from_the_cutoff_on()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (_, queued) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, new DateOnly(2026, 10, 12), Nine, Three);   // before the connection
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three, status: ShiftStatus.PendingReview, outcome: ReviewOutcome.Returned);
        var eh = Eh();

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        var row = await RowAsync(db);
        Assert.Equal((queued.Id, EmploymentHeroOutboxStatus.Sent), (row.EntityId, row.Status));
    }

    [Fact]
    public async Task Nothing_is_ever_sent_to_the_bulk_endpoints()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (shift, _) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var sender = Sender(eh, clock);
        await sender.RunAsync(db, tenant, false, default);
        shift.NightType = SleepoverType.ActiveNight;
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);
        worker.ExternalPayrollId = "43";
        await db.SaveChangesAsync();
        clock.Set(clock.GetUtcNow().AddMinutes(1));
        await sender.RunAsync(db, tenant, true, default);

        Assert.NotEmpty(eh.Requests);
        Assert.DoesNotContain(eh.Requests, r => r.RequestUri!.AbsolutePath.Contains("/bulk", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task A_drain_that_did_something_writes_one_timesheet_log_row_and_an_idle_one_none()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var sender = Sender(Eh(), clock);

        await sender.RunAsync(db, tenant, false, default);
        await sender.RunAsync(db, tenant, false, default);

        var log = await db.EmploymentHeroSyncLogs.SingleAsync();
        Assert.Equal((EmploymentHeroSyncKind.Timesheets, 2, 0), (log.Kind, log.Sent, log.Failed));
        Assert.DoesNotContain("Jane", JsonSerializer.Serialize(log));
    }

    [Fact]
    public async Task Another_organisations_rows_are_never_sent()
    {
        var name = Guid.NewGuid().ToString();
        var (dbA, tenantA, _, clock) = await OrgAsync(name);
        await using var _a = dbA;
        var (dbB, tenantB, _, _) = await OrgAsync(name);
        await using var _b = dbB;
        var workerB = await EhTimesheetFixture.WorkerAsync(dbB, tenantB);
        await EhTimesheetFixture.ApprovedShiftAsync(dbB, tenantB, workerB, Day, Nine, Three);
        var eh = Eh();

        await Sender(eh, clock).RunAsync(dbA, tenantA, false, default);

        Assert.Empty(eh.Requests);
        Assert.Empty(await dbB.EmploymentHeroOutbox.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task A_key_ODIP_cannot_read_sends_nothing_and_changes_no_row()
    {
        var (db, tenant, _, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var eh = Eh();
        var other = IntegrationKeyProtectorTests.Protector(IntegrationKeyProtectorTests.NewMasterKey());

        var log = await new EmploymentHeroTimesheetSender(StubHttpHandler.Client(eh), other, clock, NullLogger<EmploymentHeroTimesheetSender>.Instance, TimeSpan.Zero)
            .RunAsync(db, tenant, true, default);

        Assert.Null(log);
        Assert.Empty(eh.Requests);
        Assert.Empty(await db.EmploymentHeroOutbox.IgnoreQueryFilters().ToListAsync());
    }

    // ── Batch-safe saving (a conflict in one row loses nothing else) ──

    [Fact]
    public async Task A_conflict_on_one_row_is_skipped_and_the_next_row_is_still_sent()
    {
        var name = Guid.NewGuid().ToString();
        var (db, tenant, _, clock) = await OrgAsync(name);
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, Nine, Three);
        var now = clock.GetUtcNow().UtcDateTime;
        foreach (var c in await db.ShiftCompletions.ToListAsync()) db.EmploymentHeroOutbox.Add(EmploymentHeroTimesheets.NewRow(tenant, c.Id, now));
        await db.SaveChangesAsync();
        // Someone else (Send missing, a second drain) saves the first row after this run has loaded both.
        var eh = Eh();
        var raced = false;
        eh.BeforeAnswer = _ =>
        {
            if (raced) return;
            raced = true;
            using var other = EhFixture.Db(name, tenant);
            var target = other.EmploymentHeroOutbox.IgnoreQueryFilters().Where(r => r.Status == EmploymentHeroOutboxStatus.Pending).OrderBy(r => r.Id).Last();
            target.UpdatedAt = target.UpdatedAt.AddMinutes(5);
            other.SaveChanges();
        };

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        Assert.True((await db.EmploymentHeroOutbox.IgnoreQueryFilters().ToListAsync()).Count(r => r.Status == EmploymentHeroOutboxStatus.Sent) >= 1);
    }
}
