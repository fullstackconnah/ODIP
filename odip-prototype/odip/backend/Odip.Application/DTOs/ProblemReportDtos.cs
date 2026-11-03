namespace Odip.Application.DTOs;

/// <summary>What the browser sends. Everything else on the report (reporter, organisation, browser) is read by the server itself.</summary>
public sealed record ProblemReportRequest(string? Text, string? PagePath, string? AppVersion);

/// <summary>"Sent" when the Work Board card exists, "Saved" when the report is kept and will be sent shortly.</summary>
public sealed record ProblemReportCreated(Guid Id, string Status);
