using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Retention;

public enum PurgeResult { Purged, NotFound, NotDue, AlreadyPurged, Failed }

public sealed record PurgeOutcome(PurgeResult Result, PurgeRecord? Record);

/// <summary>
/// The confirmed, permanent delete of one archived participant and every row that holds their data (PLAN sections 3-5), in ONE transaction: all of it or none of it.
/// ExecuteDelete/ExecuteUpdate bypass the SaveChanges audit interceptor on purpose (the audit rows for the purged ids are deleted too); only the tombstone is saved the normal way.
/// A PostgreSQL feature (InMemory has no ExecuteDelete or transactions), so the engine is tested by PostgreSQL facts.
/// </summary>
public static class ParticipantPurger
{
    public static async Task<PurgeOutcome> PurgeAsync(OdipDbContext db, Guid tenantId, Guid participantId, Guid confirmedById, string confirmedByName, string reason, TimeProvider clock, CancellationToken ct)
    {
        if (await ExistingAsync(db, tenantId, participantId, ct) is { } done) return new(PurgeResult.AlreadyPurged, done);

        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);

            // F3: lock the participant's row, then re-check "due" inside the lock, so a restore or a new claim that raced the pre-check cannot slip a purge through.
            var locked = await db.Database.SqlQuery<int>($"SELECT 1 AS \"Value\" FROM \"Participants\" WHERE \"Id\" = {participantId} AND \"TenantId\" = {tenantId} FOR UPDATE").ToListAsync(ct);
            // Gone already: either never theirs (404) or a double click whose twin committed first while this one waited on the lock.
            if (locked.Count == 0) return await ExistingAsync(db, tenantId, participantId, ct) is { } twin ? new(PurgeResult.AlreadyPurged, twin) : new(PurgeResult.NotFound, null);
            var status = await RetentionClock.StatusAsync(db, tenantId, participantId, clock, ct);
            if (status is not { Due: true }) return new(PurgeResult.NotDue, null);

            var scope = new PurgeScope(db, tenantId, participantId);
            var kept = await scope.Q<Participant>().Where(p => p.Id == participantId).Select(p => p.PlanManagerContactId).FirstAsync(ct);

            // Candidates for O3/F2, captured before the links go: the contacts this participant is linked to, and their plan manager.
            var contactIds = await scope.Q<ParticipantContact>().Where(c => c.ParticipantId == participantId).Select(c => c.ContactId).ToListAsync(ct);
            if (kept is { } planManager) contactIds.Add(planManager);
            var personIds = await scope.Q<ParticipantContactRole>().Where(r => r.TenantId == tenantId && r.ParticipantId == participantId).Select(r => r.PersonId).Distinct().ToListAsync(ct);

            // Kept rows that point at a purged row lose the link first (the DB constraints are NO ACTION or SetNull, and ClientSetNull has no cascade in raw SQL).
            var purgedIncidents = scope.Incidents;
            await scope.Q<Complaint>().Where(c => c.IncidentReportId != null && purgedIncidents.Contains(c.IncidentReportId.Value)).ExecuteUpdateAsync(u => u.SetProperty(c => c.IncidentReportId, (Guid?)null), ct);
            // An incident that stays (it involves someone else) loses each link that points at a purged row, one update per link.
            var keptIncidents = scope.Q<IncidentReport>().Where(i => !purgedIncidents.Contains(i.Id));
            await keptIncidents.Where(i => i.ParticipantBookingId != null && scope.Bookings.Contains(i.ParticipantBookingId.Value)).ExecuteUpdateAsync(u => u.SetProperty(i => i.ParticipantBookingId, (Guid?)null), ct);
            await keptIncidents.Where(i => i.ShiftId != null && scope.Shifts.Contains(i.ShiftId.Value)).ExecuteUpdateAsync(u => u.SetProperty(i => i.ShiftId, (Guid?)null), ct);
            await keptIncidents.Where(i => i.ShiftNoteId != null && scope.ShiftNotes.Contains(i.ShiftNoteId.Value)).ExecuteUpdateAsync(u => u.SetProperty(i => i.ShiftNoteId, (Guid?)null), ct);
            await keptIncidents.Where(i => i.MedicationAdministrationId != null && scope.MedAdministrations.Contains(i.MedicationAdministrationId.Value)).ExecuteUpdateAsync(u => u.SetProperty(i => i.MedicationAdministrationId, (Guid?)null), ct);
            await keptIncidents.Where(i => i.RestrictivePracticeId != null && scope.Practices.Contains(i.RestrictivePracticeId.Value)).ExecuteUpdateAsync(u => u.SetProperty(i => i.RestrictivePracticeId, (Guid?)null), ct);
            await scope.Q<InvoiceLine>().Where(l => l.ClaimLineItemId != null && scope.ClaimLines.Contains(l.ClaimLineItemId.Value) && !scope.Invoices.Contains(l.InvoiceId))
                .ExecuteUpdateAsync(u => u.SetProperty(l => l.ClaimLineItemId, (Guid?)null), ct);

