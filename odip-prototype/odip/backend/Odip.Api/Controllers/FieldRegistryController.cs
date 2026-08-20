using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Dictionary;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Read access to the field registry (Master Data Dictionary) and form templates, plus the
/// EAV field-value store for participants. Field definitions are seeded from
/// "ODIP Master Data Dictionary.xlsx" and are read-only over this API — see
/// <see cref="Odip.Domain.Dictionary.DataDictionarySeeder"/>, the actual source of truth.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/field-registry")]
public class FieldRegistryController : ControllerBase
{
    private readonly OdipDbContext _db;
    public FieldRegistryController(OdipDbContext db) => _db = db;

    // ── Field definitions (read-only reference data) ──────────────────────

    /// <summary>List field definitions, paged, optionally filtered by domain, form, and search text.</summary>
    [HttpGet("fields")]
    public async Task<ActionResult<ApiResponse<PagedResult<FieldDefinitionDto>>>> GetFields(
        [FromQuery] string? domain, [FromQuery] string? appearsIn, [FromQuery] string? search,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.FieldDefinitions.AsQueryable();
        if (!string.IsNullOrWhiteSpace(domain))
            query = query.Where(f => f.Domain == domain);
        if (!string.IsNullOrWhiteSpace(appearsIn))
            query = query.Where(f => f.AppearsInForms.Contains(appearsIn));
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(f => f.Name.Contains(search) || f.FieldId.Contains(search));

        var totalCount = await query.CountAsync(ct);

        // Skip/Take run against the mapped columns so paging happens in the database —
        // FieldDefinition.PicklistOptions is a computed C# property (not mapped, see
        // OdipDbContext's entity.Ignore(e => e.PicklistOptions)) and cannot be translated to
        // SQL, so the DTO mapping below happens in-memory AFTER only this page is materialised,
        // never against the full 280-row tenant set.
        var page_ = await query
            .OrderBy(f => f.Domain).ThenBy(f => f.FieldId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        var result = new PagedResult<FieldDefinitionDto>
        {
            Items = page_.Select(MapFieldDefinition).ToList(),
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        };

        return Ok(ApiResponse<PagedResult<FieldDefinitionDto>>.Ok(result));
    }

    /// <summary>Get a single field definition by ID.</summary>
    [HttpGet("fields/{id:guid}")]
    public async Task<ActionResult<ApiResponse<FieldDefinitionDto>>> GetFieldById(Guid id, CancellationToken ct)
    {
        var def = await _db.FieldDefinitions.FirstOrDefaultAsync(f => f.Id == id, ct);
        if (def == null) return NotFound(ApiResponse<FieldDefinitionDto>.Fail("Field definition not found"));

        return Ok(ApiResponse<FieldDefinitionDto>.Ok(MapFieldDefinition(def)));
    }

    /// <summary>The distinct dictionary domains with a field count each, for building navigation.</summary>
    [HttpGet("domains")]
    public async Task<ActionResult<ApiResponse<List<FieldDomainSummaryDto>>>> GetDomains(CancellationToken ct)
    {
        var domains = await _db.FieldDefinitions
            .GroupBy(f => f.Domain)
            .Select(g => new FieldDomainSummaryDto { Domain = g.Key, FieldCount = g.Count() })
            .OrderBy(d => d.Domain)
            .ToListAsync(ct);

        return Ok(ApiResponse<List<FieldDomainSummaryDto>>.Ok(domains));
    }

    // ── Form templates ──────────────────────────────────────────────────

    /// <summary>The distinct form names derived from every field's "appearsIn" mapping.</summary>
    [HttpGet("forms")]
    public async Task<ActionResult<ApiResponse<List<string>>>> GetForms(CancellationToken ct)
    {
        var forms = await _db.FieldDefinitions
            .SelectMany(f => f.AppearsInForms)
            .Distinct()
            .OrderBy(name => name)
            .ToListAsync(ct);

        return Ok(ApiResponse<List<string>>.Ok(forms));
    }

    /// <summary>Build and return the form skeleton for one form, with each field's definition resolved.</summary>
    [HttpGet("forms/{formName}")]
    public async Task<ActionResult<ApiResponse<FormTemplateDto>>> GetFormByName(string formName, CancellationToken ct)
    {
        // FormTemplate.FromAppearsIn does a case-insensitive substring match against every
        // field's AppearsInForms list, so the full active dictionary must be resolved in memory
        // (unlike GET fields, this endpoint isn't a paged listing, so materialising the tenant's
        // ~280 definitions here is expected and unavoidable).
        var defs = await _db.FieldDefinitions.Where(f => f.IsActive).ToListAsync(ct);
        var template = FormTemplate.FromAppearsIn(formName, defs);

        if (template.Sections.All(s => s.FieldIds.Count == 0))
            return NotFound(ApiResponse<FormTemplateDto>.Fail($"No fields found for form '{formName}'"));

        var byFieldId = defs.ToDictionary(d => d.FieldId, d => d);

        var dto = new FormTemplateDto
        {
            Id = template.Id,
            Name = template.Name,
            Description = template.Description,
            Sections = template.Sections.Select(s => new FormSectionDto
            {
                Title = s.Title,
                Fields = s.FieldIds
                    .Where(byFieldId.ContainsKey)
                    .Select(id => byFieldId[id])
                    .Select(MapFormField)
                    .ToList()
            }).ToList()
        };

        return Ok(ApiResponse<FormTemplateDto>.Ok(dto));
    }

    // ── Field values (EAV store) ────────────────────────────────────────

    /// <summary>Get every stored value for one entity, joined to its field definition.</summary>
    [HttpGet("values/{entityType}/{entityId:guid}")]
    public async Task<ActionResult<ApiResponse<List<FieldValueDto>>>> GetValues(
        string entityType, Guid entityId, CancellationToken ct)
    {
        var entityCheck = await ValidateEntityAsync(entityType, entityId, ct);
        if (entityCheck != null) return entityCheck;

        var joined = await _db.FieldValues
            .Where(v => v.ParticipantId == entityId)
            .Join(_db.FieldDefinitions, v => v.FieldDefinitionId, d => d.Id, (v, d) => new { v, d })
            .ToListAsync(ct);

        var result = joined
            .Select(x => new FieldValueDto
            {
                FieldDefinitionId = x.d.Id,
                FieldId = x.d.FieldId,
                FieldName = x.d.Name,
                DataType = x.d.DataType.ToString(),
                Value = x.v.Value,
                IsSensitive = x.d.IsSensitive,
                UpdatedAt = x.v.UpdatedAt,
                UpdatedBy = x.v.UpdatedBy
            })
            .OrderBy(dto => dto.FieldId)
            .ToList();

        return Ok(ApiResponse<List<FieldValueDto>>.Ok(result));
    }

    /// <summary>
    /// Upsert a batch of field values for one entity in a single request. Every value is
    /// validated against its field definition (existence + <see cref="Odip.Domain.Dictionary.FieldDataType"/>
    /// type check) before anything is written — if any value in the batch fails validation, the
    /// whole batch is rejected and nothing is persisted.
    /// </summary>
    [HttpPut("values/{entityType}/{entityId:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<FieldValueDto>>>> UpsertValues(
        string entityType, Guid entityId, [FromBody] UpsertFieldValuesDto dto, CancellationToken ct)
    {
        var entityCheck = await ValidateEntityAsync(entityType, entityId, ct);
        if (entityCheck != null) return entityCheck;

        if (dto.Values.Count == 0)
            return BadRequest(ApiResponse<List<FieldValueDto>>.Fail("No values supplied."));

        var fieldDefIds = dto.Values.Select(v => v.FieldDefinitionId).Distinct().ToList();
        var definitions = await _db.FieldDefinitions
            .Where(d => fieldDefIds.Contains(d.Id))
            .ToListAsync(ct);
        var defsById = definitions.ToDictionary(d => d.Id);

        // ── Validate the whole batch before writing anything ──────────────
        var errors = new List<string>();
        foreach (var item in dto.Values)
        {
            if (!defsById.TryGetValue(item.FieldDefinitionId, out var def))
            {
                errors.Add($"{item.FieldDefinitionId}: field definition not found");
                continue;
            }

            if (!TryValidateValue(def, item.Value, out var validationError))
            {
                errors.Add($"{def.FieldId}: {validationError}");
            }
        }

        if (errors.Count > 0)
            return BadRequest(ApiResponse<List<FieldValueDto>>.Fail(errors));

        // ── Batch is fully valid — apply the upsert ────────────────────────
        var existing = await _db.FieldValues
            .Where(v => v.ParticipantId == entityId && fieldDefIds.Contains(v.FieldDefinitionId))
            .ToListAsync(ct);
        var existingByDefId = existing.ToDictionary(v => v.FieldDefinitionId);

        var now = DateTime.UtcNow;
        var updatedBy = HttpContext?.User?.Identity?.Name;

        foreach (var item in dto.Values)
        {
            if (existingByDefId.TryGetValue(item.FieldDefinitionId, out var fv))
            {
                fv.Value = item.Value;
                fv.UpdatedAt = now;
                fv.UpdatedBy = updatedBy;
            }
            else
            {
                var newValue = new FieldValue
                {
                    Id = Guid.NewGuid(),
                    ParticipantId = entityId,
                    FieldDefinitionId = item.FieldDefinitionId,
                    Value = item.Value,
                    UpdatedAt = now,
                    UpdatedBy = updatedBy
                };
                _db.FieldValues.Add(newValue);
                existingByDefId[item.FieldDefinitionId] = newValue;
            }
        }

        await _db.SaveChangesAsync(ct);

        var result = dto.Values
            .Select(item =>
            {
                var def = defsById[item.FieldDefinitionId];
                var fv = existingByDefId[item.FieldDefinitionId];
                return new FieldValueDto
                {
                    FieldDefinitionId = def.Id,
                    FieldId = def.FieldId,
                    FieldName = def.Name,
                    DataType = def.DataType.ToString(),
                    Value = fv.Value,
                    IsSensitive = def.IsSensitive,
                    UpdatedAt = fv.UpdatedAt,
                    UpdatedBy = fv.UpdatedBy
                };
            })
            .ToList();

        return Ok(ApiResponse<List<FieldValueDto>>.Ok(result));
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    /// <summary>
    /// The FieldValue EAV store currently only carries a ParticipantId FK (see
    /// Odip.Domain.Dictionary.FieldValue) — "participant" is the only entityType this API
    /// supports today. Returns a non-null ActionResult when the request should be short-circuited
    /// (unsupported entity type or entity not found), otherwise null.
    /// </summary>
    private async Task<ActionResult?> ValidateEntityAsync(string entityType, Guid entityId, CancellationToken ct)
    {
        if (!string.Equals(entityType, "participant", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(ApiResponse<object>.Fail(
                $"Unsupported entity type '{entityType}'. Only 'participant' is currently supported."));
        }

        var participantExists = await _db.Participants.AnyAsync(p => p.Id == entityId, ct);
        if (!participantExists)
        {
            return NotFound(ApiResponse<object>.Fail("Participant not found"));
        }

        return null;
    }

    private static FieldDefinitionDto MapFieldDefinition(FieldDefinition d) => new()
    {
        Id = d.Id,
        FieldId = d.FieldId,
        Name = d.Name,
        Domain = d.Domain,
        DataType = d.DataType.ToString(),
        AllowedValues = d.PicklistOptions.ToList(),
        Comments = d.Comments,
        Notes = d.Notes,
        IsSensitive = d.IsSensitive,
        IsActive = d.IsActive,
        AppearsInForms = d.AppearsInForms
    };

    private static FormFieldDto MapFormField(FieldDefinition d) => new()
    {
        FieldId = d.FieldId,
        Label = d.Name,
        DataType = d.DataType.ToString(),
        AllowedValues = d.PicklistOptions.ToList(),
        IsRequired = false, // see FormFieldDto.IsRequired doc comment — no source data for this yet
        IsSensitive = d.IsSensitive
    };

    /// <summary>
    /// Type-checks a raw EAV string value against its field definition's
    /// <see cref="FieldDataType"/>. A null/empty value always passes — it represents "not yet
    /// answered" (see FieldValue.Value's doc comment) and clears any existing value rather than
    /// being coerced. SingleSelect/MultiSelect values are checked against the field's parsed
    /// <see cref="FieldDefinition.PicklistOptions"/>; MultiSelect values are ';'-delimited, matching
    /// the same separator convention FieldDefinition.PicklistOptions itself parses.
    /// </summary>
    private static bool TryValidateValue(FieldDefinition def, string? value, out string? error)
    {
        error = null;

        if (string.IsNullOrEmpty(value))
        {
            return true;
        }

        switch (def.DataType)
        {
            case FieldDataType.Boolean:
                if (!TryParseBoolean(value))
                {
                    error = $"'{value}' is not a valid boolean value.";
                    return false;
                }
                break;

            case FieldDataType.Date:
                if (!DateOnly.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                {
                    error = $"'{value}' is not a valid date.";
                    return false;
                }
                break;

            case FieldDataType.Time:
                if (!TimeOnly.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                {
                    error = $"'{value}' is not a valid time.";
                    return false;
                }
                break;

            case FieldDataType.Number:
            case FieldDataType.Currency:
                if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out _))
                {
                    error = $"'{value}' is not a valid number.";
                    return false;
                }
                break;

            case FieldDataType.Integer:
                if (!long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
                {
                    error = $"'{value}' is not a valid integer.";
                    return false;
                }
                break;

            case FieldDataType.SingleSelect:
                if (!def.PicklistOptions.Any(o => string.Equals(o, value, StringComparison.OrdinalIgnoreCase)))
                {
                    error = $"'{value}' is not one of the allowed values ({string.Join(", ", def.PicklistOptions)}).";
                    return false;
                }
                break;

            case FieldDataType.MultiSelect:
                var selected = value.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
                var invalid = selected
                    .Where(s => !def.PicklistOptions.Any(o => string.Equals(o, s, StringComparison.OrdinalIgnoreCase)))
                    .ToList();
                if (invalid.Count > 0)
                {
                    error = $"Value(s) {string.Join(", ", invalid)} are not among the allowed values " +
                            $"({string.Join(", ", def.PicklistOptions)}).";
                    return false;
                }
                break;

            // Text, LongText, Composite, Calculated, Signature, Attachment, SystemGenerated are
            // free-form string values with no dictionary-defined format to check against.
            default:
                break;
        }

        return true;
    }

    private static bool TryParseBoolean(string value)
    {
        if (bool.TryParse(value, out _)) return true;
        return value.Trim().ToLowerInvariant() switch
        {
            "yes" or "no" or "1" or "0" => true,
            _ => false
        };
    }
}
