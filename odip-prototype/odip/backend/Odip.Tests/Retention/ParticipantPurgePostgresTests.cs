using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Retention;
using Odip.Tests.Claims;
using Odip.Tests.DataExport;
using Xunit;
using PostgresFixture = Odip.Tests.Postgres.PostgresFixture;

namespace Odip.Tests.Retention;

/// <summary>
/// The purge engine against a real PostgreSQL (InMemory has no ExecuteDelete or transactions). Skipped, never failed, when POSTGRES_CONNECTION_STRING is unset.
/// X is an archived participant in organisation A with a row in most of the purge tables; Y is a neighbour in A that shares X's trip, the group claim and a contact; B is another organisation's copy.
/// </summary>
public class ParticipantPurgePostgresTests : IClassFixture<PostgresFixture>
{
    private const string XLastName = "Zxqvname";
    private const string XNdis = "43100000002";
    private static readonly DateOnly Old = new(2018, 1, 1);
    private readonly PostgresFixture _pg;
    private readonly FixedClock _clock = new(new DateTimeOffset(2040, 1, 1, 3, 0, 0, TimeSpan.Zero));
    public ParticipantPurgePostgresTests(PostgresFixture pg) => _pg = pg;

    private sealed record World(string Cs, Guid A, Guid B, DataExportTestKit.Planted X, DataExportTestKit.Planted OfB, Guid XId, Guid YId, Guid KeptIncidentId, Guid BatchId, Guid YLineId, Guid OutboxId);

    // Indexes into Planted.Ids (see DataExportTestKit.Plant).
    private const int LinkedIx = 1, PlanManagerIx = 2, UserIx = 3, ParticipantIx = 4, TripIx = 5, BookingIx = 9, GroupClaimIx = 10, ShiftClaimIx = 11, ClaimLineIx = 12, IncidentIx = 18, ShiftIx = 28;

