using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Notifications.Templates;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Integrations;

/// <summary>Skipped: the connection moved to another business while EH's list was read, so the list was dropped and nobody changed.</summary>
public enum EmploymentHeroSyncOutcome { NotConnected, Busy, Failed, Done, Skipped }

/// <summary>What one organisation's sync came to, and its log row (counts, error class) when it ran.</summary>
public sealed record EmploymentHeroSyncResult(EmploymentHeroSyncOutcome Outcome, EmploymentHeroSyncLog? Log);

/// <summary>
/// Keeps one organisation's staff in step with Employment Hero, the master staff list. The first connect and every later run take the same path.
///
/// What happens to each person:
/// - A linked EH employee (User.ExternalPayrollId) gets EH's first name, surname, email and mobile. They are archived once EH's end date has passed, but never the organisation's last active Admin, and nobody at all when more than max(3, a quarter of the active linked staff) would go in one run.
/// - An unlinked EH employee is linked to the ODIP user with the same normalised email.
/// - Otherwise they are created as a SupportWorker through StaffCreateService, with no caller (so no elevated role) and no invite.
/// - The exception: when an unlinked ODIP staff member has the same name, the EH employee is held for the Admin to link, or not.
/// - An active ODIP staff member left unlinked, a linked one missing from EH, and any EH employee ODIP cannot take become Needs-attention items.
///
/// How a run behaves:
/// - A problem belongs to one person and never fails the run. Each person is saved on their own.
/// - The audit actor is "Employment Hero sync".
/// - It works on the context it is given: the background run's own tenant context, or the request's for Sync now.
/// </summary>
public sealed class EmploymentHeroStaffSync
{
    public const string ActorName = "Employment Hero sync";
    public const string StaffFromEmploymentHeroMessage = "Staff come from Employment Hero for this organisation. Add them there; they appear here within 30 minutes.";
    public const string KeyUnreadableMessage = "We can't read the saved API key (this server's integrations key changed or is missing). Connect again with the API key.";
    public const string UnexpectedMessage = "We couldn't apply Employment Hero's list this time. The next sync tries again.";
    public const string BusyMessage = "A sync for this organisation is already running. Try again in a minute.";
    private const string OtherOrganisationEmail = "Their email in Employment Hero belongs to another organisation on Bunya Support.";
    private const string CouldNotSave = "We couldn't save their details this time; the next sync tries again.";
    private const string ArchivedButCurrent = "Employment Hero has them as current, but their Bunya Support account is archived. Restore them on their staff page.";
    private const string LastAdminLeaving = "Employment Hero has ended their employment; they are the only Admin. Add another Admin first, then archive them.";
    // The sync re-pointed a never-signed-in person's sign-in address: any invite they were sent went to the old one.
    private const string EmailChangedStart = "Employment Hero changed their email to ";
    private const string MassLeaving = "Employment Hero has ended the employment of {0} staff in one sync, so we archived nobody in case its data is wrong. Check their end dates in Employment Hero; if they really have left, archive them on their staff page.";
    private const int NameMax = 100, MobileMax = 20, EmailMax = 200;

    private readonly EmploymentHeroClient _client;
    private readonly IntegrationKeyProtector _keys;
    private readonly TimeProvider _clock;
    private readonly ILogger<EmploymentHeroStaffSync> _logger;
    private readonly IConfiguration? _config;

    public EmploymentHeroStaffSync(EmploymentHeroClient client, IntegrationKeyProtector keys, TimeProvider clock, ILogger<EmploymentHeroStaffSync> logger, IConfiguration? config = null)
    {
        _client = client;
        _keys = keys;
        _clock = clock;
        _logger = logger;
        _config = config;
    }

    /// <summary>Whether this organisation's staff come from Employment Hero. Explicit about the organisation: an unscoped SuperAdmin context sees every connection.</summary>
    public static Task<bool> IsConnectedAsync(OdipDbContext db, Guid? tenantId, CancellationToken ct) =>
        tenantId is { } id ? db.EmploymentHeroConnections.AnyAsync(c => c.TenantId == id, ct) : Task.FromResult(false);

