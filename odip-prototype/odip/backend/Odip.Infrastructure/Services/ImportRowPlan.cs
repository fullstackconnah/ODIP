using Odip.Application.DTOs;

namespace Odip.Infrastructure.Services;

/// <summary>One row of an import on its way through preview or commit: its status, the reasons and warnings to show, and the DTO to create.</summary>
public sealed class ImportRowPlan
{
    public required int RowNumber { get; init; }
    /// <summary>Who the row is about. A funding row's becomes the name of the participant it matched.</summary>
    public required string Name { get; set; }
    public ImportRowStatus Status { get; private set; } = ImportRowStatus.Ready;
    public List<string> Reasons { get; } = new();
    /// <summary>What may be wrong and wants a look before importing (a number that names someone else, a contact left out).</summary>
    public List<string> Warnings { get; } = new();
    /// <summary>What the row does that is worth knowing but needs no check (categories 01 to 04 added into Core).</summary>
    public List<string> Notes { get; } = new();
    /// <summary>What the row will create, as read from the file (a funding row's category, management, amount and dates); null when it has nothing to show.</summary>
    public string? Detail { get; set; }
    public string? SkipReason { get; private set; }
    /// <summary>What duplicates are found by (a normalised NDIS number or email), or who a funding row is for; null when the row has none.</summary>
    public string? DuplicateKey { get; init; }
    public CreateParticipantDto? Participant { get; init; }
    public CreateStaffDto? Staff { get; init; }
    /// <summary>A funding row as read, with its participant once matched (ImportFundingRows).</summary>
    public ImportFundingLine? Funding { get; set; }
    /// <summary>An upcoming-shifts row as read, with the dates it makes shifts on (ImportShiftRows).</summary>
    public ImportShiftLine? Shift { get; set; }
    /// <summary>The Draft shifts an upcoming-shifts row will make, checked and ready to save.</summary>
    public List<Odip.Domain.Rostering.Shift> Shifts { get; } = new();

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

    public ImportRowDto ToDto() => new(RowNumber, Name, Status, Reasons, Warnings, SkipReason, Notes, Detail);

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
