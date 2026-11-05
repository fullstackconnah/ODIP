namespace Odip.Infrastructure.Data;

/// <summary>The passwordless dev login switch. Shared by the login endpoints and the seeder, so a dev-only account can never exist where dev login is off.</summary>
public static class DevAuth
{
    public static bool IsEnabled()
        => string.Equals(Environment.GetEnvironmentVariable("DEV_AUTH_ENABLED"), "true", StringComparison.OrdinalIgnoreCase);
}