    /// <summary>
    /// One organisation's sync.
    /// - A key ODIP can't read, or EH failing (even midway through paging), records a failed run and changes nobody.
    /// - Admins are alerted when the connection starts failing, and when a run finds new problems.
    /// - The changes run under a per-organisation advisory lock, held to the end of the run's transaction. Sync now and the half-hourly run therefore never
    ///   create the same person twice: the second waits for the first, then finds everyone linked, or after 20 s answers Busy.
    /// </summary>
    public async Task<EmploymentHeroSyncResult> RunAsync(OdipDbContext db, Guid tenantId, CancellationToken ct)
    {
        var conn = await db.EmploymentHeroConnections.FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
        if (conn is null) return new(EmploymentHeroSyncOutcome.NotConnected, null);
        var log = new EmploymentHeroSyncLog { Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = conn.BusinessId, StartedAt = Now() };

        var key = _keys.Unprotect(conn.ApiKeyCiphertext, conn.ApiKeyNonce, tenantId);
        if (key is null) return await FailAsync(db, conn, log, "KeyUnreadable", KeyUnreadableMessage, ct);
        List<EhEmployee> employees;
        try
        {
            employees = await _client.ListEmployeesAsync(key, conn.BusinessId, ct);
        }
        catch (EmploymentHeroException ex)
        {
            return await FailAsync(db, conn, log, ex.Failure.ToString(), ex.Message, ct);
        }

        await using var runLock = await TryLockAsync(db, tenantId, ct);
        if (runLock is null) return new(EmploymentHeroSyncOutcome.Busy, null);
        // Connect and Disconnect take this lock too, so once it is held the connection cannot move. It may have moved while EH's list was read: then the
        // list belongs to the old business, and applying it would link this organisation's staff to that business's ids.
        var businessNow = await db.EmploymentHeroConnections.AsNoTracking().Where(c => c.TenantId == tenantId).Select(c => c.BusinessId).FirstOrDefaultAsync(ct);
        if (businessNow != log.BusinessId)
        {
            _logger.LogInformation("Employment Hero sync for organisation {TenantId} skipped: the connection changed while the list was read", tenantId);
            return new(businessNow is null ? EmploymentHeroSyncOutcome.NotConnected : EmploymentHeroSyncOutcome.Skipped, null);
        }
        try
        {
            var added = await ApplyAndRecordAsync(db, tenantId, employees, log, ct);
            if (added > 0)
            {
                // Its own entity (this run's log row), so NotificationRaiser's 5-minute dedupe never swallows it behind a recent failure alert.
                await AlertAdminsAsync(db, tenantId, nameof(EmploymentHeroSyncLog), log.Id, $"{added} staff {(added == 1 ? "member needs" : "members need")} attention after the Employment Hero sync.", ct);
                await db.SaveChangesAsync(ct);
            }
            await runLock.CommitAsync(ct);
            return new(EmploymentHeroSyncOutcome.Done, log);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Anything else (the final save, the database) rolls the whole run back. It is still a failed run on the card, in the log and to the Admins,
            // never a silent 500. Rolled back first, so the record is written outside the abandoned transaction.
            await runLock.DisposeAsync();
            db.ChangeTracker.Clear();
            var current = await db.EmploymentHeroConnections.FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
            if (current is null) throw;
            _logger.LogError("Employment Hero sync for organisation {TenantId} failed unexpectedly ({Error}); nothing was changed", tenantId, ex.GetType().Name);
            var failed = new EmploymentHeroSyncLog { Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = log.BusinessId, StartedAt = log.StartedAt };
            return await FailAsync(db, current, failed, "Unexpected", UnexpectedMessage, ct);
        }
    }

    /// <summary>The advisory-lock key for one organisation's sync. It is the import's per-organisation key with "EHSYNC" mixed in, so the two never share a lock.</summary>
    public static long LockKey(Guid tenantId) => OnboardingImportService.LockKey(tenantId) ^ 0x4548_5359_4E43;

    /// <summary>
    /// Runs a change to the organisation's connection or links (Connect, Disconnect, Link) under the same lock as a sync run, and commits it with the lock,
    /// so it never lands in the middle of a run. False when a run held the lock for 20 s; then nothing ran.
    /// </summary>
    public static async Task<bool> UnderSyncLockAsync(OdipDbContext db, Guid tenantId, Func<Task> work, CancellationToken ct)
    {
        await using var syncLock = await TryLockAsync(db, tenantId, ct);
        if (syncLock is null) return false;
        await work();
        await syncLock.CommitAsync(ct);
        return true;
    }

