using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Infrastructure.ProblemReports;
using Odip.Tests.EarlyAccess;
using Xunit;

namespace Odip.Tests.ProblemReports;

public class VikunjaProblemReportSenderTests
{
    private const string Token = "test-token-0000";

    internal sealed record Call(HttpMethod Method, string Url, string Body, string? Authorization);

    /// <summary>Records every request, then answers with the supplied function (which may throw).</summary>
    internal sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<Call, HttpResponseMessage> _answer;
        public List<Call> Calls { get; } = new();
        public StubHandler(Func<Call, HttpResponseMessage> answer) => _answer = answer;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            var call = new Call(request.Method, request.RequestUri!.ToString(), body, request.Headers.Authorization?.ToString());
            lock (Calls) Calls.Add(call);
            return _answer(call);
        }
    }

    internal static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    internal static IConfiguration Config(bool full = true, bool bucket = true) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["WorkBoard:BaseUrl"] = full ? "http://board.test:3456/" : "",
            ["WorkBoard:Token"] = full ? Token : "",
            ["WorkBoard:ProjectId"] = full ? "7" : "",
            ["WorkBoard:ViewId"] = bucket ? "11" : "",
            ["WorkBoard:BucketId"] = bucket ? "22" : "",
            ["WorkBoard:LabelId"] = bucket ? "33" : "",
        }).Build();

    private static VikunjaProblemReportSender Sender(StubHandler handler, CapturingLogger<VikunjaProblemReportSender>? log = null, IConfiguration? config = null) =>
        new(new HttpClient(handler), config ?? Config(), log ?? new CapturingLogger<VikunjaProblemReportSender>());

    private static HttpResponseMessage HappyPath(Call c) => c.Method == HttpMethod.Put && c.Url.EndsWith("/projects/7/tasks")
        ? Json(HttpStatusCode.Created, "{\"id\":42,\"title\":\"x\"}")
        : Json(HttpStatusCode.OK, "{}");

    [Fact]
    public async Task Create_SendsTheCardWithBearerToken_ThenLabelAndBucket()
    {
        var handler = new StubHandler(HappyPath);
        var report = ProblemReportCardTests.Report();

        var result = await Sender(handler).TrySendAsync(report, CancellationToken.None);

        Assert.True(result.Sent);
        Assert.Equal(42, result.CardId);
        Assert.Equal(3, handler.Calls.Count);

        var create = handler.Calls[0];
        Assert.Equal(HttpMethod.Put, create.Method);
        Assert.Equal("http://board.test:3456/api/v1/projects/7/tasks", create.Url);
        Assert.Equal($"Bearer {Token}", create.Authorization);
        using var json = JsonDocument.Parse(create.Body);
        Assert.Equal(new[] { "description", "title" }, json.RootElement.EnumerateObject().Select(p => p.Name).Order());
        Assert.Equal("Sample Support Co: The roster will not save. [R-3f2a9c01]", json.RootElement.GetProperty("title").GetString());
        Assert.Contains("<strong>Problem:</strong> The roster will not save.</p>", json.RootElement.GetProperty("description").GetString());

        Assert.Equal(HttpMethod.Put, handler.Calls[1].Method);
        Assert.EndsWith("/api/v1/tasks/42/labels", handler.Calls[1].Url);
        Assert.Contains("33", handler.Calls[1].Body);
        Assert.Equal(HttpMethod.Post, handler.Calls[2].Method);
        Assert.EndsWith("/api/v1/projects/7/views/11/buckets/22/tasks", handler.Calls[2].Url);
        Assert.Contains("42", handler.Calls[2].Body);
    }

    [Fact]
    public async Task TheCard_CarriesNoParticipantNameUnlessItWasTyped()
    {
        var handler = new StubHandler(HappyPath);
        var report = ProblemReportCardTests.Report(r => r.Text = "The page is slow");

        await Sender(handler).TrySendAsync(report, CancellationToken.None);

        Assert.DoesNotContain("Jordan Participant", handler.Calls[0].Body);
    }

    [Fact]
    public async Task LabelAndBucketFailing_DoNotChangeTheOutcome()
    {
        var handler = new StubHandler(c => c.Method == HttpMethod.Put && c.Url.EndsWith("/projects/7/tasks")
            ? Json(HttpStatusCode.Created, "{\"id\":42}")
            : Json(HttpStatusCode.InternalServerError, "{}"));

        var result = await Sender(handler).TrySendAsync(ProblemReportCardTests.Report(), CancellationToken.None);

        Assert.True(result.Sent);
        Assert.Equal(42, result.CardId);
    }

    [Fact]
    public async Task WithoutViewBucketOrLabel_OnlyTheCreateIsSent()
    {
        var handler = new StubHandler(HappyPath);

        var result = await Sender(handler, config: Config(bucket: false)).TrySendAsync(ProblemReportCardTests.Report(), CancellationToken.None);

        Assert.True(result.Sent);
        Assert.Single(handler.Calls);
    }

    [Theory]
    [InlineData("WorkBoard:BaseUrl")]
    [InlineData("WorkBoard:Token")]
    [InlineData("WorkBoard:ProjectId")]
    public async Task MissingConfig_SendsNothing_AndLogsOneInformationLineWithoutTheText(string missingKey)
    {
        var values = new Dictionary<string, string?>
        {
            ["WorkBoard:BaseUrl"] = "http://board.test", ["WorkBoard:Token"] = Token, ["WorkBoard:ProjectId"] = "7",
        };
        values[missingKey] = "";
        var config = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var handler = new StubHandler(_ => throw new InvalidOperationException("must not be called"));
        var log = new CapturingLogger<VikunjaProblemReportSender>();
        var report = ProblemReportCardTests.Report(r => r.Text = "secret words");

        var result = await Sender(handler, log, config).TrySendAsync(report, CancellationToken.None);

        Assert.False(result.Sent);
        Assert.Empty(handler.Calls);
        var entry = Assert.Single(log.Entries);
        Assert.Equal(Microsoft.Extensions.Logging.LogLevel.Information, entry.Level);
        Assert.Contains(report.Id.ToString(), entry.Message);
        Assert.DoesNotContain("secret words", entry.Message);
    }

    [Fact]
    public async Task ThrowAfterTheCreateWasDispatched_IsAnUnknownOutcome()
    {
        var handler = new StubHandler(_ => throw new HttpRequestException("connection reset"));

        var result = await Sender(handler).TrySendAsync(ProblemReportCardTests.Report(), CancellationToken.None);

        Assert.False(result.Sent);
        Assert.Null(result.CardId);
        Assert.Equal(ProblemReportSendResult.UnknownOutcome, result.Error);
    }

    [Fact]
    public async Task ACancellationAfterTheCreateWasDispatched_IsAnUnknownOutcome()
    {
        var handler = new StubHandler(_ => throw new TaskCanceledException());

        var result = await Sender(handler).TrySendAsync(ProblemReportCardTests.Report(), CancellationToken.None);

        Assert.Equal(ProblemReportSendResult.UnknownOutcome, result.Error);
    }

    [Fact]
    public async Task A5xxOnTheCreate_IsAnUnknownOutcome_AndA4xxIsTheNumericStatus()
    {
        var five = await Sender(new StubHandler(_ => Json(HttpStatusCode.BadGateway, "SECRETBODY"))).TrySendAsync(ProblemReportCardTests.Report(), CancellationToken.None);
        var four = await Sender(new StubHandler(_ => Json(HttpStatusCode.Unauthorized, "SECRETBODY"))).TrySendAsync(ProblemReportCardTests.Report(), CancellationToken.None);

        Assert.Equal(ProblemReportSendResult.UnknownOutcome, five.Error);
        Assert.Equal("401", four.Error);
    }

    [Fact]
    public async Task ARetryAfterAnUnknownOutcome_AdoptsTheCardTheBoardAlreadyHolds_AndSendsNoSecondCreate()
    {
        var report = ProblemReportCardTests.Report();
        var all = new List<Call>();
        var first = new StubHandler(_ => throw new HttpRequestException("reset after send"));
        var firstResult = await Sender(first).TrySendAsync(report, CancellationToken.None);
        all.AddRange(first.Calls);
        report.LastError = firstResult.Error;

        var second = new StubHandler(c => c.Method == HttpMethod.Get
            ? Json(HttpStatusCode.OK, "[{\"id\":5,\"title\":\"other [R-aaaaaaaa]\",\"project_id\":7},{\"id\":99,\"title\":\"Sample Support Co: The roster will not save. [R-3f2a9c01]\",\"project_id\":7},{\"id\":98,\"title\":\"[R-3f2a9c01]\",\"project_id\":8}]")
            : Json(HttpStatusCode.OK, "{}"));
        var retry = await Sender(second).TrySendAsync(report, CancellationToken.None);
        all.AddRange(second.Calls);

        Assert.True(retry.Sent);
        Assert.Equal(99, retry.CardId);
        Assert.Equal(1, all.Count(c => c.Method == HttpMethod.Put && c.Url.EndsWith("/projects/7/tasks")));
        var search = second.Calls[0];
        Assert.Equal(HttpMethod.Get, search.Method);
        Assert.StartsWith("http://board.test:3456/api/v1/tasks?", search.Url);
        Assert.Contains("s=R-3f2a9c01", search.Url);
        Assert.Equal($"Bearer {Token}", search.Authorization);
    }

    [Fact]
    public async Task ARetryWithNoMatchInTheSearch_CreatesTheCard()
    {
        var report = ProblemReportCardTests.Report(r => r.LastError = ProblemReportSendResult.UnknownOutcome);
        var handler = new StubHandler(c => c.Method == HttpMethod.Get ? Json(HttpStatusCode.OK, "[]") : HappyPath(c));

        var result = await Sender(handler).TrySendAsync(report, CancellationToken.None);

        Assert.True(result.Sent);
        Assert.Equal(42, result.CardId);
        Assert.Equal(1, handler.Calls.Count(c => c.Method == HttpMethod.Put && c.Url.EndsWith("/projects/7/tasks")));
    }

    [Fact]
    public async Task AFirstAttempt_DoesNotSearch()
    {
        var handler = new StubHandler(HappyPath);

        await Sender(handler).TrySendAsync(ProblemReportCardTests.Report(), CancellationToken.None);

        Assert.DoesNotContain(handler.Calls, c => c.Method == HttpMethod.Get);
    }

    [Fact]
    public async Task NothingLoggedOrReturnedHoldsTheTokenTheTextOrAResponseBody()
    {
        var log = new CapturingLogger<VikunjaProblemReportSender>();
        var report = ProblemReportCardTests.Report(r => r.Text = "TYPEDWORDS");
        var results = new List<ProblemReportSendResult>
        {
            await Sender(new StubHandler(_ => Json(HttpStatusCode.InternalServerError, $"SECRETBODY {Token} TYPEDWORDS")), log).TrySendAsync(report, CancellationToken.None),
            await Sender(new StubHandler(_ => Json(HttpStatusCode.Forbidden, $"SECRETBODY {Token} TYPEDWORDS")), log).TrySendAsync(report, CancellationToken.None),
            await Sender(new StubHandler(_ => throw new HttpRequestException($"failed {Token} TYPEDWORDS")), log).TrySendAsync(report, CancellationToken.None),
            await Sender(new StubHandler(c => c.Method == HttpMethod.Put && c.Url.EndsWith("/projects/7/tasks") ? Json(HttpStatusCode.Created, "{\"id\":42}") : Json(HttpStatusCode.BadRequest, $"SECRETBODY {Token}")), log).TrySendAsync(report, CancellationToken.None),
        };

        var everything = string.Join("\n", log.Entries.Select(e => e.Message).Concat(results.Select(r => r.Error ?? "")));
        Assert.DoesNotContain(Token, everything);
        Assert.DoesNotContain("TYPEDWORDS", everything);
        Assert.DoesNotContain("SECRETBODY", everything);
        Assert.All(results.Where(r => !r.Sent), r => Assert.Matches("^(unknown-outcome|[0-9]{3}|[A-Za-z]+)$", r.Error!));
    }
}
