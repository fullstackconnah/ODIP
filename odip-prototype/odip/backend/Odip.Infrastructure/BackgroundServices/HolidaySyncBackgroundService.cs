using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Application.Interfaces;

namespace Odip.Infrastructure.BackgroundServices;

public class HolidaySyncBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<HolidaySyncBackgroundService> _logger;

    public HolidaySyncBackgroundService(
        IServiceScopeFactory scopeFactory,
        IConfiguration config,
        ILogger<HolidaySyncBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunSyncAsync(GetFromYear(), DateTime.UtcNow.Year + 1, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var nextRun = GetNextRunDate();
            _logger.LogInformation("Next holiday sync scheduled for {NextRun:yyyy-MM-dd}", nextRun);

            try
            {
                // Task.Delay max is ~24.8 days; poll in 6-hour chunks until the target time
                var maxChunk = TimeSpan.FromHours(6);
                while (!stoppingToken.IsCancellationRequested)
                {
                    var remaining = nextRun - DateTime.UtcNow;
                    if (remaining <= TimeSpan.Zero) break;
                    await Task.Delay(remaining < maxChunk ? remaining : maxChunk, stoppingToken);
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }

            if (!stoppingToken.IsCancellationRequested)
                await RunSyncAsync(DateTime.UtcNow.Year, DateTime.UtcNow.Year + 1, stoppingToken);
        }
    }

    private async Task RunSyncAsync(int fromYear, int toYear, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var syncService = scope.ServiceProvider.GetRequiredService<IPublicHolidaySyncService>();

        _logger.LogInformation("Running holiday sync from {From} to {To}", fromYear, toYear);

        try
        {
            var result = await syncService.SyncAsync(fromYear, toYear, ct);
            _logger.LogInformation(
                "Holiday sync complete: {Years} years, {Added} added, {Updated} updated",
                result.YearsProcessed, result.HolidaysAdded, result.HolidaysUpdated);

            foreach (var err in result.Errors)
                _logger.LogWarning("Holiday sync error: {Error}", err);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Holiday sync failed unexpectedly");
        }
    }

    private int GetFromYear() => _config.GetValue<int>("HolidaySync:FromYear", 2025);

    private DateTime GetNextRunDate()
    {
        var month = _config.GetValue<int>("HolidaySync:ScheduleMonth", 11);
        var day = _config.GetValue<int>("HolidaySync:ScheduleDay", 1);
        var now = DateTime.UtcNow;
        var next = new DateTime(now.Year, month, day, 2, 0, 0, DateTimeKind.Utc);
        return next <= now ? next.AddYears(1) : next;
    }
}
