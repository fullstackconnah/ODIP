# Public Holidays Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded holiday seeding with Nager.Date-powered automatic sync covering all Australian states, with a yearly background job and admin-triggerable manual sync.

**Architecture:** `IPublicHolidaySyncService` in Application layer handles the sync contract; `PublicHolidaySyncService` in Infrastructure implements it using `Nager.Date`; `HolidaySyncBackgroundService` drives the yearly schedule and startup catch-up; `PublicHolidaysController` gains a `/sync` endpoint for manual triggering from the settings page.

**Tech Stack:** .NET 9 BackgroundService, Nager.Date NuGet, EF Core 8 upsert, React 19 + TanStack Query v5, Tailwind CSS v4, xUnit + Moq

---

## File Map

### New Files
| File | Responsibility |
|------|----------------|
| `Odip.Application/Interfaces/IPublicHolidaySyncService.cs` | Sync contract used by controller |
| `Odip.Application/Models/SyncResult.cs` | Sync outcome value object |
| `Odip.Infrastructure/Services/NagerHolidayProvider.cs` | Wraps Nager.Date; defines `IHolidayProvider` + `HolidayRecord` |
| `Odip.Infrastructure/Services/PublicHolidaySyncService.cs` | Fetch → map → upsert logic |
| `Odip.Infrastructure/BackgroundServices/HolidaySyncBackgroundService.cs` | Yearly timer + startup catch-up |
| `Odip.Tests/Services/PublicHolidaySyncServiceTests.cs` | Unit tests for sync service |

### Modified Files
| File | Change |
|------|--------|
| `Odip.Infrastructure/Odip.Infrastructure.csproj` | Add Nager.Date package |
| `Odip.Tests/Odip.Tests.csproj` | Add EF Core InMemory + project refs |
| `Odip.Application/DTOs/DTOs.cs` | Add `SyncHolidaysDto`, `SyncResultDto` |
| `Odip.Api/Controllers/PublicHolidaysController.cs` | Add `/sync` endpoint + `IPublicHolidaySyncService` injection |
| `Odip.Api/Program.cs` | Register services |
| `Odip.Api/appsettings.json` | Add `HolidaySync` config section |
| `Odip.Infrastructure/Data/DbSeeder.cs` | Remove hardcoded holiday seed block |
| `frontend/src/api/types/public-holidays.ts` | Add `SyncHolidaysDto`, `SyncResultDto` |
| `frontend/src/api/hooks/public-holidays.ts` | Add `useSyncHolidays` mutation |
| `frontend/src/pages/SettingsPage.tsx` | Add sync button to `PublicHolidaysTab` |

---

## Task 1: Add NuGet packages

**Files:**
- Modify: `backend/Odip.Infrastructure/Odip.Infrastructure.csproj`
- Modify: `backend/Odip.Tests/Odip.Tests.csproj`

- [ ] **Step 1: Add Nager.Date to Infrastructure**

Open `backend/Odip.Infrastructure/Odip.Infrastructure.csproj`. Inside the existing `<ItemGroup>` with PackageReferences, add:

```xml
<PackageReference Include="Nager.Date" Version="3.5.0" />
```

> Check https://www.nuget.org/packages/Nager.Date for the latest 3.x version and use that instead of 3.5.0 if a newer patch exists.

- [ ] **Step 2: Update the Tests project**

Read `backend/Odip.Tests/Odip.Tests.csproj`. Add a new `<ItemGroup>` for the test package and project references if they don't already exist:

```xml
<ItemGroup>
  <PackageReference Include="Microsoft.EntityFrameworkCore.InMemory" Version="8.0.11" />
</ItemGroup>

<ItemGroup>
  <ProjectReference Include="..\Odip.Application\Odip.Application.csproj" />
  <ProjectReference Include="..\Odip.Infrastructure\Odip.Infrastructure.csproj" />
</ItemGroup>
```

Skip any reference that already exists.

- [ ] **Step 3: Restore packages**

```bash
dotnet restore backend/Odip.Infrastructure/Odip.Infrastructure.csproj
dotnet restore backend/Odip.Tests/Odip.Tests.csproj
```

