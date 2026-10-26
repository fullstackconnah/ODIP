using Microsoft.AspNetCore.DataProtection;

namespace Odip.Api.Services;

public static class DataProtectionSetup
{
    /// <summary>Persists the keys only when DataProtection:KeysPath is set (live mounts a volume), so a restart does not sign everyone out of the Microsoft flow.</summary>
    public static void Add(IServiceCollection services, IConfiguration config)
    {
        var builder = services.AddDataProtection().SetApplicationName("odip");
        var path = config["DataProtection:KeysPath"];
        if (!string.IsNullOrWhiteSpace(path)) builder.PersistKeysToFileSystem(new DirectoryInfo(path));
    }
}
