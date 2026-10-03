using Microsoft.AspNetCore.Cors.Infrastructure;
using Odip.Api.Middleware;
using Xunit;

namespace Odip.Tests.Middleware;

/// <summary>
/// The API's CORS policy, read as built. Program.cs cannot be started in a test (it needs Postgres, Firebase and a JWT secret), so the policy is
/// configured by <see cref="ApiCorsPolicy"/>, which this reads.
/// </summary>
public class ApiCorsPolicyTests
{
    private static readonly string[] Origins = ["http://localhost:5173", "http://localhost:3000"];

    private static CorsPolicy Build()
    {
        var builder = new CorsPolicyBuilder();
        ApiCorsPolicy.Configure(builder, Origins);
        return builder.Build();
    }

    [Fact]
    public void A_page_on_another_origin_may_read_Retry_After_so_the_sign_in_page_can_say_how_long_to_wait()
    {
        // A browser hides every response header outside the CORS-safelisted few from a page on another origin unless the policy lists it. The sign-in
        // page reads Retry-After from a 429 (the API's other 429s carry it too); without this, a front end served from another origin (the local dev
        // setup, VITE_API_BASE_URL) says "a few minutes" instead of the number. Same-origin production never needed it.
        Assert.Contains("Retry-After", Build().ExposedHeaders, StringComparer.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_rest_of_the_policy_is_as_it_was_the_listed_origins_headers_and_methods_with_credentials()
    {
        var policy = Build();

        Assert.False(policy.AllowAnyOrigin);
        Assert.Equal(Origins, policy.Origins);
        Assert.Equal(["Authorization", "Content-Type", "Accept", "X-Requested-With", "X-View-As-Tenant", "X-View-As-User"], policy.Headers);
        Assert.Equal(["GET", "POST", "PUT", "DELETE", "OPTIONS"], policy.Methods);
        Assert.True(policy.SupportsCredentials);
    }
}