Expected: Restore succeeded with no errors. If `Nager.Date 3.5.0` is not found, check nuget.org for the correct version.

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Infrastructure/Odip.Infrastructure.csproj backend/Odip.Tests/Odip.Tests.csproj
git commit -m "chore: add Nager.Date and EF InMemory test packages"
```

---

## Task 2: Create Application layer contracts

**Files:**
- Create: `backend/Odip.Application/Interfaces/IPublicHolidaySyncService.cs`
- Create: `backend/Odip.Application/Models/SyncResult.cs`

- [ ] **Step 1: Create SyncResult**

Create `backend/Odip.Application/Models/SyncResult.cs` (create `Models/` directory if it doesn't exist):

```csharp
namespace Odip.Application.Models;

public record SyncResult(
    int YearsProcessed,
    int HolidaysAdded,
    int HolidaysUpdated,
    string[] Errors
);
```

- [ ] **Step 2: Create IPublicHolidaySyncService**

Create `backend/Odip.Application/Interfaces/IPublicHolidaySyncService.cs` (create `Interfaces/` directory if it doesn't exist):

```csharp
using Odip.Application.Models;

namespace Odip.Application.Interfaces;

public interface IPublicHolidaySyncService
{
    Task<SyncResult> SyncAsync(int fromYear, int toYear, CancellationToken ct = default);
}
```

- [ ] **Step 3: Build**

```bash
dotnet build backend/Odip.Application/Odip.Application.csproj
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Application/
git commit -m "feat: add IPublicHolidaySyncService contract and SyncResult model"
```

---

## Task 3: Add sync DTOs to Application layer

**Files:**
- Modify: `backend/Odip.Application/DTOs/DTOs.cs`

- [ ] **Step 1: Add SyncHolidaysDto and SyncResultDto**

Open `backend/Odip.Application/DTOs/DTOs.cs` and append these two records at the end of the file:

```csharp
public record SyncHolidaysDto
{
    public int? FromYear { get; init; }
    public int? ToYear { get; init; }
}

public record SyncResultDto
{
    public int YearsProcessed { get; init; }
    public int HolidaysAdded { get; init; }
    public int HolidaysUpdated { get; init; }
    public string[] Errors { get; init; } = [];
}
```

- [ ] **Step 2: Build**

```bash
dotnet build backend/Odip.Application/Odip.Application.csproj
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Application/DTOs/DTOs.cs
git commit -m "feat: add SyncHolidaysDto and SyncResultDto"
```

---

## Task 4: Write failing tests for PublicHolidaySyncService

**Files:**
- Create: `backend/Odip.Tests/Services/PublicHolidaySyncServiceTests.cs`

- [ ] **Step 1: Find ICurrentTenant namespace**

Read the first 20 lines of `backend/Odip.Infrastructure/Data/OdipDbContext.cs` to confirm the `ICurrentTenant` namespace (likely `Odip.Domain.Interfaces` or `Odip.Application.Interfaces`). Also confirm the constructor signature — it should be:
```csharp
public OdipDbContext(DbContextOptions<OdipDbContext> options, ICurrentTenant tenant)
```
Note the exact namespace for use in the test file.

- [ ] **Step 2: Create Services test directory**

Check if `backend/Odip.Tests/Services/` exists; create it if not.

- [ ] **Step 3: Write the tests**

Create `backend/Odip.Tests/Services/PublicHolidaySyncServiceTests.cs`. Replace `Odip.Domain.Interfaces` with the actual namespace found in Step 1 if different:

```csharp
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.Interfaces;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

