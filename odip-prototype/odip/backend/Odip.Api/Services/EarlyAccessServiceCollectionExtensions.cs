using Odip.Application.Interfaces;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.EarlyAccess;

namespace Odip.Api.Services;

public static class EarlyAccessServiceCollectionExtensions
{
    /// <summary>
    /// Registers the public early-access form's services: <see cref="EarlyAccessService"/> (stores the request) and
    /// <see cref="EarlyAccessNotifier"/>, the opt-in operator email. The notifier must be ONE singleton seen three
    /// ways — concrete type, <see cref="IEarlyAccessNotifier"/> (what the controller enqueues on) and the hosted
    /// service that drains its queue — or the controller would fill a queue nobody reads. Also the hourly
    /// <see cref="EarlyAccessPurgeBackgroundService"/> (each sign-up deleted 12 months after it was first sent).
    /// </summary>
    public static IServiceCollection AddEarlyAccess(this IServiceCollection services)
    {
        services.AddScoped<EarlyAccessService>();
        services.AddSingleton<EarlyAccessNotifier>();
        services.AddSingleton<IEarlyAccessNotifier>(sp => sp.GetRequiredService<EarlyAccessNotifier>());
        services.AddHostedService(sp => sp.GetRequiredService<EarlyAccessNotifier>());
        services.AddHostedService<EarlyAccessPurgeBackgroundService>();
        return services;
    }
}
