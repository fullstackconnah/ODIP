using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Services;

public class PublicHolidaySyncServiceTests
{
    private static OdipDbContext CreateDb() => TestDb.Create();

    [Fact]
    public async Task SyncAsync_WithNoExistingHolidays_AddsAll()
    {
        using var db = CreateDb();
        var provider = new Mock<IHolidayProvider>();
        provider.Setup(p => p.GetHolidaysAsync(2025, "AU")).ReturnsAsync([
            new HolidayRecord(new DateOnly(2025, 1, 1), "New Year's Day", []),
            new HolidayRecord(new DateOnly(2025, 12, 25), "Christmas Day", []),
            new HolidayRecord(new DateOnly(2025, 11, 4), "Melbourne Cup Day", ["AU-VIC"]),
        ]);

        var service = new PublicHolidaySyncService(db, provider.Object);

        var result = await service.SyncAsync(2025, 2025);

        Assert.Equal(1, result.YearsProcessed);
        Assert.Equal(3, result.HolidaysAdded);
        Assert.Equal(0, result.HolidaysUpdated);
        Assert.Empty(result.Errors);

        var saved = await db.PublicHolidays.ToListAsync();
        Assert.Equal(3, saved.Count);
        Assert.Contains(saved, h => h.Date == new DateOnly(2025, 1, 1) && h.State == null);
        Assert.Contains(saved, h => h.Date == new DateOnly(2025, 11, 4) && h.State == "VIC");
    }

    [Fact]
    public async Task SyncAsync_MultiCountyHoliday_CreatesSeparateRowsPerState()
    {
        using var db = CreateDb();
        var provider = new Mock<IHolidayProvider>();
        provider.Setup(p => p.GetHolidaysAsync(2025, "AU")).ReturnsAsync([
            new HolidayRecord(new DateOnly(2025, 6, 9), "King's Birthday", ["AU-VIC", "AU-NSW"]),
        ]);

        var service = new PublicHolidaySyncService(db, provider.Object);

        var result = await service.SyncAsync(2025, 2025);

        Assert.Equal(2, result.HolidaysAdded);
        var saved = await db.PublicHolidays.ToListAsync();
        Assert.Contains(saved, h => h.Date == new DateOnly(2025, 6, 9) && h.State == "VIC");
        Assert.Contains(saved, h => h.Date == new DateOnly(2025, 6, 9) && h.State == "NSW");
    }

    [Fact]
    public async Task SyncAsync_ExistingHolidayWithSameName_SkipsUpdate()
    {
        using var db = CreateDb();
        db.PublicHolidays.Add(new Odip.Domain.Entities.PublicHoliday
        {
            Id = Guid.NewGuid(),
            Date = new DateOnly(2025, 1, 1),
            Name = "New Year's Day",
            State = null
        });
        await db.SaveChangesAsync();

        var provider = new Mock<IHolidayProvider>();
        provider.Setup(p => p.GetHolidaysAsync(2025, "AU")).ReturnsAsync([
            new HolidayRecord(new DateOnly(2025, 1, 1), "New Year's Day", []),
        ]);

        var service = new PublicHolidaySyncService(db, provider.Object);

        var result = await service.SyncAsync(2025, 2025);

        Assert.Equal(0, result.HolidaysAdded);
        Assert.Equal(0, result.HolidaysUpdated);
    }

    [Fact]
    public async Task SyncAsync_ExistingHolidayWithDifferentName_UpdatesName()
    {
        using var db = CreateDb();
        db.PublicHolidays.Add(new Odip.Domain.Entities.PublicHoliday
        {
            Id = Guid.NewGuid(),
            Date = new DateOnly(2025, 1, 27),
            Name = "Australia Day",
            State = null
        });
        await db.SaveChangesAsync();

        var provider = new Mock<IHolidayProvider>();
        provider.Setup(p => p.GetHolidaysAsync(2025, "AU")).ReturnsAsync([
            new HolidayRecord(new DateOnly(2025, 1, 27), "Australian National Day", []),
        ]);

        var service = new PublicHolidaySyncService(db, provider.Object);

        var result = await service.SyncAsync(2025, 2025);

        Assert.Equal(0, result.HolidaysAdded);
        Assert.Equal(1, result.HolidaysUpdated);
        Assert.Equal("Australian National Day", db.PublicHolidays.First().Name);
    }

    [Fact]
    public async Task SyncAsync_ProviderThrowsForOneYear_ReturnsErrorAndContinues()
    {
        using var db = CreateDb();
        var provider = new Mock<IHolidayProvider>();
        provider.Setup(p => p.GetHolidaysAsync(2025, "AU"))
            .ThrowsAsync(new InvalidOperationException("API unavailable"));
        provider.Setup(p => p.GetHolidaysAsync(2026, "AU")).ReturnsAsync([
            new HolidayRecord(new DateOnly(2026, 1, 1), "New Year's Day", []),
        ]);

        var service = new PublicHolidaySyncService(db, provider.Object);

        var result = await service.SyncAsync(2025, 2026);

        Assert.Single(result.Errors);
        Assert.Contains("2025", result.Errors[0]);
        Assert.Equal(1, result.HolidaysAdded);
        Assert.Equal(1, result.YearsProcessed);
    }
}
