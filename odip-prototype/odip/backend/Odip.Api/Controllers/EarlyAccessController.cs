using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.EarlyAccess;
using Odip.Application.Interfaces;
using Odip.Infrastructure.EarlyAccess;

namespace Odip.Api.Controllers;

/// <summary>
/// Public intake for the landing page's early-access form. Anonymous: it carries no principal, no tenant and
/// no bearer token, and it never reads <c>ICurrentTenant</c> — <c>X-View-As-Tenant</c>/<c>X-View-As-User</c>
/// and any tenant claim are ignored, and the stored rows are not tenant-scoped (see
/// <see cref="Odip.Domain.Entities.EarlyAccessRequest"/>).
///
/// Contract (the landing page is built against it):
/// <list type="bullet">
/// <item>202 <c>{ "status": "received" }</c> for any valid request — including an address already on file
/// (never revealed) and a filled honeypot (silently dropped, nothing stored).</item>
/// <item>400 ValidationProblemDetails whose <c>errors</c> are keyed <c>name</c>, <c>organisation</c>, <c>email</c>.</item>
/// <item>413 when the body exceeds <see cref="MaxBodyBytes"/>; 415 when it is not JSON.</item>
/// <item>429 with <c>Retry-After</c> from <see cref="EarlyAccessRateLimiting"/> (5 per client IP per 10 minutes plus
/// a global cap), applied by the limiter before this action runs.</item>
/// <item>500 with the generic ExceptionHandlingMiddleware body for anything unexpected.</item>
/// </list>
/// </summary>
[ApiController]
[AllowAnonymous]
[Route(RoutePath)]
public class EarlyAccessController : ControllerBase
{
    public const string RoutePath = "api/public/early-access";

    /// <summary>The request body limit the contract promises: 4 KB of JSON.</summary>
    public const int MaxBodyBytes = 4096;

    private const string UnexpectedErrorMessage = "An unexpected error occurred. Please try again later.";

    private readonly EarlyAccessService _service;
    private readonly IEarlyAccessNotifier _notifier;
    private readonly ILogger<EarlyAccessController> _logger;

    public EarlyAccessController(EarlyAccessService service, IEarlyAccessNotifier notifier, ILogger<EarlyAccessController> logger)
    {
        _service = service;
        _notifier = notifier;
        _logger = logger;
    }

    [HttpPost]
    [EarlyAccessRateLimit]
    [Consumes("application/json")]
    [RequestSizeLimit(MaxBodyBytes)]
    [ProducesResponseType(typeof(EarlyAccessReceivedDto), StatusCodes.Status202Accepted)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<IActionResult> Submit(
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] EarlyAccessRequestDto? request,
        CancellationToken ct)
    {
        // Honeypot first, before validation: a bot that fills every input should see the same 202 whether
        // or not its other values were well-formed, and learn nothing from a 400.
        if (!string.IsNullOrWhiteSpace(request?.Website))
        {
            _logger.LogInformation("Early-access honeypot field was filled; request dropped without storing anything");
            return Accepted(EarlyAccessReceivedDto.Received);
        }

        var checkedRequest = EarlyAccessRequestValidator.Validate(request);
        if (!checkedRequest.IsValid)
        {
            return ValidationProblem(new ValidationProblemDetails(checkedRequest.Errors)
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "One or more validation errors occurred.",
                Type = "https://tools.ietf.org/html/rfc9110#section-15.5.1",
            });
        }

        EarlyAccessRecordResult result;
        try
        {
            result = await _service.RecordAsync(checkedRequest.Name, checkedRequest.Organisation, checkedRequest.Email, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // The visitor went away before anything was written (the write itself ignores cancellation). Nobody is
            // left to answer, so no error log and no 500 for a closed connection; 499 is the conventional "client
            // closed request" status and only ever lands in access logs.
            return StatusCode(499);
        }
        catch (Exception ex)
        {
            // The contract says a storage failure is a generic 500. Returning it here, rather than letting it
            // reach ExceptionHandlingMiddleware, keeps it a 500 whatever the exception type: the middleware maps
            // InvalidOperationException (which EF raises for some transient faults) to a 400.
            _logger.LogError(ex, "Could not store an early-access request");
            return StatusCode(StatusCodes.Status500InternalServerError, ApiResponse<object>.Fail(UnexpectedErrorMessage));
        }

        // Only a first-time address is worth an email. The notifier queues and returns at once, so the response
        // is the same 202 in the same time whichever branch ran. The row is already stored: a notifier fault must
        // not turn this into an error for the visitor.
        if (result.Outcome == EarlyAccessOutcome.Created)
        {
            try
            {
                _notifier.NotifyNewRequest(new EarlyAccessNotification(
                    checkedRequest.Name, checkedRequest.Organisation, checkedRequest.Email, result.RequestedAtUtc));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Early-access notification could not be queued; the request itself was stored");
            }
        }

        return Accepted(EarlyAccessReceivedDto.Received);
    }
}
