using Odip.Domain.Entities;

namespace Odip.Application.DTOs;

/// <summary>Where imported participants land: "Already receiving services" (Active) or "New onboarding" (the Onboarding checklist).</summary>
public enum ImportLanding { Active, Onboarding }

/// <summary>What an upcoming-shifts file holds: one dated row per shift, or a weekly pattern repeated over a span.</summary>
public enum ImportShiftShape { Dated, Pattern }

/// <summary>Ready to import; Skipped (already in ODIP, or the template's example row); Invalid ("Can't import", with reasons).</summary>
public enum ImportRowStatus { Ready, Skipped, Invalid }

public record ImportFieldDto(string Key, string Label, bool Required);

/// <summary>A column of the uploaded file, the field it is matched to (null: Don't import), and a note when ODIP won't import it.</summary>
public record ImportColumnDto(int Index, string Header, string? Field, string? Note);

/// <summary>One row's outcome. <see cref="Warnings"/> want a look before importing; <see cref="Notes"/> only say what the row does; <see cref="Detail"/> is what it will create.</summary>
public record ImportRowDto(int RowNumber, string Name, ImportRowStatus Status, List<string> Reasons, List<string> Warnings, string? SkipReason, List<string> Notes, string? Detail);

/// <summary>What a preview found. <see cref="CreateCount"/> is what Import would create: the ready rows or, for funding plans, the plans they make.</summary>
public record ImportPreviewDto(List<ImportFieldDto> Fields, List<ImportColumnDto> Columns, List<ImportRowDto> Rows,
    int ReadyCount, int SkippedCount, int InvalidCount, DateTime? PreviouslyImportedAt, int CreateCount,
    int? UnfilledCount = null, DateOnly? FirstDate = null, DateOnly? LastDate = null, int? WeekCount = null, bool ReadinessEnforced = false);

/// <summary>What a commit did. <see cref="Replayed"/>: the idempotency key matched an earlier batch, which is answered instead (with no rows).</summary>
public record ImportResultDto(Guid BatchId, int CreatedCount, int SkippedCount, int FailedCount, List<ImportRowDto> Rows, bool Replayed,
    DateOnly? FirstWeekStart = null, int? WeekCount = null, int? UnfilledCount = null);

public record ImportBatchDto(Guid Id, ImportKind Kind, string FileName, string CreatedByName, DateTime CreatedAt,
    int RowCount, int CreatedCount, int SkippedCount, int FailedCount, DateTime? UndoneAt, string? UndoneByName, int? KeptCount = null);

/// <summary>A record that has changed since its import, so the batch cannot be undone.</summary>
public record ImportUndoBlockerDto(Guid EntityId, string Name, string Reason);

/// <summary>One staff member's sign-in invite: the account made or found (FirebaseAccountStatus), or why there is none.</summary>
public record ImportInviteDto(Guid StaffId, string Name, string Email, string? FirebaseAccount, string? Error);

/// <summary>One request's invites, how many never-signed-in staff are still after them, and the cursor to send again with (the last id done).</summary>
public record ImportInvitesDto(List<ImportInviteDto> Invites, int Left, Guid? Next);

/// <summary>
/// Where a staff import's people stand for sign-in invites, each in exactly one count: still to invite, invited before but not signed in, signed in,
/// or who cannot be invited (archived, no email, or an address the app invented).
/// </summary>
public record ImportInviteCountDto(int ToInvite, int InvitedBefore, int SignedIn, int CannotInvite);

/// <summary>The people a browser just sent a sign-in invite email to (Firebase accepted each send).</summary>
public record InvitesSentRequest(List<Guid>? UserIds);