    private static async Task<CatalogueImportLock?> TryLockAsync(OdipDbContext db, Guid tenantId, CancellationToken ct)
    {
        try
        {
            return await CatalogueImportLock.AcquireAsync(db, LockKey(tenantId), BusyMessage, ct);
        }
        catch (InvalidOperationException ex) when (ex.Message == BusyMessage)
        {
            return null;
        }
    }

    /// <summary>Records a run that couldn't read EH's list, on the connection and in the log; nobody's details change. Admins hear once, when it starts failing.</summary>
    private async Task<EmploymentHeroSyncResult> FailAsync(OdipDbContext db, EmploymentHeroConnection conn, EmploymentHeroSyncLog log, string errorClass, string message, CancellationToken ct)
    {
        var wasFailing = conn.LastSyncError is not null;
        conn.LastSyncAt = log.FinishedAt = Now();
        conn.LastSyncError = message;
        log.ErrorClass = errorClass;
        db.EmploymentHeroSyncLogs.Add(log);
        await PruneLogAsync(db, conn.TenantId, ct);
        if (!wasFailing) await AlertAdminsAsync(db, conn.TenantId, nameof(EmploymentHeroConnection), conn.Id, $"The Employment Hero sync stopped working: {message}", ct);
        await db.SaveChangesAsync(ct);
        _logger.LogWarning("Employment Hero sync failed for organisation {TenantId} ({ErrorClass}); the next run tries again", conn.TenantId, errorClass);
        return new(EmploymentHeroSyncOutcome.Failed, log);
    }

    /// <summary>
    /// Raises one IntegrationDegraded email per active Admin of this organisation (named explicitly, as every query here is: a SuperAdmin context would
    /// otherwise reach every organisation's Admins). It goes into the caller's SaveChanges, because NotificationRaiser never saves.
    /// </summary>
    internal static async Task AlertAdminsAsync(OdipDbContext db, Guid tenantId, string entityType, Guid entityId, string problem, CancellationToken ct)
    {
        var admins = await db.Users.Where(u => u.TenantId == tenantId && u.IsActive && u.Role == UserRole.Admin).Select(u => new { u.Id, u.Email }).ToListAsync(ct);
        var raiser = new NotificationRaiser(db);
        foreach (var admin in admins)
            await raiser.RaiseAsync(NotificationEventType.IntegrationDegraded, entityType, entityId, new[] { admin.Id },
                new IntegrationDegradedPayload(admin.Email, "Employment Hero", problem), ct);
    }

    /// <summary>Applies EH's list, rewrites the Needs-attention items and records the run. Returns how many items are new.</summary>
    private async Task<int> ApplyAndRecordAsync(OdipDbContext db, Guid tenantId, List<EhEmployee> employees, EmploymentHeroSyncLog log, CancellationToken ct)
    {
        db.AuditActorName = ActorName;
        try
        {
            var today = await ProviderTimeZoneResolver.TodayAsync(db, tenantId, _clock, ct);
            var problems = await ApplyAsync(db, tenantId, employees, today, log, ct);
            var added = await ReconcileAsync(db, tenantId, problems, ct);
            log.NeedsAttention = problems.Select(p => p.Key).Distinct().Count();
            log.FinishedAt = Now();
            // Fetched again: a failed save (SaveOneAsync) clears the context.
            var conn = await db.EmploymentHeroConnections.FirstAsync(c => c.TenantId == tenantId, ct);
            conn.LastSyncAt = log.FinishedAt;
            conn.LastSyncError = null;
            db.EmploymentHeroSyncLogs.Add(log);
            await PruneLogAsync(db, tenantId, ct);
            await db.SaveChangesAsync(ct);
            _logger.LogInformation("Employment Hero sync for organisation {TenantId}: {Linked} linked, {Created} created, {Updated} updated, {Archived} archived, {Attention} need attention",
                tenantId, log.Linked, log.Created, log.Updated, log.Archived, log.NeedsAttention);
            return added;
        }
        finally
        {
            db.AuditActorName = null;
        }
    }

    /// <summary>One problem for one person. Key is stable across runs: "{Kind}:{UserId or EH employee id}".</summary>
    private sealed record Problem(EmploymentHeroAttentionKind Kind, Guid? UserId, string? EmployeeId, string Name, string Reason)
    {
        public string Key => $"{Kind}:{UserId?.ToString() ?? EmployeeId}";
    }

