using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using Odip.Application.Common;
using Odip.Domain.Enums;
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
            ["TripClaim"] = "TripClaim",
            ["ClaimLineItem"] = "ClaimLineItem",
            ["Complaint"] = "Complaint",
            ["Shift"] = "Shift",
            ["ShiftPattern"] = "ShiftPattern",
            ["ProviderSettings"] = "ProviderSettings",
        };

        if (!allowedTypes.TryGetValue(entityType, out var canonicalEntityType))
            return BadRequest(new { error = "Invalid entity type." });

        // Rows before 2026-11 have no TenantId, so history is shown only for an entity the caller can see: found through its own tenant-filtered table, or, for the
        // tables without a filter, through the trip, user or vehicle it hangs off.
        var visible = canonicalEntityType switch
        {
            "TripInstance" => await _db.TripInstances.AnyAsync(e => e.Id == entityId, ct),
            "Participant" => await _db.Participants.AnyAsync(e => e.Id == entityId, ct),
            "ParticipantBooking" => await _db.ParticipantBookings.AnyAsync(e => e.Id == entityId && _db.TripInstances.Any(t => t.Id == e.TripInstanceId), ct),
            "IncidentReport" => await _db.IncidentReports.AnyAsync(e => e.Id == entityId, ct),
            "Staff" => await _db.Users.AnyAsync(e => e.Id == entityId, ct),
            "StaffAssignment" => await _db.StaffAssignments.AnyAsync(e => e.Id == entityId && _db.TripInstances.Any(t => t.Id == e.TripInstanceId), ct),
            "VehicleAssignment" => await _db.VehicleAssignments.AnyAsync(e => e.Id == entityId && _db.TripInstances.Any(t => t.Id == e.TripInstanceId), ct),
            "ParticipantMedication" => await _db.ParticipantMedications.AnyAsync(e => e.Id == entityId, ct),
            "MedicationAdministration" => await _db.MedicationAdministrations.AnyAsync(e => e.Id == entityId, ct),
            "ParticipantNote" => await _db.ParticipantNotes.AnyAsync(e => e.Id == entityId, ct),
            "TripClaim" => await _db.TripClaims.AnyAsync(e => e.Id == entityId, ct),
            "ClaimLineItem" => await _db.ClaimLineItems.AnyAsync(e => e.Id == entityId, ct),
            "Complaint" => await _db.Complaints.AnyAsync(e => e.Id == entityId, ct),
            "Shift" => await _db.Shifts.AnyAsync(e => e.Id == entityId, ct),
            "ShiftPattern" => await _db.ShiftPatterns.AnyAsync(e => e.Id == entityId, ct),
            // Scoped, never _db.ProviderSettings: a SuperAdmin's query filter is off, so a plain query would show any organisation's settings history.
            "ProviderSettings" => await _db.ScopedProviderSettings().AnyAsync(e => e.Id == entityId, ct),
            _ => false,
        };
        // A hard-deleted record is gone from its table. Its history stays readable to its own organisation while the newest row says Deleted.
        if (!visible && _db.CurrentTenantId is Guid tid)
        {
            var newest = await _db.AuditLogs
                .Where(a => a.EntityType == canonicalEntityType && a.EntityId == entityId)
                .OrderByDescending(a => a.ChangedAt).ThenByDescending(a => a.Id)
                .Select(a => new { a.Action, a.TenantId })
                .FirstOrDefaultAsync(ct);
            visible = newest is { Action: AuditAction.Deleted } && newest.TenantId == tid;
        }
        if (!visible) return NotFound(new { error = "Entity not found." });

        // Deliberately a lower ceiling (100, not the house 200) — audit history pages are
        // rarely browsed deep, and this predates the shared 50/200 convention. Do not "tidy"
        // this to match every other controller.
        (page, pageSize) = PagingParams.Clamp(page, pageSize, maxPageSize: 100);

        var query = _db.AuditLogs
            .Where(a => a.EntityType == canonicalEntityType && a.EntityId == entityId)
            .OrderByDescending(a => a.ChangedAt).ThenByDescending(a => a.Id);

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
            Changes = DeserializeChanges(a.Changes, maskBank: canonicalEntityType == "ProviderSettings")
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

    /// <summary>The records deleted in the caller's organisation, newest first, each with the values it held.</summary>
    [HttpGet("deleted")]
    public async Task<ActionResult> GetDeleted([FromQuery] string? entityType, [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);
        var result = new PagedResult<DeletedRecordDto> { Page = page, PageSize = pageSize };
        // A null tenant would compare as IS NULL and match every row from before the column existed.
        if (_db.CurrentTenantId is not Guid tenantId) return Ok(ApiResponse<PagedResult<DeletedRecordDto>>.Ok(result));

        var query = _db.AuditLogs.Where(a => a.TenantId == tenantId && a.Action == AuditAction.Deleted);
        if (!string.IsNullOrWhiteSpace(entityType)) query = query.Where(a => a.EntityType == entityType);

        result.TotalCount = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(a => a.ChangedAt).ThenByDescending(a => a.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(a => new { a.Id, a.EntityType, a.EntityId, a.ChangedAt, a.ChangedByName, a.Changes })
            .ToListAsync(ct);
        // Bank fields are matched by name, so any deleted row holding one (a ProviderSettings row, say) is masked as its history is.
        result.Items = rows.Select(a => new DeletedRecordDto(a.Id, a.EntityType, a.EntityId, a.ChangedAt, a.ChangedByName, DeserializeChanges(a.Changes, maskBank: true))).ToList();
        return Ok(ApiResponse<PagedResult<DeletedRecordDto>>.Ok(result));
    }

    private sealed record DeletedRecordDto(Guid Id, string EntityType, Guid EntityId, DateTimeOffset DeletedAt, string? DeletedByName, List<AuditChangeDto> Fields);

    private static readonly JsonSerializerOptions StoredOptions = new() { PropertyNameCaseInsensitive = true };

    // Stored as {"Field","Old","New"}; a typed list lets MVC re-case them to field/old/new. JsonElement keeps a non-string value readable.
    private static List<AuditChangeDto> DeserializeChanges(string json, bool maskBank = false)
    {
        try
        {
            var changes = JsonSerializer.Deserialize<List<AuditChangeDto>>(json, StoredOptions) ?? [];
            return maskBank ? changes.Select(c => BankFields.Contains(c.Field) ? c with { Old = MaskBank(c.Old), New = MaskBank(c.New) } : c).ToList() : changes;
        }
        catch (JsonException)
        {
            return [];
        }
    }

    // ProviderSettingsController.AuditIfChanged writes only these words for a bank field; a raw value (an older or hand-made row) reads as changed instead of leaving the server.
    private static readonly string[] BankFields = ["BankAccountName", "BSB", "AccountNumber"];
    private static readonly string[] BankWords = ["set", "changed", "cleared"];
    private static JsonElement? MaskBank(JsonElement? v) => v switch
    {
        null or { ValueKind: JsonValueKind.Null } => v,
        { ValueKind: JsonValueKind.String } when BankWords.Contains(v.Value.GetString()) => v,
        _ => JsonSerializer.SerializeToElement("changed"),
    };

    private sealed record AuditChangeDto(string? Field, JsonElement? Old, JsonElement? New);
}
