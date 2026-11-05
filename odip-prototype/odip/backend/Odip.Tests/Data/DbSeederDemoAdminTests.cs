using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>The E2E organisation Admin (demo.admin) exists only where dev login is on; live seeds without it.</summary>
[Collection(DevAuthEnvCollection.Name)]
public class DbSeederDemoAdminTests : IDisposable
{
    private static readonly Guid DemoTenantId = Guid.Parse("b0000000-0000-0000-0000-000000000001");
    private readonly string? _previous = Environment.GetEnvironmentVariable("DEV_AUTH_ENABLED");

    public void Dispose() => Environment.SetEnvironmentVariable("DEV_AUTH_ENABLED", _previous);

    [Fact]
    public async Task With_dev_auth_on_one_Admin_is_seeded_in_Demo_and_a_second_run_adds_none()
    {
        Environment.SetEnvironmentVariable("DEV_AUTH_ENABLED", "true");
        using var db = TestDb.Create();
        await DbSeeder.SeedAsync(db, CancellationToken.None);
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        var admin = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Username == "demo.admin");
        Assert.Equal(UserRole.Admin, admin.Role);
        Assert.Equal(DemoTenantId, admin.TenantId);
        Assert.True(admin.IsActive);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("false")]
    public async Task With_dev_auth_off_there_is_no_demo_admin(string? flag)
    {
        Environment.SetEnvironmentVariable("DEV_AUTH_ENABLED", flag);
        using var db = TestDb.Create();
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        Assert.False(await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Username == "demo.admin"));
    }
}
