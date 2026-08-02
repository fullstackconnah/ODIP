using Odip.Domain.Interfaces;

namespace Odip.Domain.Dictionary;

/// <summary>
/// The data type of a <see cref="FieldDefinition"/>, derived from the free-text
/// "dataType" column of the ODIP Master Data Dictionary via <see cref="FieldDataTypeParser.Parse"/>.
/// </summary>
public enum FieldDataType
{
    /// <summary>Short free text. Also the default/fallback for unrecognised dictionary values.</summary>
    Text,

    /// <summary>Multi-line free text.</summary>
    LongText,

    /// <summary>Single choice from <see cref="FieldDefinition.PicklistOptions"/>.</summary>
    SingleSelect,

    /// <summary>Zero or more choices from <see cref="FieldDefinition.PicklistOptions"/>.</summary>
    MultiSelect,

    /// <summary>True/false flag.</summary>
    Boolean,

    /// <summary>Calendar date.</summary>
    Date,

    /// <summary>Time of day.</summary>
    Time,

    /// <summary>Decimal or general numeric value.</summary>
    Number,

    /// <summary>Whole-number value.</summary>
    Integer,

    /// <summary>Monetary amount.</summary>
    Currency,

    /// <summary>Value derived from other fields rather than entered directly.</summary>
    Calculated,

    /// <summary>Captured signature (image/consent artefact).</summary>
    Signature,

    /// <summary>Uploaded file/document.</summary>
    Attachment,

    /// <summary>Text assembled from other fields (e.g. a full name built from parts).</summary>
    Composite,

    /// <summary>System-generated value the user never types directly (e.g. an ID).</summary>
    SystemGenerated
}

/// <summary>
/// Tolerant parser converting the free-text "dataType" strings found in
/// ODIP Master Data Dictionary.xlsx into <see cref="FieldDataType"/> values.
/// Unrecognised or unexpected values default to <see cref="FieldDataType.Text"/>.
/// </summary>
public static class FieldDataTypeParser
{
    /// <summary>
    /// Parses a free-text data type label (e.g. "Single-select", "Text (system-generated)")
    /// into a <see cref="FieldDataType"/>. Matching is case-insensitive and tolerant of
    /// spacing/punctuation variants. Defaults to <see cref="FieldDataType.Text"/> when
    /// <paramref name="raw"/> is null, empty, or unrecognised.
    /// </summary>
    public static FieldDataType Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return FieldDataType.Text;
        }

        var normalised = raw.Trim().ToLowerInvariant();

        // Order matters: check more specific phrases before generic ones.
        if (normalised.Contains("system-generated") || normalised.Contains("system generated"))
        {
            return FieldDataType.SystemGenerated;
        }

        if (normalised.Contains("multi-select") || normalised.Contains("multi select") || normalised.Contains("multiselect"))
        {
            return FieldDataType.MultiSelect;
        }

        if (normalised.Contains("single-select") || normalised.Contains("single select") || normalised.Contains("singleselect")
            || normalised.Contains("dropdown") || normalised.Contains("select"))
        {
            return FieldDataType.SingleSelect;
        }

        if (normalised.Contains("long text") || normalised.Contains("longtext") || normalised.Contains("textarea") || normalised.Contains("memo"))
        {
            return FieldDataType.LongText;
        }

        if (normalised.Contains("composite"))
        {
            return FieldDataType.Composite;
        }

        if (normalised.Contains("bool") || normalised == "yes/no" || normalised.Contains("checkbox"))
        {
            return FieldDataType.Boolean;
        }

        if (normalised.Contains("date") && !normalised.Contains("update"))
        {
            return FieldDataType.Date;
        }

        if (normalised.Contains("time"))
        {
            return FieldDataType.Time;
        }

        if (normalised.Contains("currency") || normalised.Contains("money"))
        {
            return FieldDataType.Currency;
        }

        if (normalised.Contains("calculated") || normalised.Contains("calculation") || normalised.Contains("formula"))
        {
            return FieldDataType.Calculated;
        }

        if (normalised.Contains("signature"))
        {
            return FieldDataType.Signature;
        }

        if (normalised.Contains("attachment") || normalised.Contains("upload") || normalised.Contains("file"))
        {
            return FieldDataType.Attachment;
        }

        if (normalised.Contains("integer") || normalised.Contains("whole number"))
        {
            return FieldDataType.Integer;
        }

        if (normalised.Contains("number") || normalised.Contains("numeric") || normalised.Contains("decimal"))
        {
            return FieldDataType.Number;
        }

        // "Text", "Email", "Phone", "Secure" and any other free-text-shaped value
        // are all rendered as a single-line text field.
        return FieldDataType.Text;
    }
}