            // O2: a batch file that held one of the purged lines is blanked (its row and totals stay).
            var batchIds = scope.Q<ClaimBatchLine>().Where(l => l.ClaimLineItemId != null && scope.ClaimLines.Contains(l.ClaimLineItemId.Value)).Select(l => l.BatchId);
            var filesCleared = await scope.Q<ClaimBatch>().Where(b => batchIds.Contains(b.Id) && b.Content.Length > 0).ExecuteUpdateAsync(u => u.SetProperty(b => b.Content, new byte[0]), ct);

            var counts = new Dictionary<string, int>();
            foreach (var step in PurgePlan.Steps)
            {
                if (step.Ids(scope) is { } ids) foreach (var id in await ids.ToListAsync(ct)) scope.Purged.Add(id);
                var n = await step.DeleteAsync(scope, ct);
                if (n > 0) counts[step.Table] = n;
            }

            // O3/F2: a contact goes only when nothing else references it after the purge (a shared contact stays). shortcut: a link added to the same contact between this
            // statement's snapshot and the commit is cascaded away; lock the candidates FOR UPDATE first if that race ever matters.
            if (contactIds.Count > 0)
            {
                var orphans = await scope.Q<Contact>().Where(c => contactIds.Contains(c.Id)
                    && !scope.Q<ParticipantContact>().Any(l => l.ContactId == c.Id) && !scope.Q<Participant>().Any(p => p.PlanManagerContactId == c.Id)).Select(c => c.Id).ToListAsync(ct);
                if (orphans.Count > 0)
                {
                    foreach (var id in orphans) scope.Purged.Add(id);
                    counts["Contacts"] = await scope.Q<Contact>().Where(c => orphans.Contains(c.Id)).ExecuteDeleteAsync(ct);
                }
            }
            // The people the participant's contact roles named go the same way, unless something else still uses them.
            if (personIds.Count > 0)
            {
                var gone = await scope.Q<Person>().Where(p => p.TenantId == tenantId && personIds.Contains(p.Id)
                    && !scope.Q<ParticipantContactRole>().Any(r => r.PersonId == p.Id)
                    && !scope.Q<ServiceAgreementShare>().Any(h => h.RecipientPersonId == p.Id)
                    && !scope.Q<ServiceAgreementDraftApproval>().Any(a => a.AgreedByPersonId == p.Id)).Select(p => p.Id).ToListAsync(ct);
                if (gone.Count > 0)
                {
                    foreach (var id in gone) scope.Purged.Add(id);
                    counts["People"] = await scope.Q<Person>().Where(p => gone.Contains(p.Id)).ExecuteDeleteAsync(ct);
                }
            }

            // L7: the audit rows of every purged row (no tenant column; the ids are Guids).
            var audited = scope.PurgedIds;
            var auditRows = await scope.Q<AuditLog>().Where(a => a.EntityId == participantId || audited.Contains(a.EntityId)).ExecuteDeleteAsync(ct);
            if (auditRows > 0) counts["AuditLogs"] = auditRows;

            var record = new PurgeRecord
            {
                Id = Guid.NewGuid(), TenantId = tenantId, EntityType = PurgeRecord.ParticipantType, EntityId = participantId,
                ConfirmedById = confirmedById, ConfirmedByName = confirmedByName, ConfirmedAt = clock.GetUtcNow(), Reason = reason,
                RetentionStartsOn = status.Start, RetentionStartEstimated = status.Estimated, DueOn = status.DueOn,
                RowCounts = JsonSerializer.Serialize(counts), ClaimBatchFilesCleared = filesCleared,
            };
            db.PurgeRecords.Add(record);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new(PurgeResult.Purged, record);
        }
        catch (Exception e) when (e is DbUpdateException or PostgresException)
        {
            db.ChangeTracker.Clear();
            // A double click raced: the other request committed the record first (unique index), so answer with it.
            return await ExistingAsync(db, tenantId, participantId, ct) is { } raced ? new(PurgeResult.AlreadyPurged, raced) : new(PurgeResult.Failed, null);
        }
    }

    public static Task<PurgeRecord?> ExistingAsync(OdipDbContext db, Guid tenantId, Guid participantId, CancellationToken ct) =>
        db.PurgeRecords.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking()
            .FirstOrDefaultAsync(r => r.TenantId == tenantId && r.EntityType == PurgeRecord.ParticipantType && r.EntityId == participantId, ct);
}
