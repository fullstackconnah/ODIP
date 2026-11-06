using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Integrations;

namespace Odip.Api.Controllers;

/// <summary>
/// Address lookup for the address fields: a proxy to the Google Places API (New), so the key never reaches the browser. Dark until GooglePlaces:ApiKey is set: with no key
/// both endpoints are 404 and the fields are plain inputs. The order of answers is fixed: sign-in (401), role (403) and the per-user budget (429) come before the action,
/// then no key (404), then the hand-checked input (400). It is deliberately not [ApiController], whose automatic model validation would answer 400 before the 404.
/// Suggest is a POST so the typed text sits in the body, never in a URL that a proxy could log; a place id is not personal text, so details is a GET.
/// </summary>
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
[Route("api/v1/address")]
[ServiceFilter(typeof(AddressLookupRateLimitFilter))]
public class AddressLookupController(IConfiguration config, GooglePlacesClient google) : ControllerBase
{
    private const int MinQuery = 3;
    private const int MaxQuery = 200;
    // Google's session token: at most 36 URL-safe characters. The browser makes 22.
    private static readonly Regex SessionFormat = new(@"^[A-Za-z0-9_-]{1,36}\z", RegexOptions.Compiled);
    private static readonly Regex PlaceIdFormat = new(@"^[A-Za-z0-9_-]{1,300}\z", RegexOptions.Compiled);

    [HttpPost("suggest")]
    [RequestSizeLimit(4096)]
    public async Task<IActionResult> Suggest([FromBody] AddressSuggestRequest? body, CancellationToken ct)
    {
        if (Key() is not { } key) return NotFound();
        if (body?.Q is null) return BadRequest(ApiResponse<object>.Fail("Type some of the address."));
        if (body.Session is null || !SessionFormat.IsMatch(body.Session)) return BadRequest(ApiResponse<object>.Fail("The lookup session is not valid."));
        var q = body.Q.Trim();
        if (q.Length > MaxQuery) return BadRequest(ApiResponse<object>.Fail("That address is too long to look up."));
        if (q.Length < MinQuery) return Ok(ApiResponse<IReadOnlyList<AddressSuggestionDto>>.Ok(Array.Empty<AddressSuggestionDto>()));

        // A Google failure is an empty list, never an error: the person keeps typing.
        var rows = await google.SuggestAsync(key, q, body.Session, ct) ?? Array.Empty<AddressSuggestionDto>();
        return Ok(ApiResponse<IReadOnlyList<AddressSuggestionDto>>.Ok(rows));
    }

    [HttpGet("details")]
    public async Task<IActionResult> Details([FromQuery] string? placeId, [FromQuery] string? session, CancellationToken ct)
    {
        if (Key() is not { } key) return NotFound();
        if (placeId is null || !PlaceIdFormat.IsMatch(placeId)) return BadRequest(ApiResponse<object>.Fail("That place is not valid."));
        if (session is null || !SessionFormat.IsMatch(session)) return BadRequest(ApiResponse<object>.Fail("The lookup session is not valid."));

        var details = await google.DetailsAsync(key, placeId, session, ct);
        return details is null
            ? StatusCode(StatusCodes.Status502BadGateway, ApiResponse<AddressDetailsDto>.Fail("Address details are unavailable."))
            : Ok(ApiResponse<AddressDetailsDto>.Ok(details));
    }

    /// <summary>Read per request, like the Microsoft sign-in settings. Blank or whitespace counts as unset (compose passes empty strings for unset variables).</summary>
    private string? Key() => config["GooglePlaces:ApiKey"] is { } k && !string.IsNullOrWhiteSpace(k) ? k.Trim() : null;
}
