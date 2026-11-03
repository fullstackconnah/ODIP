using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Odip.Application.Interfaces;
using Odip.Application.ProblemReports;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.ProblemReports;

/// <summary>The Work Board (Vikunja) connection, read from <c>WorkBoard:*</c>. Null when the base URL, token or project is missing.</summary>
internal sealed record WorkBoardSettings(string BaseUrl, string Token, long ProjectId, long? ViewId, long? BucketId, long? LabelId)
{
    public static WorkBoardSettings? From(IConfiguration config)
    {
        var baseUrl = config["WorkBoard:BaseUrl"];
        var token = config["WorkBoard:Token"];
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(token) || !long.TryParse(config["WorkBoard:ProjectId"], out var project))
            return null;
        return new WorkBoardSettings(baseUrl.TrimEnd('/'), token, project, Id(config["WorkBoard:ViewId"]), Id(config["WorkBoard:BucketId"]), Id(config["WorkBoard:LabelId"]));
    }

    private static long? Id(string? value) => long.TryParse(value, out var id) ? id : null;
}

/// <summary>
/// Creates the card with the Vikunja API: create the task, then (best effort) label it and move it to the Ideas bucket.
/// An answer that never arrived after the create was dispatched is an unknown outcome: the card may exist, so the next try
/// searches for the report's reference in the title and adopts a match before it creates again. Only the report id and a
/// numeric status or exception type name are ever logged or returned, never the text, the token or a response body.
/// </summary>
public sealed class VikunjaProblemReportSender : IProblemReportSender
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly ILogger<VikunjaProblemReportSender> _logger;

    public VikunjaProblemReportSender(HttpClient http, IConfiguration config, ILogger<VikunjaProblemReportSender> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
    }

    public async Task<ProblemReportSendResult> TrySendAsync(ProblemReport report, CancellationToken ct)
    {
        var board = WorkBoardSettings.From(_config);
        if (board is null)
        {
            _logger.LogInformation("Work Board is not configured; problem report {ReportId} stays saved", report.Id);
            return new ProblemReportSendResult(false, null, ProblemReportSendResult.NotConfigured);
        }

        var dispatched = false;
        try
        {
            if (report.Attempts > 0 || report.LastError is not null) // any retry searches first: an earlier attempt may have made the card without recording it
            {
                dispatched = true; // a search that fails leaves the outcome as unknown, so the next try searches again
                var found = await FindExistingCardAsync(board, report, ct);
                if (found is { } existing)
                {
                    await DecorateAsync(board, existing, ct);
                    return new ProblemReportSendResult(true, existing, null);
                }
                dispatched = false;
            }

            using var create = Request(board, HttpMethod.Put, $"/api/v1/projects/{board.ProjectId}/tasks",
                JsonContent.Create(new { title = ProblemReportCard.CardTitle(report), description = ProblemReportCard.CardHtml(report) }));
            dispatched = true;
            using var response = await _http.SendAsync(create, ct);
            var status = (int)response.StatusCode;
            if (status >= 500) return Unknown(report, status);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Work Board refused problem report {ReportId} with status {Status}", report.Id, status);
                return new ProblemReportSendResult(false, null, status.ToString());
            }

            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if (!json.RootElement.TryGetProperty("id", out var idElement) || !idElement.TryGetInt64(out var cardId))
                return Unknown(report, status);

            await DecorateAsync(board, cardId, ct);
            return new ProblemReportSendResult(true, cardId, null);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Work Board call for problem report {ReportId} failed with {ErrorType}", report.Id, ex.GetType().Name);
            return new ProblemReportSendResult(false, null, dispatched ? ProblemReportSendResult.UnknownOutcome : ex.GetType().Name);
        }
    }

    private ProblemReportSendResult Unknown(ProblemReport report, int status)
    {
        _logger.LogWarning("Work Board answered problem report {ReportId} with status {Status}; the card may exist", report.Id, status);
        return new ProblemReportSendResult(false, null, ProblemReportSendResult.UnknownOutcome);
    }

    /// <summary>Global search by the title's reference; the project is matched client side because the filter syntax is not relied on.</summary>
    private async Task<long?> FindExistingCardAsync(WorkBoardSettings board, ProblemReport report, CancellationToken ct)
    {
        var reference = $"R-{report.Id.ToString("D")[..8]}";
        using var request = Request(board, HttpMethod.Get, $"/api/v1/tasks?s={Uri.EscapeDataString(reference)}&per_page=50", null);
        using var response = await _http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        if (json.RootElement.ValueKind != JsonValueKind.Array) return null;
        foreach (var task in json.RootElement.EnumerateArray())
        {
            if (task.TryGetProperty("project_id", out var project) && project.TryGetInt64(out var projectId) && projectId == board.ProjectId
                && task.TryGetProperty("title", out var title) && title.GetString()?.Contains(ProblemReportCard.Ref(report), StringComparison.Ordinal) == true
                && task.TryGetProperty("id", out var id) && id.TryGetInt64(out var cardId))
                return cardId;
        }
        return null;
    }

    /// <summary>Label and bucket are a nicety: the card already exists, so a failure here changes nothing.</summary>
    private async Task DecorateAsync(WorkBoardSettings board, long cardId, CancellationToken ct)
    {
        try
        {
            if (board.LabelId is { } label)
            {
                using var request = Request(board, HttpMethod.Put, $"/api/v1/tasks/{cardId}/labels", JsonContent.Create(new { label_id = label }));
                using var _ = await _http.SendAsync(request, ct);
            }
            if (board.ViewId is { } view && board.BucketId is { } bucket)
            {
                using var request = Request(board, HttpMethod.Post, $"/api/v1/projects/{board.ProjectId}/views/{view}/buckets/{bucket}/tasks", JsonContent.Create(new { task_id = cardId }));
                using var _ = await _http.SendAsync(request, ct);
            }
        }
        catch (Exception ex)
        {
            _logger.LogInformation("Work Board label or bucket for card {CardId} failed with {ErrorType}", cardId, ex.GetType().Name);
        }
    }

    private static HttpRequestMessage Request(WorkBoardSettings board, HttpMethod method, string path, HttpContent? content) =>
        new(method, board.BaseUrl + path)
        {
            Content = content,
            Headers = { Authorization = new AuthenticationHeaderValue("Bearer", board.Token) },
        };
}
