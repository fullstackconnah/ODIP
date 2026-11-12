using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The one place that decides how an answer is written onto a row of the fixed participant grids
/// (consents, health conditions, ADL, checklist, community-access risk). The single-row PUT
/// controllers and the participant saves (wizard, Update, PATCH, caregiver accept) all call these,
/// so a rule changed here changes every screen. Free-text answers are trimmed and a blank one
/// becomes null.
/// </summary>
public static class ParticipantGridRules
{
    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    /// <summary>
    /// Re-stamps <see cref="ParticipantConsent.RecordedAt"/> only when <see cref="ParticipantConsent.Granted"/>
    /// actually changes — a compliance timestamp should track when the decision was (re-)made, not get
    /// bumped on every unrelated save of the same answer. Signed-by/date are not hard-enforced against
    /// Granted (a caller may record ahead of a formal signature pass, per ParticipantConsent's type doc).
    /// </summary>
    public static void ApplyAnswer(ParticipantConsent row, bool? granted, string? signedByName, DateOnly? signedDate)
    {
        if (row.Granted != granted)
            row.RecordedAt = granted.HasValue ? DateTime.UtcNow : null;
        row.Granted = granted;
        row.SignedByName = Clean(signedByName);
        row.SignedDate = signedDate;
        row.UpdatedAt = DateTime.UtcNow;
    }

    private static readonly DateOnly EarliestSignedDate = new(2000, 1, 1);

    /// <summary>The 400 text for a consent signed date after the provider's <paramref name="today"/> or before 2000-01-01; null for no date or a date in range.</summary>
    public static string? SignedDateError(DateOnly? signedDate, DateOnly today) =>
        signedDate is not { } d ? null
        : d > today ? "The signed date can't be in the future."
        : d < EarliestSignedDate ? "The signed date must be in 2000 or later."
        : null;

    /// <summary>The first <see cref="SignedDateError"/> among a participant save's consents; null when none is refused.</summary>
    public static string? ConsentDateError(IEnumerable<CreateParticipantConsentDto>? consents, DateOnly today) =>
        consents?.Select(c => SignedDateError(c.SignedDate, today)).FirstOrDefault(e => e != null);

    /// <summary>As <see cref="ConsentDateError(IEnumerable{CreateParticipantConsentDto}?, DateOnly)"/>, but a consent whose date equals the stored row's for the same type is not checked: a legacy date saves as it was.</summary>
    public static string? ConsentDateError(IEnumerable<CreateParticipantConsentDto>? consents, DateOnly today, IEnumerable<ParticipantConsent> stored) =>
        ConsentDateError(consents?.Where(c => !stored.Any(s => s.ConsentType == c.ConsentType && s.SignedDate == c.SignedDate)), today);

    /// <summary>
    /// Writes the answer onto <paramref name="row"/> and saves. A new row that loses the first-save race on the (participant, type) unique index is
    /// dropped, the winner's row is loaded and given this answer, and the save runs once more: last write wins and the caller gets the stored row.
    /// Any other failure, or a race on a row that was not new, throws.
    /// </summary>
    public static async Task<ParticipantConsent> SaveConsentAnswerAsync(OdipDbContext db, ParticipantConsent row, bool? granted, string? signedByName, DateOnly? signedDate, CancellationToken ct)
    {
        ApplyAnswer(row, granted, signedByName, signedDate);
        try
        {
            await db.SaveChangesAsync(ct);
            return row;
        }
        catch (DbUpdateException ex) when (db.Entry(row).State == EntityState.Added
            && ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "IX_ParticipantConsents_ParticipantId_ConsentType" })
        {
            db.Entry(row).State = EntityState.Detached;
            var stored = await db.ParticipantConsents.FirstAsync(c => c.ParticipantId == row.ParticipantId && c.ConsentType == row.ConsentType, ct);
            ApplyAnswer(stored, granted, signedByName, signedDate);
            await db.SaveChangesAsync(ct);
            return stored;
        }
    }

    /// <summary>
    /// As <see cref="SaveConsentAnswerAsync"/> for the other (participant, type) grid rows: applies the answer, saves, and on a first-save race lost
    /// to the named unique index, drops the new row, reloads the winner with <paramref name="reload"/>, applies the answer to it and saves once more.
    /// </summary>
    public static async Task<T> SaveGridAnswerAsync<T>(OdipDbContext db, T row, string constraintName, Action<T> apply, Func<CancellationToken, Task<T>> reload, CancellationToken ct)
        where T : class
    {
        apply(row);
        try
        {
            await db.SaveChangesAsync(ct);
            return row;
        }
        catch (DbUpdateException ex) when (db.Entry(row).State == EntityState.Added
            && ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg && pg.ConstraintName == constraintName)
        {
            db.Entry(row).State = EntityState.Detached;
            var stored = await reload(ct);
            apply(stored);
            await db.SaveChangesAsync(ct);
            return stored;
        }
    }

    public static void ApplyAnswer(ParticipantHealthCondition row, bool? has, string? severity, bool? planProvided, bool? trainingRequired, string? notes)
    {
        row.Has = has;
        row.Severity = Clean(severity);
        row.PlanProvided = planProvided;
        row.TrainingRequired = trainingRequired;
        row.Notes = Clean(notes);
        row.UpdatedAt = DateTime.UtcNow;
    }

    public static void ApplyAnswer(ParticipantAdlAssessment row, AdlLevel? level, string? notes, string? howToHelpNotes)
    {
        row.Level = level;
        row.Notes = Clean(notes);
        row.HowToHelpNotes = Clean(howToHelpNotes);
        row.UpdatedAt = DateTime.UtcNow;
    }

    public static void ApplyAnswer(ParticipantChecklistItem row, ChecklistItemValue? value, string? notes)
    {
        row.Value = value;
        row.Notes = Clean(notes);
        row.UpdatedAt = DateTime.UtcNow;
    }

    public static void ApplyAnswer(ParticipantCommunityAccessRiskItem row, RiskRatingLevel? rating, string? strategyNotes)
    {
        row.Rating = rating;
        row.StrategyNotes = Clean(strategyNotes);
        row.UpdatedAt = DateTime.UtcNow;
    }
}
