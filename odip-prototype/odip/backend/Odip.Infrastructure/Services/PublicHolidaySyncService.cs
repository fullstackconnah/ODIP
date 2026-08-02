using Microsoft.EntityFrameworkCore;
using Odip.Application.Interfaces;
using Odip.Application.Models;
using Odip.Infrastructure.Data;
using DomainHoliday = Odip.Domain.Entities.PublicHoliday;

namespace Odip.Infrastructure.Services;

public class PublicHolidaySyncService : IPublicHolidaySyncService
{
    private readonly OdipDbContext _db;
    private readonly IHolidayProvider _provider;

    public PublicHolidaySyncService(OdipDbContext db, IHolidayProvider provider)
    {
        _db = db;
        _provider = provider;
    }

    public async Task<SyncResult> SyncAsync(int fromYear, int toYear, CancellationToken ct = default)
    {
        var errors = new List<string>();
        var totalAdded = 0;
        var totalUpdated = 0;
        var yearsProcessed = 0;

        for (var year = fromYear; year <= toYear; year++)
        {
            try
            {
                var (added, updated) = await SyncYearAsync(year, ct);
                totalAdded += added;
                totalUpdated += updated;
                yearsProcessed++;
            }
            catch (Exception ex)
            {
                errors.Add($"Year {year}: {ex.Message}");
            }
        }

        return new SyncResult(yearsProcessed, totalAdded, totalUpdated, [.. errors]);
    }

    private async Task<(int Added, int Updated)> SyncYearAsync(int year, CancellationToken ct)
    {
        var holidays = await _provider.GetHolidaysAsync(year, "AU");
        var incoming = holidays
            .SelectMany(h => h.Counties.Length == 0
                ? (IEnumerable<DomainHoliday>)[new DomainHoliday { Date = h.Date, Name = h.Name, State = null }]
                : h.Counties.Select(c => new DomainHoliday { Date = h.Date, Name = h.Name, State = c.StartsWith("AU-") ? c[3..] : c }))
            .ToList();

        var existing = await _db.PublicHolidays
            .Where(h => h.Date.Year == year)
            .ToListAsync(ct);

        var added = 0;
        var updated = 0;

        foreach (var holiday in incoming)
        {
            var match = existing.FirstOrDefault(e => e.Date == holiday.Date && e.State == holiday.State);

            if (match is null)
            {
                holiday.Id = Guid.NewGuid();
                _db.PublicHolidays.Add(holiday);
                added++;
            }
            else if (match.Name != holiday.Name)
            {
                match.Name = holiday.Name;
                updated++;
            }
        }

        await _db.SaveChangesAsync(ct);
        return (added, updated);
    }
}
