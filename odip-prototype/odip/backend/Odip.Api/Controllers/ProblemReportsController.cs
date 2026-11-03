using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Application.ProblemReports;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// "Report a problem". Any signed-in user, ReadOnly included (ReadOnlyMiddleware exempts exactly this POST), may send one
/// note. The row is saved first; one try at the Work Board follows within four seconds; whatever happens there the
/// answer is 201: "Sent" or "Saved" (the background service retries). The reporter, organisation and browser come
/// from the server's view of the request, never from the body.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/problem-reports")]
[EnableRateLimiting("api")]
public class ProblemReportsController : ControllerBase
{
    private const int MaxText = 2000;
    private const int ReportsPerWindow = 5;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan BoardBudget = TimeSpan.FromSeconds(4);
    private static readonly TimeSpan FirstRetryDelay = TimeSpan.FromMinutes(2);

    private static readonly string ApiVersion =
        typeof(ProblemReportsController).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly IProblemReportSender _sender;
    private readonly ILogger<ProblemReportsController> _logger;

    public ProblemReportsController(OdipDbContext db, ICurrentTenant tenant, IProblemReportSender sender, ILogger<ProblemReportsController> logger)
    {
        _db = db;
        _tenant = tenant;
        _sender = sender;
        _logger = logger;
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ProblemReportRequest request, CancellationToken ct)
    {
        // A SuperAdmin viewing a tenant has TenantId set (IsSuperAdmin is false then); one with nothing in view has neither.
        if (_tenant.TenantId is not { } tenantId)
            return BadRequest(ApiResponse<object>.Fail("Choose an organisation to view first."));

        var text = (request.Text ?? string.Empty).Trim();
        if (text.Length == 0) return BadRequest(ApiResponse<object>.Fail("Write a few words about what went wrong."));
        if (text.Length > MaxText) return BadRequest(ApiResponse<object>.Fail("Keep it under 2,000 characters."));

        if (!Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return Unauthorized();

        var now = DateTime.UtcNow;
        var since = now - Window;
        if (await _db.ProblemReports.CountAsync(r => r.ReporterUserId == userId && r.CreatedAt > since, ct) >= ReportsPerWindow)
        {
            Response.Headers.RetryAfter = ((int)Window.TotalSeconds).ToString();
            return StatusCode(StatusCodes.Status429TooManyRequests, ApiResponse<object>.Fail("You've sent a few reports in a row. Try again in a few minutes."));
        }

        var organisation = await _db.Tenants.Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct);
        var report = new ProblemReport
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            ReporterUserId = userId,
            // Claims, not a Users lookup: a SuperAdmin viewing a tenant has no Users row visible there.
            ReporterName = Limit(User.FindFirst("fullName")?.Value ?? User.FindFirst(ClaimTypes.Name)?.Value, 200, "Unknown user"),
            ReporterRole = Limit(User.FindFirst(ClaimTypes.Role)?.Value, 32, "Unknown"),
            OrganisationName = Limit(organisation, 200, "Unknown organisation"),
            Text = text,
            PagePath = ProblemReportPath.Sanitise(request.PagePath),
            AppVersion = Limit(request.AppVersion, 64, "unknown"),
            ApiVersion = Limit(ApiVersion, 64, "unknown"),
            UserAgent = Limit(Request.Headers.UserAgent.ToString(), 300, "unknown"),
            Status = ProblemReportStatus.Saved,
            NextAttemptAt = now + FirstRetryDelay,
            CreatedAt = now,
        };
        _db.ProblemReports.Add(report);
        await _db.SaveChangesAsync(CancellationToken.None); // the report is kept even if the user has gone

        ProblemReportSendResult result;
        try
        {
            using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
            budget.CancelAfter(BoardBudget);
            result = await _sender.TrySendAsync(report, budget.Token);
        }
        catch (Exception)
        {
            result = new ProblemReportSendResult(false, null, ProblemReportSendResult.UnknownOutcome);
        }

        if (result.Sent)
        {
            report.Status = ProblemReportStatus.Sent;
            report.CardId = result.CardId;
            report.SentAt = DateTime.UtcNow;
        }
        else
        {
            report.LastError = result.Error is null ? null : Limit(result.Error, 500, "unknown");
        }

        try
        {
            // Without the request token: a card that was made must have its id recorded even if the user left mid-send.
            await _db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            // The report row exists, so the retry loop still has it; the user is told it is saved.
            _logger.LogWarning("Could not record the Work Board outcome for problem report {ReportId}: {ErrorType}", report.Id, ex.GetType().Name);
            return StatusCode(StatusCodes.Status201Created, ApiResponse<ProblemReportCreated>.Ok(new ProblemReportCreated(report.Id, nameof(ProblemReportStatus.Saved))));
        }

        return StatusCode(StatusCodes.Status201Created, ApiResponse<ProblemReportCreated>.Ok(new ProblemReportCreated(report.Id, report.Status.ToString())));
    }

    /// <summary>Trims, drops control characters and cuts to <paramref name="max"/>; over-long values are shortened, not refused.</summary>
    private static string Limit(string? value, int max, string fallback)
    {
        var clean = new string((value ?? string.Empty).Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (clean.Length == 0) return fallback;
        return clean.Length <= max ? clean : clean[..max];
    }
}
