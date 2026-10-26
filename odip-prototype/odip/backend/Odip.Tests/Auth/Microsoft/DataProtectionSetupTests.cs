using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Odip.Api.Services;
using Xunit;

namespace Odip.Tests.Auth.Microsoft;

// M3: the Microsoft cookies are protected with DataProtection, so a restart must not invalidate them on live (keys on a volume).
public class DataProtectionSetupTests
{
    private static IDataProtectionProvider Provider(string? keysPath)
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(keysPath is null
            ? new Dictionary<string, string?>()
            : new Dictionary<string, string?> { ["DataProtection:KeysPath"] = keysPath }).Build();
        var services = new ServiceCollection();
        DataProtectionSetup.Add(services, cfg);
        return services.BuildServiceProvider().GetRequiredService<IDataProtectionProvider>();
    }

    [Fact]
    public void KeysPathSet_PayloadSurvivesANewProvider()
    {
        var dir = Path.Combine(Path.GetTempPath(), "odip-dp-" + Guid.NewGuid().ToString("N"));
        try
        {
            var sealedText = Provider(dir).CreateProtector("p").Protect("hello");
            Assert.Equal("hello", Provider(dir).CreateProtector("p").Unprotect(sealedText));
            Assert.NotEmpty(Directory.GetFiles(dir, "*.xml"));
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    [Fact]
    public void KeysPathUnset_StillProtects_WithoutTouchingDisk()
    {
        var p = Provider(null).CreateProtector("p");
        Assert.Equal("hello", p.Unprotect(p.Protect("hello")));
    }
}