public class PublicHolidaySyncServiceTests
{
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    [Fact]
    public async Task SyncAsync_WithNoExistingHolidays_AddsAll()
    {
        using var db = CreateDb();
        var provider = new Mock<IHolidayProvider>();
        provider.Setup(p => p.GetHolidays(2025, "AU")).Returns([
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
        provider.Setup(p => p.GetHolidays(2025, "AU")).Returns([
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
        provider.Setup(p => p.GetHolidays(2025, "AU")).Returns([
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
        provider.Setup(p => p.GetHolidays(2025, "AU")).Returns([
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
        provider.Setup(p => p.GetHolidays(2025, "AU"))
            .Throws(new InvalidOperationException("API unavailable"));
        provider.Setup(p => p.GetHolidays(2026, "AU")).Returns([
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
```

- [ ] **Step 4: Run tests (expected compile failure)**

```bash
dotnet test backend/Odip.Tests/Odip.Tests.csproj --filter "FullyQualifiedName~PublicHolidaySyncServiceTests"
```

Expected: Compile errors — `IHolidayProvider`, `HolidayRecord`, `PublicHolidaySyncService` not found yet. This confirms the tests are driving implementation.

- [ ] **Step 5: Commit**

```bash
git add backend/Odip.Tests/Services/PublicHolidaySyncServiceTests.cs
git commit -m "test: add failing tests for PublicHolidaySyncService (TDD)"
```

---

## Task 5: Implement NagerHolidayProvider and PublicHolidaySyncService

**Files:**
- Create: `backend/Odip.Infrastructure/Services/NagerHolidayProvider.cs`
- Create: `backend/Odip.Infrastructure/Services/PublicHolidaySyncService.cs`

- [ ] **Step 1: Check if Services directory exists**

Check `backend/Odip.Infrastructure/Services/`; create it if not.

- [ ] **Step 2: Create NagerHolidayProvider**

Create `backend/Odip.Infrastructure/Services/NagerHolidayProvider.cs`:

```csharp
using Nager.Date;
using Nager.Date.Models;

namespace Odip.Infrastructure.Services;

public record HolidayRecord(DateOnly Date, string Name, string[] Counties);

public interface IHolidayProvider
{
    IEnumerable<HolidayRecord> GetHolidays(int year, string countryCode);
}

public class NagerHolidayProvider : IHolidayProvider
{
    public IEnumerable<HolidayRecord> GetHolidays(int year, string countryCode)
    {
        if (!Enum.TryParse<CountryCode>(countryCode, out var code))
            return [];

        return DateSystem.GetPublicHolidays(year, code)
            .Select(h => new HolidayRecord(
                DateOnly.FromDateTime(h.Date),
                h.LocalName,
                h.Counties ?? []
            ));
    }
}
```

- [ ] **Step 3: Create PublicHolidaySyncService**

Create `backend/Odip.Infrastructure/Services/PublicHolidaySyncService.cs`:

```csharp
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
        var incoming = _provider.GetHolidays(year, "AU")
            .SelectMany(h => h.Counties.Length == 0
                ? (IEnumerable<DomainHoliday>)[new DomainHoliday { Date = h.Date, Name = h.Name, State = null }]
                : h.Counties.Select(c => new DomainHoliday { Date = h.Date, Name = h.Name, State = c.Replace("AU-", "") }))
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
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
dotnet test backend/Odip.Tests/Odip.Tests.csproj --filter "FullyQualifiedName~PublicHolidaySyncServiceTests"
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/Odip.Infrastructure/Services/NagerHolidayProvider.cs backend/Odip.Infrastructure/Services/PublicHolidaySyncService.cs
git commit -m "feat: implement PublicHolidaySyncService with Nager.Date provider"
```

---

## Task 6: Add HolidaySyncBackgroundService

**Files:**
- Create: `backend/Odip.Infrastructure/BackgroundServices/HolidaySyncBackgroundService.cs`

- [ ] **Step 1: Create BackgroundServices directory**

Check `backend/Odip.Infrastructure/BackgroundServices/`; create it if not.

- [ ] **Step 2: Create HolidaySyncBackgroundService**

Create `backend/Odip.Infrastructure/BackgroundServices/HolidaySyncBackgroundService.cs`:

```csharp
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
        await RunSyncAsync(GetFromYear(), DateTime.Now.Year + 1, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var nextRun = GetNextRunDate();
            _logger.LogInformation("Next holiday sync scheduled for {NextRun:yyyy-MM-dd}", nextRun);

            try
            {
                await Task.Delay(nextRun - DateTime.UtcNow, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            if (!stoppingToken.IsCancellationRequested)
                await RunSyncAsync(DateTime.Now.Year, DateTime.Now.Year + 1, stoppingToken);
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
```

- [ ] **Step 3: Build Infrastructure**

```bash
dotnet build backend/Odip.Infrastructure/Odip.Infrastructure.csproj
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Infrastructure/BackgroundServices/HolidaySyncBackgroundService.cs
git commit -m "feat: add HolidaySyncBackgroundService for yearly schedule"
```

---

## Task 7: Add /sync endpoint to PublicHolidaysController

**Files:**
- Modify: `backend/Odip.Api/Controllers/PublicHolidaysController.cs`

- [ ] **Step 1: Replace the controller with the updated version**

Replace the full content of `backend/Odip.Api/Controllers/PublicHolidaysController.cs` with:

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/public-holidays")]
public class PublicHolidaysController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly IPublicHolidaySyncService _syncService;

    public PublicHolidaysController(OdipDbContext db, IPublicHolidaySyncService syncService)
    {
        _db = db;
        _syncService = syncService;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<PublicHolidayDto>>>> GetAll(
        [FromQuery] int? year, CancellationToken ct)
    {
        var query = _db.PublicHolidays.AsQueryable();
        if (year.HasValue) query = query.Where(h => h.Date.Year == year.Value);

        var items = await query.OrderBy(h => h.Date)
            .Select(h => new PublicHolidayDto { Id = h.Id, Date = h.Date, Name = h.Name, State = h.State })
            .ToListAsync(ct);

        return Ok(ApiResponse<List<PublicHolidayDto>>.Ok(items));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<PublicHolidayDto>>> Create(
        [FromBody] CreatePublicHolidayDto dto, CancellationToken ct)
    {
        var holiday = new PublicHoliday { Id = Guid.NewGuid(), Date = dto.Date, Name = dto.Name, State = dto.State };
        _db.PublicHolidays.Add(holiday);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<PublicHolidayDto>.Ok(
            new PublicHolidayDto { Id = holiday.Id, Date = holiday.Date, Name = holiday.Name, State = holiday.State }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var h = await _db.PublicHolidays.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (h == null) return NotFound(ApiResponse<bool>.Fail("Holiday not found"));
        _db.PublicHolidays.Remove(h);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("sync")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<SyncResultDto>>> Sync(
        [FromBody] SyncHolidaysDto dto, CancellationToken ct)
    {
        var fromYear = dto.FromYear ?? DateTime.Now.Year;
        var toYear = dto.ToYear ?? DateTime.Now.Year + 1;

        var result = await _syncService.SyncAsync(fromYear, toYear, ct);

        return Ok(ApiResponse<SyncResultDto>.Ok(new SyncResultDto
        {
            YearsProcessed = result.YearsProcessed,
            HolidaysAdded = result.HolidaysAdded,
            HolidaysUpdated = result.HolidaysUpdated,
            Errors = result.Errors
        }));
    }
}
```

- [ ] **Step 2: Build API project**

```bash
dotnet build backend/Odip.Api/Odip.Api.csproj
```

Expected: Build succeeded. (DI registration happens at runtime, not compile-time.)

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Api/Controllers/PublicHolidaysController.cs
git commit -m "feat: add POST /public-holidays/sync endpoint"
```

---

## Task 8: Register services and configure appsettings

**Files:**
- Modify: `backend/Odip.Api/Program.cs`
- Modify: `backend/Odip.Api/appsettings.json`

- [ ] **Step 1: Add service registrations to Program.cs**

Read `backend/Odip.Api/Program.cs` and locate the section where scoped services are registered (near `builder.Services.AddScoped<ClaimGenerationService>()`). Add these three lines in that same block:

```csharp
builder.Services.AddScoped<Odip.Infrastructure.Services.IHolidayProvider, Odip.Infrastructure.Services.NagerHolidayProvider>();
builder.Services.AddScoped<Odip.Application.Interfaces.IPublicHolidaySyncService, Odip.Infrastructure.Services.PublicHolidaySyncService>();
builder.Services.AddHostedService<Odip.Infrastructure.BackgroundServices.HolidaySyncBackgroundService>();
```

> Alternatively, add `using` directives at the top of Program.cs and use the short names.

- [ ] **Step 2: Add HolidaySync config section to appsettings.json**

Read `backend/Odip.Api/appsettings.json`. Add a new top-level key:

```json
"HolidaySync": {
  "FromYear": 2025,
  "ScheduleMonth": 11,
  "ScheduleDay": 1
}
```

- [ ] **Step 3: Build the full solution**

```bash
dotnet build backend/Odip.sln
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 4: Run all tests**

```bash
dotnet test backend/Odip.Tests/Odip.Tests.csproj
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/Odip.Api/Program.cs backend/Odip.Api/appsettings.json
git commit -m "feat: register holiday sync services and configure schedule defaults"
```

---

## Task 9: Remove hardcoded holiday seed from DbSeeder

**Files:**
- Modify: `backend/Odip.Infrastructure/Data/DbSeeder.cs`

- [ ] **Step 1: Remove the hardcoded holiday block**

Read `backend/Odip.Infrastructure/Data/DbSeeder.cs` around lines 820–865. Find and remove the entire block that starts with:

```csharp
if (!await context.PublicHolidays.AnyAsync(ct))
{
    var holidays = new List<PublicHoliday>
    {
        // National 2025
        ...
    };
    context.PublicHolidays.AddRange(holidays);
}
```

Remove only this block. Do not remove the surrounding `await context.SaveChangesAsync(ct);` if it is shared with other seeding logic above it.

- [ ] **Step 2: Build Infrastructure**

```bash
dotnet build backend/Odip.Infrastructure/Odip.Infrastructure.csproj
```

Expected: Build succeeded.

- [ ] **Step 3: Run all tests**

```bash
dotnet test backend/Odip.Tests/Odip.Tests.csproj
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Infrastructure/Data/DbSeeder.cs
git commit -m "refactor: remove hardcoded holiday seed — replaced by HolidaySyncBackgroundService"
```

---

## Task 10: Add frontend types and useSyncHolidays hook

**Files:**
- Modify: `frontend/src/api/types/public-holidays.ts`
- Modify: `frontend/src/api/hooks/public-holidays.ts`

- [ ] **Step 1: Add types to public-holidays.ts**

Open `frontend/src/api/types/public-holidays.ts` and append to the end:

```typescript
export interface SyncHolidaysDto {
  fromYear?: number
  toYear?: number
}

export interface SyncResultDto {
  yearsProcessed: number
  holidaysAdded: number
  holidaysUpdated: number
  errors: string[]
}
```

- [ ] **Step 2: Verify types are re-exported**

Read `frontend/src/api/types/index.ts`. Confirm it re-exports from `./public-holidays` (e.g., `export * from './public-holidays'`). If the new types are not exported, add them.

- [ ] **Step 3: Add useSyncHolidays hook**

Open `frontend/src/api/hooks/public-holidays.ts`.

Update the import line to include the new types:
```typescript
import type { PublicHolidayDto, CreatePublicHolidayDto, SyncHolidaysDto, SyncResultDto } from '../types'
```

Append the new hook at the end of the file:
```typescript
export function useSyncHolidays() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SyncHolidaysDto = {}) =>
      apiPost<SyncResultDto>('/public-holidays/sync', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['public-holidays'] })
    },
  })
}
```

- [ ] **Step 4: Build frontend**

```bash
cd frontend && npm run build
```

Expected: Build succeeds, 0 TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types/public-holidays.ts frontend/src/api/hooks/public-holidays.ts
git commit -m "feat: add useSyncHolidays hook and sync DTO types"
```

---

## Task 11: Add sync button to PublicHolidaysTab in SettingsPage

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Read SettingsPage.tsx**

Read `frontend/src/pages/SettingsPage.tsx` in full. Identify:
1. The `PublicHolidaysTab` component (or inline section)
2. What toast/notification library is used for success/error feedback (look for existing mutation `onSuccess` handlers)
3. Where existing action buttons are rendered in that tab

- [ ] **Step 2: Import useSyncHolidays**

Find the import line for holiday hooks (e.g., `import { usePublicHolidays, useCreatePublicHoliday, useDeletePublicHoliday } from '../api/hooks/public-holidays'`) and add `useSyncHolidays`:

```typescript
import { usePublicHolidays, useCreatePublicHoliday, useDeletePublicHoliday, useSyncHolidays } from '../api/hooks/public-holidays'
```

- [ ] **Step 3: Add state and handler inside the PublicHolidaysTab component**

Locate the body of the `PublicHolidaysTab` component (or the inline public holidays section). Add these lines inside it, alongside the existing mutation declarations:

```typescript
const syncHolidays = useSyncHolidays()
const [showSyncAdvanced, setShowSyncAdvanced] = useState(false)
const [syncFromYear, setSyncFromYear] = useState<number | undefined>(undefined)
const [syncToYear, setSyncToYear] = useState<number | undefined>(undefined)

const handleSync = () => {
  syncHolidays.mutate(
    { fromYear: syncFromYear, toYear: syncToYear },
    {
      onSuccess: (result) => {
        // Use the same toast/notification pattern used elsewhere in this file
        // e.g.: toast.success(`Sync complete: ${result.holidaysAdded} added, ${result.holidaysUpdated} updated`)
        console.info('Sync complete', result)
      },
      onError: (err: any) => {
        console.error('Sync failed', err)
      },
    }
  )
}
```

> Replace the `console.info`/`console.error` calls with whatever notification mechanism the file already uses (look at other `onSuccess` handlers in the file — they'll show the pattern).

- [ ] **Step 4: Add the sync UI**

Find the action button area in the PublicHolidaysTab (where the "Add Holiday" button is). Add the sync section below it, matching the file's indentation and style:

```tsx
{/* Holiday Sync */}
<div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
  <button
    onClick={handleSync}
    disabled={syncHolidays.isPending}
    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {syncHolidays.isPending ? 'Syncing...' : 'Sync Holidays'}
  </button>
  <button
    type="button"
    onClick={() => setShowSyncAdvanced(v => !v)}
    className="text-sm text-gray-500 hover:text-gray-700 underline"
  >
    {showSyncAdvanced ? 'Hide advanced' : 'Advanced'}
  </button>
</div>

{showSyncAdvanced && (
  <div className="flex items-center gap-3 mt-2">
    <label className="text-sm text-gray-600">From year</label>
    <input
      type="number"
      value={syncFromYear ?? ''}
      onChange={e => setSyncFromYear(e.target.value ? Number(e.target.value) : undefined)}
      placeholder={String(new Date().getFullYear())}
      className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
    />
    <label className="text-sm text-gray-600">To year</label>
    <input
      type="number"
      value={syncToYear ?? ''}
      onChange={e => setSyncToYear(e.target.value ? Number(e.target.value) : undefined)}
      placeholder={String(new Date().getFullYear() + 1)}
      className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
    />
  </div>
)}
```

> Adapt button class names to match the existing button style in the tab if they differ.

- [ ] **Step 5: Lint and build**

```bash
cd frontend && npm run lint && npm run build
```

Expected: No errors or warnings.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "feat: add manual holiday sync button to settings page"
```

---

## Task 12: End-to-end smoke test

- [ ] **Step 1: Start the backend and observe startup sync logs**

```bash
dotnet run --project backend/Odip.Api
```

Watch the logs. Expected within a few seconds of startup:
```
info: ...HolidaySyncBackgroundService[0]
      Running holiday sync from 2025 to 2026
info: ...HolidaySyncBackgroundService[0]
      Holiday sync complete: 2 years, N added, 0 updated
```

- [ ] **Step 2: Verify GET holidays returns all states**

```bash
curl http://localhost:5000/api/v1/public-holidays?year=2025 \
  -H "Authorization: Bearer <any-valid-token>"
```

Expected: Response includes holidays with `state` values covering multiple states (ACT, NSW, NT, QLD, SA, TAS, VIC, WA) and `null` for national holidays.

- [ ] **Step 3: Verify manual sync endpoint**

```bash
curl -X POST http://localhost:5000/api/v1/public-holidays/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d "{}"
```

Expected response:
```json
{
  "data": {
    "yearsProcessed": 2,
    "holidaysAdded": 0,
    "holidaysUpdated": 0,
    "errors": []
  }
}
```

(0 added because startup sync already ran — idempotent.)

- [ ] **Step 4: Start frontend and test settings page**

```bash
cd frontend && npm run dev
```

Navigate to Settings → Public Holidays tab. Verify:
- "Sync Holidays" button is visible
- Clicking it while holidays are already loaded shows success toast/notification
- "Advanced" toggle reveals year inputs

- [ ] **Step 5: Run full test suite**

```bash
dotnet test backend/Odip.Tests/Odip.Tests.csproj
```

Expected: All tests pass.
