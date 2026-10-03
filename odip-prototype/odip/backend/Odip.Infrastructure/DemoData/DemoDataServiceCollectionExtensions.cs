using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Infrastructure.BackgroundServices;

namespace Odip.Infrastructure.DemoData;

public static class DemoDataServiceCollectionExtensions
{
    /// <summary>
    /// Wires the demo top-up (Program.cs calls this once). With <c>DemoData:Scenarios</c> Off, the default, and what CI and the image
    /// build use, this adds NOTHING to the host, so startup and every request behave exactly as they did without the feature. A
    /// value that is neither On nor Off (a typo) is treated as Off, and the only thing added is a hosted notice that says so in the
    /// log, because a silently ignored flag is a presenter wondering why the demo data never arrives. With it On, one
    /// <see cref="DemoDataMaintainer"/> and one <see cref="DemoDataHostedService"/> are registered.
    /// </summary>
    public static IServiceCollection AddDemoData(this IServiceCollection services, IConfiguration configuration)
    {
        var options = DemoDataOptions.FromConfiguration(configuration);

        if (!options.Enabled)
        {
            if (options.Warning is not null)
                services.AddSingleton<IHostedService>(sp => new DemoDataConfigNotice(options, sp.GetRequiredService<ILogger<DemoDataConfigNotice>>()));
            return services;
        }

        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton(options);
        services.AddSingleton(sp => new DemoDataMaintainer(options, sp.GetRequiredService<TimeProvider>(), sp.GetRequiredService<ILogger<DemoDataMaintainer>>()));
        services.AddHostedService<DemoDataHostedService>();
        return services;
    }
}

/// <summary>Logs, once at startup, that <c>DemoData:Scenarios</c> held something that is neither On nor Off and is being treated as Off, or that <c>DemoData:Packs</c> named something that is not a pack.</summary>
public sealed class DemoDataConfigNotice : IHostedService
{
    private readonly DemoDataOptions _options;
    private readonly ILogger<DemoDataConfigNotice> _logger;

    public DemoDataConfigNotice(DemoDataOptions options, ILogger<DemoDataConfigNotice> logger)
    {
        _options = options;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (_options.Warning is not null) _logger.LogWarning("{Warning}", _options.Warning);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