    private async Task<List<Problem>> ApplyAsync(OdipDbContext db, Guid tenantId, List<EhEmployee> employees, DateOnly today, EmploymentHeroSyncLog log, CancellationToken ct)
    {
        var problems = new List<Problem>();
        var creator = new StaffCreateService(db, _config);
        // Every staff member of the organisation, archived ones too (their addresses still count); never a SuperAdmin.
        var users = await db.Users.Where(u => u.TenantId == tenantId && u.Role != UserRole.SuperAdmin).ToListAsync(ct);
        var byId = employees.GroupBy(Id).ToDictionary(g => g.Key, g => g.First());
        var dismissed = (await db.EmploymentHeroAttentions
            .Where(a => a.TenantId == tenantId && a.Kind == EmploymentHeroAttentionKind.NotLinked && a.DismissedAt != null && a.UserId != null)
            .Select(a => a.UserId!.Value).ToListAsync(ct)).ToHashSet();

        // 1. Links. An unlinked EH employee takes the ODIP user with its email; current records go first, so a rehire wins over the old record.
        var pending = new List<EhEmployee>();
        // Looked up once, not scanned per employee. Linking only sets ExternalPayrollId (never an email), so the email map stays right through the loop; duplicates keep the first user, as FirstOrDefault did.
        var linkedIds = users.Where(u => u.ExternalPayrollId is not null).Select(u => u.ExternalPayrollId!).ToHashSet();
        var byEmail = new Dictionary<string, User>();
        foreach (var u in users) byEmail.TryAdd(EmailIdentity.Normalise(u.Email), u);
        var unlinkedInEh = byId.Values.Where(e => !linkedIds.Contains(Id(e))).OrderBy(e => IsLeaver(e, today)).ToList();
        foreach (var e in unlinkedInEh)
        {
            var email = EmailOf(e);
            var match = email is null ? null : byEmail.GetValueOrDefault(email);
            if (match is null) { pending.Add(e); continue; }
            var linkedTo = match.ExternalPayrollId is { } linkedId ? byId.GetValueOrDefault(linkedId) : null;
            if (match.ExternalPayrollId is null || (linkedTo is not null && IsLeaver(linkedTo, today) && !IsLeaver(e, today)))
            {
                match.ExternalPayrollId = Id(e);
                if (!await SaveOneAsync(db, users, match, ct)) { problems.Add(FixInEh(e, CouldNotSave)); continue; }
                log.Linked++;
            }
            else if (!IsLeaver(e, today))
                problems.Add(FixInEh(e, $"Their email in Employment Hero is already used by {match.FullName}, who is linked to another Employment Hero employee."));
        }

        // 2. EH is the master: linked people take EH's values. Leavers are gathered here and archived in 2b.
        var leavers = new List<(User Person, EhEmployee Employee)>();
        foreach (var u in users.Where(u => u.ExternalPayrollId is { } ext && byId.ContainsKey(ext)).ToList())
        {
            var e = byId[u.ExternalPayrollId!];
            if (IsLeaver(e, today) && u.IsActive) leavers.Add((u, e));
            // The sync never restores an archived account (Decision 2). A current EH employee linked to one is shown on every run, so the item lasts
            // as long as the problem does; otherwise they would stay locked out unseen.
            if (!u.IsActive && !IsLeaver(e, today))
                problems.Add(new(EmploymentHeroAttentionKind.FixInOdip, u.Id, Id(e), u.FullName, ArchivedButCurrent));
            if (!await UpdateAsync(db, creator, u, e, problems, ct)) continue;
            if (await SaveOneAsync(db, users, u, ct)) log.Updated++;
            else problems.Add(FixInEh(e, CouldNotSave));
        }

        // 2b. Leavers are archived (archived means no sign-in), with two brakes. More than max(3, a quarter of the active linked staff) in one run
        //     looks like bad EH data, not resignations, so nobody is archived and each one is shown instead. And never the last active Admin.
        var activeLinked = users.Count(u => u.IsActive && u.ExternalPayrollId is not null);
        var tooMany = leavers.Count > Math.Max(3, activeLinked / 4.0);
        foreach (var (u, e) in leavers)
        {
            if (tooMany)
            {
                problems.Add(new(EmploymentHeroAttentionKind.FixInOdip, u.Id, Id(e), u.FullName, string.Format(CultureInfo.InvariantCulture, MassLeaving, leavers.Count)));
                continue;
            }
            // Only an Admin who has signed in counts: an invited Admin who never has can't yet run the organisation.
            if (u.Role == UserRole.Admin && !users.Any(o => o.Id != u.Id && o.IsActive && o.Role == UserRole.Admin && o.LastLoginAt != null))
            {
                problems.Add(new(EmploymentHeroAttentionKind.FixInOdip, u.Id, Id(e), u.FullName, LastAdminLeaving));
                continue;
            }
            u.IsActive = false;
            if (await SaveOneAsync(db, users, u, ct)) log.Archived++;
            else problems.Add(FixInEh(e, CouldNotSave));
        }

        // 3. New people, unless an unlinked ODIP staff member has the same name: then the Admin decides (Link, or Leave unlinked).
        var unlinked = users.Where(u => u.IsActive && u.ExternalPayrollId is null && !dismissed.Contains(u.Id)).ToList();
        var held = new Dictionary<Guid, EhEmployee>();
        foreach (var e in pending.Where(e => !IsLeaver(e, today)))
        {
            var namesake = unlinked.FirstOrDefault(u => !held.ContainsKey(u.Id) && NameKey(u.FirstName, u.LastName) == NameKey(e.FirstName, e.Surname));
            if (namesake is not null) { held[namesake.Id] = e; continue; }
            var email = EmailOf(e);
            if (email is null) { problems.Add(FixInEh(e, "They have no email in Employment Hero, and we need one to add them.")); continue; }
            if (ValueProblem(e, email) is { } problem) { problems.Add(FixInEh(e, problem)); continue; }
            var staged = await creator.StageAsync(new CreateStaffDto
            {
                FirstName = e.FirstName!.Trim(), LastName = e.Surname!.Trim(), Email = email, AddressConfirmed = true,
                Role = UserRole.SupportWorker, Position = Position.SupportWorker, Mobile = MobileOf(e), IsActive = true,
            }, caller: null, tenantId, ct);
            if (staged.User is not { } created) { problems.Add(FixInEh(e, CreateRefusal(staged))); continue; }
            created.TenantId = tenantId;
            created.ExternalPayrollId = Id(e);
            created.EmploymentStartDate = StartOf(e);
            if (await SaveOneAsync(db, users, null, ct)) { users.Add(created); log.Created++; }
            else problems.Add(FixInEh(e, CouldNotSave));
        }

        // 4. Staff ODIP has and EH doesn't: shown to the Admin, never archived on absence.
        foreach (var u in users.Where(u => u.IsActive))
        {
            if (u.ExternalPayrollId is null)
            {
                var namesake = held.GetValueOrDefault(u.Id);
                problems.Add(new(EmploymentHeroAttentionKind.NotLinked, u.Id, namesake is null ? null : Id(namesake), u.FullName, namesake is null
                    ? "No Employment Hero employee has their email."
                    : $"No Employment Hero employee has their email. {Display(namesake)} in Employment Hero has the same name and may be the same person."));
            }
            else if (!byId.ContainsKey(u.ExternalPayrollId))
                problems.Add(new(EmploymentHeroAttentionKind.MissingFromEmploymentHero, u.Id, u.ExternalPayrollId, u.FullName, "Linked, but no longer in Employment Hero's employee list."));
        }
        // 5. An address the sync changed stays an item until the person signs in (or the Admin dismisses it): their old invite no longer works.
        var emailChanges = await db.EmploymentHeroAttentions
            .Where(a => a.TenantId == tenantId && a.Kind == EmploymentHeroAttentionKind.FixInOdip && a.Reason.StartsWith(EmailChangedStart)).ToListAsync(ct);
        foreach (var a in emailChanges)
            if (users.FirstOrDefault(u => u.Id == a.UserId) is { IsActive: true, LastLoginAt: null } u)
                problems.Add(new(EmploymentHeroAttentionKind.FixInOdip, u.Id, a.ExternalEmployeeId, u.FullName, a.Reason));
        return problems;
    }

