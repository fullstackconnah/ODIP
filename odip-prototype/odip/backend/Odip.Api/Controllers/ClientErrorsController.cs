using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;

namespace Odip.Api.Controllers;

/// <summary>
/// A front-end crash reaches the API log. Any signed-in user, ReadOnly included (ReadOnlyMiddleware exempts exactly this POST), may send one;
/// nothing is stored. The user and organisation come from the request, and CR/LF are stripped from the two values that sit in the log line
/// so a crafted report cannot forge another one.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/client-errors")]
[EnableRateLimiting("api")]
public class ClientErrorsController : ControllerBase
{
    private static readonly string[] Kinds = ["boundary", "error", "rejection"];

    private readonly ICurrentTenant _tenant;
    private readonly ILogger<ClientErrorsController> _logger;

    public ClientErrorsController(ICurrentTenant tenant, ILogger<ClientErrorsController> logger)
    {
        _tenant = tenant;
        _logger = logger;
    }

    [HttpPost]
    [RequestSizeLimit(16_384)]
    public IActionResult Report([FromBody] ClientErrorRequest request)
    {
        var message = Line(request.Message, 500);
        if (message.Length == 0) return BadRequest(ApiResponse<object>.Fail("A message is required."));
        var kind = (request.Kind ?? string.Empty).Trim().ToLowerInvariant();
        if (!Kinds.Contains(kind)) return BadRequest(ApiResponse<object>.Fail("Unknown kind."));

        var userId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : (Guid?)null;
        // The stacks and ids ride in a scope, not the message template, so a stack with line breaks cannot forge a log line.
        using (_logger.BeginScope(new Dictionary<string, object?> { ["UserId"] = userId, ["TenantId"] = _tenant.TenantId, ["Stack"] = Cut(request.Stack, 4000), ["ComponentStack"] = Cut(request.ComponentStack, 4000) }))
            _logger.LogWarning("Client error {Kind} at {Path}: {Message}", kind, Line(request.Path, 200), message);
        return NoContent();
    }

    private static string Cut(string? value, int max) => value is { Length: > 0 } v && v.Length > max ? v[..max] : value ?? string.Empty;

    private static string Line(string? value, int max) => Cut(new string((value ?? string.Empty).Where(c => !char.IsControl(c)).ToArray()).Trim(), max);
}
