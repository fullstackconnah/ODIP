using Microsoft.AspNetCore.Cors.Infrastructure;

namespace Odip.Api.Middleware;

/// <summary>
/// The CORS policy the API runs with (Program.cs registers it as the default policy). It lives here, not inline in Program.cs, so a test can read it:
/// Program.cs needs Postgres, Firebase and a JWT secret to start, so no test can run the real pipeline.
/// </summary>
public static class ApiCorsPolicy
{
    public static void Configure(CorsPolicyBuilder policy, string[] allowedOrigins) =>
        policy.WithOrigins(allowedOrigins)
              .WithHeaders("Authorization", "Content-Type", "Accept", "X-Requested-With", "X-View-As-Tenant", "X-View-As-User")
              .WithMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
              // A browser hides every response header outside the CORS-safelisted few from a page on another origin unless it is listed. Retry-After is the
              // wait behind a 429 (the "login" flood limiter's, or the "api" limiter's), and the sign-in page says "N minutes" from it. The claim file download names its batch and its file in the other two.
              .WithExposedHeaders("Retry-After", "X-Claim-Batch-Id", "Content-Disposition")
              .AllowCredentials();
}