/// <summary>
/// A registry definition for one field from the ODIP Master Data Dictionary
/// (sourced from Oassist's "ODIP Master Data Dictionary.xlsx").
/// Spine/critical participant fields are modelled as real columns on
/// <c>Participant</c>; every other field is form-driven and stored via the
/// <see cref="FieldValue"/> EAV table keyed against this definition
/// (see plan doc 03 §2).
/// </summary>
public class FieldDefinition : ITenantEntity
{
    /// <summary>Surrogate primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>Owning tenant. Auto-populated by OdipDbContext.SaveChangesAsync.</summary>
    public Guid TenantId { get; set; }

    /// <summary>The dictionary code (e.g. "PID-007"). Unique per tenant.</summary>
    public string FieldId { get; set; } = string.Empty;

    /// <summary>Human-readable field name (e.g. "Participant Full Name").</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>The dictionary domain/category (e.g. "Participant Identity", "Health &amp; Medical").</summary>
    public string Domain { get; set; } = string.Empty;

    /// <summary>The field's data type, parsed from the dictionary's free-text dataType column.</summary>
    public FieldDataType DataType { get; set; } = FieldDataType.Text;

    /// <summary>
    /// Raw allowed-values string from the dictionary (e.g. "Yes; No; Unsure").
    /// Only meaningful when <see cref="DataType"/> is <see cref="FieldDataType.SingleSelect"/>
    /// or <see cref="FieldDataType.MultiSelect"/>. Use <see cref="PicklistOptions"/> to consume it.
    /// </summary>
    public string? PicklistOptionsRaw { get; set; }

    /// <summary>Free-text comments from the dictionary.</summary>
    public string? Comments { get; set; }

    /// <summary>Free-text notes from the dictionary.</summary>
    public string? Notes { get; set; }

    /// <summary>
    /// True when this field belongs to a clinical-adjacent domain (health, behavioural,
    /// personal care, risk, medication, dietary) and must be treated as sensitive data
    /// under the platform's security posture.
    /// </summary>
    public bool IsSensitive { get; set; }

    /// <summary>True while this field definition is in active use. Inactive definitions are retained for history.</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>Names of the forms this field appears on, as sourced from the dictionary's "appearsIn" column.</summary>
    public List<string> AppearsInForms { get; set; } = new();

    /// <summary>
    /// The parsed picklist options from <see cref="PicklistOptionsRaw"/>, split first on ';'
    /// and, failing that, on ','. Entries are trimmed and empty entries are dropped.
    /// Only meaningful for <see cref="FieldDataType.SingleSelect"/>/<see cref="FieldDataType.MultiSelect"/> fields.
    /// </summary>
    public IReadOnlyList<string> PicklistOptions
    {
        get
        {
            if (string.IsNullOrWhiteSpace(PicklistOptionsRaw))
            {
                return Array.Empty<string>();
            }

            var separator = PicklistOptionsRaw.Contains(';') ? ';' : ',';

            return PicklistOptionsRaw
                .Split(separator)
                .Select(option => option.Trim())
                .Where(option => option.Length > 0)
                .ToList();
        }
    }
}
