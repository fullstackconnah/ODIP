using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// PD-5: auto-generates and keeps in sync a <see cref="ParticipantNote"/> per safety-critical
/// field group (allergies, behaviours of concern, falls risk, risks/hazards, restrictive
/// practices) — see SPEC-03 §PD-5 for the full design. Idempotency is keyed on
/// (ParticipantId, SourceKey), enforced by a partial unique index (see
/// <see cref="OdipDbContext"/>'s ParticipantNote configuration) — this service is the only
/// writer that ever sets <see cref="ParticipantNote.SourceKey"/>, and it never clears one once
/// set (see <see cref="ParticipantNote.IsManuallyEdited"/>'s doc for why).
///
/// Every method here only mutates the EF change tracker — it never calls
/// <c>SaveChangesAsync</c> itself — so the caller's own single <c>SaveChangesAsync</c> commits
/// the triggering write and the note write together, in one transaction. Same "mutate the
/// tracker only" idiom as <see cref="StaffCompatibilityLinkService"/>.
/// </summary>
public class SafetyNoteSyncService
{
    public const string AllergiesKey = "safety:allergies";
    public const string BehavioursOfConcernKey = "safety:behavioursOfConcern";
    public const string RestrictivePracticesKey = "safety:restrictivePractices";
    public const string RisksHazardsKey = "safety:risksHazards";
    public const string FallsRiskKey = "safety:fallsRisk";

    private readonly OdipDbContext _db;
    public SafetyNoteSyncService(OdipDbContext db) => _db = db;

    /// <summary>A category's computed state at the moment of a sync pass: whether the source
    /// value is "present" (non-empty), its normalised value snapshot, and freshly generated
    /// title/body text.</summary>
    private readonly record struct CategoryState(bool IsPresent, string Snapshot, string Title, string Body);

    // ── Public entry points — one per trigger path, per SPEC-03's Trigger coverage table ─────

    /// <summary>
    /// Syncs the four categories sourced directly off a <see cref="Participant"/>'s own columns
    /// (allergies, behaviours of concern, falls risk, and the risks/hazards flat fields plus its
    /// active <see cref="ParticipantRiskEntry"/> rows). Called from
    /// <c>ParticipantsController.Create</c>/<c>Update</c>/<c>Patch</c>.
    /// </summary>
    public async Task SyncFromParticipantAsync(Participant p, CancellationToken ct)
    {
        await SyncCategoryAsync(p.Id, AllergiesKey, ComputeAllergiesState(p), ct);
        await SyncCategoryAsync(p.Id, BehavioursOfConcernKey, ComputeBehavioursOfConcernState(p), ct);
        await SyncCategoryAsync(p.Id, FallsRiskKey, ComputeFallsRiskState(p), ct);
        await SyncCategoryAsync(p.Id, RisksHazardsKey, await ComputeRisksHazardsStateAsync(p, ct), ct);
    }

