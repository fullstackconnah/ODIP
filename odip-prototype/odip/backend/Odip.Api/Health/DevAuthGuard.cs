namespace Odip.Api.Health;

/// <summary>Startup guard: the passwordless dev login must never be live in Production by one wrong flag.</summary>
public static class DevAuthGuard
{
    // Reads IConfiguration (env, appsettings, command line) like every other DEV_AUTH_ENABLED reader.
    public static void EnsureAllowed(IConfiguration config, IHostEnvironment env)
    {
        var devAuthEnabled = string.Equals(config["DEV_AUTH_ENABLED"], "true", StringComparison.OrdinalIgnoreCase);
        var allowInProduction = string.Equals(config["DEV_AUTH_ALLOW_IN_PRODUCTION"], "true", StringComparison.OrdinalIgnoreCase);
        if (devAuthEnabled && env.IsProduction() && !allowInProduction)
            throw new InvalidOperationException(
                "DEV_AUTH_ENABLED=true is not allowed in the Production environment: it issues tokens without a password. " +
                "Unset DEV_AUTH_ENABLED, or also set DEV_AUTH_ALLOW_IN_PRODUCTION=true to acknowledge it on a throwaway instance.");
    }
}
