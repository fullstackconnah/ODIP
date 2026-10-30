using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Odip.Api.Health;
using Xunit;

namespace Odip.Tests.Health;

/// <summary>The passwordless dev login must fail closed: Production needs a second, explicit acknowledgement.</summary>
public class DevAuthGuardTests
{
    private sealed class Env(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "Odip.Api";
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    // Literal keys on purpose: a misspelt key in the guard must fail a test.
    private static IConfiguration Config(bool devAuth, bool allowInProd) => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["DEV_AUTH_ENABLED"] = devAuth ? "TRUE" : null,
            ["DEV_AUTH_ALLOW_IN_PRODUCTION"] = allowInProd ? "true" : null,
        })
        .Build();

    [Fact]
    public void Production_with_dev_auth_and_no_acknowledgement_refuses_to_start()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => DevAuthGuard.EnsureAllowed(Config(true, false), new Env(Environments.Production)));
        Assert.Contains("DEV_AUTH_ENABLED", ex.Message);
        Assert.Contains("DEV_AUTH_ALLOW_IN_PRODUCTION", ex.Message);
    }

    [Fact]
    public void Production_with_the_flag_from_json_config_refuses_to_start()
    {
        // The appsettings route: ServiceAgreementDraftsController reads the flag through IConfiguration too.
        var json = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("""{ "DEV_AUTH_ENABLED": "true" }"""));
        var config = new ConfigurationBuilder().AddJsonStream(json).Build();
        Assert.Throws<InvalidOperationException>(
            () => DevAuthGuard.EnsureAllowed(config, new Env(Environments.Production)));
    }

    [Theory]
    [InlineData("Production", true, true)]
    [InlineData("Production", false, false)]
    [InlineData("Production", false, true)]
    [InlineData("Development", true, false)]
    [InlineData("Staging", true, false)]
    public void Other_combinations_start(string environment, bool devAuth, bool allowInProd)
        => DevAuthGuard.EnsureAllowed(Config(devAuth, allowInProd), new Env(environment));
}
