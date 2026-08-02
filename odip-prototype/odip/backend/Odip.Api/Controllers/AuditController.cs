using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Audit trail retrieval for auditable entities.
/// Admin-only access to view historical changes.
/// </summary>
[ApiController]
[Route("api/v1/audit")]
[Authorize(Roles = "Admin,SuperAdmin")]
public class AuditController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ILogger<AuditController> _logger;

    public AuditController(OdipDbContext db, ILogger<AuditController> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Get audit history for a specific entity.
    /// </summary>
    /// <param name="entityType">Entity type (TripInstance, Participant, etc.)</param>
    /// <param name="entityId">Entity ID (GUID)</param>
    /// <param name="page">Page number (1-indexed)</param>
    /// <param name="pageSize">Number of entries per page</param>
    /// <param name="ct">Cancellation token</param>
    [HttpGet("{entityType}/{entityId:guid}")]
    public async Task<ActionResult> GetAuditHistory(
        string entityType,
        Guid entityId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        var allowedTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["TripInstance"] = "TripInstance",
            ["Participant"] = "Participant",
            ["ParticipantBooking"] = "ParticipantBooking",
            ["IncidentReport"] = "IncidentReport",
            ["Staff"] = "Staff",
            ["StaffAssignment"] = "StaffAssignment",
            ["VehicleAssignment"] = "VehicleAssignment",
        };

        if (!allowedTypes.TryGetValue(entityType, out var canonicalEntityType))
            return BadRequest(new { error = "Invalid entity type." });

        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 100) pageSize = 50;

        var query = _db.AuditLogs
            .Where(a => a.EntityType == canonicalEntityType && a.EntityId == entityId)
            .OrderByDescending(a => a.ChangedAt);

        var total = await query.CountAsync(ct);

        // Fetch raw data from DB, then deserialize locally
        var rawEntries = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new
            {
                a.Id,
                a.Action,
                a.ChangedAt,
                a.ChangedByName,
                a.Changes
            })
            .ToListAsync(ct);

        var entries = rawEntries.Select(a => new
        {
            a.Id,
            Action = a.Action.ToString(),
            a.ChangedAt,
            a.ChangedByName,
            Changes = DeserializeChanges(a.Changes)
        }).ToList();

        return Ok(new
        {
            entries,
            total,
            page,
            pageSize,
            totalPages = (total + pageSize - 1) / pageSize
        });
    }

    private static JsonElement DeserializeChanges(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<JsonElement>(json);
        }
        catch (JsonException)
        {
            return JsonSerializer.Deserialize<JsonElement>("[]");
        }
    }
}
