using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Imports;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>GA PR3 pay: an approved group staff row is sent to EH as one line whose external id is the row id; a row with no actual times is flagged without blocking the next.</summary>
public class GroupActivityPaySenderTests
{
    private const string Lines = "/api/v2/business/777/timesheet";
    private static readonly DateOnly Day = new(2026, 10, 14);
    private static readonly DateTime NineSydney = new(2026, 10, 13, 22, 0, 0, DateTimeKind.Utc), ThreeSydney = new(2026, 10, 14, 4, 0, 0, DateTimeKind.Utc);

    private static StubHttpHandler Eh() => new StubHttpHandler()
        .On(HttpMethod.Post, Lines + "?enforceUniqueExternalId=true", HttpStatusCode.OK, new { id = 9001 })
        .On(HttpMethod.Get, $"{Lines}/9001", HttpStatusCode.OK, new { id = 9001, status = "Submitted" });

    private static EmploymentHeroTimesheetSender Sender(StubHttpHandler eh, FakeClock clock) =>
        new(StubHttpHandler.Client(eh), EhFixture.Keys, clock, NullLogger<EmploymentHeroTimesheetSender>.Instance, TimeSpan.Zero);

    private static async Task<(OdipDbContext Db, Guid Tenant, FakeClock Clock)> OrgAsync()
    {
        var id = Guid.NewGuid();
        var db = EhFixture.Db(Guid.NewGuid().ToString(), id);
        var conn = await EhFixture.ConnectAsync(db, id);
        conn.WorkTypeStandard = "7";
        conn.WorkTypeActiveNight = "8";
        await db.SaveChangesAsync();
        return (db, id, EhFixture.Clock());
    }

    private static async Task<GroupActivityStaff> ApprovedRowAsync(OdipDbContext db, Guid tenant, GroupActivity activity, Guid userId, bool actuals)
    {
        var row = new GroupActivityStaff
        {
            Id = Guid.NewGuid(), TenantId = tenant, GroupActivityId = activity.Id, UserId = userId, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
            TimeZoneId = "Australia/Sydney", ActualStart = actuals ? NineSydney : null, ActualEnd = actuals ? ThreeSydney : null, ReviewOutcome = ReviewOutcome.Approved,
            ReviewedAt = DateTime.UtcNow, SubmittedAt = DateTime.UtcNow,
        };
        db.GroupActivityStaff.Add(row);
        await db.SaveChangesAsync();
        return row;
    }

    private static async Task<GroupActivity> ActivityAsync(OdipDbContext db, Guid tenant)
    {
        var a = new GroupActivity { Id = Guid.NewGuid(), TenantId = tenant, ServiceDate = Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), Title = "Bowling", Status = ShiftStatus.Completed };
        db.GroupActivities.Add(a);
        await db.SaveChangesAsync();
        return a;
    }

    [Fact]
    public async Task An_approved_row_is_scanned_and_sent_as_one_line_with_the_row_id_as_external_id()
    {
        var (db, tenant, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var row = await ApprovedRowAsync(db, tenant, await ActivityAsync(db, tenant), worker.Id, actuals: true);
        var eh = Eh();

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        var post = Assert.Single(eh.Requests);
        Assert.Equal(HttpMethod.Post, post.Method);
        var body = JsonDocument.Parse(eh.Bodies[0]!).RootElement;
        Assert.Equal(row.Id.ToString("D"), body.GetProperty("externalId").GetString());
        Assert.Equal("2026-10-14T09:00:00", body.GetProperty("startTime").GetString());
        var outbox = await db.EmploymentHeroOutbox.IgnoreQueryFilters().SingleAsync();
        Assert.Equal((EmploymentHeroOutboxKind.GroupStaffTimesheet, EmploymentHeroOutboxStatus.Sent), (outbox.Kind, outbox.Status));
    }

    [Fact]
    public async Task A_row_with_no_actual_times_is_flagged_and_does_not_block_the_next_row()
    {
        var (db, tenant, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var activity = await ActivityAsync(db, tenant);
        var bare = await ApprovedRowAsync(db, tenant, activity, worker.Id, actuals: false);
        var good = await ApprovedRowAsync(db, tenant, activity, worker.Id, actuals: true);
        var eh = Eh();

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Single(eh.Requests);
        var rows = await db.EmploymentHeroOutbox.IgnoreQueryFilters().ToListAsync();
        Assert.Equal(EmploymentHeroOutboxStatus.NeedsAttention, rows.Single(r => r.EntityId == bare.Id).Status);
        Assert.Equal(EmploymentHeroOutboxStatus.Sent, rows.Single(r => r.EntityId == good.Id).Status);
    }

    [Fact]
    public async Task A_group_shifts_coordinator_completion_is_not_queued_as_pay()
    {
        var (db, tenant, clock) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var activity = await ActivityAsync(db, tenant);
        var (shift, _) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, new TimeOnly(9, 0), new TimeOnly(15, 0));
        shift.GroupActivityId = activity.Id;
        await db.SaveChangesAsync();
        var eh = Eh();

        await Sender(eh, clock).RunAsync(db, tenant, false, default);

        Assert.Empty(eh.Requests);
        Assert.Empty(await db.EmploymentHeroOutbox.IgnoreQueryFilters().ToListAsync());
    }
}