    /// <summary>
    /// Syncs only the risks/hazards category — called from <see cref="ParticipantRiskEntriesController"/>'s
    /// Create/Update/Delete (the entries collection's ongoing edit path, distinct from a
    /// whole-participant save). Loads the participant fresh since this controller doesn't already
    /// have it tracked.
    /// </summary>
    public async Task SyncRiskEntryNotesAsync(Guid participantId, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct);
        if (participant == null) return;
        await SyncCategoryAsync(participant.Id, RisksHazardsKey, await ComputeRisksHazardsStateAsync(participant, ct), ct);
    }

    /// <summary>
    /// Syncs only the restrictive-practices category. Called from
    /// <see cref="RestrictivePracticesController"/>'s four actions, in the same place that
    /// controller already recomputes <see cref="Participant.HasRestrictivePracticeFlag"/> — this
    /// method trusts that value rather than re-deriving it.
    /// </summary>
    public async Task SyncRestrictivePracticeNoteAsync(Participant p, CancellationToken ct)
    {
        await SyncCategoryAsync(p.Id, RestrictivePracticesKey, ComputeRestrictivePracticeState(p), ct);
    }

    /// <summary>
    /// PD-5 item 5d: bounded read-time reconciliation safety net, invoked from
    /// <c>ParticipantNotesController.GetForParticipant</c>. For any of the 5 categories with a
    /// non-empty current value and no existing note for its SourceKey, generates one inline. This
    /// is a fixed 5-category pass keyed off data already needed to render the page (one
    /// participant load, one risk-entries query, one change-tracker scan per category) — it never
    /// runs per-note, so it can't turn the list endpoint into an N+1, and it never writes anything
    /// for a category that already has a note (whether manual, auto, drifted, or archived) — only
    /// a genuinely missing note triggers a write here.
    /// </summary>
    public async Task ReconcileForParticipantAsync(Guid participantId, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct);
        if (participant == null) return;

        await SyncFromParticipantAsync(participant, ct);
        await SyncRestrictivePracticeNoteAsync(participant, ct);
    }

    /// <summary>
    /// "Dismiss" action (PUT .../dismiss-drift): acknowledges drift without touching the note's
    /// text — advances SourceValueSnapshot to the current value and clears HasSourceDrift. No-ops
    /// (returns true, changes nothing) when the note has no drift to dismiss; returns false when
    /// the note isn't an auto-note or its participant can't be found, for the controller to 404 on.
    /// </summary>
    public async Task<bool> DismissDriftAsync(ParticipantNote note, CancellationToken ct)
    {
        if (note.SourceKey == null) return false;
        if (!note.HasSourceDrift) return true;

        var state = await ComputeCategoryStateAsync(note, ct);
        if (state == null) return false;

        note.SourceValueSnapshot = state.Value.Snapshot;
        note.HasSourceDrift = false;
        return true;
    }

    /// <summary>
    /// "Regenerate" action (PUT .../regenerate): replaces the note's text with freshly generated
    /// content, clears IsManuallyEdited (re-arming normal auto-sync), and refreshes the snapshot.
    /// No-ops (returns true, changes nothing) when there's no drift to regenerate from; returns
    /// false when the note isn't an auto-note or its participant can't be found.
    /// </summary>
    public async Task<bool> RegenerateAsync(ParticipantNote note, CancellationToken ct)
    {
        if (note.SourceKey == null) return false;
        if (!note.HasSourceDrift) return true;

        var state = await ComputeCategoryStateAsync(note, ct);
        if (state == null) return false;

        note.Title = state.Value.Title;
        note.Description = state.Value.Body;
        note.SourceValueSnapshot = state.Value.Snapshot;
        note.IsManuallyEdited = false;
        note.HasSourceDrift = false;
        note.IsArchived = !state.Value.IsPresent;
        note.UpdatedAt = DateTime.UtcNow;
        return true;
    }

    private async Task<CategoryState?> ComputeCategoryStateAsync(ParticipantNote note, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == note.ParticipantId, ct);
        if (participant == null) return null;

        return note.SourceKey switch
        {
            AllergiesKey => ComputeAllergiesState(participant),
            BehavioursOfConcernKey => ComputeBehavioursOfConcernState(participant),
            FallsRiskKey => ComputeFallsRiskState(participant),
            RisksHazardsKey => await ComputeRisksHazardsStateAsync(participant, ct),
            RestrictivePracticesKey => ComputeRestrictivePracticeState(participant),
            _ => null,
        };
    }

    // ── Category state computation ───────────────────────────────────

    private static CategoryState ComputeAllergiesState(Participant p)
    {
        var detail = p.AllergiesDetail?.Trim();
        var mgmt = p.AllergyManagementNotes?.Trim();
        var anaphylaxis = p.IsAnaphylaxisRisk == true;
        var isPresent = !string.IsNullOrEmpty(detail) || !string.IsNullOrEmpty(mgmt) || anaphylaxis;
        var snapshot = $"{detail}|{p.IsAnaphylaxisRisk}|{mgmt}";
        var body = BuildAllergiesBody(detail, anaphylaxis, mgmt);
        return new CategoryState(isPresent, snapshot, "Allergies (auto)", body);
    }

    private static CategoryState ComputeBehavioursOfConcernState(Participant p)
    {
        var current = p.BehavioursOfConcernCurrent == true;
        var history = p.BehavioursOfConcernFiveYearHistory == true;
        var isPresent = current || history;
        var snapshot = $"{p.BehavioursOfConcernCurrent}|{p.BehavioursOfConcernFiveYearHistory}";
        var body = BuildBehavioursOfConcernBody(current, history);
        return new CategoryState(isPresent, snapshot, "Behaviours of Concern (auto)", body);
    }

    private static CategoryState ComputeFallsRiskState(Participant p)
    {
        var isPresent = p.FallsRiskRating.HasValue;
        var snapshot = $"{p.FallsRiskRating}";
        var body = $"Falls risk rating: {p.FallsRiskRating}.";
        return new CategoryState(isPresent, snapshot, "Falls Risk (auto)", body);
    }

    private async Task<CategoryState> ComputeRisksHazardsStateAsync(Participant p, CancellationToken ct)
    {
        var summary = p.BehaviourRiskSummary?.Trim();
        var notes = p.Notes?.Trim();
        var activeEntries = await GetActiveRiskEntriesAsync(p.Id, ct);
        var isPresent = !string.IsNullOrEmpty(summary) || !string.IsNullOrEmpty(notes) || activeEntries.Count > 0;
        var snapshot = BuildRisksHazardsSnapshot(summary, notes, activeEntries);
        var body = BuildRisksHazardsBody(summary, notes, activeEntries);
        return new CategoryState(isPresent, snapshot, "Risks & Hazards (auto)", body);
    }

    private static CategoryState ComputeRestrictivePracticeState(Participant p)
    {
        var snapshot = p.HasRestrictivePracticeFlag ? "true" : "false";
        const string body = "This participant has one or more active restrictive practice register entries. See the Restrictive Practices tab for details.";
        return new CategoryState(p.HasRestrictivePracticeFlag, snapshot, "Restrictive Practices (auto)", body);
    }

    /// <summary>
    /// Reads active <see cref="ParticipantRiskEntry"/> rows for a participant, merging anything
    /// already tracked-but-not-yet-saved in this DbContext instance (e.g. the rows
    /// <c>ParticipantsController.Create</c>'s <c>RiskEntries</c> loop just <c>Add</c>ed, still
    /// pending the same <c>SaveChangesAsync</c>, or a row this request just <c>Remove</c>d) with
    /// anything already persisted. This is what lets the create-time sync call see a risk entry
    /// submitted alongside the new participant before it's actually hit the database, and what
    /// keeps the delete path from still counting a just-removed row as active.
    /// </summary>
    private async Task<List<ParticipantRiskEntry>> GetActiveRiskEntriesAsync(Guid participantId, CancellationToken ct)
    {
        var trackedEntries = _db.ChangeTracker.Entries<ParticipantRiskEntry>()
            .Where(e => e.Entity.ParticipantId == participantId)
            .ToList();

        // Every tracked id (deleted or not) is excluded from the DB query below — a row queued
        // for deletion in this same SaveChangesAsync must not still count as active just because
        // it hasn't hit the database yet.
        var trackedIds = trackedEntries.Select(e => e.Entity.Id).ToHashSet();

        var activeFromTracked = trackedEntries
            .Where(e => e.State != EntityState.Deleted && e.Entity.IsActive)
            .Select(e => e.Entity);

        var persisted = await _db.ParticipantRiskEntries
            .Where(r => r.ParticipantId == participantId && r.IsActive && !trackedIds.Contains(r.Id))
            .ToListAsync(ct);

        return activeFromTracked.Concat(persisted).OrderBy(e => e.Id).ToList();
    }

    private static string BuildRisksHazardsSnapshot(string? summary, string? notes, List<ParticipantRiskEntry> activeEntries)
    {
        var entriesPart = string.Join(";", activeEntries.Select(e => $"{e.AtRiskParty}:{e.Description}:{e.MitigationNotes}"));
        return $"{summary}|{notes}|{entriesPart}";
    }

    // ── Content generation ───────────────────────────────────────────

    private static string BuildAllergiesBody(string? detail, bool anaphylaxis, string? mgmt)
    {
        var lines = new List<string>();
        if (!string.IsNullOrEmpty(detail)) lines.Add($"Allergies: {detail}");
        if (anaphylaxis) lines.Add("Anaphylaxis risk: Yes.");
        if (!string.IsNullOrEmpty(mgmt)) lines.Add($"Management: {mgmt}");
        return lines.Count > 0 ? string.Join("\n", lines) : "No current allergy details on file.";
    }

    private static string BuildBehavioursOfConcernBody(bool current, bool history)
    {
        var lines = new List<string>();
        if (current) lines.Add("Behaviours of concern are currently present.");
        if (history) lines.Add("There is a five-year history of behaviours of concern.");
        return lines.Count > 0 ? string.Join("\n", lines) : "No current behaviours of concern on file.";
    }

    private static string BuildRisksHazardsBody(string? summary, string? notes, List<ParticipantRiskEntry> activeEntries)
    {
        var lines = new List<string>();
        if (!string.IsNullOrEmpty(summary)) lines.Add($"Summary: {summary}");
        if (!string.IsNullOrEmpty(notes)) lines.Add($"Notes: {notes}");
        foreach (var entry in activeEntries)
        {
            var line = $"Risk to {entry.AtRiskParty}: {entry.Description}";
            if (!string.IsNullOrEmpty(entry.MitigationNotes)) line += $" (Mitigation: {entry.MitigationNotes})";
            lines.Add(line);
        }
        return lines.Count > 0 ? string.Join("\n", lines) : "No current risks/hazards on file.";
    }

    // ── Shared algorithm ─────────────────────────────────────────────

    /// <summary>
    /// The sync algorithm shared by every category, per SPEC-03 §PD-5 "Sync algorithm":
    /// <list type="number">
    /// <item><description>Value empty + auto-note exists, not manually edited → archive it.</description></item>
    /// <item><description>Value empty + auto-note exists, manually edited → leave content/archived state untouched; recompute drift.</description></item>
    /// <item><description>Value present + no note → create one.</description></item>
    /// <item><description>Value present + note exists, not manually edited → update content if changed, un-archive, refresh snapshot.</description></item>
    /// <item><description>Value present + note exists, manually edited → leave content/archived state untouched; recompute drift only.</description></item>
    /// </list>
    /// </summary>
    private async Task SyncCategoryAsync(Guid participantId, string sourceKey, CategoryState state, CancellationToken ct)
    {
        var existing = _db.ChangeTracker.Entries<ParticipantNote>()
            .Select(e => e.Entity)
            .FirstOrDefault(n => n.ParticipantId == participantId && n.SourceKey == sourceKey);

        existing ??= await _db.ParticipantNotes
            .FirstOrDefaultAsync(n => n.ParticipantId == participantId && n.SourceKey == sourceKey, ct);

        if (!state.IsPresent)
        {
            if (existing == null) return;

            if (!existing.IsManuallyEdited)
            {
                existing.IsArchived = true;
                existing.SourceValueSnapshot = state.Snapshot;
                existing.HasSourceDrift = false;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                existing.HasSourceDrift = state.Snapshot != existing.SourceValueSnapshot;
            }
            return;
        }

        if (existing == null)
        {
            var note = new ParticipantNote
            {
                Id = Guid.NewGuid(),
                ParticipantId = participantId,
                SourceKey = sourceKey,
                Title = state.Title,
                Description = state.Body,
                CreatedByName = "System",
                SourceValueSnapshot = state.Snapshot,
                IsManuallyEdited = false,
                HasSourceDrift = false,
            };
            _db.ParticipantNotes.Add(note);
            return;
        }

        if (!existing.IsManuallyEdited)
        {
            // Idempotent no-op guard: skip the write entirely (no UpdatedAt bump) when nothing
            // about the generated content or archived state actually changed.
            var contentChanged = existing.Title != state.Title || existing.Description != state.Body;
            if (contentChanged)
            {
                existing.Title = state.Title;
                existing.Description = state.Body;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            if (existing.IsArchived)
            {
                existing.IsArchived = false;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            existing.SourceValueSnapshot = state.Snapshot;
            existing.HasSourceDrift = false;
        }
        else
        {
            existing.HasSourceDrift = state.Snapshot != existing.SourceValueSnapshot;
        }
    }
}
