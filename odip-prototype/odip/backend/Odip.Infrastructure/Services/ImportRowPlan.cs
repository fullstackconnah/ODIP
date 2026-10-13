using Odip.Application.DTOs;

namespace Odip.Infrastructure.Services;

/// <summary>One row of an import on its way through preview or commit: its status, the reasons and warnings to show, and the DTO to create.</summary>
public sealed class ImportRowPlan
{
    public required int RowNumber { get; init; }
    public required string Name { get; init; }
    public ImportRowStatus Status { get; private set; } = ImportRowStatus.Ready;
    public List<string> Reasons { get; } = new();
    public List<string> Warnings { get; } = new();
    public string? SkipReason { get; private set; }
    /// <summary>What duplicates are found by (a normalised NDIS number or email); null when the row has none.</summary>
    public string? DuplicateKey { get; init; }
    public CreateParticipantDto? Participant { get; init; }
    public CreateStaffDto? Staff { get; init; }

    /// <summary>The row can't be imported for this reason. A skipped row stays skipped: it would not be imported anyway.</summary>
    public void Refuse(string reason)
    {
        if (Status == ImportRowStatus.Skipped) return;
        Status = ImportRowStatus.Invalid;
        Reasons.Add(reason);
    }

    /// <summary>The row is left out, and its reasons no longer matter (it is already in ODIP, or it is the template's example).</summary>
    public void Skip(string reason)
    {
        Status = ImportRowStatus.Skipped;
        SkipReason = reason;
        Reasons.Clear();
    }

    public ImportRowDto ToDto() => new(RowNumber, Name, Status, Reasons, Warnings, SkipReason);

    /// <summary>A key seen on an earlier row makes every later row with it Can't import, naming the first row.</summary>
    public static void MarkFileDuplicates(List<ImportRowPlan> plans, string what)
    {
        var firstRow = new Dictionary<string, int>();
        foreach (var plan in plans)
        {
            if (plan.DuplicateKey is not { } key || plan.Status == ImportRowStatus.Skipped) continue;
            if (firstRow.TryGetValue(key, out var earlier)) plan.Refuse($"The same {what} is on row {earlier}.");
            else firstRow[key] = plan.RowNumber;
        }
    }
}
