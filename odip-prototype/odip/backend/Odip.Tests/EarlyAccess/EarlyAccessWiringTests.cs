using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Interfaces;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.EarlyAccess;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>
/// Program.cs registers the early-access services through AddEarlyAccess(); these tests run that exact method, so a dropped
/// registration or a second notifier instance (a queue nobody drains) fails here rather than at the first real submission.
/// </summary>
public class EarlyAccessWiringTests
{
    private sealed class AnonymousTenant : ICurrentTenant
    {
        public Guid? TenantId => null;
        public bool IsSuperAdmin => false;
        public Guid? ViewAsUserId => null;
    }

    private static ServiceProvider Build()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(Guid.NewGuid().ToString()));
        services.AddScoped<ICurrentTenant, AnonymousTenant>();
        services.AddEarlyAccess();
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
    }

    [Fact]
    public void TheNotifier_IsOneSingleton_ThatIsAlsoTheHostedService()
    {
        using var provider = Build();

        var notifier = provider.GetRequiredService<IEarlyAccessNotifier>();

        Assert.Same(notifier, provider.GetRequiredService<EarlyAccessNotifier>());
        var hosted = Assert.Single(provider.GetServices<IHostedService>().OfType<EarlyAccessNotifier>());
        Assert.Same(notifier, hosted);
    }

    [Fact]
    public void TheController_CanBeActivatedFromTheRegisteredServices()
    {
        using var provider = Build();
        using var scope = provider.CreateScope();

        var controller = ActivatorUtilities.CreateInstance<EarlyAccessController>(scope.ServiceProvider);

        Assert.NotNull(controller);
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<EarlyAccessService>());
    }
}
