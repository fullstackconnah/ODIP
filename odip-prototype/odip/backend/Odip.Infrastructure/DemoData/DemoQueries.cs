using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.DemoData;

public sealed record DemoParticipantRow(Guid Id, string? NdisNumber, string FirstName, string LastName, bool IsActive, bool IsDraft);

public sealed record RecordedSlot(Guid MedicationId, DateTime ScheduledAt);

public sealed record TakenCell(Guid Id, Guid UserId, Guid ParticipantId);

public sealed record ActiveContactRole(Guid Id, Guid ParticipantId);

public sealed record OpenCoverageTask(string? SourceKey, Guid? ShiftId, Guid? LeaveRequestId);

public sealed record LevelCell(Guid UserId, Guid ParticipantId, CompatibilityLevel Level);

public sealed record HolidayRow(DateOnly Date, string Name);

/// <summary>
/// Every database query the top-up makes, in one place. They are written as plain LINQ over a context so that
/// <c>DemoQueryTranslationTests</c> can ask the Npgsql provider (without a server) for the SQL of each one: EF InMemory, which runs every
/// other demo test, will happily evaluate a query Npgsql cannot translate, and the first anyone would hear of it is a failed tick on the host.
/// The filters stay selective in SQL (a status, a date) and anything that grows with the weeks since the top-up began is matched in memory
/// instead of being sent as an ever-longer id list.
/// </summary>
public static class DemoQueries
{
    // ── maintainer and directory ─────────────────────────────────────────────

    /// <summary>Tenants named Demo: the maintainer then checks the domain and that exactly one is active.</summary>
    public static IQueryable<Tenant> DemoTenantCandidates(OdipDbContext db) =>
        db.Tenants.AsNoTracking().Where(t => t.Name == DemoPeople.TenantName);

    public static IQueryable<string> ProviderState(OdipDbContext db) => db.ProviderSettings.AsNoTracking().Select(p => p.State);

    public static IQueryable<DemoParticipantRow> Participants(OdipDbContext db) =>
        db.Participants.Select(p => new DemoParticipantRow(p.Id, p.NdisNumber, p.FirstName, p.LastName, p.IsActive, p.IsDraft));

    /// <summary>"Insert-if-missing": which of these ids already exist (a primary-key probe, <c>"Id" = ANY(@ids)</c>).</summary>
    public static IQueryable<Guid> ExistingIds<T>(OdipDbContext db, Guid[] ids) where T : class =>
        db.Set<T>().IgnoreQueryFilters().Where(e => ids.Contains(EF.Property<Guid>(e, "Id"))).Select(e => EF.Property<Guid>(e, "Id"));

    // ── staff, compatibility, contacts ───────────────────────────────────────

    public static IQueryable<User> UsersByEmail(OdipDbContext db, List<string> emails) => db.Users.Where(u => emails.Contains(u.Email));

    public static IQueryable<TakenCell> CompatibilityCellsOf(OdipDbContext db, List<Guid> userIds) =>
        db.StaffParticipantCompatibilities.Where(c => userIds.Contains(c.UserId)).Select(c => new TakenCell(c.Id, c.UserId, c.ParticipantId));

    public static IQueryable<ActiveContactRole> ActiveEmergencyContacts(OdipDbContext db, List<Guid> participantIds) =>
        db.ParticipantContactRoles
            .Where(r => r.RoleType == ContactRoleType.EmergencyContact && r.Status == ContactRoleStatus.Active && participantIds.Contains(r.ParticipantId))
            .Select(r => new ActiveContactRole(r.Id, r.ParticipantId));

    // ── roster ───────────────────────────────────────────────────────────────

    public static IQueryable<ShiftPattern> PatternsByIds(OdipDbContext db, List<Guid> patternIds) =>
        db.ShiftPatterns.AsNoTracking().Where(p => patternIds.Contains(p.Id));

    /// <summary>
    /// Shifts that could still need moving forward: past (or today), and Published, Draft or PendingReview, and either from one of this
    /// top-up's patterns or with no pattern at all (the caller then matches those against the pack-week ids in memory).
    /// </summary>
    public static IQueryable<Shift> OpenShifts(OdipDbContext db, DateOnly today, List<Guid> patternIds) =>
        db.Shifts
            .Where(s => s.ServiceDate <= today
                        && (s.Status == ShiftStatus.Published || s.Status == ShiftStatus.Draft || s.Status == ShiftStatus.PendingReview))
            .Where(s => s.ShiftPatternId == null || patternIds.Contains(s.ShiftPatternId.Value));

    public static IQueryable<ShiftCompletion> CompletionsOf(OdipDbContext db, List<Guid> shiftIds) =>
        db.ShiftCompletions.Where(c => shiftIds.Contains(c.ShiftId));

    // ── leave ────────────────────────────────────────────────────────────────

