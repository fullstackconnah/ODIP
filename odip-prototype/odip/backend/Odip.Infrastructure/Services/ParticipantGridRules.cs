using Odip.Domain.Entities;
using Odip.Domain.Enums;

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
