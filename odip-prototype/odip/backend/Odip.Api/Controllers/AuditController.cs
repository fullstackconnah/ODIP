using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using Odip.Application.Common;
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
            ["ParticipantMedication"] = "ParticipantMedication",
            ["MedicationAdministration"] = "MedicationAdministration",
            ["ParticipantNote"] = "ParticipantNote",
        };

        if (!allowedTypes.TryGetValue(entityType, out var canonicalEntityType))
            return BadRequest(new { error = "Invalid entity type." });

        // AuditLog has no organisation column or query filter, so history is shown only for an entity the caller can see: found through its own tenant-filtered table, or, for the
        // tables without a filter, through the trip, user or vehicle it hangs off.
        var visible = canonicalEntityType switch
        {
            "TripInstance" => await _db.TripInstances.AnyAsync(e => e.Id == entityId, ct),
            "Participant" => await _db.Participants.AnyAsync(e => e.Id == entityId, ct),
            "ParticipantBooking" => await _db.ParticipantBookings.AnyAsync(e => e.Id == entityId && _db.TripInstances.Any(t => t.Id == e.TripInstanceId), ct),
            "IncidentReport" => await _db.IncidentReports.AnyAsync(e => e.Id == entityId && _db.Users.Any(u => u.Id == e.ReportedByUserId), ct),
            "Staff" => await _db.Users.AnyAsync(e => e.Id == entityId, ct),
            "StaffAssignment" => await _db.StaffAssignments.AnyAsync(e => e.Id == entityId && _db.TripInstances.Any(t => t.Id == e.TripInstanceId), ct),
            "VehicleAssignment" => await _db.VehicleAssignments.AnyAsync(e => e.Id == entityId && _db.TripInstances.Any(t => t.Id == e.TripInstanceId), ct),
            "ParticipantMedication" => await _db.ParticipantMedications.AnyAsync(e => e.Id == entityId, ct),
            "MedicationAdministration" => await _db.MedicationAdministrations.AnyAsync(e => e.Id == entityId, ct),
            "ParticipantNote" => await _db.ParticipantNotes.AnyAsync(e => e.Id == entityId, ct),
            _ => false,
        };
        if (!visible) return NotFound(new { error = "Entity not found." });

        // Deliberately a lower ceiling (100, not the house 200) — audit history pages are
        // rarely browsed deep, and this predates the shared 50/200 convention. Do not "tidy"
        // this to match every other controller.
        (page, pageSize) = PagingParams.Clamp(page, pageSize, maxPageSize: 100);

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
