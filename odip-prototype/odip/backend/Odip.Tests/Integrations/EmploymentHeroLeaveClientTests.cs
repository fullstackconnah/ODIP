using System.Net;
using System.Text.Json;
using Odip.Infrastructure.Integrations;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>The EH client's PR 3 calls: leave requests written and read, categories, standard hours and balances.</summary>
public class EmploymentHeroLeaveClientTests
{
    private const string Key = "eh-api-key-5f2a9c";
    private const string Biz = "/api/v2/business/777";
    private const string Mine = Biz + "/employee/42/leaverequest";
    private const string Marker = "Sent from ODIP (ref 11111111-2222-3333-4444-555555555555)";

    private static EhLeaveLine Line(int? id = null) => new(id, 42, "2026-11-02T00:00:00", "2026-11-06T00:00:00", 5, 36.0m, Marker, true);

    [Fact]
    public async Task Create_posts_one_request_with_the_whole_body()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Post, Mine, HttpStatusCode.Created, new { id = 9001, status = "Approved" });

        var made = await StubHttpHandler.Client(eh).CreateLeaveRequestAsync(Key, "777", 42, Line(), CancellationToken.None);

        Assert.Equal(9001, made.Id);
        Assert.Equal("Approved", made.Status);
        var request = Assert.Single(eh.Requests);
        Assert.Equal("Basic", request.Headers.Authorization!.Scheme);
        using var body = JsonDocument.Parse(Assert.Single(eh.Bodies)!);
        var names = body.RootElement.EnumerateObject().Select(p => p.Name).Order().ToArray();
        Assert.Equal(new[] { "automaticallyApprove", "employeeId", "fromDate", "hours", "leaveCategoryId", "notes", "toDate" }, names);
        Assert.Equal(42, body.RootElement.GetProperty("employeeId").GetInt32());
        Assert.Equal("2026-11-02T00:00:00", body.RootElement.GetProperty("fromDate").GetString());
        Assert.Equal("2026-11-06T00:00:00", body.RootElement.GetProperty("toDate").GetString());
        Assert.Equal(5, body.RootElement.GetProperty("leaveCategoryId").GetInt32());
        Assert.Equal(36.0m, body.RootElement.GetProperty("hours").GetDecimal());
        Assert.Equal(Marker, body.RootElement.GetProperty("notes").GetString());
        Assert.True(body.RootElement.GetProperty("automaticallyApprove").GetBoolean());
    }

    [Fact]
    public async Task Update_puts_the_same_body_plus_its_id_and_reads_no_body()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Put, Mine + "/9001", HttpStatusCode.OK);

        await StubHttpHandler.Client(eh).UpdateLeaveRequestAsync(Key, "777", 42, 9001, Line(), CancellationToken.None);

        Assert.Equal(HttpMethod.Put, Assert.Single(eh.Requests).Method);
        using var body = JsonDocument.Parse(Assert.Single(eh.Bodies)!);
        Assert.Equal(9001, body.RootElement.GetProperty("id").GetInt32());
        Assert.Equal(42, body.RootElement.GetProperty("employeeId").GetInt32());
    }

    [Fact]
    public async Task An_empty_200_reads_as_done()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Post, Mine + "/9001/approve", HttpStatusCode.OK);

        await StubHttpHandler.Client(eh).ApproveLeaveRequestAsync(Key, "777", 42, 9001, CancellationToken.None);   // no throw

        Assert.Equal(HttpMethod.Post, Assert.Single(eh.Requests).Method);
    }

    [Fact]
    public async Task Approve_posts_to_the_request()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Post, Mine + "/9001/approve", HttpStatusCode.OK, new { id = 9001, status = "Approved" });

        await StubHttpHandler.Client(eh).ApproveLeaveRequestAsync(Key, "777", 42, 9001, CancellationToken.None);

        Assert.Equal(Mine + "/9001/approve", Assert.Single(eh.Requests).RequestUri!.AbsolutePath);
    }

    [Fact]
    public async Task Get_and_delete_treat_404_as_gone()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Get, Mine + "/9001", HttpStatusCode.NotFound).On(HttpMethod.Delete, Mine + "/9001", HttpStatusCode.NotFound);
        var client = StubHttpHandler.Client(eh);

        Assert.Null(await client.GetLeaveRequestAsync(Key, "777", 42, 9001, CancellationToken.None));
        Assert.False(await client.DeleteLeaveRequestAsync(Key, "777", 42, 9001, CancellationToken.None));
    }

    [Fact]
    public async Task Get_and_delete_read_a_live_request()
    {
        var eh = new StubHttpHandler()
            .On(HttpMethod.Get, Mine + "/9001", HttpStatusCode.OK, new { id = 9001, employeeId = 42, leaveCategoryId = 5, fromDate = "2026-11-02T00:00:00", toDate = "2026-11-06T00:00:00", status = "Rejected", notes = Marker })
            .On(HttpMethod.Delete, Mine + "/9001", HttpStatusCode.OK);
        var client = StubHttpHandler.Client(eh);

        var got = await client.GetLeaveRequestAsync(Key, "777", 42, 9001, CancellationToken.None);

        Assert.Equal("Rejected", got!.Status);
        Assert.True(await client.DeleteLeaveRequestAsync(Key, "777", 42, 9001, CancellationToken.None));
    }

    [Fact]
    public async Task The_list_asks_for_dates_and_optionally_one_employee()
    {
        var row = new { id = 9001, employeeId = 42, leaveCategoryId = 5, fromDate = "2026-11-02T00:00:00", toDate = "2026-11-06T00:00:00", status = "Approved", notes = "x" };
        var eh = new StubHttpHandler()
            .On(HttpMethod.Get, Biz + "/leaverequest?FromDate=2026-08-13&ToDate=2027-10-15", HttpStatusCode.OK, new[] { row })
            .On(HttpMethod.Get, Biz + "/leaverequest?FromDate=2026-08-13&ToDate=2027-10-15&EmployeeId=42", HttpStatusCode.OK, new[] { row });
        var client = StubHttpHandler.Client(eh);

        var all = await client.ListLeaveRequestsAsync(Key, "777", new DateOnly(2026, 8, 13), new DateOnly(2027, 10, 15), null, CancellationToken.None);
        var one = await client.ListLeaveRequestsAsync(Key, "777", new DateOnly(2026, 8, 13), new DateOnly(2027, 10, 15), 42, CancellationToken.None);

        Assert.Equal(new EhLeaveRef(9001, 42, 5, new DateTime(2026, 11, 2), new DateTime(2026, 11, 6), "Approved", "x"), Assert.Single(all));
        Assert.Single(one);
    }

    [Fact]
    public async Task Standard_hours_read_the_daily_figure()
    {
        var eh = new StubHttpHandler()
            .On(HttpMethod.Get, Biz + "/employee/42/standardhours", HttpStatusCode.OK, new { standardHoursPerDay = 7.2, standardHoursPerWeek = 36 })
            .On(HttpMethod.Get, Biz + "/employee/43/standardhours", HttpStatusCode.OK, new { });
        var client = StubHttpHandler.Client(eh);

        Assert.Equal(7.2m, await client.GetStandardHoursPerDayAsync(Key, "777", 42, CancellationToken.None));
        Assert.Null(await client.GetStandardHoursPerDayAsync(Key, "777", 43, CancellationToken.None));
    }

    [Fact]
    public async Task Balances_bind_name_amount_and_unit_only()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Get, Biz + "/employee/42/leavebalances", HttpStatusCode.OK,
            new[] { new { leaveCategoryId = 5, leaveCategoryName = "Annual Leave", accruedAmount = 120.5, unitType = "Hours", other = "x" } });

        var rows = await StubHttpHandler.Client(eh).ListLeaveBalancesAsync(Key, "777", 42, CancellationToken.None);

        Assert.Equal(new EhLeaveBalance("Annual Leave", 120.5m, "Hours"), Assert.Single(rows));
        Assert.Equal(new[] { "AccruedAmount", "LeaveCategoryName", "UnitType" }, typeof(EhLeaveBalance).GetProperties().Select(p => p.Name).Order().ToArray());
    }

    [Fact]
    public async Task Categories_read_id_and_name()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Get, Biz + "/leavecategory", HttpStatusCode.OK, new[] { new { id = 5, name = "Annual Leave", other = 1 } });

        var rows = await StubHttpHandler.Client(eh).ListLeaveCategoriesAsync(Key, "777", CancellationToken.None);

        Assert.Equal(new EhLeaveCategory(5, "Annual Leave"), Assert.Single(rows));
    }

    [Fact]
    public async Task A_refused_leave_write_is_Refused_with_EHs_words()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Post, Mine, HttpStatusCode.BadRequest, new { title = "Bad", detail = "The pay run is finalised." });

        var ex = await Assert.ThrowsAsync<EmploymentHeroException>(() => StubHttpHandler.Client(eh).CreateLeaveRequestAsync(Key, "777", 42, Line(), CancellationToken.None));

        Assert.Equal(EmploymentHeroFailure.Refused, ex.Failure);
        Assert.Equal("Employment Hero refused it: The pay run is finalised.", ex.Message);
    }

    [Fact]
    public async Task A_429_on_a_leave_call_carries_Retry_After()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Get, Biz + "/leavecategory", HttpStatusCode.TooManyRequests, null, TimeSpan.FromSeconds(90));

        var ex = await Assert.ThrowsAsync<EmploymentHeroException>(() => StubHttpHandler.Client(eh).ListLeaveCategoriesAsync(Key, "777", CancellationToken.None));

        Assert.Equal(EmploymentHeroFailure.RateLimited, ex.Failure);
        Assert.Equal(TimeSpan.FromSeconds(90), ex.RetryAfter);
    }
}
