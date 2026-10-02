using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.DemoData;

public sealed record DemoParticipantRow(Guid Id, string? NdisNumber, string FirstName, string LastName, bool IsActive, bool IsDraft);

public sealed record TakenCell(Guid Id, Guid UserId, Guid ParticipantId);

public sealed record ActiveContactRole(Guid Id, Guid ParticipantId);

public sealed record OpenCoverageTask(string? SourceKey, Guid? ShiftId, Guid? LeaveRequestId);

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
}
