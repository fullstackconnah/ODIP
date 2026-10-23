using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Imports;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>What EF InMemory cannot show: the filtered unique payroll-id index, one connection per organisation, and (Task 6) the sync on a real database.</summary>
public class EmploymentHeroPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public EmploymentHeroPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static User Person(Guid tenantId, string first, string? payrollId) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = "Lee", Username = $"{first}{Guid.NewGuid():N}",
        Email = $"{first}.{Guid.NewGuid():N}@example.org", Role = UserRole.SupportWorker, ExternalPayrollId = payrollId,
    };

    [SkippableFact]
    public async Task The_payroll_id_is_unique_per_organisation_over_non_null_values_only()
    {
        RequirePostgres();
        var (dbA, tenantA) = await _pg.NewTenantContextAsync();
        var (dbB, tenantB) = await _pg.NewTenantContextAsync();
        await using var _a = dbA;
        await using var _b = dbB;

        // Any number of unlinked people, and the same EH id in two organisations: allowed.
        dbA.Users.AddRange(Person(tenantA, "ann", null), Person(tenantA, "bob", null), Person(tenantA, "cat", "101"));
        dbB.Users.Add(Person(tenantB, "dan", "101"));
        await dbA.SaveChangesAsync();
        await dbB.SaveChangesAsync();

        // The same EH id twice in one organisation: refused by the index.
        dbA.Users.Add(Person(tenantA, "eve", "101"));
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => dbA.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(failure.InnerException);
        Assert.Equal("23505", pg.SqlState);
        Assert.Equal(User.ExternalPayrollIdIndexName, pg.ConstraintName);
    }

    [SkippableFact]
    public async Task An_organisation_has_one_connection()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        EmploymentHeroConnection Connection() => new()
        {
            Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = "777", BusinessName = "Acme Care", ApiKeyCiphertext = [1, 2, 3], ApiKeyNonce = new byte[12],
            ConnectedAt = DateTime.UtcNow, ConnectedByName = "Ada Admin",
        };

        db.EmploymentHeroConnections.Add(Connection());
        await db.SaveChangesAsync();
        db.EmploymentHeroConnections.Add(Connection());

        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal("23505", Assert.IsType<PostgresException>(failure.InnerException).SqlState);
    }

