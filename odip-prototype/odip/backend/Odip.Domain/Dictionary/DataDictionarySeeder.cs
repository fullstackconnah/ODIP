using System.Text.Json;
using System.Text.Json.Serialization;

namespace Odip.Domain.Dictionary;

/// <summary>
/// Loads <see cref="FieldDefinition"/> records from the JSON export of Oassist's
/// "ODIP Master Data Dictionary.xlsx" (see SeedData/DataDictionarySeed.json).
/// </summary>
public static class DataDictionarySeeder
{
    /// <summary>
    /// Dictionary domains treated as clinical-adjacent under the platform's security
    /// posture; fields belonging to these domains are auto-flagged <see cref="FieldDefinition.IsSensitive"/>.
    /// </summary>
    private static readonly HashSet<string> SensitiveDomains = new(StringComparer.OrdinalIgnoreCase)
    {
        "Health & Medical",
        "Cognitive & Behavioural",
        "Mobility & Personal Care",
        "Risk Assessment",
        "Pick-Up & Medication",
        "Meals & Diet"
    };

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    /// <summary>
    /// Parses the data dictionary JSON document and maps every entry to a
    /// tenant-scoped <see cref="FieldDefinition"/>. Each returned definition is
    /// assigned a fresh <see cref="FieldDefinition.Id"/>.
    /// </summary>
    /// <param name="json">The raw contents of DataDictionarySeed.json.</param>
    /// <param name="tenantId">The tenant to stamp every field definition with.</param>
    /// <exception cref="InvalidDataException">
    /// Thrown when <paramref name="json"/> is not valid JSON, does not match the
    /// expected shape, or contains a field entry missing its fieldId.
    /// </exception>
    public static IReadOnlyList<FieldDefinition> LoadFromJson(string json, Guid tenantId)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            throw new InvalidDataException("Data dictionary JSON is empty.");
        }

        DataDictionaryDocument? document;
        try
        {
            document = JsonSerializer.Deserialize<DataDictionaryDocument>(json, SerializerOptions);
        }
        catch (JsonException ex)
        {
            throw new InvalidDataException($"Data dictionary JSON is malformed: {ex.Message}", ex);
        }

        if (document is null)
        {
            throw new InvalidDataException("Data dictionary JSON deserialised to null.");
        }

        if (document.Fields is null)
        {
            throw new InvalidDataException("Data dictionary JSON is missing the required \"fields\" array.");
        }

        var results = new List<FieldDefinition>(document.Fields.Count);

        foreach (var entry in document.Fields)
        {
            if (string.IsNullOrWhiteSpace(entry.FieldId))
            {
                throw new InvalidDataException(
                    $"Data dictionary entry \"{entry.Name}\" is missing its required fieldId.");
            }

            var domain = entry.Domain ?? string.Empty;

            results.Add(new FieldDefinition
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                FieldId = entry.FieldId,
                Name = entry.Name ?? string.Empty,
                Domain = domain,
                DataType = FieldDataTypeParser.Parse(entry.DataType),
                PicklistOptionsRaw = entry.AllowedValues,
                Comments = entry.Comments,
                Notes = entry.Notes,
                IsSensitive = SensitiveDomains.Contains(domain),
                IsActive = true,
                AppearsInForms = entry.AppearsIn?.ToList() ?? new List<string>()
            });
        }

        return results;
    }

    /// <summary>Summarises a set of field definitions as (total field count, distinct domain count).</summary>
    public static (int fields, int domains) Stats(IEnumerable<FieldDefinition> definitions)
    {
        var materialised = definitions as ICollection<FieldDefinition> ?? definitions.ToList();
        var domainCount = materialised
            .Select(d => d.Domain)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();

        return (materialised.Count, domainCount);
    }

    /// <summary>Root shape of DataDictionarySeed.json.</summary>
    private sealed class DataDictionaryDocument
    {
        [JsonPropertyName("source")]
        public string? Source { get; set; }

        [JsonPropertyName("generated")]
        public string? Generated { get; set; }

        [JsonPropertyName("fieldCount")]
        public int FieldCount { get; set; }

        [JsonPropertyName("fields")]
        public List<DataDictionaryFieldEntry>? Fields { get; set; }
    }

    /// <summary>Shape of one entry in DataDictionarySeed.json's "fields" array.</summary>
    private sealed class DataDictionaryFieldEntry
    {
        [JsonPropertyName("fieldId")]
        public string? FieldId { get; set; }

        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("domain")]
        public string? Domain { get; set; }

        [JsonPropertyName("comments")]
        public string? Comments { get; set; }

        [JsonPropertyName("dataType")]
        public string? DataType { get; set; }

        [JsonPropertyName("allowedValues")]
        public string? AllowedValues { get; set; }

        [JsonPropertyName("notes")]
        public string? Notes { get; set; }

        [JsonPropertyName("appearsIn")]
        public List<string>? AppearsIn { get; set; }
    }
}
