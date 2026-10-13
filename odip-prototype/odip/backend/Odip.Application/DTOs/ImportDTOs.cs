using Odip.Domain.Entities;

namespace Odip.Application.DTOs;

/// <summary>Where imported participants land: "Already receiving services" (Active) or "New onboarding" (the Onboarding checklist).</summary>
public enum ImportLanding { Active, Onboarding }

/// <summary>Ready to import; Skipped (already in ODIP, or the template's example row); Invalid ("Can't import", with reasons).</summary>
public enum ImportRowStatus { Ready, Skipped, Invalid }

public record ImportFieldDto(string Key, string Label, bool Required);

/// <summary>A column of the uploaded file, the field it is matched to (null: Don't import), and a note when ODIP won't import it.</summary>
public record ImportColumnDto(int Index, string Header, string? Field, string? Note);

public record ImportRowDto(int RowNumber, string Name, ImportRowStatus Status, List<string> Reasons, List<string> Warnings, string? SkipReason);

public record ImportPreviewDto(List<ImportFieldDto> Fields, List<ImportColumnDto> Columns, List<ImportRowDto> Rows,
    int ReadyCount, int SkippedCount, int InvalidCount, DateTime? PreviouslyImportedAt);

/// <summary>What a commit did. <see cref="Replayed"/>: the idempotency key matched an earlier batch, which is answered instead (with no rows).</summary>
public record ImportResultDto(Guid BatchId, int CreatedCount, int SkippedCount, int FailedCount, List<ImportRowDto> Rows, bool Replayed);

public record ImportBatchDto(Guid Id, ImportKind Kind, string FileName, string CreatedByName, DateTime CreatedAt,
    int RowCount, int CreatedCount, int SkippedCount, int FailedCount, DateTime? UndoneAt, string? UndoneByName);

/// <summary>A record that has changed since its import, so the batch cannot be undone.</summary>
public record ImportUndoBlockerDto(Guid EntityId, string Name, string Reason);