    /// <summary>EH's values onto one linked person; returns whether anything changed. A value ODIP can't take becomes a problem and leaves the person as they were.</summary>
    private async Task<bool> UpdateAsync(OdipDbContext db, StaffCreateService creator, User u, EhEmployee e, List<Problem> problems, CancellationToken ct)
    {
        var changed = false;
        var email = EmailOf(e);
        if (ValueProblem(e, email) is { } problem) problems.Add(FixInEh(e, problem));
        else
        {
            // An empty EH mobile never blanks the one ODIP has.
            var (first, last, mobile) = (e.FirstName!.Trim(), e.Surname!.Trim(), MobileOf(e) ?? u.Mobile);
            if (u.FirstName != first || u.LastName != last || u.Mobile != mobile) { u.FirstName = first; u.LastName = last; u.Mobile = mobile; changed = true; }
            // EH owns the start date: it follows EH, and clears when EH has none (null means no limit).
            if (u.EmploymentStartDate != StartOf(e)) { u.EmploymentStartDate = StartOf(e); changed = true; }
            if (email is not null && email != EmailIdentity.Normalise(u.Email))
            {
                // A sign-in address is the person's identity. The sync re-points it only for a support worker who has never signed in: StaffController.Update
                // lets only an Admin change a working one, and a pending Admin's or Coordinator's invite must not go to an address EH holds.
                if (u.LastLoginAt is not null || u.Role != UserRole.SupportWorker)
                    problems.Add(new(EmploymentHeroAttentionKind.FixInOdip, u.Id, Id(e), u.FullName, u.LastLoginAt is not null
                        ? $"Employment Hero has a new email for them ({email}). They have signed in to Bunya Support before, so an Admin changes their sign-in address on their staff page, then sends a sign-in invite."
                        : $"Employment Hero has a new email for them ({email}). They have the {u.Role} role in Bunya Support, so an Admin changes their sign-in address on their staff page."));
                else if (await EmailProblemAsync(db, creator, email, u.Id, u.TenantId, ct) is { } emailProblem) problems.Add(FixInEh(e, emailProblem));
                else
                {
                    u.Email = email;
                    changed = true;
                    problems.Add(new(EmploymentHeroAttentionKind.FixInOdip, u.Id, Id(e), u.FullName, $"{EmailChangedStart}{email}. Send them a new sign-in invite."));
                }
            }
        }
        if (changed) u.UpdatedAt = Now();
        return changed;
    }

