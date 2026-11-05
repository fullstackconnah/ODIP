using Microsoft.AspNetCore.Mvc;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

public partial class AuthControllerExchangeTests
{
    [Fact]
    public async Task Dev_login_as_demo_admin_returns_an_Admin_token_for_the_Demo_tenant()
    {
        var previous = Environment.GetEnvironmentVariable("DEV_AUTH_ENABLED");
        Environment.SetEnvironmentVariable("DEV_AUTH_ENABLED", "true");
        try
        {
            using var db = TestDb.Create();
            await DbSeeder.SeedAsync(db, CancellationToken.None);

            var result = await CreateController(db, "ignored@acme.example.com").DevLogin(new DevLoginDto { Username = "demo.admin" }, CancellationToken.None);

            var data = Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
            Assert.Equal("Admin", data.Role);
            Assert.Equal(Guid.Parse("b0000000-0000-0000-0000-000000000001"), data.TenantId);
        }
        finally
        {
            Environment.SetEnvironmentVariable("DEV_AUTH_ENABLED", previous);
        }
    }
}
