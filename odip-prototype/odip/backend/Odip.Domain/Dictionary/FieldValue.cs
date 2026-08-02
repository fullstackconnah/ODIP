using Odip.Domain.Interfaces;

namespace Odip.Domain.Dictionary;

/// <summary>
/// Stores a single participant's value for a form-driven <see cref="FieldDefinition"/>
/// as an entity-attribute-value (EAV) record.
/// </summary>
/// <remarks>
/// Spine/critical participant fields (name, DOB, NDIS number, plan type, etc.) live as
/// real, strongly-typed columns on <c>Participant</c> for query performance and
/// referential integrity. This table exists only for the long tail of form-driven
/// dictionary fields that vary by form/domain and would otherwise require constant
/// schema migrations (see plan doc 03 §2). <see cref="Value"/> is always stored as a
/// string; callers are responsible for serialising/deserialising according to the
/// referenced <see cref="FieldDefinition.DataType"/> (e.g. multi-select values as a
/// delimited or JSON-encoded list).
/// </remarks>
public class FieldValue : ITenantEntity
{
    /// <summary>Surrogate primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>Owning tenant. Auto-populated by OdipDbContext.SaveChangesAsync.</summary>
    public Guid TenantId { get; set; }

    /// <summary>The participant this value belongs to.</summary>
    public Guid ParticipantId { get; set; }

    /// <summary>The <see cref="FieldDefinition"/> this value is recorded against.</summary>
    public Guid FieldDefinitionId { get; set; }

    /// <summary>
    /// The string-serialised value entered for this participant/field pair.
    /// Null represents "not yet answered" rather than an empty answer.
    /// </summary>
    public string? Value { get; set; }

    /// <summary>UTC timestamp of the last write to this value.</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Identifier (e.g. user id or name) of who last updated this value.</summary>
    public string? UpdatedBy { get; set; }
}