    /// <summary>
    /// Saves one person's change on its own, so one bad row costs only that row. Inside the run's transaction (Task 6) EF rolls a failed save back to the
    /// savepoint it made first. The context is then cleared, the staff are re-attached as saved, and the failed edit is reloaded away.
    /// </summary>
    private async Task<bool> SaveOneAsync(OdipDbContext db, List<User> users, User? edited, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning("Employment Hero sync could not save one staff member ({Error}); the others carry on", ex.InnerException?.GetType().Name ?? ex.GetType().Name);
            db.ChangeTracker.Clear();
            db.Users.AttachRange(users);
            if (edited is not null) await db.Entry(edited).ReloadAsync(ct);
            return false;
        }
    }

    /// <summary>Makes the stored items match this run's problems: new ones are added (and counted, for the one alert), solved ones are removed, and a dismissed one stays dismissed while it lasts.</summary>
    private async Task<int> ReconcileAsync(OdipDbContext db, Guid tenantId, List<Problem> problems, CancellationToken ct)
    {
        var existing = await db.EmploymentHeroAttentions.Where(a => a.TenantId == tenantId).ToListAsync(ct);
        var wanted = problems.GroupBy(p => p.Key).ToDictionary(g => g.Key, g => g.First());
        db.EmploymentHeroAttentions.RemoveRange(existing.Where(a => !wanted.ContainsKey(a.Key)));
        var added = 0;
        foreach (var (key, p) in wanted)
        {
            var item = existing.FirstOrDefault(a => a.Key == key);
            if (item is null)
            {
                db.EmploymentHeroAttentions.Add(item = new EmploymentHeroAttention { Id = Guid.NewGuid(), TenantId = tenantId, Key = key, Kind = p.Kind, CreatedAt = Now() });
                added++;
            }
            item.UserId = p.UserId;
            item.ExternalEmployeeId = p.EmployeeId;
            item.Name = Clip(p.Name, 200);
            item.Reason = Clip(p.Reason, 500);
        }
        return added;
    }

    /// <summary>Why a linked person can't take this address. It may already belong to another ODIP account, it may be at another organisation's domain, or it may be the SuperAdmin domain.</summary>
    private static async Task<string?> EmailProblemAsync(OdipDbContext db, StaffCreateService creator, string email, Guid userId, Guid tenantId, CancellationToken ct)
    {
        var holder = await db.Users.IgnoreQueryFilters([TenantFilter.Name]).Where(u => u.Id != userId && u.Email.ToLower() == email)
            .Select(u => new { u.TenantId, u.FirstName, u.LastName }).FirstOrDefaultAsync(ct);
        if (holder is not null)
            return holder.TenantId == tenantId ? $"Their email in Employment Hero is already used by {(holder.FirstName + " " + holder.LastName).Trim()} in Bunya Support." : OtherOrganisationEmail;
        if (creator.ReservedDomainError(null, email) is { } reserved) return reserved;
        return await creator.OtherOrganisationAddressErrorAsync(null, email, tenantId, ct) is null ? null : OtherOrganisationEmail;
    }

    /// <summary>A refusal from StaffCreateService, as the item says it. Same-organisation addresses were matched in step 1, so "taken" means another organisation.</summary>
    private static string CreateRefusal(StaffCreateResult staged) =>
        staged.IsConflict || staged.Error == StaffCreateService.OtherOrganisationMessage ? OtherOrganisationEmail : $"We couldn't add them: {staged.Error}";

    /// <summary>Why ODIP can't take EH's name, email or mobile as they are (the column limits and the staff form's rules), or null.</summary>
    private static string? ValueProblem(EhEmployee e, string? email)
    {
        if (string.IsNullOrWhiteSpace(e.FirstName) || string.IsNullOrWhiteSpace(e.Surname)) return "Their first name or surname is missing in Employment Hero.";
        if (e.FirstName.Trim().Length > NameMax || e.Surname.Trim().Length > NameMax) return "Their name in Employment Hero is longer than 100 characters.";
        if (email is not null && (email.Length > EmailMax || !new EmailAddressAttribute().IsValid(email))) return "Their email in Employment Hero isn't a valid address.";
        if (MobileOf(e) is { Length: > MobileMax }) return "Their mobile in Employment Hero is longer than 20 characters.";
        return null;
    }

    private static Problem FixInEh(EhEmployee e, string reason) => new(EmploymentHeroAttentionKind.FixInEmploymentHero, null, Id(e), Display(e), reason);
    /// <summary>The sync log keeps 90 days: 48 runs a day per organisation would otherwise grow without end.</summary>
    private async Task PruneLogAsync(OdipDbContext db, Guid tenantId, CancellationToken ct)
    {
        var cutoff = Now().AddDays(-90);
        db.EmploymentHeroSyncLogs.RemoveRange(await db.EmploymentHeroSyncLogs.Where(l => l.TenantId == tenantId && l.StartedAt < cutoff).ToListAsync(ct));
    }

    private DateTime Now() => _clock.GetUtcNow().UtcDateTime;
    private static string Id(EhEmployee e) => e.Id.ToString(CultureInfo.InvariantCulture);
    /// <summary>A leaver's end date has passed in the organisation's own today: their last day is still a working day.</summary>
    public static bool IsLeaver(EhEmployee e, DateOnly today) => e.EndDate is { } end && DateOnly.FromDateTime(end) < today;
    private static DateOnly? StartOf(EhEmployee e) => e.StartDate is { } start ? DateOnly.FromDateTime(start) : null;
    private static string NameKey(string? first, string? last) => $"{first?.Trim()} {last?.Trim()}".ToLowerInvariant();
    private static string Display(EhEmployee e) => $"{e.FirstName?.Trim()} {e.Surname?.Trim()}".Trim() is { Length: > 0 } name ? name : $"Employee {Id(e)}";
    private static string? EmailOf(EhEmployee e) => string.IsNullOrWhiteSpace(e.EmailAddress) ? null : EmailIdentity.Normalise(e.EmailAddress);
    private static string? MobileOf(EhEmployee e) => string.IsNullOrWhiteSpace(e.MobilePhone) ? null : e.MobilePhone.Trim();
    private static string Clip(string s, int max) => s.Length <= max ? s : s[..max];
}
