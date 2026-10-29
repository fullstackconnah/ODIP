using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.EarlyAccess;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;
using static Odip.Tests.Integrations.StubHttpHandler;

namespace Odip.Tests.Integrations;

/// <summary>EH is the master staff list: link by email, hold a same-name match, create, update, archive leavers, and turn every problem into a per-person item.</summary>
public class EmploymentHeroStaffSyncTests
{
    private static async Task<(OdipDbContext Db, Guid Tenant)> OrganisationAsync(params Func<Guid, User>[] staff)
    {
        var tenant = Guid.NewGuid();
        var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);
        foreach (var person in staff) db.Users.Add(person(tenant));
        await db.SaveChangesAsync();
        return (db, tenant);
    }

    private static Task<EmploymentHeroSyncResult> RunAsync(OdipDbContext db, Guid tenant, StubHttpHandler eh) => Sync(eh).RunAsync(db, tenant, CancellationToken.None);

    private static User Archived(User person)
    {
        person.IsActive = false;
        return person;
    }

    [Fact]
    public async Task First_connect_links_by_email_in_any_case_and_creates_the_rest_as_support_workers_with_no_invite()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Sam", "Lee", "sam@acme.org.au"));
        await using var _ = db;
        var sam = await db.Users.SingleAsync(u => u.FirstName == "Sam");

        var result = await RunAsync(db, tenant, Eh(Employee(101, "Sam", "Lee", " SAM@Acme.org.au"), Employee(102, "Ana", "Ruiz", "ana@gmail.com", "0400 111 222")));

        Assert.Equal(EmploymentHeroSyncOutcome.Done, result.Outcome);
        Assert.Equal("101", sam.ExternalPayrollId);
        var ana = await db.Users.SingleAsync(u => u.ExternalPayrollId == "102");
        Assert.Equal(("Ana", "Ruiz", "ana@gmail.com", "0400 111 222", UserRole.SupportWorker, (Position?)Position.SupportWorker, true, (DateTime?)null, tenant),
            (ana.FirstName, ana.LastName, ana.Email, ana.Mobile, ana.Role, ana.Position, ana.IsActive, ana.LastLoginAt, ana.TenantId));
        Assert.Equal((1, 1, 0), (result.Log!.Linked, result.Log.Created, result.Log.NeedsAttention));
        Assert.Empty(db.EmploymentHeroAttentions);
        Assert.Empty(db.NotificationOutbox);
        Assert.Single(db.EmploymentHeroSyncLogs);
    }

    [Fact]
    public async Task Every_run_updates_name_email_and_mobile_archives_a_leaver_and_names_itself_in_the_audit()
    {
        var (db, tenant) = await OrganisationAsync(
            t => EhFixture.Staff(t, "Sam", "Lee", "sam@acme.org.au", "101"), t => EhFixture.Staff(t, "Ana", "Ruiz", "ana@gmail.com", "102"), t => EhFixture.Staff(t, "Bo", "Chan", "bo@gmail.com", "103"));
        await using var _ = db;

        var result = await RunAsync(db, tenant, Eh(
            Employee(101, "Samuel", "Lee", "samuel@acme.org.au", "0411 222 333"),
            Employee(102, "Ana", "Ruiz", "ana@gmail.com", null, "2026-10-13T00:00:00"),   // last day yesterday
            Employee(103, "Bo", "Chan", "bo@gmail.com", null, "2026-10-14T00:00:00")));    // last day today

        var sam = await db.Users.SingleAsync(u => u.ExternalPayrollId == "101");
        Assert.Equal(("Samuel", "samuel@acme.org.au", "0411 222 333"), (sam.FirstName, sam.Email, sam.Mobile));
        Assert.False((await db.Users.SingleAsync(u => u.ExternalPayrollId == "102")).IsActive);
        Assert.True((await db.Users.SingleAsync(u => u.ExternalPayrollId == "103")).IsActive);
        Assert.Equal((4, 1), (result.Log!.Updated, result.Log.Archived));   // all four: Sam by name, the rest by their first-seen EH start date
        var update = await db.AuditLogs.SingleAsync(a => a.EntityId == sam.Id && a.Action == AuditAction.Updated);
        Assert.Equal(("Employment Hero sync", (Guid?)null), (update.ChangedByName, update.ChangedById));
    }

    [Fact]
    public async Task Problems_become_items_for_that_person_and_everyone_else_still_syncs()
    {
        var (db, tenant) = await OrganisationAsync(_ => EhFixture.Staff(Guid.NewGuid(), "Gus", "Ng", "gus@other.org"));   // Gus works for another organisation
        await using var _ = db;

        var result = await RunAsync(db, tenant, Eh(
            Employee(201, "Nia", "Ko", null),
            Employee(202, "Gus", "Ng", "gus@other.org"),
            Employee(203, "Ivy", "Lo", "ivy@gmail.com", "0400 000 000 000 000 000 00"),
            Employee(204, "Jo", null, "jo@gmail.com"),
            Employee(205, "Kim", "Wu", "kim@gmail.com")));

        Assert.Equal(EmploymentHeroSyncOutcome.Done, result.Outcome);
        Assert.Null((await db.EmploymentHeroConnections.SingleAsync()).LastSyncError);
        Assert.True(await db.Users.AnyAsync(u => u.ExternalPayrollId == "205"));
        var items = await db.EmploymentHeroAttentions.ToDictionaryAsync(a => a.ExternalEmployeeId!, a => (a.Kind, a.Reason));
        Assert.Equal(4, items.Count);
        Assert.All(items.Values, i => Assert.Equal(EmploymentHeroAttentionKind.FixInEmploymentHero, i.Kind));
        Assert.Equal("They have no email in Employment Hero, and we need one to add them.", items["201"].Reason);
        Assert.Equal("Their email in Employment Hero belongs to another organisation on Bunya Support.", items["202"].Reason);
        Assert.Equal("Their mobile in Employment Hero is longer than 20 characters.", items["203"].Reason);
        Assert.Equal("Their first name or surname is missing in Employment Hero.", items["204"].Reason);
    }

    [Fact]
    public async Task A_same_name_EH_employee_is_held_for_the_unlinked_ODIP_person_and_created_after_Leave_unlinked()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Jane", "Smith", "jane@gmail.com"));
        await using var _ = db;
        var jane = await db.Users.SingleAsync(u => u.FirstName == "Jane");
        var eh = Eh(Employee(301, "Jane", "Smith", "jane.smith@acme.org.au"));

        await RunAsync(db, tenant, eh);

        Assert.Equal(2, await db.Users.CountAsync());   // Ada and the one Jane: no second Jane
        var item = await db.EmploymentHeroAttentions.SingleAsync();
        Assert.Equal((EmploymentHeroAttentionKind.NotLinked, (Guid?)jane.Id, "301"), (item.Kind, item.UserId, item.ExternalEmployeeId));
        Assert.Equal("No Employment Hero employee has their email. Jane Smith in Employment Hero has the same name and may be the same person.", item.Reason);

        item.DismissedAt = DateTime.UtcNow;   // the Admin chose "Leave unlinked"
        await db.SaveChangesAsync();
        await RunAsync(db, tenant, eh);

        Assert.True(await db.Users.AnyAsync(u => u.ExternalPayrollId == "301" && u.Email == "jane.smith@acme.org.au"));
        Assert.NotNull((await db.EmploymentHeroAttentions.SingleAsync(a => a.UserId == jane.Id)).DismissedAt);
    }

    [Fact]
    public async Task Of_two_same_name_EH_employees_the_first_is_held_for_the_ODIP_namesake_and_the_second_is_created
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Jane", "Smith", "jane@gmail.com"));
        await using var _ = db;
        var jane = await db.Users.SingleAsync(u => u.FirstName == "Jane");

        await RunAsync(db, tenant, Eh(Employee(311, "Jane", "Smith", "jane.smith@acme.org.au"), Employee(312, "Jane", "Smith", "j.smith@acme.org.au")));

        var held = await db.EmploymentHeroAttentions.SingleAsync();
        Assert.Equal((EmploymentHeroAttentionKind.NotLinked, (Guid?)jane.Id, "311"), (held.Kind, held.UserId, held.ExternalEmployeeId));
        Assert.Null((await db.Users.SingleAsync(u => u.Id == jane.Id)).ExternalPayrollId);
        Assert.False(await db.Users.AnyAsync(u => u.ExternalPayrollId == "311"));
        Assert.True(await db.Users.AnyAsync(u => u.ExternalPayrollId == "312" && u.Email == "j.smith@acme.org.au"));
        Assert.Equal(3, await db.Users.CountAsync());   // Ada, the one Jane and the created second Jane
    }

    [Fact]
    public async Task Leavers_are_not_created_a_rehire_links_to_the_current_record_and_the_last_day_is_still_active()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Bo", "Chan", "bo@gmail.com"), t => EhFixture.Staff(t, "Ed", "Fox", "ed@gmail.com", "405"));
        await using var _ = db;

        await RunAsync(db, tenant, Eh(
            Employee(401, "Bo", "Chan", "bo@gmail.com", null, "2025-03-31T00:00:00"),   // Bo's old record
            Employee(402, "Bo", "Chan", "bo@gmail.com"),                                  // Bo, rehired
            Employee(403, "Cy", "Park", "cy@gmail.com", null, "2026-06-30T00:00:00"),     // left before the connect
            Employee(404, "Di", "Vu", "di@gmail.com", null, "2026-10-14T00:00:00"),       // last day today
            Employee(405, "Ed", "Fox", "ed@gmail.com", null, "2025-01-31T00:00:00"),      // Ed's old record, still linked
            Employee(406, "Ed", "Fox", "ed@gmail.com")));                                 // Ed, rehired

        var bo = await db.Users.SingleAsync(u => u.FirstName == "Bo");
        var ed = await db.Users.SingleAsync(u => u.FirstName == "Ed");
        Assert.Equal(("402", true), (bo.ExternalPayrollId, bo.IsActive));
        Assert.Equal(("406", true), (ed.ExternalPayrollId, ed.IsActive));
        Assert.False(await db.Users.AnyAsync(u => u.Email == "cy@gmail.com"));
        Assert.True((await db.Users.SingleAsync(u => u.ExternalPayrollId == "404")).IsActive);
        Assert.Empty(db.EmploymentHeroAttentions);
    }

    [Fact]
    public async Task A_current_EH_employee_linked_to_an_archived_account_is_shown_for_restoring()
    {
        var (db, tenant) = await OrganisationAsync(
            t => Archived(EhFixture.Staff(t, "Ed", "Fox", "ed@gmail.com", "405")),   // archived when their old record ended
            t => Archived(EhFixture.Staff(t, "Fay", "Ong", "fay@gmail.com")));        // archived by hand, never linked
        await using var _ = db;

        var eh = Eh(
            Employee(405, "Ed", "Fox", "ed@gmail.com", null, "2025-01-31T00:00:00"), Employee(406, "Ed", "Fox", "ed@gmail.com"),
            Employee(501, "Fay", "Ong", "fay@gmail.com"));

        await RunAsync(db, tenant, eh);
        await RunAsync(db, tenant, eh);   // already linked now: the items must last as long as the accounts stay archived

        var items = await db.EmploymentHeroAttentions.ToListAsync();
        Assert.Equal(2, items.Count);
        Assert.All(items, i => Assert.Equal(
            (EmploymentHeroAttentionKind.FixInOdip, "Employment Hero has them as current, but their Bunya Support account is archived. Restore them on their staff page."), (i.Kind, i.Reason)));
        var people = await db.Users.Where(u => u.FirstName == "Ed" || u.FirstName == "Fay").OrderBy(u => u.FirstName).ToListAsync();
        Assert.Equal(new[] { ("406", false), ("501", false) }, people.Select(u => (u.ExternalPayrollId!, u.IsActive)));   // linked, never restored by the sync
    }

    [Fact]
    public async Task A_linked_person_missing_from_EHs_list_is_never_archived()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Sam", "Lee", "sam@acme.org.au", "101"));
        await using var _ = db;

        await RunAsync(db, tenant, Eh());

        var sam = await db.Users.SingleAsync(u => u.FirstName == "Sam");
        Assert.True(sam.IsActive);
        var item = await db.EmploymentHeroAttentions.SingleAsync();
        Assert.Equal((EmploymentHeroAttentionKind.MissingFromEmploymentHero, (Guid?)sam.Id), (item.Kind, item.UserId));
    }

    [Fact]
    public async Task An_email_change_for_someone_who_has_signed_in_is_left_for_an_Admin()
    {
        var (db, tenant) = await OrganisationAsync(
            t => EhFixture.Staff(t, "Sam", "Lee", "sam@acme.org.au", "101", lastLogin: new DateTime(2026, 10, 1)), t => EhFixture.Staff(t, "Tom", "Ito", "tom@gmail.com", "102"));
        await using var _ = db;

        await RunAsync(db, tenant, Eh(Employee(101, "Sam", "Lee", "sam.lee@acme.org.au"), Employee(102, "Tom", "Ito", "tom.ito@gmail.com")));

        var sam = await db.Users.SingleAsync(u => u.FirstName == "Sam");
        Assert.Equal("sam@acme.org.au", sam.Email);
        Assert.Equal("tom.ito@gmail.com", (await db.Users.SingleAsync(u => u.FirstName == "Tom")).Email);
        var item = await db.EmploymentHeroAttentions.SingleAsync(a => a.UserId == sam.Id);
        Assert.Equal((EmploymentHeroAttentionKind.FixInOdip, (Guid?)sam.Id), (item.Kind, item.UserId));
        Assert.Contains("sam.lee@acme.org.au", item.Reason);
    }

    [Fact]
    public async Task Two_new_people_with_the_same_name_get_different_usernames()
    {
        var (db, tenant) = await OrganisationAsync();
        await using var _ = db;

        await RunAsync(db, tenant, Eh(Employee(601, "Jo", "Smith", "jo1@gmail.com"), Employee(602, "Jo", "Smith", "jo2@gmail.com")));

        var usernames = await db.Users.Where(u => u.FirstName == "Jo").Select(u => u.Username).ToListAsync();
        Assert.Equal(2, usernames.Count);
        Assert.NotEqual(usernames[0], usernames[1]);
    }

    [Fact]
    public async Task A_second_run_with_nothing_new_changes_nothing()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Sam", "Lee", "sam@acme.org.au"));
        await using var _ = db;
        var eh = Eh(Employee(101, "Sam", "Lee", "sam@acme.org.au"), Employee(102, "Ana", "Ruiz", "ana@gmail.com"));
        await RunAsync(db, tenant, eh);
        var audited = await db.AuditLogs.CountAsync();

        var second = await RunAsync(db, tenant, eh);

        Assert.Equal((0, 0, 0, 0), (second.Log!.Linked, second.Log.Created, second.Log.Updated, second.Log.Archived));
        Assert.Equal(3, await db.Users.CountAsync());
        Assert.Equal(audited, await db.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task The_only_Admin_is_never_archived_and_is_shown_instead()
    {
        var (db, tenant) = await OrganisationAsync();
        await using var _ = db;
        // EH ends the employment of Ada, the organisation's one Admin (EH id 1).
        var eh = new StubHttpHandler().On(EmployeesPage(Business), HttpStatusCode.OK, new[] { Employee(1, "Ada", "Admin", "ada@acme.org.au", null, "2026-10-01T00:00:00") });

        var result = await RunAsync(db, tenant, eh);

        var ada = await db.Users.SingleAsync(u => u.FirstName == "Ada");
        Assert.True(ada.IsActive);
        Assert.Equal(0, result.Log!.Archived);
        var item = await db.EmploymentHeroAttentions.SingleAsync();
        Assert.Equal((EmploymentHeroAttentionKind.FixInOdip, (Guid?)ada.Id), (item.Kind, item.UserId));
        Assert.Equal("Employment Hero has ended their employment; they are the only Admin. Add another Admin first, then archive them.", item.Reason);
    }

    [Fact]
    public async Task Too_many_leavers_in_one_run_archives_nobody_and_shows_each_one()
    {
        // Four of the five linked staff end at once: more than max(3, a quarter of 5), so it reads as bad EH data, not resignations.
        var (db, tenant) = await OrganisationAsync(
            t => EhFixture.Staff(t, "Sam", "Lee", "sam@gmail.com", "101"), t => EhFixture.Staff(t, "Ana", "Ruiz", "ana@gmail.com", "102"),
            t => EhFixture.Staff(t, "Bo", "Chan", "bo@gmail.com", "103"), t => EhFixture.Staff(t, "Cy", "Park", "cy@gmail.com", "104"));
        await using var _ = db;
        const string ended = "2026-10-01T00:00:00";

        var result = await RunAsync(db, tenant, Eh(
            Employee(101, "Sam", "Lee", "sam@gmail.com", null, ended), Employee(102, "Ana", "Ruiz", "ana@gmail.com", null, ended),
            Employee(103, "Bo", "Chan", "bo@gmail.com", null, ended), Employee(104, "Cy", "Park", "cy@gmail.com", null, ended)));

        Assert.Equal(0, result.Log!.Archived);
        Assert.True(await db.Users.AllAsync(u => u.IsActive));
        var items = await db.EmploymentHeroAttentions.ToListAsync();
        Assert.Equal(4, items.Count);
        Assert.All(items, i => Assert.Equal(EmploymentHeroAttentionKind.FixInOdip, i.Kind));
        Assert.All(items, i => Assert.StartsWith("Employment Hero has ended the employment of 4 staff in one sync, so we archived nobody", i.Reason));
    }

    [Fact]
    public async Task An_empty_EH_mobile_keeps_the_ODIP_one()
    {
        var (db, tenant) = await OrganisationAsync(t =>
        {
            var person = EhFixture.Staff(t, "Sam", "Lee", "sam@acme.org.au");
            person.Mobile = "0400 111 222";
            return person;
        });
        await using var _ = db;

        await RunAsync(db, tenant, Eh(Employee(101, "Sam", "Lee", "sam@acme.org.au")));

        var sam = await db.Users.SingleAsync(u => u.FirstName == "Sam");
        Assert.Equal(("101", "0400 111 222"), (sam.ExternalPayrollId, sam.Mobile));
    }

    [Fact]
    public async Task An_email_change_for_a_pending_Coordinator_is_left_for_an_Admin()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Cal", "Ray", "cal@acme.org.au", "103", UserRole.Coordinator));   // invited, never signed in
        await using var _ = db;

        await RunAsync(db, tenant, Eh(Employee(103, "Cal", "Ray", "cal.ray@gmail.com")));

        Assert.Equal("cal@acme.org.au", (await db.Users.SingleAsync(u => u.FirstName == "Cal")).Email);
        var item = await db.EmploymentHeroAttentions.SingleAsync();
        Assert.Equal(EmploymentHeroAttentionKind.FixInOdip, item.Kind);
        Assert.Contains("cal.ray@gmail.com", item.Reason);
    }

    [Fact]
    public async Task Sync_log_rows_older_than_90_days_are_deleted()
    {
        var (db, tenant) = await OrganisationAsync();
        await using var _ = db;
        db.EmploymentHeroSyncLogs.AddRange(
            new EmploymentHeroSyncLog { Id = Guid.NewGuid(), TenantId = tenant, BusinessId = Business, StartedAt = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc) },
            new EmploymentHeroSyncLog { Id = Guid.NewGuid(), TenantId = tenant, BusinessId = Business, StartedAt = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc) });
        await db.SaveChangesAsync();

        await RunAsync(db, tenant, Eh());

        // The clock is 14 October 2026, 01:00 UTC: 1 July is past 90 days, 1 August is not, and the run adds its own row.
        Assert.Equal(new[] { new DateTime(2026, 8, 1), new DateTime(2026, 10, 14, 1, 0, 0) },
            await db.EmploymentHeroSyncLogs.OrderBy(l => l.StartedAt).Select(l => l.StartedAt).ToArrayAsync());
    }

    [Fact]
    public async Task A_refused_key_fails_the_run_changes_nobody_and_alerts_Admins_once_until_it_works_again()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Sam", "Lee", "sam@acme.org.au", "101"));
        await using var _ = db;
        var refused = new StubHttpHandler().On(EmployeesPage(Business), HttpStatusCode.Unauthorized);

        var result = await RunAsync(db, tenant, refused);

        Assert.Equal((EmploymentHeroSyncOutcome.Failed, "KeyRefused"), (result.Outcome, result.Log!.ErrorClass));
        Assert.Equal("Employment Hero didn't accept the API key. Check it in Employment Hero and connect again.", (await db.EmploymentHeroConnections.SingleAsync()).LastSyncError);
        var alert = await db.NotificationOutbox.SingleAsync();   // Ada is the one Admin
        Assert.Equal(NotificationEventType.IntegrationDegraded, alert.EventType);
        Assert.Contains("stopped working", alert.PayloadJson);
        Assert.DoesNotContain(ApiKey, alert.PayloadJson);

        // Outside NotificationRaiser's own 5-minute dedupe, so only the "already failing" rule can hold a second alert back.
        alert.CreatedAt = alert.CreatedAt.AddHours(-1);
        await db.SaveChangesAsync();
        await RunAsync(db, tenant, refused);
        Assert.Single(db.NotificationOutbox);
        Assert.Equal(2, await db.EmploymentHeroSyncLogs.CountAsync());

        var ok = await RunAsync(db, tenant, Eh(Employee(101, "Sam", "Lee", "sam@acme.org.au")));
        Assert.Equal(EmploymentHeroSyncOutcome.Done, ok.Outcome);
        Assert.Null((await db.EmploymentHeroConnections.SingleAsync()).LastSyncError);
    }

    [Fact]
    public async Task A_list_cut_short_changes_nobody()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Sam", "Lee", "sam@acme.org.au", "101"));
        await using var _ = db;
        // A full first page (without Ada), then EH throttles: a partial list must neither rename Sam nor treat Ada as gone.
        var firstPage = new[] { Employee(101, "Samuel", "Lee", "sam@acme.org.au") }.Concat(Enumerable.Range(1000, 99).Select(i => Employee(i, "P", $"{i}", $"p{i}@gmail.com"))).ToArray();
        var eh = new StubHttpHandler().On(EmployeesPage(Business), HttpStatusCode.OK, firstPage).On(EmployeesPage(Business, 100), HttpStatusCode.TooManyRequests);

        var result = await RunAsync(db, tenant, eh);

        Assert.Equal((EmploymentHeroSyncOutcome.Failed, "RateLimited"), (result.Outcome, result.Log!.ErrorClass));
        Assert.Equal("Sam", (await db.Users.SingleAsync(u => u.ExternalPayrollId == "101")).FirstName);
        Assert.Equal(2, await db.Users.CountAsync());
        Assert.Empty(db.EmploymentHeroAttentions);
    }

    [Fact]
    public async Task A_saved_key_the_master_key_cannot_read_fails_that_organisation_and_calls_nobody()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant, IntegrationKeyProtectorTests.Protector(IntegrationKeyProtectorTests.NewMasterKey()));   // saved under a master key this server no longer has
        var eh = Eh();

        var result = await RunAsync(db, tenant, eh);

        Assert.Equal((EmploymentHeroSyncOutcome.Failed, "KeyUnreadable"), (result.Outcome, result.Log!.ErrorClass));
        Assert.Empty(eh.Requests);
        Assert.Equal(EmploymentHeroStaffSync.KeyUnreadableMessage, (await db.EmploymentHeroConnections.SingleAsync()).LastSyncError);
    }

    [Fact]
    public async Task New_problems_alert_Admins_once_and_the_same_problems_do_not_alert_again()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Jane", "Smith", "jane@gmail.com"));
        await using var _ = db;

        await RunAsync(db, tenant, Eh());

        var alert = await db.NotificationOutbox.SingleAsync();
        Assert.Contains("1 staff member needs attention after the Employment Hero sync.", alert.PayloadJson);
        alert.CreatedAt = alert.CreatedAt.AddHours(-1);
        await db.SaveChangesAsync();
        await RunAsync(db, tenant, Eh());
        Assert.Single(db.NotificationOutbox);
    }

    [Fact]
    public async Task The_key_and_staff_details_never_reach_the_log()
    {
        var logger = new CapturingLogger<EmploymentHeroStaffSync>();
        var (db, tenant) = await OrganisationAsync();
        await using var _ = db;

        await Sync(new StubHttpHandler().On(EmployeesPage(Business), HttpStatusCode.Unauthorized), logger: logger).RunAsync(db, tenant, CancellationToken.None);
        await Sync(Eh(Employee(701, "Lia", "Moe", "lia@gmail.com")), logger: logger).RunAsync(db, tenant, CancellationToken.None);

        Assert.Equal(2, logger.Entries.Count);
        Assert.All(logger.Entries, e =>
        {
            Assert.DoesNotContain(ApiKey, e.Message);
            Assert.DoesNotContain("lia@gmail.com", e.Message);
            Assert.DoesNotContain("Lia", e.Message);
        });
    }

    [Fact]
    public async Task A_new_problem_alert_is_not_swallowed_by_a_recent_failure_alert()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Jane", "Smith", "jane@gmail.com"));
        await using var _ = db;

        await RunAsync(db, tenant, new StubHttpHandler().On(EmployeesPage(Business), HttpStatusCode.Unauthorized));   // raises the failure alert
        await RunAsync(db, tenant, Eh());                                                                               // Jane is a new item

        // Both within NotificationRaiser's 5-minute dedupe window, but about different things: each kind has its own entity.
        var alerts = await db.NotificationOutbox.ToListAsync();
        Assert.Equal(2, alerts.Count);
        Assert.Contains(alerts, a => a.PayloadJson.Contains("stopped working"));
        Assert.Contains(alerts, a => a.PayloadJson.Contains("1 staff member needs attention"));
    }

    [Fact]
    public async Task An_email_change_for_someone_who_never_signed_in_is_applied_and_asks_for_a_new_invite_until_they_sign_in()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Tom", "Ito", "tom@gmail.com", "102"));
        await using var _ = db;
        var eh = Eh(Employee(102, "Tom", "Ito", "tom.ito@gmail.com"));

        await RunAsync(db, tenant, eh);
        await RunAsync(db, tenant, eh);   // nothing changes now, but the old invite still points at the old address

        var tom = await db.Users.SingleAsync(u => u.FirstName == "Tom");
        Assert.Equal("tom.ito@gmail.com", tom.Email);
        var item = await db.EmploymentHeroAttentions.SingleAsync();
        Assert.Equal((EmploymentHeroAttentionKind.FixInOdip, (Guid?)tom.Id), (item.Kind, item.UserId));
        Assert.Equal("Employment Hero changed their email to tom.ito@gmail.com. Send them a new sign-in invite.", item.Reason);

        tom.LastLoginAt = new DateTime(2026, 10, 14, 0, 30, 0, DateTimeKind.Utc);   // they signed in with the new address
        await db.SaveChangesAsync();
        await RunAsync(db, tenant, eh);
        Assert.Empty(db.EmploymentHeroAttentions);
    }

    [Fact]
    public async Task A_business_changed_while_EH_was_read_skips_the_run_and_changes_nobody()
    {
        var name = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        await using var db = Db(name, tenant);
        await ConnectAsync(db, tenant);
        db.Users.Add(EhFixture.Staff(tenant, "Sam", "Lee", "sam@acme.org.au"));
        await db.SaveChangesAsync();
        var eh = Eh(Employee(101, "Sam", "Lee", "sam@acme.org.au"), Employee(102, "Ana", "Ruiz", "ana@gmail.com"));
        // An Admin reconnects to business 888 while business 777's list is being read: 777's ids must not land on 888's connection.
        eh.BeforeAnswer = _ =>
        {
            using var admin = Db(name, tenant);
            admin.EmploymentHeroConnections.Single().BusinessId = "888";
            admin.SaveChanges();
        };

        var result = await RunAsync(db, tenant, eh);

        Assert.Equal(EmploymentHeroSyncOutcome.Skipped, result.Outcome);
        await using var check = Db(name, tenant);
        Assert.Null((await check.Users.SingleAsync(u => u.FirstName == "Sam")).ExternalPayrollId);
        Assert.False(await check.Users.AnyAsync(u => u.FirstName == "Ana"));
        Assert.Empty(check.EmploymentHeroSyncLogs);
        Assert.Null((await check.EmploymentHeroConnections.SingleAsync()).LastSyncAt);
    }

    /// <summary>Refuses the run's last save (the one that writes a successful log row), as a lost database or a unique-index race would.</summary>
    private sealed class FailingFinalSave : Microsoft.EntityFrameworkCore.Diagnostics.SaveChangesInterceptor
    {
        public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> SavingChangesAsync(
            Microsoft.EntityFrameworkCore.Diagnostics.DbContextEventData eventData, Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            eventData.Context!.ChangeTracker.Entries<EmploymentHeroSyncLog>().Any(e => e.State == EntityState.Added && e.Entity.ErrorClass == null)
                ? throw new DbUpdateException("the final save failed")
                : base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    [Fact]
    public async Task An_unexpected_failure_is_recorded_as_a_failed_run_and_alerts_the_Admins()
    {
        var name = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        await using (var setup = Db(name, tenant)) await ConnectAsync(setup, tenant);
        await using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name)
            .AddInterceptors(new Odip.Infrastructure.Audit.AuditInterceptor(new Microsoft.AspNetCore.Http.HttpContextAccessor()), new FailingFinalSave()).Options,
            Odip.Tests.Imports.ImportTestSupport.Tenant(tenant));

        var result = await RunAsync(db, tenant, Eh(Employee(101, "Ana", "Ruiz", "ana@gmail.com")));

        Assert.Equal((EmploymentHeroSyncOutcome.Failed, "Unexpected"), (result.Outcome, result.Log!.ErrorClass));
        await using var check = Db(name, tenant);
        Assert.Equal(EmploymentHeroStaffSync.UnexpectedMessage, (await check.EmploymentHeroConnections.SingleAsync()).LastSyncError);
        Assert.Equal("Unexpected", (await check.EmploymentHeroSyncLogs.SingleAsync()).ErrorClass);
        Assert.Contains("stopped working", (await check.NotificationOutbox.SingleAsync()).PayloadJson);
    }

    [Theory]
    [InlineData(12, 3, 3)]   // 3 is not more than max(3, 12 / 4): archived
    [InlineData(20, 5, 5)]   // 5 is not more than a quarter of 20: archived
    [InlineData(20, 6, 0)]   // 6 is: held, every one shown instead
    public async Task The_leaver_brake_holds_only_above_max_3_or_a_quarter_of_the_active_linked_staff(int linked, int leaving, int archived)
    {
        // Ada (EH 1, current) is one of the linked staff; staff 2 to linked are linked too, and the first `leaving` of them have ended.
        var ids = Enumerable.Range(2, linked - 1).ToArray();
        var (db, tenant) = await OrganisationAsync(ids.Select(i => (Func<Guid, User>)(t => EhFixture.Staff(t, $"P{i}", "Lee", $"p{i}@gmail.com", $"{i}"))).ToArray());
        await using var _ = db;

        var result = await RunAsync(db, tenant, Eh(ids.Select(i => Employee(i, $"P{i}", "Lee", $"p{i}@gmail.com", null, i <= leaving + 1 ? "2026-10-01T00:00:00" : null)).ToArray()));

        Assert.Equal(archived, result.Log!.Archived);
        Assert.Equal(linked - archived, await db.Users.CountAsync(u => u.IsActive));
    }

    private static readonly DateTime SignedIn = new(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>Ada, the fixture's Admin (EH 1), has signed in to ODIP.</summary>
    private static async Task AdaHasSignedInAsync(OdipDbContext db)
    {
        (await db.Users.SingleAsync(u => u.FirstName == "Ada")).LastLoginAt = SignedIn;
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Two_Admins_leaving_in_one_run_archives_one_and_keeps_the_last()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Bea", "Admin", "bea@acme.org.au", "2", UserRole.Admin, SignedIn));
        await using var _ = db;
        await AdaHasSignedInAsync(db);
        var eh = new StubHttpHandler().On(EmployeesPage(Business), HttpStatusCode.OK, new[]
        {
            Employee(1, "Ada", "Admin", "ada@acme.org.au", null, "2026-10-01T00:00:00"), Employee(2, "Bea", "Admin", "bea@acme.org.au", null, "2026-10-01T00:00:00"),
        });

        var result = await RunAsync(db, tenant, eh);

        Assert.Equal(1, result.Log!.Archived);
        Assert.Equal(1, await db.Users.CountAsync(u => u.Role == UserRole.Admin && u.IsActive));
        var item = await db.EmploymentHeroAttentions.SingleAsync();
        Assert.Equal("Employment Hero has ended their employment; they are the only Admin. Add another Admin first, then archive them.", item.Reason);
    }

    [Fact]
    public async Task A_pending_Admin_who_never_signed_in_does_not_count_so_the_only_signed_in_Admin_is_kept()
    {
        // Cal was invited as an Admin but has never signed in: archiving Ada would leave nobody able to run the organisation (deep review N1).
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Cal", "Ray", "cal@acme.org.au", null, UserRole.Admin));
        await using var _ = db;
        await AdaHasSignedInAsync(db);
        var eh = new StubHttpHandler().On(EmployeesPage(Business), HttpStatusCode.OK, new[] { Employee(1, "Ada", "Admin", "ada@acme.org.au", null, "2026-10-01T00:00:00") });

        var result = await RunAsync(db, tenant, eh);

        Assert.Equal(0, result.Log!.Archived);
        var ada = await db.Users.SingleAsync(u => u.FirstName == "Ada");
        Assert.True(ada.IsActive);
        var item = await db.EmploymentHeroAttentions.SingleAsync(a => a.UserId == ada.Id);
        Assert.Equal((EmploymentHeroAttentionKind.FixInOdip, "Employment Hero has ended their employment; they are the only Admin. Add another Admin first, then archive them."), (item.Kind, item.Reason));
    }

    [Fact]
    public async Task A_second_Admin_who_has_signed_in_counts_so_the_leaving_Admin_is_archived()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Cal", "Ray", "cal@acme.org.au", null, UserRole.Admin, SignedIn));
        await using var _ = db;
        await AdaHasSignedInAsync(db);
        var eh = new StubHttpHandler().On(EmployeesPage(Business), HttpStatusCode.OK, new[] { Employee(1, "Ada", "Admin", "ada@acme.org.au", null, "2026-10-01T00:00:00") });

        var result = await RunAsync(db, tenant, eh);

        Assert.Equal(1, result.Log!.Archived);
        Assert.False((await db.Users.SingleAsync(u => u.FirstName == "Ada")).IsActive);
        Assert.True((await db.Users.SingleAsync(u => u.FirstName == "Cal")).IsActive);
    }

    [Fact]
    public async Task A_future_hire_is_created_active_with_their_start_date_and_the_date_follows_EH_on_update_and_clears_when_EH_has_none()
    {
        var (db, tenant) = await OrganisationAsync();
        await using var _ = db;

        await RunAsync(db, tenant, Eh(Employee(501, "Fay", "Dunn", "fay@gmail.com", null, null, "2027-02-01T00:00:00")));
        var fay = await db.Users.SingleAsync(u => u.ExternalPayrollId == "501");
        Assert.True(fay.IsActive);
        Assert.Equal(new DateOnly(2027, 2, 1), fay.EmploymentStartDate);

        var moved = await RunAsync(db, tenant, Eh(Employee(501, "Fay", "Dunn", "fay@gmail.com", null, null, "2027-03-01T00:00:00")));
        Assert.Equal((1, new DateOnly(2027, 3, 1)), (moved.Log!.Updated, (await db.Users.SingleAsync(u => u.ExternalPayrollId == "501")).EmploymentStartDate));

        var same = await RunAsync(db, tenant, Eh(Employee(501, "Fay", "Dunn", "fay@gmail.com", null, null, "2027-03-01T00:00:00")));
        Assert.Equal(0, same.Log!.Updated);

        var cleared = await RunAsync(db, tenant, Eh(Employee(501, "Fay", "Dunn", "fay@gmail.com", null, null, null)));
        Assert.Equal((1, (DateOnly?)null), (cleared.Log!.Updated, (await db.Users.SingleAsync(u => u.ExternalPayrollId == "501")).EmploymentStartDate));
    }

    [Fact]
    public async Task Two_ODIP_users_with_the_same_normalised_email_link_the_first_in_list_order()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Gus", "One", "gus@gmail.com"), t => EhFixture.Staff(t, "Gus", "Two", "GUS@gmail.com "));
        await using var _ = db;

        // The sync reads staff in the database's order (InMemory orders by key, not insertion), so the first of the two there is the one it must link.
        var inListOrder = await db.Users.Where(u => u.TenantId == tenant && u.Email.Contains("gus", StringComparison.OrdinalIgnoreCase)).ToListAsync();

        var result = await RunAsync(db, tenant, Eh(Employee(601, "Gus", "One", "gus@gmail.com")));

        Assert.Equal("601", (await db.Users.SingleAsync(u => u.Id == inListOrder[0].Id)).ExternalPayrollId);
        Assert.Null((await db.Users.SingleAsync(u => u.Id == inListOrder[1].Id)).ExternalPayrollId);
        Assert.Equal(1, result.Log!.Linked);
    }

    [Fact]
    public async Task A_current_EH_employee_sharing_the_email_of_an_already_linked_user_is_shown_not_linked()
    {
        var (db, tenant) = await OrganisationAsync(t => EhFixture.Staff(t, "Hal", "Roe", "hal@gmail.com", "701"));
        await using var _ = db;

        var result = await RunAsync(db, tenant, Eh(Employee(701, "Hal", "Roe", "hal@gmail.com"), Employee(702, "Hal", "Roe", "hal@gmail.com")));

        Assert.Equal("701", (await db.Users.SingleAsync(u => u.FirstName == "Hal")).ExternalPayrollId);
        Assert.Equal(0, result.Log!.Linked);
        Assert.Contains(db.EmploymentHeroAttentions, a => a.ExternalEmployeeId == "702");
        Assert.DoesNotContain(db.EmploymentHeroAttentions, a => a.ExternalEmployeeId == "701");
    }

    private sealed class RefusingLink : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            eventData.Context!.ChangeTracker.Entries<User>().Any(e => e.State == EntityState.Modified && e.Entity.ExternalPayrollId == "801")
                ? throw new DbUpdateException("collision")
                : base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    [Fact]
    public async Task A_link_that_fails_to_save_is_shown_and_the_next_employee_still_links()
    {
        var (name, tenant) = (Guid.NewGuid().ToString(), Guid.NewGuid());
        await using var db = Db(name, tenant, new RefusingLink());
        await ConnectAsync(db, tenant);
        db.Users.AddRange(EhFixture.Staff(tenant, "Ivy", "Ng", "ivy@gmail.com"), EhFixture.Staff(tenant, "Jo", "Kim", "jo@gmail.com"));
        await db.SaveChangesAsync();

        var result = await RunAsync(db, tenant, Eh(Employee(801, "Ivy", "Ng", "ivy@gmail.com"), Employee(802, "Jo", "Kim", "jo@gmail.com")));

        Assert.Null((await db.Users.SingleAsync(u => u.FirstName == "Ivy")).ExternalPayrollId);
        Assert.Equal("802", (await db.Users.SingleAsync(u => u.FirstName == "Jo")).ExternalPayrollId);
        Assert.Equal(1, result.Log!.Linked);
        Assert.Contains(db.EmploymentHeroAttentions, a => a.ExternalEmployeeId == "801" && a.Kind == EmploymentHeroAttentionKind.FixInEmploymentHero);
    }
}