    private async Task<World> SeedAsync(bool corruptCrossTenantShift = false)
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var setup = PostgresFixture.NewContext(cs)) await setup.Database.MigrateAsync();

        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        await using var admin = PostgresFixture.NewContext(cs);
        admin.Tenants.AddRange(new Tenant { Id = a, Name = "Alpha Care", EmailDomain = $"{a:N}.example.com" }, new Tenant { Id = b, Name = "Bravo Care", EmailDomain = $"{b:N}.example.com" });
        admin.SaveChanges();
        var ofB = DataExportTestKit.Plant(admin, b, "43100000001");
        var x = DataExportTestKit.Plant(admin, a, XNdis);
        Guid Id(int i) => x.Ids[i];

        var y = new Participant { Id = Guid.NewGuid(), TenantId = a, FirstName = "Yara", LastName = "Yarrow", NdisNumber = "43100000009", PlanType = PlanType.SelfManaged };
        admin.Participants.Add(y);
        admin.SaveChanges();
        var yBooking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = Id(TripIx), ParticipantId = y.Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) };
        var yLine = new ClaimLineItem
        {
            TenantId = a, Id = Guid.NewGuid(), TripClaimId = Id(GroupClaimIx), ParticipantBookingId = yBooking.Id, SupportItemCode = "01_002_0117_1_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 2, 1), SupportsDeliveredTo = new DateOnly(2026, 2, 1), Hours = 1m, UnitPrice = 60m, TotalAmount = 60m,
        };
        // F6: an incident that stays (it involves Y) but points at X's booking.
        var kept = new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = a, ReportedByUserId = Id(UserIx), InvolvedParticipantId = y.Id, ParticipantBookingId = Id(BookingIx), IncidentType = IncidentType.Other, OtherTypeSpecify = "x",
            Severity = IncidentSeverity.Low, Title = "Kept", Description = "About Y", IncidentDateTime = new DateTime(2026, 8, 30, 9, 0, 0, DateTimeKind.Utc),
        };
        var batch = new ClaimBatch { Id = Guid.NewGuid(), TenantId = a, FileName = "claims-1.csv", Status = ClaimBatchStatus.Built, Content = [1, 2, 3, 4] };
        var batchLine = new ClaimBatchLine { Id = Guid.NewGuid(), TenantId = a, BatchId = batch.Id, ClaimLineItemId = Id(ClaimLineIx), Outcome = ClaimBatchLineOutcome.Pending };
        var invoice = new Invoice { Id = Guid.NewGuid(), TenantId = a, Kind = InvoiceKind.Invoice, Status = InvoiceStatus.Issued, Number = 1, DisplayNumber = "INV-0001", TripClaimId = Id(ShiftClaimIx), ParticipantId = Id(ParticipantIx) };
        var outbox = new NotificationOutbox
        {
            Id = Guid.NewGuid(), TenantId = a, EventType = NotificationEventType.ShiftAssigned, EntityType = "Shift", EntityId = Id(ShiftIx), RecipientUserId = Id(UserIx), PayloadJson = "{}",
            Status = NotificationOutboxStatus.Failed, NextAttemptAt = DateTime.UtcNow, CreatedAt = DateTime.UtcNow,
        };
        var log = new NotificationLog { Id = Guid.NewGuid(), TenantId = a, OutboxId = outbox.Id, Channel = NotificationChannelKind.Email, RecipientAddress = "a@example.com" };
        var yContact = new ParticipantContact { ParticipantId = y.Id, ContactId = Id(LinkedIx) };
        AuditLog Audit(string type, Guid id, string changes) => new() { Id = Guid.NewGuid(), EntityType = type, EntityId = id, Action = AuditAction.Updated, ChangedAt = DateTimeOffset.UtcNow, ChangedByName = "Sam Hill", Changes = changes };
        admin.AddRange(yBooking, yLine, kept, batch, batchLine, invoice, outbox, log, yContact,
            Audit("Participant", Id(ParticipantIx), $"[{{\"Field\":\"LastName\",\"Old\":\"Lee\",\"New\":\"{XLastName}\"}}]"), Audit("Shift", Id(ShiftIx), "[]"), Audit("Participant", y.Id, "[]"));
        admin.SaveChanges();

        // X is the archived one, due long ago; the plant's incident involves X.
        var (xId, incidentId) = (Id(ParticipantIx), Id(IncidentIx));
        await admin.Participants.Where(p => p.Id == xId).ExecuteUpdateAsync(u => u.SetProperty(p => p.IsActive, false).SetProperty(p => p.RetentionStartsOn, Old).SetProperty(p => p.LastName, XLastName));
        await admin.IncidentReports.Where(i => i.Id == incidentId).ExecuteUpdateAsync(u => u.SetProperty(i => i.InvolvedParticipantId, xId));

        if (corruptCrossTenantShift)
            admin.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = b, ParticipantId = Id(ParticipantIx), UserId = ofB.Ids[UserIx], ServiceDate = new DateOnly(2026, 2, 2), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0) });
        admin.SaveChanges();
        return new World(cs, a, b, x, ofB, Id(ParticipantIx), y.Id, kept.Id, batch.Id, yLine.Id, outbox.Id);
    }

    private static Task<PurgeOutcome> Purge(World w, FixedClock clock, string reason = "Seven years passed")
    {
        var db = PostgresFixture.NewContext(w.Cs, DataExportTestKit.Tenant(w.A));
        return ParticipantPurger.PurgeAsync(db, w.A, w.XId, Guid.NewGuid(), "Ada Admin", reason, clock, CancellationToken.None);
    }

    private static async Task<Dictionary<string, int>> Counts(World w, Guid tenantId, Guid participantId)
    {
        await using var db = PostgresFixture.NewContext(w.Cs);
        return await PurgePlan.CountAsync(db, tenantId, participantId, CancellationToken.None);
    }

    [SkippableFact]
    public async Task A_person_shared_with_another_participant_stays_and_one_only_X_uses_goes()
    {
        var w = await SeedAsync();
        var (shared, only) = (new Person { Id = Guid.NewGuid(), TenantId = w.A, FirstName = "Sam", LastName = "Shared" }, new Person { Id = Guid.NewGuid(), TenantId = w.A, FirstName = "Olive", LastName = "Only" });
        await using (var seed = PostgresFixture.NewContext(w.Cs))
        {
            seed.AddRange(shared, only,
                new ParticipantContactRole { Id = Guid.NewGuid(), TenantId = w.A, ParticipantId = w.XId, PersonId = shared.Id, RoleType = ContactRoleType.Guardian },
                new ParticipantContactRole { Id = Guid.NewGuid(), TenantId = w.A, ParticipantId = w.YId, PersonId = shared.Id, RoleType = ContactRoleType.Guardian },
                new ParticipantContactRole { Id = Guid.NewGuid(), TenantId = w.A, ParticipantId = w.XId, PersonId = only.Id, RoleType = ContactRoleType.Guardian });
            await seed.SaveChangesAsync();
        }

        var outcome = await Purge(w, _clock);

        Assert.Equal(PurgeResult.Purged, outcome.Result);
        var counts = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, int>>(outcome.Record!.RowCounts)!;
        Assert.Equal(1, counts["People"]);
        await using var db = PostgresFixture.NewContext(w.Cs);
        Assert.True(await db.People.AnyAsync(p => p.Id == shared.Id));
        Assert.False(await db.People.AnyAsync(p => p.Id == only.Id));
    }

    [SkippableFact]
    public async Task An_incident_about_X_goes_even_when_its_reporter_belongs_to_no_staff_of_the_organisation()
    {
        var w = await SeedAsync();
        var strayId = Guid.NewGuid();
        await using (var seed = PostgresFixture.NewContext(w.Cs))
        {
            seed.IncidentReports.Add(new IncidentReport
            {
                Id = strayId, TenantId = w.A, ReportedByUserId = w.OfB.Ids[UserIx], InvolvedParticipantId = w.XId, IncidentType = IncidentType.Other, OtherTypeSpecify = "x",
                Severity = IncidentSeverity.Low, Title = "Stray", Description = "About X", IncidentDateTime = new DateTime(2018, 5, 5, 9, 0, 0, DateTimeKind.Utc),
            });
            await seed.SaveChangesAsync();
        }

        await Purge(w, _clock);

        await using var db = PostgresFixture.NewContext(w.Cs);
        Assert.False(await db.IncidentReports.AnyAsync(i => i.Id == strayId));
    }

    [SkippableFact]
    public async Task The_purge_removes_every_row_of_X_and_leaves_Y_and_the_other_organisation_untouched()
    {
        var w = await SeedAsync();
        var seeded = (await Counts(w, w.A, w.XId)).Where(c => c.Value > 0).ToDictionary(c => c.Key, c => c.Value);
        var (yBefore, bBefore) = (await Counts(w, w.A, w.YId), await Counts(w, w.B, w.OfB.Ids[ParticipantIx]));
        await using var probe = PostgresFixture.NewContext(w.Cs);
        var auditBefore = await probe.AuditLogs.CountAsync();
        Assert.True(seeded.Count > 20, "the seed should reach most of the purge tables");

        var outcome = await Purge(w, _clock);

        Assert.Equal(PurgeResult.Purged, outcome.Result);
        // Everything of X is gone, counted through the same queries the due list uses.
        Assert.Empty((await Counts(w, w.A, w.XId)).Where(c => c.Value > 0));
        Assert.Equal(yBefore, await Counts(w, w.A, w.YId));
        Assert.Equal(bBefore, await Counts(w, w.B, w.OfB.Ids[ParticipantIx]));
        foreach (var table in new[] { "Participants", "Shifts", "ParticipantBookings", "ClaimLineItems", "TripClaims", "Invoices", "IncidentReports" })
            Assert.True(seeded.ContainsKey(table), table + " was not seeded for X");

        // The tombstone counts what was seeded, plus the contact and the audit rows the purge also removed.
        var counts = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, int>>(outcome.Record!.RowCounts)!;
        foreach (var (table, n) in seeded) Assert.Equal(n, counts[table]);
        Assert.Equal(1, counts["Contacts"]); // X's plan manager; the contact shared with Y stays
        Assert.True(counts["AuditLogs"] >= 2);

        // Neighbour rows survive: Y, Y's booking and line, the shared contact and link, the group claim.
        await using var db = PostgresFixture.NewContext(w.Cs);
        Assert.True(await db.Participants.AnyAsync(p => p.Id == w.OfB.Ids[ParticipantIx]) && await db.Shifts.AnyAsync(sh => sh.Id == w.OfB.Ids[ShiftIx]));
        Assert.True(await db.Participants.AnyAsync(p => p.Id == w.YId));
        Assert.True(await db.ClaimLineItems.AnyAsync(l => l.Id == w.YLineId));
        Assert.True(await db.ParticipantContacts.AnyAsync(c => c.ParticipantId == w.YId && c.ContactId == w.X.Ids[LinkedIx]));
        Assert.True(await db.Contacts.AnyAsync(c => c.Id == w.X.Ids[LinkedIx]));
        Assert.False(await db.Contacts.AnyAsync(c => c.Id == w.X.Ids[PlanManagerIx]));
        Assert.True(await db.TripClaims.AnyAsync(c => c.Id == w.X.Ids[GroupClaimIx]));
        Assert.True(await db.TripInstances.AnyAsync(t => t.Id == w.X.Ids[TripIx]));

        // F6: the incident that stays lost its link to X's booking.
        var kept = await db.IncidentReports.SingleAsync(i => i.Id == w.KeptIncidentId);
        Assert.Null(kept.ParticipantBookingId);
        Assert.False(await db.IncidentReports.AnyAsync(i => i.Id == w.X.Ids[IncidentIx]));

        // O2: the batch file is blanked, the row stays, and the count is recorded.
        Assert.Empty((await db.ClaimBatches.SingleAsync(b => b.Id == w.BatchId)).Content);
        Assert.Equal(1, outcome.Record.ClaimBatchFilesCleared);

        // F1: the outbox row and its log are both gone.
        Assert.False(await db.NotificationOutbox.AnyAsync(o => o.Id == w.OutboxId));
        Assert.False(await db.NotificationLogs.AnyAsync(l => l.OutboxId == w.OutboxId));

        // No audit row was added, none names X, and Y's stays.
        Assert.True(await db.AuditLogs.CountAsync() < auditBefore);
        Assert.False(await db.AuditLogs.AnyAsync(a => a.EntityId == w.XId || a.EntityId == w.X.Ids[ShiftIx] || a.Changes.Contains(XLastName) || a.Changes.Contains(XNdis)));
        Assert.True(await db.AuditLogs.AnyAsync(a => a.EntityId == w.YId));

        // The intake snapshot and its PDF went with the participant.
        Assert.False(await db.ParticipantIntakeSnapshots.AnyAsync(s => s.ParticipantId == w.XId));

        // The tombstone holds no personal detail.
        var tomb = await db.PurgeRecords.IgnoreQueryFilters().SingleAsync();
        var json = System.Text.Json.JsonSerializer.Serialize(tomb);
        foreach (var secret in new[] { XLastName, XNdis, "Ben", "Slipped", "Went well" }) Assert.DoesNotContain(secret, json);
        Assert.Equal((w.XId, "Ada Admin", false), (tomb.EntityId, tomb.ConfirmedByName, tomb.RetentionStartEstimated));
        Assert.True(tomb.RetentionStartsOn >= Old); // the effective start: the stored date, or the later seeded activity that pushed it out
        Assert.Equal(tomb.RetentionStartsOn.AddYears(7), tomb.DueOn);
    }

    [SkippableFact]
    public async Task A_failure_inside_the_purge_rolls_back_everything_and_leaves_no_record()
    {
        var w = await SeedAsync(corruptCrossTenantShift: true); // another organisation's shift points at X, which the tenant-scoped steps will not delete
        var before = await Counts(w, w.A, w.XId);

        var outcome = await Purge(w, _clock);

        Assert.Equal(PurgeResult.Failed, outcome.Result);
        Assert.Equal(before, await Counts(w, w.A, w.XId));
        await using var db = PostgresFixture.NewContext(w.Cs);
        Assert.Empty(await db.PurgeRecords.IgnoreQueryFilters().ToListAsync());
        Assert.NotEmpty((await db.ClaimBatches.SingleAsync(b => b.Id == w.BatchId)).Content);
        Assert.NotNull((await db.IncidentReports.SingleAsync(i => i.Id == w.KeptIncidentId)).ParticipantBookingId);
    }

    [SkippableFact]
    public async Task A_second_purge_returns_the_same_record_and_changes_nothing()
    {
        var w = await SeedAsync();
        var first = await Purge(w, _clock);
        var yBefore = await Counts(w, w.A, w.YId);

        var second = await Purge(w, _clock);

        Assert.Equal(PurgeResult.AlreadyPurged, second.Result);
        Assert.Equal(first.Record!.Id, second.Record!.Id);
        Assert.Equal(yBefore, await Counts(w, w.A, w.YId));
        await using var db = PostgresFixture.NewContext(w.Cs);
        Assert.Single(await db.PurgeRecords.IgnoreQueryFilters().ToListAsync());
    }

    [SkippableFact]
    public async Task Two_purges_at_the_same_moment_give_one_record()
    {
        var w = await SeedAsync();

        var both = await Task.WhenAll(Purge(w, _clock), Purge(w, _clock));

        Assert.All(both, o => Assert.True(o.Result is PurgeResult.Purged or PurgeResult.AlreadyPurged, o.Result.ToString()));
        Assert.Single(both.Select(o => o.Record!.Id).Distinct());
        await using var db = PostgresFixture.NewContext(w.Cs);
        Assert.Single(await db.PurgeRecords.IgnoreQueryFilters().ToListAsync());
    }

    [SkippableFact]
    public async Task A_participant_that_is_not_due_when_the_lock_is_taken_is_not_purged()
    {
        var w = await SeedAsync();
        await using (var admin = PostgresFixture.NewContext(w.Cs))
            await admin.Participants.Where(p => p.Id == w.XId).ExecuteUpdateAsync(u => u.SetProperty(p => p.IsActive, true).SetProperty(p => p.RetentionStartsOn, (DateOnly?)null)); // restored just before

        var outcome = await Purge(w, _clock);

        Assert.Equal(PurgeResult.NotDue, outcome.Result);
        await using var db = PostgresFixture.NewContext(w.Cs);
        Assert.True(await db.Participants.AnyAsync(p => p.Id == w.XId));
    }
}
