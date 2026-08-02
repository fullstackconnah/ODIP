using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Development-only endpoints. Must not be exposed in production.
/// </summary>
[ApiController]
[Route("api/v1/dev")]
[Authorize(Roles = "Admin,SuperAdmin")]
public class DevController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ILogger<DevController> _logger;
    private readonly IWebHostEnvironment _env;

    public DevController(OdipDbContext db, ILogger<DevController> logger, IWebHostEnvironment env)
    {
        _db = db;
        _logger = logger;
        _env = env;
    }

    /// <summary>
    /// Clears all data and re-seeds from scratch. Development only.
    /// </summary>
    [HttpPost("reseed")]
    public async Task<IActionResult> Reseed(CancellationToken ct)
    {
        if (_env.IsProduction())
            return Forbid();

        _logger.LogWarning("Reseed triggered via API — clearing and re-seeding all data.");
        await DbSeeder.ReseedAsync(_db, ct);
        _logger.LogInformation("Reseed complete.");

        return Ok(new { message = "Database reseeded successfully.", timestamp = DateTime.UtcNow });
    }

    /// <summary>
    /// Seeds data only if not already present. Safe to call on an empty database.
    /// </summary>
    [HttpPost("seed")]
    public async Task<IActionResult> Seed(CancellationToken ct)
    {
        if (_env.IsProduction())
            return Forbid();

        _logger.LogInformation("Seed triggered via API.");
        await DbSeeder.SeedAsync(_db, ct);
        _logger.LogInformation("Seed complete.");

        return Ok(new { message = "Database seeded successfully.", timestamp = DateTime.UtcNow });
    }
}