    /// <summary>Still Pending, with a first day before today: the few requests nobody decided in time.</summary>
    public static IQueryable<LeaveRequest> LapsedLeave(OdipDbContext db, DateOnly today) =>
        db.LeaveRequests.Where(l => l.Status == LeaveStatus.Pending && l.StartDate < today);

    public static IQueryable<RecurringUnavailability> LapsedRules(OdipDbContext db, DateOnly today) =>
        db.RecurringUnavailabilities.Where(r => r.Status == LeaveStatus.Pending && r.EffectiveFrom < today);

    // ── LeaveCoverage tasks ──────────────────────────────────────────────────

    public static IQueryable<LeaveRequest> ApprovedLeaveNotYetOver(OdipDbContext db, DateOnly today) =>
        db.LeaveRequests.AsNoTracking().Where(l => l.Status == LeaveStatus.Approved && l.EndDate >= today);

    public static IQueryable<Shift> PublishedShiftsOf(OdipDbContext db, List<Guid> userIds, DateOnly firstDay) =>
        db.Shifts.Include(s => s.Participant)
            .Where(s => s.Status == ShiftStatus.Published && s.UserId != null && userIds.Contains(s.UserId.Value) && s.ServiceDate >= firstDay);

    public static IQueryable<string> ExistingTaskKeys(OdipDbContext db, List<string> keys) =>
        db.BookingTasks.Where(t => t.SourceKey != null && keys.Contains(t.SourceKey)).Select(t => t.SourceKey!);

    public static IQueryable<OpenCoverageTask> OpenCoverageTasks(OdipDbContext db) =>
        db.BookingTasks.AsNoTracking()
            .Where(t => t.TaskType == TaskType.LeaveCoverage && t.LeaveRequestId != null && t.ShiftId != null && t.SourceKey != null
                        && (t.Status == TaskItemStatus.NotStarted || t.Status == TaskItemStatus.InProgress))
            .Select(t => new OpenCoverageTask(t.SourceKey, t.ShiftId, t.LeaveRequestId));

    public static IQueryable<Guid> WorkedShiftIds(OdipDbContext db, List<Guid> shiftIds) =>
        db.Shifts.Where(s => shiftIds.Contains(s.Id) && (s.Status == ShiftStatus.PendingReview || s.Status == ShiftStatus.Completed)).Select(s => s.Id);

    /// <summary>Read only: the staff as they are in the database now.</summary>
    public static IQueryable<User> UsersByIds(OdipDbContext db, List<Guid> ids) => db.Users.AsNoTracking().Where(u => ids.Contains(u.Id));

    // ── live set: who can be cast (the same inputs the roster board gives its conflict engine) ──

    /// <summary>Every shift of a Monday-to-Sunday week, whatever its status, as the board loads them: the engine counts them all.</summary>
    public static IQueryable<Shift> WeekShifts(OdipDbContext db, DateOnly from, DateOnly to) =>
        db.Shifts.AsNoTracking().Where(s => s.ServiceDate >= from && s.ServiceDate <= to);

    public static IQueryable<LevelCell> CompatibilityLevels(OdipDbContext db, List<Guid> userIds) =>
        db.StaffParticipantCompatibilities.Where(c => userIds.Contains(c.UserId)).Select(c => new LevelCell(c.UserId, c.ParticipantId, c.Level));

    public static IQueryable<HolidayRow> HolidaysOf(OdipDbContext db, string state, DateOnly from, DateOnly to) =>
        db.PublicHolidays.Where(h => h.Date >= from && h.Date <= to && (h.State == null || h.State == state)).Select(h => new HolidayRow(h.Date, h.Name));

    public static IQueryable<StaffAssignment> TripAssignmentsOf(OdipDbContext db, List<Guid> userIds, DateOnly from, DateOnly to) =>
        db.StaffAssignments.AsNoTracking().Include(a => a.TripInstance)
            .Where(a => userIds.Contains(a.UserId) && a.Status != AssignmentStatus.Cancelled && a.AssignmentStart <= to && a.AssignmentEnd >= from);

    public static IQueryable<Participant> ParticipantsByIds(OdipDbContext db, List<Guid> ids) =>
        db.Participants.AsNoTracking().Where(p => ids.Contains(p.Id));

    // ── live set: the rows it keeps moving ──

    /// <summary>Tracked: the live shifts are moved from one state to the next.</summary>
    public static IQueryable<Shift> ShiftsByIds(OdipDbContext db, List<Guid> ids) => db.Shifts.Where(s => ids.Contains(s.Id));

    /// <summary>Tracked: a live shift's completion is finished, and later approved, in place.</summary>
    public static IQueryable<ShiftCompletion> ActiveCompletionsOf(OdipDbContext db, List<Guid> shiftIds) =>
        db.ShiftCompletions.Where(c => shiftIds.Contains(c.ShiftId) && c.IsActive);

