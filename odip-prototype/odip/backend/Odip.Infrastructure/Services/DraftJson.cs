using System.Text.Json;
using System.Text.Json.Serialization;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The JSON a draft revision keeps beside its rows: each block as the engine takes it, the worker requirements of a block, and what the engine answered when the
/// revision was saved. Written and read here and nowhere else, with the API's own conventions (names in camel case, enums as their names, a null left out), so what is
/// stored is also what the screen's quote request and answer look like.
/// </summary>
public static class DraftJson
{
    public static JsonSerializerOptions Options { get; } = Build();

    private static JsonSerializerOptions Build()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }

    public static string Write(PlanBlock block) => JsonSerializer.Serialize(block, Options);

    public static string Write(DraftBlockRequirementsDto requirements) => JsonSerializer.Serialize(requirements, Options);

    /// <summary>The answer of the engine without its per-occurrence lines: the revision's totals, issues, notices, holiday occurrences and open questions.</summary>
    public static string Write(PlanQuote quote) => JsonSerializer.Serialize(quote with { Lines = Array.Empty<PlannedLine>() }, Options);

    /// <summary>The block as stored, or an empty block when the stored text cannot be read (a draft is never refused for its storage; the blocks list says what was kept).</summary>
    public static PlanBlock ReadBlock(string json) => Read<PlanBlock>(json) ?? new PlanBlock();

    public static DraftBlockRequirementsDto ReadRequirements(string json) => Read<DraftBlockRequirementsDto>(json) ?? new DraftBlockRequirementsDto();

    public static PlanQuote? ReadQuote(string? json) => string.IsNullOrWhiteSpace(json) ? null : Read<PlanQuote>(json);

    /// <summary>One block row as the API shows it. A block whose text cannot be read is an empty block that says so (<see cref="DraftBlockDto.Unreadable"/>), not one that looks planned.</summary>
    public static DraftBlockDto ToDto(ServiceAgreementDraftBlock row)
    {
        var block = Read<PlanBlock>(row.BlockJson);
        return new DraftBlockDto { Block = block ?? new PlanBlock(), Requirements = ReadRequirements(row.RequirementsJson), Unreadable = block is null };
    }

    private static T? Read<T>(string json) where T : class
    {
        try { return JsonSerializer.Deserialize<T>(json, Options); }
        catch (JsonException) { return null; }
    }
}