[SkippableFact]
    public async Task The_outbox_refuses_a_second_row_for_one_entity_but_not_for_another_kind_or_organisation()
    {
        RequirePostgres();
        var (dbA, tenantA) = await _pg.NewTenantContextAsync();
        var (dbB, tenantB) = await _pg.NewTenantContextAsync();
        await using var _a = dbA;
        await using var _b = dbB;
        var entity = Guid.NewGuid();
        EmploymentHeroOutbox Row(Guid tenant, EmploymentHeroOutboxKind kind) => new() { Id = Guid.NewGuid(), TenantId = tenant, Kind = kind, EntityId = entity };

        dbA.EmploymentHeroOutbox.Add(Row(tenantA, EmploymentHeroOutboxKind.Timesheet));
        await dbA.SaveChangesAsync();
        dbA.EmploymentHeroOutbox.Add(Row(tenantA, EmploymentHeroOutboxKind.Leave));
        dbB.EmploymentHeroOutbox.Add(Row(tenantB, EmploymentHeroOutboxKind.Timesheet));
        await dbA.SaveChangesAsync();
        await dbB.SaveChangesAsync();

        dbA.EmploymentHeroOutbox.Add(Row(tenantA, EmploymentHeroOutboxKind.Timesheet));
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => dbA.SaveChangesAsync());
        Assert.Equal(EmploymentHeroOutbox.OneRowIndexName, Assert.IsType<PostgresException>(failure.InnerException).ConstraintName);
    }

    private static async Task ConnectAsync(OdipDbContext db, Guid tenantId)
    {
        var (cipher, nonce) = EhFixture.Keys.Protect(EhFixture.ApiKey, tenantId);
        db.EmploymentHeroConnections.Add(new EmploymentHeroConnection
        {
            Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = EhFixture.Business, BusinessName = "Acme Care", ApiKeyCiphertext = cipher, ApiKeyNonce = nonce,
            ConnectedAt = DateTime.UtcNow, ConnectedByName = "Ada Admin",
        });
        await db.SaveChangesAsync();
    }

    private static StubHttpHandler EhList(object[] employees) => new StubHttpHandler().On(StubHttpHandler.EmployeesPage(EhFixture.Business), HttpStatusCode.OK, employees);

    [SkippableFact]
    public async Task The_sync_runs_on_Postgres()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        await ConnectAsync(db, tenantId);
        var token = Guid.NewGuid().ToString("N")[..8];
        var sam = Person(tenantId, "Sam", null);
        db.Users.Add(sam);
        await db.SaveChangesAsync();

        var result = await EhFixture.Sync(EhList([StubHttpHandler.Employee(101, "Sam", "Lee", sam.Email), StubHttpHandler.Employee(102, "Ana", "Ruiz", $"ana.{token}@example.org")]))
            .RunAsync(db, tenantId, CancellationToken.None);

        Assert.Equal(EmploymentHeroSyncOutcome.Done, result.Outcome);
        db.ChangeTracker.Clear();
        Assert.Equal(new[] { "101", "102" }, await db.Users.Where(u => u.ExternalPayrollId != null).OrderBy(u => u.ExternalPayrollId).Select(u => u.ExternalPayrollId!).ToArrayAsync());
        Assert.Equal(1, await db.EmploymentHeroSyncLogs.CountAsync());
    }

    [SkippableFact]
    public async Task Two_syncs_at_once_create_each_person_once_on_Postgres()
    {
        RequirePostgres();
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await using (setup) await ConnectAsync(setup, tenantId);
        var token = Guid.NewGuid().ToString("N")[..8];
        var employees = Enumerable.Range(1, 30).Select(i => StubHttpHandler.Employee(800 + i, "New", $"Person{i}", $"new{i}.{token}@example.org")).ToArray();
        await using var a = PostgresFixture.NewContext(_pg.ConnectionString, ImportTestSupport.Tenant(tenantId));
        await using var b = PostgresFixture.NewContext(_pg.ConnectionString, ImportTestSupport.Tenant(tenantId));

        // Sync now pressed during the half-hourly run: the second waits on the organisation's lock, then finds everyone already linked.
        var results = await Task.WhenAll(
            EhFixture.Sync(EhList(employees)).RunAsync(a, tenantId, CancellationToken.None),
            EhFixture.Sync(EhList(employees)).RunAsync(b, tenantId, CancellationToken.None));

        // On a slow, busy test server the second run may give up on the 20 s lock wait (Busy): that is a correct answer too, never a failure.
        Assert.All(results, r => Assert.NotEqual(EmploymentHeroSyncOutcome.Failed, r.Outcome));
        Assert.Equal(30, results.Sum(r => r.Log?.Created ?? 0));
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString, ImportTestSupport.Tenant(tenantId));
        Assert.Equal(30, await check.Users.CountAsync(u => u.ExternalPayrollId != null));
        Assert.Equal(0, await check.EmploymentHeroAttentions.CountAsync());
    }

    [SkippableFact]
    public async Task One_person_the_database_refuses_costs_only_that_person_on_Postgres()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        await ConnectAsync(db, tenantId);
        // A SuperAdmin row in the organisation already holds EH id 900. The sync never reads SuperAdmins, so it takes EH 900 for a new person and the
        // payroll-id index refuses that save. Inside the run's transaction, EF's savepoint must keep 901 and 902 going.
        var holder = Person(tenantId, "sup", "900");
        holder.Role = UserRole.SuperAdmin;
        db.Users.Add(holder);
        await db.SaveChangesAsync();
        var token = Guid.NewGuid().ToString("N")[..8];

        var result = await EhFixture.Sync(EhList([
                StubHttpHandler.Employee(900, "Nina", "Ross", $"nina.{token}@example.org"),
                StubHttpHandler.Employee(901, "Omar", "Saeed", $"omar.{token}@example.org"),
                StubHttpHandler.Employee(902, "Pia", "Tran", $"pia.{token}@example.org")]))
            .RunAsync(db, tenantId, CancellationToken.None);

        Assert.Equal(EmploymentHeroSyncOutcome.Done, result.Outcome);
        db.ChangeTracker.Clear();
        Assert.Equal(new[] { "901", "902" }, await db.Users.Where(u => u.Role != UserRole.SuperAdmin && u.ExternalPayrollId != null)
            .OrderBy(u => u.ExternalPayrollId).Select(u => u.ExternalPayrollId!).ToArrayAsync());
        var item = await db.EmploymentHeroAttentions.SingleAsync();
        Assert.Equal((EmploymentHeroAttentionKind.FixInEmploymentHero, "900"), (item.Kind, item.ExternalEmployeeId));
        Assert.Contains("couldn't save their details", item.Reason);
        Assert.Equal(1, await db.EmploymentHeroSyncLogs.CountAsync());
    }

    [SkippableFact]
    public async Task Connect_waits_for_a_sync_in_flight_on_Postgres()
    {
        RequirePostgres();
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await using (setup) await ConnectAsync(setup, tenantId);
        await using var running = PostgresFixture.NewContext(_pg.ConnectionString, ImportTestSupport.Tenant(tenantId));
        await using var admin = PostgresFixture.NewContext(_pg.ConnectionString, ImportTestSupport.Tenant(tenantId));
        var eh = new StubHttpHandler().On("/api/v2/business/888", HttpStatusCode.OK, new { id = 888, name = "Acme Care (new)" });
        var controller = new EmploymentHeroController(admin, ImportTestSupport.Tenant(tenantId), EhFixture.Keys, StubHttpHandler.Client(eh), EhFixture.Sync(eh), EhFixture.Clock())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = ImportTestSupport.Admin() } },
        };
        var release = new TaskCompletionSource();
        var held = new TaskCompletionSource();

        // A run holds the organisation's sync lock (as the half-hourly run does while it applies EH's list).
        var run = EmploymentHeroStaffSync.UnderSyncLockAsync(running, tenantId, async () => { held.SetResult(); await release.Task; }, CancellationToken.None);
        await held.Task;
        var connect = controller.Connect(new EmploymentHeroConnectDto(EhFixture.ApiKey, "888"), CancellationToken.None);
        await Task.Delay(1500);
        Assert.False(connect.IsCompleted);   // Connect waits for the run instead of clearing links under it

        release.SetResult();
        Assert.True(await run);
        Assert.IsType<OkObjectResult>((await connect).Result);
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString, ImportTestSupport.Tenant(tenantId));
        Assert.Equal("888", (await check.EmploymentHeroConnections.SingleAsync()).BusinessId);
    }

    [SkippableFact]
    public async Task A_failed_archive_is_reloaded_so_the_last_Admin_check_stays_right_on_Postgres()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        await ConnectAsync(db, tenantId);
        // Two linked Admins, both ended in EH. Ann first, so she is archived (or not) first.
        var ann = Person(tenantId, "ann", "901");
        ann.Role = UserRole.Admin;
        ann.LastLoginAt = DateTime.UtcNow.AddDays(-1);   // both have signed in, so each counts as the other Admin
        db.Users.Add(ann);
        await db.SaveChangesAsync();
        var bea = Person(tenantId, "bea", "902");
        bea.Role = UserRole.Admin;
        bea.LastLoginAt = DateTime.UtcNow.AddDays(-1);
        db.Users.Add(bea);
        await db.SaveChangesAsync();
        // The database refuses Ann's archive mid-run. Inside the run's transaction EF rolls back to its savepoint; the sync must then reload Ann, or her
        // in-memory IsActive=false would make Bea look like the last Admin and keep her.
        var fn = $"eh_refuse_{Guid.NewGuid():N}";
        await db.Database.ExecuteSqlRawAsync(
            $"CREATE FUNCTION {fn}() RETURNS trigger AS $body$ BEGIN IF NEW.\"Id\" = '{ann.Id}' AND NEW.\"IsActive\" = false THEN RAISE EXCEPTION 'refused' USING ERRCODE = '23514'; END IF; RETURN NEW; END $body$ LANGUAGE plpgsql; " +
            $"CREATE TRIGGER {fn} BEFORE UPDATE ON \"Users\" FOR EACH ROW EXECUTE FUNCTION {fn}();");
        try
        {
            var result = await EhFixture.Sync(EhList([
                    StubHttpHandler.Employee(901, ann.FirstName, ann.LastName, ann.Email, null, "2026-10-01T00:00:00"),
                    StubHttpHandler.Employee(902, bea.FirstName, bea.LastName, bea.Email, null, "2026-10-01T00:00:00")]))
                .RunAsync(db, tenantId, CancellationToken.None);

            Assert.Equal(EmploymentHeroSyncOutcome.Done, result.Outcome);
            db.ChangeTracker.Clear();
            Assert.True((await db.Users.SingleAsync(u => u.Id == ann.Id)).IsActive);
            Assert.False((await db.Users.SingleAsync(u => u.Id == bea.Id)).IsActive);
        }
        finally
        {
            await db.Database.ExecuteSqlRawAsync($"DROP TRIGGER IF EXISTS {fn} ON \"Users\"; DROP FUNCTION IF EXISTS {fn}();");
        }
    }

    private static StubHttpHandler EhLines() => new StubHttpHandler()
        .On(HttpMethod.Post, "/api/v2/business/777/timesheet?enforceUniqueExternalId=true", HttpStatusCode.OK, new { id = 9001 });

    private static async Task<(Guid, int)> SeedShiftsAsync(OdipDbContext db, Guid tenantId, int count)
    {
        await ConnectAsync(db, tenantId);
        var conn = await db.EmploymentHeroConnections.IgnoreQueryFilters().SingleAsync(c => c.TenantId == tenantId);
        conn.WorkTypeStandard = "7";
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenantId);
        var day = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);
        for (var i = 0; i < count; i++) await EhTimesheetFixture.ApprovedShiftAsync(db, tenantId, worker, day, new TimeOnly(9, 0), new TimeOnly(15, 0));
        await db.SaveChangesAsync();
        return (tenantId, count);
    }

    [SkippableFact]
    public async Task The_sender_runs_on_Postgres()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        await SeedShiftsAsync(db, tenantId, 2);
        var eh = EhLines();

        await new EmploymentHeroTimesheetSender(StubHttpHandler.Client(eh), EhFixture.Keys, TimeProvider.System, Microsoft.Extensions.Logging.Abstractions.NullLogger<EmploymentHeroTimesheetSender>.Instance, TimeSpan.Zero)
            .RunAsync(db, tenantId, true, CancellationToken.None);

        Assert.Equal(2, await db.EmploymentHeroOutbox.IgnoreQueryFilters().CountAsync(r => r.TenantId == tenantId && r.Status == EmploymentHeroOutboxStatus.Sent));
    }

    private static async Task<LeaveRequest> SeedLeaveAsync(OdipDbContext db, Guid tenantId)
    {
        await ConnectAsync(db, tenantId);
        var conn = await db.EmploymentHeroConnections.IgnoreQueryFilters().SingleAsync(c => c.TenantId == tenantId);
        conn.LeaveCategoryAnnual = "5";
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenantId);
        var monday = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);
        while (monday.DayOfWeek != DayOfWeek.Monday) monday = monday.AddDays(1);
        var decided = EmploymentHeroLeave.Cutoff(conn.ConnectedAt).AddDays(1);
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = tenantId, UserId = worker.Id, LeaveType = LeaveType.Annual, StartDate = monday, EndDate = monday.AddDays(2),
            Status = LeaveStatus.Approved, RequestedByUserId = worker.Id, RequestedAt = decided, DecidedByUserId = worker.Id, DecidedAt = decided,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();
        return leave;
    }

    private static EmploymentHeroLeaveSync LeaveSync(StubHttpHandler eh) =>
        new(StubHttpHandler.Client(eh), EhFixture.Keys, TimeProvider.System, Microsoft.Extensions.Logging.Abstractions.NullLogger<EmploymentHeroLeaveSync>.Instance, TimeSpan.Zero);

    [SkippableFact]
    public async Task The_leave_sync_runs_on_Postgres()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var leave = await SeedLeaveAsync(db, tenantId);
        var eh = EhLeaveFixture.Eh();
        var sync = LeaveSync(eh);

        await sync.RunAsync(db, tenantId, false, CancellationToken.None);
        leave.EndDate = leave.EndDate.AddDays(1);
        await db.SaveChangesAsync();
        await sync.RunAsync(db, tenantId, false, CancellationToken.None);

        Assert.Equal(1, eh.Requests.Count(r => r.Method == HttpMethod.Post && r.RequestUri!.AbsolutePath == EhLeaveFixture.Requests42));
        Assert.Equal(1, eh.Requests.Count(r => r.Method == HttpMethod.Put));
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, (await db.EmploymentHeroOutbox.IgnoreQueryFilters().SingleAsync(r => r.TenantId == tenantId)).Status);
    }

    [SkippableFact]
    public async Task Two_leave_drains_at_once_post_the_leave_once_on_Postgres()
    {
        RequirePostgres();
        var (db1, tenantId) = await _pg.NewTenantContextAsync();
        await using var _1 = db1;
        await SeedLeaveAsync(db1, tenantId);
        await using var db2 = PostgresFixture.NewContext(_pg.ConnectionString!, ImportTestSupport.Tenant(tenantId));
        var eh = EhLeaveFixture.Eh();
        eh.BeforeAnswer = _ => Thread.Sleep(50);

        await Task.WhenAll(LeaveSync(eh).RunAsync(db1, tenantId, false, CancellationToken.None), LeaveSync(eh).RunAsync(db2, tenantId, false, CancellationToken.None));

        Assert.Equal(1, eh.Requests.Count(r => r.Method == HttpMethod.Post && r.RequestUri!.AbsolutePath == EhLeaveFixture.Requests42));
    }

    private static StubHttpHandler EhHolding(string fromDate, string toDate, string? notes) =>
        EhLeaveFixture.Eh().OnAnyQuery("/api/v2/business/777/leaverequest", HttpStatusCode.OK,
            new[] { new { id = 9001, employeeId = 42, leaveCategoryId = 5, fromDate, toDate, status = "Approved", notes } });

    [SkippableFact]
    public async Task A_pull_and_a_drain_on_one_EH_leave_keep_one_row_on_Postgres()
    {
        RequirePostgres();
        var (db1, tenantId) = await _pg.NewTenantContextAsync();
        await using var _1 = db1;
        var leave = await SeedLeaveAsync(db1, tenantId);
        var now = DateTime.UtcNow;
        var row = EmploymentHeroLeave.NewRow(tenantId, EmploymentHeroOutboxKind.Leave, leave.Id, now.AddMinutes(-20));
        (row.Attempts, row.NextAttemptAt) = (1, now.AddMinutes(-10));
        db1.EmploymentHeroOutbox.Add(row);
        await db1.SaveChangesAsync();
        await using var db2 = PostgresFixture.NewContext(_pg.ConnectionString!, ImportTestSupport.Tenant(tenantId));
        var eh = EhHolding(leave.StartDate.ToString("yyyy-MM-dd") + "T00:00:00", leave.EndDate.ToString("yyyy-MM-dd") + "T00:00:00", EmploymentHeroLeave.Marker(leave.Id));

        await Task.WhenAll(LeaveSync(eh).RunAsync(db1, tenantId, true, CancellationToken.None), LeaveSync(eh).RunAsync(db2, tenantId, false, CancellationToken.None));

        Assert.Equal(0, eh.Requests.Count(r => r.Method == HttpMethod.Post && r.RequestUri!.AbsolutePath == EhLeaveFixture.Requests42));
        var all = await db1.LeaveRequests.AsNoTracking().ToListAsync();
        Assert.Equal(("9001", LeaveSource.Odip), (Assert.Single(all).ExternalLeaveId, all[0].Source));
    }

    [SkippableFact]
    public async Task Two_pulls_at_once_import_each_EH_leave_once_on_Postgres()
    {
        RequirePostgres();
        var (db1, tenantId) = await _pg.NewTenantContextAsync();
        await using var _1 = db1;
        await ConnectAsync(db1, tenantId);
        await EhTimesheetFixture.WorkerAsync(db1, tenantId);
        await using var db2 = PostgresFixture.NewContext(_pg.ConnectionString!, ImportTestSupport.Tenant(tenantId));
        var day = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(3).ToString("yyyy-MM-dd") + "T00:00:00";
        var eh = EhHolding(day, day, null);
        eh.BeforeAnswer = _ => Thread.Sleep(50);

        await Task.WhenAll(LeaveSync(eh).RunAsync(db1, tenantId, true, CancellationToken.None), LeaveSync(eh).RunAsync(db2, tenantId, true, CancellationToken.None));

        Assert.Equal(1, await db1.LeaveRequests.IgnoreQueryFilters().CountAsync(l => l.TenantId == tenantId && l.ExternalLeaveId == "9001"));
    }

    [SkippableFact]
    public async Task Two_leave_scans_queueing_the_same_leave_never_deadlock_on_Postgres()
    {
        RequirePostgres();
        for (var i = 0; i < 50; i++)
        {
            var (db1, tenantId) = await _pg.NewTenantContextAsync();
            await using var _1 = db1;
            var first = await SeedLeaveAsync(db1, tenantId);
            db1.LeaveRequests.AddRange(Enumerable.Range(1, 9).Select(k => new LeaveRequest
            {
                Id = Guid.NewGuid(), TenantId = tenantId, UserId = first.UserId, LeaveType = LeaveType.Annual, StartDate = first.StartDate.AddDays(7 * k), EndDate = first.StartDate.AddDays(7 * k),
                Status = LeaveStatus.Approved, RequestedByUserId = first.UserId, RequestedAt = first.DecidedAt!.Value, DecidedByUserId = first.UserId, DecidedAt = first.DecidedAt,
            }));
            await db1.SaveChangesAsync();
            await using var db2 = PostgresFixture.NewContext(_pg.ConnectionString!, ImportTestSupport.Tenant(tenantId));
            var eh = EhLeaveFixture.Eh();

            await Task.WhenAll(LeaveSync(eh).RunAsync(db1, tenantId, false, CancellationToken.None), LeaveSync(eh).RunAsync(db2, tenantId, false, CancellationToken.None));

            Assert.Equal(10, eh.Requests.Count(r => r.Method == HttpMethod.Post && r.RequestUri!.AbsolutePath == EhLeaveFixture.Requests42));
        }
    }

    [SkippableFact]
    public async Task Two_pulls_importing_the_same_EH_leaves_never_deadlock_on_Postgres()
    {
        RequirePostgres();
        for (var i = 0; i < 20; i++)
        {
            var (db1, tenantId) = await _pg.NewTenantContextAsync();
            await using var _1 = db1;
            await ConnectAsync(db1, tenantId);
            await EhTimesheetFixture.WorkerAsync(db1, tenantId);
            await using var db2 = PostgresFixture.NewContext(_pg.ConnectionString!, ImportTestSupport.Tenant(tenantId));
            string Day(int n) => DateOnly.FromDateTime(DateTime.UtcNow).AddDays(n).ToString("yyyy-MM-dd") + "T00:00:00";
            var eh = EhLeaveFixture.Eh().OnAnyQuery("/api/v2/business/777/leaverequest", HttpStatusCode.OK,
                Enumerable.Range(0, 4).Select(k => new { id = 9001 + k, employeeId = 42, leaveCategoryId = 5, fromDate = Day(3 + k), toDate = Day(3 + k), status = "Approved", notes = (string?)null }).ToArray());

            await Task.WhenAll(LeaveSync(eh).RunAsync(db1, tenantId, true, CancellationToken.None), LeaveSync(eh).RunAsync(db2, tenantId, true, CancellationToken.None));

            Assert.Equal(new[] { "9001", "9002", "9003", "9004" }, (await db1.LeaveRequests.IgnoreQueryFilters().Where(l => l.TenantId == tenantId).Select(l => l.ExternalLeaveId!).ToListAsync()).Order().ToArray());
        }
    }

    [SkippableFact]
    public async Task Two_drains_at_once_post_each_shift_once_on_Postgres()
    {
        RequirePostgres();
        var (db1, tenantId) = await _pg.NewTenantContextAsync();
        await using var _1 = db1;
        await SeedShiftsAsync(db1, tenantId, 3);
        await using var db2 = PostgresFixture.NewContext(_pg.ConnectionString!, ImportTestSupport.Tenant(tenantId));
        var eh = EhLines();
        EmploymentHeroTimesheetSender Sender() => new(StubHttpHandler.Client(eh), EhFixture.Keys, TimeProvider.System, Microsoft.Extensions.Logging.Abstractions.NullLogger<EmploymentHeroTimesheetSender>.Instance, TimeSpan.Zero);

        await Task.WhenAll(Sender().RunAsync(db1, tenantId, false, CancellationToken.None), Sender().RunAsync(db2, tenantId, false, CancellationToken.None));

        Assert.Equal(3, eh.Requests.Count(r => r.Method == HttpMethod.Post));
    }

    [SkippableFact]
    public async Task The_payroll_check_query_runs_on_Postgres()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        await SeedShiftsAsync(db, tenantId, 2);
        var tenant = new Moq.Mock<Odip.Domain.Interfaces.ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        var controller = new EmploymentHeroPayrollController(db, tenant.Object, EhFixture.Keys, StubHttpHandler.Client(new StubHttpHandler()))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = ImportTestSupport.Admin() } },
        };
        var day = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);

        var result = await controller.SendMissing(new PayrollRangeDto(day.AddDays(-3), day.AddDays(3)), CancellationToken.None);

        var sent = Assert.IsType<OkObjectResult>(result.Result);
        var data = Assert.IsType<Odip.Application.Common.ApiResponse<SendMissingResultDto>>(sent.Value).Data!;
        Assert.Equal(2, data.Queued);
        Assert.Equal(2, data.Check.Waiting);
        Assert.Single(data.Check.Workers);
    }

    [SkippableFact]
    public async Task An_EH_leave_id_is_unique_per_organisation_only_when_set()
    {
        RequirePostgres();
        var (dbA, tenantA) = await _pg.NewTenantContextAsync();
        var (dbB, tenantB) = await _pg.NewTenantContextAsync();
        await using var _a = dbA;
        await using var _b = dbB;
        LeaveRequest Leave(Guid tenantId, string? ehId) => new()
        {
            Id = Guid.NewGuid(), TenantId = tenantId, UserId = Guid.NewGuid(), RequestedByUserId = Guid.NewGuid(), ExternalLeaveId = ehId,
            StartDate = new DateOnly(2026, 11, 2), EndDate = new DateOnly(2026, 11, 6),
        };
        var userA = Person(tenantA, "ann", null);
        var userB = Person(tenantB, "bob", null);
        dbA.Users.Add(userA);
        dbB.Users.Add(userB);
        await dbA.SaveChangesAsync();
        await dbB.SaveChangesAsync();

        // Any number without an id, and the same id in two organisations: allowed.
        var l1 = Leave(tenantA, null); l1.UserId = userA.Id;
        var l2 = Leave(tenantA, null); l2.UserId = userA.Id;
        var l3 = Leave(tenantA, "9001"); l3.UserId = userA.Id;
        var l4 = Leave(tenantB, "9001"); l4.UserId = userB.Id;
        dbA.LeaveRequests.AddRange(l1, l2, l3);
        dbB.LeaveRequests.Add(l4);
        await dbA.SaveChangesAsync();
        await dbB.SaveChangesAsync();

        var again = Leave(tenantA, "9001"); again.UserId = userA.Id;
        dbA.LeaveRequests.Add(again);
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => dbA.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(failure.InnerException);
        Assert.Equal("23505", pg.SqlState);
        Assert.Equal(LeaveRequest.ExternalLeaveIdIndexName, pg.ConstraintName);
    }
}