    /// <summary>
    /// Shifts from before the two days the live set works on that were never finished (a host that was off): Published or InProgress, no pattern,
    /// for the live set's participants. No lower bound: only what earlier ticks left behind can match, a handful of rows however long the gap.
    /// </summary>
    public static IQueryable<Shift> UnfinishedShifts(OdipDbContext db, DateOnly before, List<Guid> participantIds) =>
        db.Shifts.Where(s => s.ShiftPatternId == null && (s.Status == ShiftStatus.Published || s.Status == ShiftStatus.InProgress)
                             && s.ServiceDate < before && participantIds.Contains(s.ParticipantId));

    /// <summary>Tracked: a high-risk dose this top-up recorded whose staff witness has not answered yet.</summary>
    public static IQueryable<MedicationAdministration> PendingWitnessDoses(OdipDbContext db) =>
        db.MedicationAdministrations.Where(a => a.WitnessStatus == WitnessStatus.Pending && a.IdempotencyKey != null && a.IdempotencyKey.StartsWith("demo-v1:"));

    /// <summary>
    /// The scheduled slots that already have an ACTIVE record (whoever wrote it: the old seed's aged rows, a worker, an earlier tick) in a provider-local
    /// window, so a slot is never given a second record. A superseded record is history, and its replacement is the active one.
    /// </summary>
    public static IQueryable<RecordedSlot> SlotsRecorded(OdipDbContext db, List<Guid> medicationIds, DateTime fromLocal, DateTime toLocal) =>
        db.MedicationAdministrations.AsNoTracking()
            .Where(a => medicationIds.Contains(a.ParticipantMedicationId) && a.ScheduledAt != null && a.ScheduledAt >= fromLocal && a.ScheduledAt < toLocal
                        && a.SupersededByAdministrationId == null)
            .Select(a => new RecordedSlot(a.ParticipantMedicationId, a.ScheduledAt!.Value));

    /// <summary>Tracked: the obligation tasks with these source keys that are still open (a closed task never reopens, so it is not wanted).</summary>
    public static IQueryable<BookingTask> OpenTasksByKeys(OdipDbContext db, List<string> keys) =>
        db.BookingTasks.Where(t => t.SourceKey != null && keys.Contains(t.SourceKey)
                                   && (t.Status == TaskItemStatus.NotStarted || t.Status == TaskItemStatus.InProgress));

    /// <summary>Live shifts that have been waiting for review long enough to be approved: past, not claimed by a pattern, PendingReview, for the live set's participants.</summary>
    public static IQueryable<Shift> UnreviewedShifts(OdipDbContext db, DateOnly onOrBefore, List<Guid> participantIds) =>
        db.Shifts.Where(s => s.Status == ShiftStatus.PendingReview && s.ShiftPatternId == null && s.ServiceDate <= onOrBefore && participantIds.Contains(s.ParticipantId));

    // ── medications, doses and the shift package ──

    /// <summary>Read only: a medication is read for its schedule and never changed.</summary>
    public static IQueryable<ParticipantMedication> MedicationsByIds(OdipDbContext db, List<Guid> ids) =>
        db.ParticipantMedications.AsNoTracking().Where(m => ids.Contains(m.Id));

    public static IQueryable<ParticipantMedication> ActiveMedicationsOf(OdipDbContext db, List<Guid> participantIds) =>
        db.ParticipantMedications.AsNoTracking().Where(m => participantIds.Contains(m.ParticipantId) && m.Status == MedicationStatus.Active);

    public static IQueryable<ParticipantRoutine> RoutinesByIds(OdipDbContext db, List<Guid> ids) =>
        db.ParticipantRoutines.AsNoTracking().Where(r => ids.Contains(r.Id));

    /// <summary>Tracked: a dose record's outcome or witness answer is filled in later.</summary>
    public static IQueryable<MedicationAdministration> AdministrationsByIds(OdipDbContext db, List<Guid> ids) =>
        db.MedicationAdministrations.Where(a => ids.Contains(a.Id));

    /// <summary>Tracked: as-needed doses this top-up recorded at or after <paramref name="sinceUtc"/> that have no outcome yet (written when the shift is finished).</summary>
    public static IQueryable<MedicationAdministration> PrnDosesAwaitingOutcome(OdipDbContext db, List<Guid> medicationIds, DateTime sinceUtc) =>
        db.MedicationAdministrations.Where(a => medicationIds.Contains(a.ParticipantMedicationId) && a.Status == MedicationAdministrationStatus.Administered
                                                && a.PrnOutcome == null && a.AdministeredAt != null && a.AdministeredAt >= sinceUtc
                                                && a.IdempotencyKey != null && a.IdempotencyKey.StartsWith("demo-v1:"));

    public static IQueryable<ShiftBreak> RunningBreaksOf(OdipDbContext db, List<Guid> completionIds) =>
        db.ShiftBreaks.Where(b => completionIds.Contains(b.ShiftCompletionId) && b.EndedAt == null);

    public static IQueryable<ShiftNote> NotesOf(OdipDbContext db, List<Guid> shiftIds) =>
        db.ShiftNotes.AsNoTracking().Where(n => shiftIds.Contains(n.ShiftId));
}
