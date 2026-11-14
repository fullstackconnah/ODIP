using System.Security.Claims;

namespace Odip.Api.Services;

public static class ClaimsPrincipalExtensions
{
    /// <summary>The signed-in user's id from the NameIdentifier claim; null when the claim is missing or is not a Guid.</summary>
    public static Guid? TryGetUserId(this ClaimsPrincipal? user) =>
        Guid.TryParse(user?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
}
