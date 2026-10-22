using System.Net;
using System.Text.Json;
using Odip.Infrastructure.Integrations;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>The EH client's PR 2 calls: timesheet writes, Retry-After, refusals with EH's own words, and what the period picker and work-type settings read.</summary>
public class EmploymentHeroTimesheetClientTests
{
    private const string Key = "eh-api-key-5f2a9c";
    private const string Lines = "/api/v2/business/777/timesheet";
    private static readonly Guid Completion = Guid.Parse("11111111-2222-3333-4444-555555555555");

    private static EhTimesheetLine Line(int? id = null, int? workTypeId = 7) =>
        new(id, 42, "2026-10-14T09:04:00", "2026-10-14T15:10:00", [new EhBreak("2026-10-14T12:00:00", "2026-10-14T12:30:00", false)], workTypeId, Completion.ToString("D"));

    [Fact]
    public async Task Create_posts_one_line_with_enforced_unique_external_id_and_the_whole_body()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Post, $"{Lines}?enforceUniqueExternalId=true", HttpStatusCode.OK, new { id = 9001, externalId = Completion.ToString("D"), workTypeId = "7" });

        var made = await StubHttpHandler.Client(eh).CreateTimesheetAsync(Key, "777", Line(), CancellationToken.None);

        Assert.Equal(new EhTimesheetRef(9001, Completion.ToString("D")), made);
        var request = Assert.Single(eh.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("Basic", request.Headers.Authorization!.Scheme);
        using var body = JsonDocument.Parse(Assert.Single(eh.Bodies)!);
        var names = body.RootElement.EnumerateObject().Select(p => p.Name).Order().ToArray();
        Assert.Equal(new[] { "breaks", "employeeId", "endTime", "externalId", "startTime", "workTypeId" }, names);
        Assert.Equal(42, body.RootElement.GetProperty("employeeId").GetInt32());
        Assert.Equal("2026-10-14T09:04:00", body.RootElement.GetProperty("startTime").GetString());
        Assert.Equal("2026-10-14T15:10:00", body.RootElement.GetProperty("endTime").GetString());
        Assert.Equal(7, body.RootElement.GetProperty("workTypeId").GetInt32());
        var brk = Assert.Single(body.RootElement.GetProperty("breaks").EnumerateArray());
        Assert.False(brk.GetProperty("isPaidBreak").GetBoolean());
        Assert.Equal("2026-10-14T12:00:00", brk.GetProperty("startTime").GetString());
    }

    [Fact]
    public async Task Create_leaves_workTypeId_out_when_there_is_none()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Post, $"{Lines}?enforceUniqueExternalId=true", HttpStatusCode.OK, new { id = 9001 });

        await StubHttpHandler.Client(eh).CreateTimesheetAsync(Key, "777", Line(workTypeId: null), CancellationToken.None);

        using var body = JsonDocument.Parse(Assert.Single(eh.Bodies)!);
        Assert.False(body.RootElement.TryGetProperty("workTypeId", out _));
        Assert.False(body.RootElement.TryGetProperty("id", out _));
    }

    [Fact]
    public async Task Update_puts_the_same_body_plus_its_id()
    {
        var eh = new StubHttpHandler().On(HttpMethod.Put, $"{Lines}/9001", HttpStatusCode.OK, new { id = 9001 });

        await StubHttpHandler.Client(eh).UpdateTimesheetAsync(Key, "777", 9001, Line(), CancellationToken.None);

        Assert.Equal(HttpMethod.Put, Assert.Single(eh.Requests).Method);
        using var body = JsonDocument.Parse(Assert.Single(eh.Bodies)!);
        Assert.Equal(9001, body.RootElement.GetProperty("id").GetInt32());
        Assert.Equal(42, body.RootElement.GetProperty("employeeId").GetInt32());
    }

    [Fact]
    public async Task A_429_carries_Retry_After()
    {
        var url = $"{Lines}?enforceUniqueExternalId=true";
        var with = new StubHttpHandler().On(HttpMethod.Post, url, HttpStatusCode.TooManyRequests, null, TimeSpan.FromSeconds(120));
        var without = new StubHttpHandler().On(HttpMethod.Post, url, HttpStatusCode.TooManyRequests);

        var a = await Assert.ThrowsAsync<EmploymentHeroException>(() => StubHttpHandler.Client(with).CreateTimesheetAsync(Key, "777", Line(), CancellationToken.None));
        var b = await Assert.ThrowsAsync<EmploymentHeroException>(() => StubHttpHandler.Client(without).CreateTimesheetAsync(Key, "777", Line(), CancellationToken.None));

        Assert.Equal(EmploymentHeroFailure.RateLimited, a.Failure);
        Assert.Equal(TimeSpan.FromSeconds(120), a.RetryAfter);
        Assert.Equal(EmploymentHeroFailure.RateLimited, b.Failure);
        Assert.Null(b.RetryAfter);
    }

    [Fact]
    public async Task A_400_is_Refused_with_EH_words_clipped()
    {
        var url = $"{Lines}?enforceUniqueExternalId=true";
        var long400 = new StubHttpHandler().On(HttpMethod.Post, url, HttpStatusCode.BadRequest, new { title = "Bad", detail = new string('x', 500) });
        var unreadable = new StubHttpHandler().On(HttpMethod.Post, url, HttpStatusCode.BadRequest, "<html>no</html>");

        var a = await Assert.ThrowsAsync<EmploymentHeroException>(() => StubHttpHandler.Client(long400).CreateTimesheetAsync(Key, "777", Line(), CancellationToken.None));
        var b = await Assert.ThrowsAsync<EmploymentHeroException>(() => StubHttpHandler.Client(unreadable).CreateTimesheetAsync(Key, "777", Line(), CancellationToken.None));

        Assert.Equal(EmploymentHeroFailure.Refused, a.Failure);
        Assert.StartsWith("Employment Hero refused it: ", a.Message);
        Assert.True(a.Message.Length <= 228);
        Assert.DoesNotContain(Key, a.Message);
        Assert.Equal("Employment Hero refused it.", b.Message);
    }

    [Fact]
    public async Task Get_and_delete_treat_404_as_gone()
    {
        var client = StubHttpHandler.Client(new StubHttpHandler());

        Assert.Null(await client.GetTimesheetAsync(Key, "777", 9001, CancellationToken.None));
        Assert.False(await client.DeleteTimesheetAsync(Key, "777", 9001, CancellationToken.None));
    }

    [Fact]
    public async Task Get_reads_the_status_and_delete_says_it_deleted()
    {
        var eh = new StubHttpHandler()
            .On(HttpMethod.Get, $"{Lines}/9001", HttpStatusCode.OK, new { id = 9001, status = "Submitted", employeeId = "42" })
            .On(HttpMethod.Delete, $"{Lines}/9001", HttpStatusCode.OK);
        var client = StubHttpHandler.Client(eh);

        Assert.Equal(new EhTimesheetState(9001, "Submitted"), await client.GetTimesheetAsync(Key, "777", 9001, CancellationToken.None));
        Assert.True(await client.DeleteTimesheetAsync(Key, "777", 9001, CancellationToken.None));
    }

    [Fact]
    public async Task Find_by_external_id_reads_EHs_list_model()
    {
        var g = Completion.ToString("D");
        var path = $"{Lines}?$filter=ExternalId eq '{g}'";
        var eh = new StubHttpHandler().On(HttpMethod.Get, path, HttpStatusCode.OK, new[] { new { id = 9001, workTypeId = "7", locationId = "3", externalId = g } });
        var empty = new StubHttpHandler().On(HttpMethod.Get, path, HttpStatusCode.OK, Array.Empty<object>());

        Assert.Equal(9001, (await StubHttpHandler.Client(eh).FindTimesheetByExternalIdAsync(Key, "777", g, CancellationToken.None))!.Id);
        Assert.Null(await StubHttpHandler.Client(empty).FindTimesheetByExternalIdAsync(Key, "777", g, CancellationToken.None));
    }

    [Fact]
    public async Task The_period_calls_read_what_the_picker_needs()
    {
        var eh = new StubHttpHandler()
            .On("/api/v2/business/777/payschedule", HttpStatusCode.OK, new[] { new { id = 5, name = "Fortnightly", frequency = "Fortnightly" } })
            .On("/api/v2/business/777/payschedule/nextpaydates", HttpStatusCode.OK, new[] { new { payScheduleId = 5, nextScheduledFromDate = "2026-10-12T00:00:00", nextScheduledToDate = "2026-10-25T00:00:00" } })
            .On("/api/v2/business/777/payrun?$orderby=PayPeriodEnding desc&$top=30", HttpStatusCode.OK,
                new[] { new { id = 1, payScheduleId = 5, payPeriodStarting = "2026-09-28T00:00:00", payPeriodEnding = "2026-10-11T00:00:00", isFinalised = true } });
        var client = StubHttpHandler.Client(eh);

        Assert.Equal(new EhPaySchedule(5, "Fortnightly", "Fortnightly"), Assert.Single(await client.ListPaySchedulesAsync(Key, "777", CancellationToken.None)));
        Assert.Equal(5, Assert.Single(await client.ListNextPayDatesAsync(Key, "777", CancellationToken.None)).PayScheduleId);
        var run = Assert.Single(await client.ListRecentPayRunsAsync(Key, "777", CancellationToken.None));
        Assert.True(run.IsFinalised);
        Assert.Equal(new DateTime(2026, 10, 11), run.PayPeriodEnding);
    }

    [Fact]
    public async Task Work_types_offer_pay_categories_only()
    {
        var eh = new StubHttpHandler().On("/api/v2/business/777/worktype", HttpStatusCode.OK, new object[]
        {
            new { id = 1, name = "Ordinary", mappingType = "PayCategory" }, new { id = 2, name = "Annual", mappingType = "LeaveCategory" },
            new { id = 3, name = "Primary", mappingType = "PrimaryPayCategory" }, new { id = 4, name = "Cond", mappingType = "ShiftCondition" },
        });

        var types = await StubHttpHandler.Client(eh).ListWorkTypesAsync(Key, "777", CancellationToken.None);

        Assert.Equal(new[] { 1, 3 }, types.Select(t => t.Id));
    }
}
