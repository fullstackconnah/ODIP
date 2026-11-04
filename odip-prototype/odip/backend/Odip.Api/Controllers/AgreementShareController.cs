using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>Keeps every answer of the emailed-link routes out of search engines, caches, referrers and frames, whatever the status.</summary>
[AttributeUsage(AttributeTargets.Class)]
public sealed class AgreementShareHeadersAttribute : ResultFilterAttribute
{
    public override void OnResultExecuting(ResultExecutingContext context)
    {
        var headers = context.HttpContext.Response.Headers;
        headers["X-Robots-Tag"] = "noindex, nofollow";
        headers["Cache-Control"] = "no-store";
        headers["Referrer-Policy"] = "no-referrer";
        headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
    }
}

/// <summary>
/// The page behind the link in the agreement email, reached by someone with no ODIP account and authenticated only by the token. The tenant and participant come from the share row:
/// this controller never reads ICurrentTenant (empty here) and never honours X-View-As-*. Every failure (no such token, expired, revoked, never delivered, another organisation's)
/// is the same 404 with one message, so a probing caller learns nothing. The signed-in endpoints live on ServiceAgreementDraftsController, never here.
/// </summary>
[ApiController]
[AllowAnonymous]
[AgreementShareHeaders]
[Route("api/v1/public/agreement-share")]
[EnableRateLimiting("public")]
public class AgreementShareController : ControllerBase
{
    private const string NotFoundMessage = "This link is not valid.";
    private readonly AgreementShareService _share;

    public AgreementShareController(AgreementShareService share) => _share = share;

    /// <summary>The agreement as the link shows it. The first successful read notes that the link was opened.</summary>
    [HttpGet("{token}")]
    public async Task<ActionResult<ApiResponse<SharedAgreementDto>>> Get(string token, CancellationToken ct)
    {
        var view = await _share.ViewAsync(token, ct);
        return view is null ? NotFound(ApiResponse<SharedAgreementDto>.Fail(NotFoundMessage)) : Ok(ApiResponse<SharedAgreementDto>.Ok(view));
    }

    /// <summary>The agreement PDF the contact is sent (it carries the participant's NDIS number, as the agreement does).</summary>
    [HttpGet("{token}/pdf")]
    public async Task<IActionResult> Pdf(string token, CancellationToken ct)
    {
        var pdf = await _share.PdfAsync(token, ct);
        return pdf is null ? NotFound(ApiResponse<object>.Fail(NotFoundMessage)) : File(pdf.Content, "application/pdf", pdf.FileName);
    }
}
