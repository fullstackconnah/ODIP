using System.Net;
using System.Text;
using Odip.Infrastructure.Integrations;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>The EH client: Basic auth with the key as the username, the AU base URL, paging by 100, and every failure mapped to words that never hold the key.</summary>
public class EmploymentHeroClientTests
{
    private const string Key = "eh-api-key-5f2a9c";

    [Fact]
    public async Task Sends_basic_auth_with_the_key_as_username_and_a_blank_password_to_the_AU_host()
    {
        var eh = new StubHttpHandler().On("/api/v2/business", HttpStatusCode.OK, new[] { new { id = 777, name = "Acme Care" } });

        var businesses = await StubHttpHandler.Client(eh).ListBusinessesAsync(Key, CancellationToken.None);

        var request = Assert.Single(eh.Requests);
        Assert.Equal("https://api.yourpayroll.com.au/api/v2/business", request.RequestUri!.ToString());
        Assert.Equal("Basic", request.Headers.Authorization!.Scheme);
        Assert.Equal(Convert.ToBase64String(Encoding.UTF8.GetBytes(Key + ":")), request.Headers.Authorization.Parameter);
        Assert.Equal(new EhBusiness(777, "Acme Care"), Assert.Single(businesses));
    }

    [Fact]
    public async Task Pages_employees_100_at_a_time_until_a_short_page_and_reads_only_the_details_fields()
    {
        var firstPage = Enumerable.Range(1, 100).Select(i => StubHttpHandler.Employee(i, "P", $"{i}", $"p{i}@example.org")).ToArray();
        var eh = new StubHttpHandler()
            .On(StubHttpHandler.EmployeesPage("777"), HttpStatusCode.OK, firstPage)
            .On(StubHttpHandler.EmployeesPage("777", 100), HttpStatusCode.OK, new[] { StubHttpHandler.Employee(101, "Ana", "Ruiz", "ana@example.org", "0400 111 222", "2026-10-13T00:00:00") });

        var employees = await StubHttpHandler.Client(eh).ListEmployeesAsync(Key, "777", CancellationToken.None);

        Assert.Equal(101, employees.Count);
        Assert.Equal(2, eh.Requests.Count);
        Assert.Equal(new EhEmployee(101, "Ana", "Ruiz", "ana@example.org", "0400 111 222", new DateTime(2024, 1, 15), new DateTime(2026, 10, 13)), employees[^1]);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, EmploymentHeroFailure.KeyRefused)]
    [InlineData(HttpStatusCode.Forbidden, EmploymentHeroFailure.KeyRefused)]
    [InlineData(HttpStatusCode.NotFound, EmploymentHeroFailure.BusinessNotFound)]
    [InlineData(HttpStatusCode.TooManyRequests, EmploymentHeroFailure.RateLimited)]
    [InlineData(HttpStatusCode.InternalServerError, EmploymentHeroFailure.Unavailable)]
    public async Task Each_failure_has_its_own_class_and_a_message_without_the_key(HttpStatusCode status, EmploymentHeroFailure expected)
    {
        var eh = new StubHttpHandler().On("/api/v2/business/777", status);

        var ex = await Assert.ThrowsAsync<EmploymentHeroException>(() => StubHttpHandler.Client(eh).GetBusinessAsync(Key, "777", CancellationToken.None));

        Assert.Equal(expected, ex.Failure);
        Assert.DoesNotContain(Key, ex.Message);
    }

    [Fact]
    public async Task An_unreachable_server_or_an_unreadable_answer_is_Unavailable()
    {
        var eh = new StubHttpHandler()
            .OnThrow("/api/v2/business", new HttpRequestException("connection refused"))
            .On("/api/v2/business/777", HttpStatusCode.OK, "not an object");
        var client = StubHttpHandler.Client(eh);

        Assert.Equal(EmploymentHeroFailure.Unavailable, (await Assert.ThrowsAsync<EmploymentHeroException>(() => client.ListBusinessesAsync(Key, CancellationToken.None))).Failure);
        Assert.Equal(EmploymentHeroFailure.Unavailable, (await Assert.ThrowsAsync<EmploymentHeroException>(() => client.GetBusinessAsync(Key, "777", CancellationToken.None))).Failure);
    }
}
