using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Keeps a chemical-restraint medicine and its restrictive-practice register entry in step (M16). The invariant: at most one entry links a
/// medicine, and for a linked entry <c>IsActive == med.IsChemicalRestraint &amp;&amp; med.Status != Ceased</c> (On hold counts as not ceased).
/// Authorisation lives only on the entry. The two directions never call each other, so there is no loop: <see cref="SyncFromMedicationAsync"/>
/// writes only the entry (plus the participant flag and safety note), <see cref="ApplyEntryToMedication"/> only the medicine's tick.
/// Neither saves: the calling controller's single SaveChanges carries both writes in one transaction, and each writes only a value that changes,
/// so an in-step save bumps nothing and no one gets a spurious 409.
/// </summary>
public class RestraintRegisterSync
{
    private readonly OdipDbContext _db;
    private readonly SafetyNoteSyncService _notes;

    public RestraintRegisterSync(OdipDbContext db, SafetyNoteSyncService notes)
    {
        _db = db;
        _notes = notes;
    }

    /// <summary>What the medicine form sent about the entry. Null members mean "leave the entry's value".</summary>
    public sealed record RestraintAnswers(bool? Authorised, string? AuthorisedBy, DateOnly? AuthorisationDate, bool? RequiresReporting);

    /// <summary>"Risperidone 1 mg": the name used in every refusal and chip.</summary>
    public static string MedicineLabel(ParticipantMedication m) => $"{m.Name} {m.Strength}".Trim();

    /// <summary>The description of a NEW entry: "Name Strength – Purpose", absent parts dropped (en dash U+2013), capped at the column's 2000.</summary>
    public static string DefaultDescription(ParticipantMedication m)
    {
        var label = MedicineLabel(m);
        var purpose = m.Purpose?.Trim();
        var text = string.IsNullOrEmpty(purpose) ? label : string.IsNullOrEmpty(label) ? purpose : $"{label} – {purpose}";
        return text.Length > 2000 ? text[..2000] : text;
    }

    /// <summary>The entry linked to a medicine, merging rows this request has added or changed but not yet saved with the persisted one.</summary>
    public async Task<RestrictivePractice?> FindLinkedAsync(Guid medicationId, CancellationToken ct)
    {
        var tracked = _db.ChangeTracker.Entries<RestrictivePractice>()
            .Where(e => e.Entity.RelatedMedicationId == medicationId && e.State != EntityState.Deleted && e.State != EntityState.Detached)
            .Select(e => e.Entity)
            .FirstOrDefault();
        return tracked ?? await _db.RestrictivePractices.FirstOrDefaultAsync(rp => rp.RelatedMedicationId == medicationId, ct);
    }

    /// <summary>
    /// Brings the medicine's entry in step with the medicine: creates it on first need, (de)activates it, and writes the form's authorisation
    /// answers. Returns the entry (null when there is none and none is needed). Never saves.
    /// </summary>
    public async Task<RestrictivePractice?> SyncFromMedicationAsync(ParticipantMedication med, Participant participant, RestraintAnswers? answers, CancellationToken ct)
    {
        var entry = await FindLinkedAsync(med.Id, ct);
        var desiredActive = med.IsChemicalRestraint && med.Status != MedicationStatus.Ceased;
        if (entry == null && !desiredActive) return null;

        var activeChanged = false;
        var changed = false;
        if (entry == null)
        {
            entry = new RestrictivePractice
            {
                Id = Guid.NewGuid(),
                TenantId = participant.TenantId,
                ParticipantId = participant.Id,
                Type = RestrictivePracticeType.ChemicalRestraint,
                Description = DefaultDescription(med),
                RelatedMedicationId = med.Id,
                IsActive = true,
            };
            _db.RestrictivePractices.Add(entry);
            activeChanged = true;
        }
        else if (entry.IsActive != desiredActive)
        {
            entry.IsActive = desiredActive;
            activeChanged = changed = true;
        }

        if (med.IsChemicalRestraint && answers != null)
        {
            if (answers.Authorised == true)
            {
                var by = answers.AuthorisedBy?.Trim();
                if (entry.AuthorisedBy != by || entry.AuthorisationDate != answers.AuthorisationDate)
                {
                    entry.AuthorisedBy = by;
                    entry.AuthorisationDate = answers.AuthorisationDate;
                    entry.AuthorisationEndDate = null; // re-authorising through the medicine starts a fresh, open-ended authorisation
                    changed = true;
                }
            }
            else if (answers.Authorised == false && (entry.AuthorisedBy != null || entry.AuthorisationDate != null))
            {
                entry.AuthorisedBy = null;
                entry.AuthorisationDate = null;
                entry.AuthorisationEndDate = null;
                changed = true;
            }
            if (answers.RequiresReporting is { } report && entry.RequiresReporting != report)
            {
                entry.RequiresReporting = report;
                changed = true;
            }
        }

        if (changed && _db.Entry(entry).State != EntityState.Added) entry.UpdatedAt = DateTime.UtcNow;

        if (activeChanged)
        {
            // Every tracked row counts, not just this one: the startup backfill changes several entries of one participant before its single save.
            var tracked = _db.ChangeTracker.Entries<RestrictivePractice>().Where(e => e.Entity.ParticipantId == participant.Id).ToList();
            var trackedIds = tracked.Select(e => e.Entity.Id).ToList();
            participant.HasRestrictivePracticeFlag =
                tracked.Any(e => e.State != EntityState.Deleted && e.Entity.IsActive)
                || await _db.RestrictivePractices.AnyAsync(rp => rp.ParticipantId == participant.Id && rp.IsActive && !trackedIds.Contains(rp.Id), ct);
            await _notes.SyncRestrictivePracticeNoteAsync(participant, ct);
        }
        return entry;
    }

    /// <summary>Register to medicine: the medicine's tick follows the entry's active state. Returns whether it wrote.</summary>
    public static bool ApplyEntryToMedication(RestrictivePractice entry, ParticipantMedication med)
    {
        if (med.IsChemicalRestraint == entry.IsActive) return false;
        med.IsChemicalRestraint = entry.IsActive;
        med.UpdatedAt = DateTime.UtcNow;
        return true;
    }
}
