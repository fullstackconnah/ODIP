using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Domain.Entities;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Medications;

namespace Odip.Tests.Integrations;

/// <summary>A connected organisation for the leave sync. The clock is two days past the leave cutoff, so no test depends on the epoch's value.</summary>
internal static class EhLeaveFixture
{
    public const string Employee42 = "/api/v2/business/777/employee/42";
    public const string Requests42 = Employee42 + "/leaverequest";

    public static async Task<(OdipDbContext Db, Guid Tenant, EmploymentHeroConnection Conn, FakeClock Clock, User Worker, DateOnly Monday)> OrgAsync(string? database = null, Guid? tenant = null)
    {
        var id = tenant ?? Guid.NewGuid();
        var db = EhFixture.Db(database ?? Guid.NewGuid().ToString(), id);
        var conn = await EhFixture.ConnectAsync(db, id);
        (conn.LeaveCategoryAnnual, conn.LeaveCategorySick, conn.LeaveCategoryPersonal, conn.LeaveCategoryOther) = ("5", "7", "7", "8");
        await db.SaveChangesAsync();
        var cutoff = EmploymentHeroLeave.Cutoff(conn.ConnectedAt);
        var clock = FakeClock.AtUtc(cutoff.Year, cutoff.Month, cutoff.Day, 1, 0);
        clock.Set(clock.GetUtcNow().AddDays(2));
        var worker = await EhTimesheetFixture.WorkerAsync(db, id);
        var monday = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime.AddHours(11)).AddDays(1);
        while (monday.DayOfWeek != DayOfWeek.Monday) monday = monday.AddDays(1);
        return (db, id, conn, clock, worker, monday);
    }

    /// <summary>An Approved ODIP leave decided one day after the cutoff.</summary>
    public static async Task<LeaveRequest> ApprovedLeaveAsync(OdipDbContext db, Guid tenantId, User worker, DateOnly from, DateOnly to, LeaveType type = LeaveType.Annual)
    {
        var connectedAt = await db.EmploymentHeroConnections.IgnoreQueryFilters().Where(c => c.TenantId == tenantId).Select(c => c.ConnectedAt).SingleAsync();
        var decided = EmploymentHeroLeave.Cutoff(connectedAt).AddDays(1);
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = tenantId, UserId = worker.Id, LeaveType = type, StartDate = from, EndDate = to, Status = LeaveStatus.Approved,
            RequestedByUserId = worker.Id, RequestedAt = decided, DecidedByUserId = worker.Id, DecidedAt = decided,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();
        return leave;
    }

    /// <summary>EH answering the leave calls for employee 42: standard hours, create (9001, already approved), update, approve and delete.</summary>
    public static StubHttpHandler Eh(decimal? hoursPerDay = 7.2m) => new StubHttpHandler()
        .On(HttpMethod.Get, Employee42 + "/standardhours", HttpStatusCode.OK, new { standardHoursPerDay = hoursPerDay })
        .On(HttpMethod.Post, Requests42, HttpStatusCode.OK, new { id = 9001, employeeId = 42, status = "Approved" })
        .On(HttpMethod.Put, Requests42 + "/9001", HttpStatusCode.OK)
        .On(HttpMethod.Post, Requests42 + "/9001/approve", HttpStatusCode.OK)
        .On(HttpMethod.Delete, Requests42 + "/9001", HttpStatusCode.OK);

    public static EmploymentHeroLeaveSync Sync(StubHttpHandler eh, FakeClock clock) =>
        new(StubHttpHandler.Client(eh), EhFixture.Keys, clock, NullLogger<EmploymentHeroLeaveSync>.Instance, TimeSpan.Zero);

    public static string ListPath(DateOnly from, DateOnly to) =>
        $"/api/v2/business/777/leaverequest?FromDate={from:yyyy-MM-dd}&ToDate={to:yyyy-MM-dd}&EmployeeId=42";
}
