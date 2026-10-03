using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.DemoData;

public sealed record DemoParticipantRow(Guid Id, string? NdisNumber, string FirstName, string LastName, bool IsActive, bool IsDraft);

public sealed record RecordedSlot(Guid MedicationId, DateTime ScheduledAt);

/// <summary>The key the app holds an acknowledgement to (a unique index): one per reader and handover, whoever wrote it and whatever its id is.</summary>
public sealed record AckKey(Guid SourceCompletionId, Guid UserId);

/// <summary>The key the app holds a routine tick to (two partial unique indexes): one per completion, routine and occurrence; a routine with no time has the one.</summary>
public sealed record TickKey(Guid CompletionId, Guid RoutineId, DateTime? ScheduledAt);

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
    /// for the live set's participants, never one a coordinator returned (that is the worker's again). No lower bound: only what earlier ticks left behind can match, a handful of rows however long the gap.
    /// </summary>
    public static IQueryable<Shift> UnfinishedShifts(OdipDbContext db, DateOnly before, List<Guid> participantIds) =>
        db.Shifts.Where(s => s.ShiftPatternId == null && (s.Status == ShiftStatus.Published || s.Status == ShiftStatus.InProgress) && s.ReturnCount == 0
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

    /// <summary>
    /// Tracked: the incidents reported by these users since an instant that are still moving (not resolved and closed, or waiting for their report
    /// to the Commission). An incident has no tenant column, so the reporters, who are the Demo tenant's own, are what scopes it.
    /// </summary>
    public static IQueryable<IncidentReport> AgingIncidents(OdipDbContext db, List<Guid> reporterIds, DateTime sinceUtc) =>
        db.IncidentReports.Where(i => i.IsActive && reporterIds.Contains(i.ReportedByUserId) && i.CreatedAt >= sinceUtc
                                      && (i.Status == IncidentStatus.Submitted || i.Status == IncidentStatus.UnderReview || i.Status == IncidentStatus.Resolved
                                          || i.QscReportingStatus == QscReportingStatus.Required));

    /// <summary>Read only: these incidents, whichever tenant they belong to by id (the caller passes the Demo tenant's own).</summary>
    public static IQueryable<IncidentReport> IncidentsByIds(OdipDbContext db, List<Guid> ids) =>
        db.IncidentReports.AsNoTracking().Where(i => ids.Contains(i.Id));

    /// <summary>Read only: the doses this top-up recorded in a window of instants that have a staff witness (the ones whose witness was sent a request).</summary>
    public static IQueryable<MedicationAdministration> WitnessedDosesBetween(OdipDbContext db, DateTime fromUtc, DateTime toUtc) =>
        db.MedicationAdministrations.AsNoTracking()
            .Where(a => a.WitnessUserId != null && a.IdempotencyKey != null && a.IdempotencyKey.StartsWith("demo-v1:") && a.CreatedAt >= fromUtc && a.CreatedAt < toUtc);

    /// <summary>Read only: the active, submitted completions of these shifts.</summary>
    public static IQueryable<ShiftCompletion> SubmittedCompletionsOf(OdipDbContext db, List<Guid> shiftIds) =>
        db.ShiftCompletions.AsNoTracking().Where(c => shiftIds.Contains(c.ShiftId) && c.IsActive && c.SubmittedAt != null);

    /// <summary>A closed shift with the active completion the worker submitted for it.</summary>
    public sealed record ClosedPair(ShiftCompletion Completion, Shift Shift);

    /// <summary>
    /// The closed shifts (PendingReview or Completed) from a date on, each with its active submitted completion, read only: the material the shift
    /// package history decorates. Only shifts that had a worker.
    /// </summary>
    public static IQueryable<ClosedPair> ClosedCompletions(OdipDbContext db, DateOnly since) =>
        from c in db.ShiftCompletions.AsNoTracking()
        join s in db.Shifts.AsNoTracking() on c.ShiftId equals s.Id
        where c.IsActive && c.SubmittedAt != null && c.ActualEnd != null && s.UserId != null && s.ServiceDate >= since
              && (s.Status == ShiftStatus.PendingReview || s.Status == ShiftStatus.Completed)
        select new ClosedPair(c, s);

    /// <summary>
    /// Read only: every active submitted completion of these participants' shifts from a date on, with the facts of its shift that the app's handover rule orders by:
    /// the material <see cref="HandoverSourceRule.LatestBefore"/> chooses a reader's handover from (PR 2 review L3).
    /// </summary>
    public static IQueryable<HandoverSource> HandoverSourcesOf(OdipDbContext db, List<Guid> participantIds, DateOnly since) =>
        from c in db.ShiftCompletions.AsNoTracking()
        join s in db.Shifts.AsNoTracking() on c.ShiftId equals s.Id
        where participantIds.Contains(s.ParticipantId) && c.IsActive && c.SubmittedAt != null && s.ServiceDate >= since
        select new HandoverSource(c.Id, s.Id, s.ParticipantId, s.ServiceDate, s.StartTime, c.SubmittedAt!.Value, c.HandoverText, c.NothingToHandOver, s.UserId);

    public sealed record ShiftState(Guid Id, ShiftStatus Status, Guid? UserId);

    /// <summary>
    /// Read only: the status and the worker of those of these shifts that exist, so a live window is counted only while the live set works its shift (PR 2 review L2:
    /// not a cancelled or draft one; independent review N1: nor one with nobody on it, or somebody the stories do not name, which the live set leaves alone).
    /// </summary>
    public static IQueryable<ShiftState> ShiftStatesOf(OdipDbContext db, List<Guid> ids) =>
        db.Shifts.AsNoTracking().Where(s => ids.Contains(s.Id)).Select(s => new ShiftState(s.Id, s.Status, s.UserId));

    /// <summary>Read only: the active routines of these participants, which the shift package matches against a shift's window.</summary>
    public static IQueryable<ParticipantRoutine> ActiveRoutinesOf(OdipDbContext db, List<Guid> participantIds) =>
        db.ParticipantRoutines.AsNoTracking().Where(r => participantIds.Contains(r.ParticipantId) && r.IsActive);

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

    /// <summary>
    /// Tracked: as-needed doses this top-up gave in a shift's window (from <paramref name="sinceUtc"/> up to, not including, <paramref name="untilUtc"/>) that have no outcome
    /// yet (written when the shift is finished). The upper bound matters now that every live shift is its own piece: yesterday's can heal after today's has given a dose,
    /// and its close must not give today's dose an outcome dated before it was given (independent review N2).
    /// </summary>
    public static IQueryable<MedicationAdministration> PrnDosesAwaitingOutcome(OdipDbContext db, List<Guid> medicationIds, DateTime sinceUtc, DateTime untilUtc) =>
        db.MedicationAdministrations.Where(a => medicationIds.Contains(a.ParticipantMedicationId) && a.Status == MedicationAdministrationStatus.Administered
                                                && a.PrnOutcome == null && a.AdministeredAt != null && a.AdministeredAt >= sinceUtc && a.AdministeredAt < untilUtc
                                                && a.IdempotencyKey != null && a.IdempotencyKey.StartsWith("demo-v1:"));

    /// <summary>
    /// Tracked: the running breaks of these completions, whoever started them. The app holds one running break per completion (a unique index), so a break
    /// the script would start waits for a person's to end, and the shift's end ends whichever is running.
    /// </summary>
    public static IQueryable<ShiftBreak> RunningBreaksOf(OdipDbContext db, List<Guid> completionIds) =>
        db.ShiftBreaks.Where(b => completionIds.Contains(b.ShiftCompletionId) && b.EndedAt == null);

    /// <summary>
    /// Read only: the acknowledgements already recorded for these handovers by these readers, whoever wrote them. A person's own row has a random id where the
    /// script's is deterministic, so "is it there" is asked of the pair (<see cref="AckKey"/>), never only of the script's own id: a second row for the pair
    /// is refused by the database and, inside a pack's one transaction, rolls the whole pack back. Query filters are ignored on purpose, as in
    /// <see cref="ExistingIds{T}"/>: the unique index sees every row whatever its tenant, so a row that would collide is "already there" wherever it is.
    /// </summary>
    public static IQueryable<AckKey> HandoverAcksOf(OdipDbContext db, List<Guid> sourceCompletionIds, List<Guid> userIds) =>
        db.HandoverAcknowledgements.IgnoreQueryFilters().AsNoTracking().Where(a => sourceCompletionIds.Contains(a.SourceCompletionId) && userIds.Contains(a.UserId))
            .Select(a => new AckKey(a.SourceCompletionId, a.UserId));

    /// <summary>Read only: the routine ticks already on these completions, whoever made them (<see cref="TickKey"/>), for the same reason, and filters ignored for the same one, as <see cref="HandoverAcksOf"/>.</summary>
    public static IQueryable<TickKey> RoutineTicksOf(OdipDbContext db, List<Guid> completionIds) =>
        db.ShiftRoutineChecks.IgnoreQueryFilters().AsNoTracking().Where(t => completionIds.Contains(t.ShiftCompletionId))
            .Select(t => new TickKey(t.ShiftCompletionId, t.ParticipantRoutineId, t.ScheduledAt));

    public static IQueryable<ShiftNote> NotesOf(OdipDbContext db, List<Guid> shiftIds) =>
        db.ShiftNotes.AsNoTracking().Where(n => shiftIds.Contains(n.ShiftId));
}
