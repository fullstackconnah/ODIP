using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// T1 (idempotency) and T12 (the owner's edits survive), on EF InMemory with the production pack list. The Postgres-backed twins of T1 are in
/// DemoDataPostgresTests (InMemory cannot see unique indexes, so only Postgres proves a re-run cannot collide with itself).
/// </summary>
public class DemoIdempotencyAndOwnerEditsTests
{
    private static readonly DateTimeOffset Friday = new(2026, 10, 2, 0, 30, 0, TimeSpan.Zero);   // Fri 10:30 AEST

    private static async Task<DemoTestEnv> NewEnvAsync(DateTimeOffset? at = null)
    {
        var env = new DemoTestEnv(at ?? Friday);
        await DemoFixture.SeedPeopleAsync(env);
        return env;
    }

    private static async Task<DemoTickResult> TickAsync(DemoTestEnv env)
    {
        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.Empty(result.Failures);
        return result;
    }

    private static async Task<DemoSnapshot> SnapshotAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        return DemoSnapshot.Take(db);
    }

    // ── T1 ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task T1_TheFirstTickBuildsTheDemo_AndASecondTickOnTheSameClockChangesNothing()
    {
        var env = await NewEnvAsync();

        var first = await TickAsync(env);
        var after1 = await SnapshotAsync(env);
        var second = await TickAsync(env);
        var after2 = await SnapshotAsync(env);

        Assert.True(first.RowsAdded.Values.Sum() > 150, $"the first tick added only {first.RowsAdded.Values.Sum()} rows");
        Assert.Equal(0, second.RowsAdded.Values.Sum());
        Assert.Equal(0, second.RowsChanged.Values.Sum());
        var changes = after1.Diff(after2);
        Assert.True(changes.Count == 0, "a second tick changed: " + DemoSnapshot.Describe(changes));
        Assert.Equal(after1.Count, after2.Count);
        Assert.True(after1.CountOf("AuditLog") > 0, "the audit interceptor ran on the first tick");
    }

    [Fact]
    public async Task T1_AThirdAndFourthTick_AlsoChangeNothing()
    {
        var env = await NewEnvAsync();
        await TickAsync(env);
        var baseline = await SnapshotAsync(env);

        await TickAsync(env);
        await TickAsync(env);

        Assert.Empty(baseline.Diff(await SnapshotAsync(env)));
    }

    [Fact]
    public async Task T1_TwoIndependentDatabases_GetTheSameIds_ForEveryRowThatIsNotServiceGenerated()
    {
        var a = await NewEnvAsync();
        var b = await NewEnvAsync();

        await TickAsync(a);
        await TickAsync(b);

        var sa = await SnapshotAsync(a);
        var sb = await SnapshotAsync(b);
        // Deterministic ids: shifts, patterns, completions, leave, rules, availability, compatibility, people and roles. Not the audit rows (Guid.NewGuid)
        // and not the obligation tasks (ObligationTaskService assigns its own ids, and is idempotent by SourceKey instead).
        foreach (var type in new[] { "Shift", "ShiftPattern", "ShiftCompletion", "LeaveRequest", "RecurringUnavailability", "StaffAvailability", "StaffParticipantCompatibility", "Person", "ParticipantContactRole", "ProviderSettings" })
        {
            var ka = sa.Keys.Where(k => DemoSnapshot.TypeOf(k) == type).OrderBy(k => k, StringComparer.Ordinal).ToList();
            var kb = sb.Keys.Where(k => DemoSnapshot.TypeOf(k) == type).OrderBy(k => k, StringComparer.Ordinal).ToList();
            Assert.True(ka.Count > 0, $"no {type} rows");
            Assert.Equal(ka, kb);
        }
        Assert.Equal(sa.CountOf("BookingTask"), sb.CountOf("BookingTask"));
        Assert.Equal(sa.CountOf("AuditLog"), sb.CountOf("AuditLog"));
    }

    [Fact]
    public async Task T1_TheDefaultPacksRunWithoutSkippingAStory_WhenAllTheDemoPeopleArePresent()
    {
        var env = await NewEnvAsync();

        var result = await TickAsync(env);

        Assert.Empty(result.SkippedStories);
    }

    [Fact]
    public async Task T1_AMissingPerson_SkipsOnlyTheStoriesThatNeedThem_AndTheRestStillRun()
    {
        var env = await NewEnvAsync();
        await using (var db = env.AdminDb())
        {
            // Lachlan left: his two week-pack shifts, his compatibility cell, his leave and his rule cannot be built, and nothing else is affected.
            var lachlan = await db.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("lachlan"));
            lachlan.IsActive = false;
            await db.SaveChangesAsync();
        }

        var result = await TickAsync(env);

        Assert.Contains(result.SkippedStories, s => s.Contains("lachlan", StringComparison.OrdinalIgnoreCase) || s.Contains("wsc-expired") || s.Contains("needs-fa"));
        await using var check = env.AdminDb();
        Assert.False(await check.Shifts.AnyAsync(s => s.UserId == DemoFixture.StaffId("lachlan")));
        Assert.True(await check.Shifts.CountAsync() > 80);
        Assert.True(await check.LeaveRequests.AnyAsync(l => l.UserId == DemoFixture.StaffId("priya")));
    }

    // ── T12 ──────────────────────────────────────────────────────────────────

    private static readonly DateTimeOffset NextWeek = new(2026, 10, 9, 23, 30, 0, TimeSpan.Zero);   // Sat 10 Oct 10:30 AEDT

    [Fact]
    public async Task T12_AnEditedShiftNote_ARescheduledShift_AndAReassignment_AreNeverRevertedByLaterTicks()
    {
        var env = await NewEnvAsync();
        await TickAsync(env);
        Guid noteShift, movedShift, reassigned;
        await using (var db = env.AdminDb())
        {
            var future = await db.Shifts.Where(s => s.ShiftPatternId != null && s.Status == ShiftStatus.Published && s.ServiceDate > new DateOnly(2026, 10, 12))
                .OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime).Take(3).ToListAsync();
            noteShift = future[0].Id;
            future[0].Notes = "Owner: bring the weighted blanket.";
            movedShift = future[1].Id;
            future[1].StartTime = new TimeOnly(11, 15);
            future[1].EndTime = new TimeOnly(15, 45);
            reassigned = future[2].Id;
            future[2].UserId = DemoFixture.StaffId("sarah");
            await db.SaveChangesAsync();
        }

        env.Clock.Set(new DateTimeOffset(2026, 10, 3, 0, 30, 0, TimeSpan.Zero));
        await TickAsync(env);
        env.Clock.Set(new DateTimeOffset(2026, 10, 6, 0, 30, 0, TimeSpan.Zero));
        await TickAsync(env);

        await using var check = env.AdminDb();
        Assert.Equal("Owner: bring the weighted blanket.", (await check.Shifts.SingleAsync(s => s.Id == noteShift)).Notes);
        var moved = await check.Shifts.SingleAsync(s => s.Id == movedShift);
        Assert.Equal((new TimeOnly(11, 15), new TimeOnly(15, 45)), (moved.StartTime, moved.EndTime));
        Assert.Equal(DemoFixture.StaffId("sarah"), (await check.Shifts.SingleAsync(s => s.Id == reassigned)).UserId);
    }

    [Fact]
    public async Task T12_ALeaveDecisionTheOwnerMade_IsNeverReverted_EvenOnceItsStartHasPassed()
    {
        var env = await NewEnvAsync();
        await TickAsync(env);
        var emily = DemoIds.For("leave", "emily-personal", new DateOnly(2026, 10, 5));
        var brendan = DemoIds.For("leave", "brendan-annual", new DateOnly(2026, 10, 5));
        await using (var db = env.AdminDb())
        {
            var approved = await db.LeaveRequests.SingleAsync(l => l.Id == emily);
            approved.Status = LeaveStatus.Approved;
            approved.DecidedByUserId = DemoFixture.StaffId("sarah");
            approved.DecidedAt = new DateTime(2026, 10, 2, 1, 0, 0, DateTimeKind.Utc);
            approved.DecisionNote = "Approved at the desk.";
            var declined = await db.LeaveRequests.SingleAsync(l => l.Id == brendan);
            declined.Status = LeaveStatus.Declined;
            declined.DecidedByUserId = DemoFixture.StaffId("sarah");
            declined.DecidedAt = new DateTime(2026, 10, 2, 1, 5, 0, DateTimeKind.Utc);
            declined.DecisionNote = "Short staffed.";
            await db.SaveChangesAsync();
        }

        env.Clock.Set(NextWeek);                                    // both requests' start dates (Fri 9 Oct) are now in the past
        await TickAsync(env);

        await using var check = env.AdminDb();
        var a = await check.LeaveRequests.SingleAsync(l => l.Id == emily);
        Assert.Equal((LeaveStatus.Approved, "Approved at the desk."), (a.Status, a.DecisionNote));
        var d = await check.LeaveRequests.SingleAsync(l => l.Id == brendan);
        Assert.Equal((LeaveStatus.Declined, "Short staffed."), (d.Status, d.DecisionNote));
    }

    [Fact]
    public async Task T12_AShiftStatusChangedByHand_IsLeftWhereTheOwnerPutIt()
    {
        var env = await NewEnvAsync();
        await TickAsync(env);
        Guid inProgress, cancelled, started;
        await using (var db = env.AdminDb())
        {
            var published = await db.Shifts.Where(s => s.ShiftPatternId != null && s.Status == ShiftStatus.Published).OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime).Take(3).ToListAsync();
            inProgress = published[0].Id;
            published[0].Status = ShiftStatus.InProgress;          // a worker tapped Start
            cancelled = published[1].Id;
            published[1].Status = ShiftStatus.Cancelled;           // the coordinator cancelled it
            started = published[2].Id;
            published[2].Status = ShiftStatus.Draft;               // pulled back to a draft
            await db.SaveChangesAsync();
        }

        env.Clock.Set(new DateTimeOffset(2026, 10, 20, 0, 30, 0, TimeSpan.Zero));       // all three are long over
        await TickAsync(env);

        await using var check = env.AdminDb();
        Assert.Equal(ShiftStatus.InProgress, (await check.Shifts.SingleAsync(s => s.Id == inProgress)).Status);
        Assert.Equal(ShiftStatus.Cancelled, (await check.Shifts.SingleAsync(s => s.Id == cancelled)).Status);
        // A draft whose day has gone is cancelled by the top-up: that is its own rule for drafts, not a revert of anything.
        Assert.Contains((await check.Shifts.SingleAsync(s => s.Id == started)).Status, new[] { ShiftStatus.Draft, ShiftStatus.Cancelled });
        Assert.False(await check.ShiftCompletions.AnyAsync(c => c.ShiftId == inProgress || c.ShiftId == cancelled));
    }

    [Fact]
    public async Task T12_ACompletionTheOfficeReviewedByHand_IsNeverOverwritten()
    {
        var env = await NewEnvAsync();
        await TickAsync(env);
        Guid shiftId;
        await using (var db = env.AdminDb())
        {
            var waiting = await db.Shifts.Where(s => s.Status == ShiftStatus.PendingReview).OrderBy(s => s.ServiceDate).FirstAsync();
            shiftId = waiting.Id;
            var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shiftId);
            completion.ReviewOutcome = ReviewOutcome.Approved;
            completion.ReviewedByUserId = DemoFixture.StaffId("rachel");      // Rachel approved it, not Sarah
            completion.ReviewedAt = new DateTime(2026, 10, 2, 0, 0, 0, DateTimeKind.Utc);
            waiting.Status = ShiftStatus.Completed;
            await db.SaveChangesAsync();
        }

        env.Clock.Set(new DateTimeOffset(2026, 10, 20, 0, 30, 0, TimeSpan.Zero));
        await TickAsync(env);

        await using var check = env.AdminDb();
        var done = await check.ShiftCompletions.SingleAsync(c => c.ShiftId == shiftId);
        Assert.Equal(DemoFixture.StaffId("rachel"), done.ReviewedByUserId);
        Assert.Equal(new DateTime(2026, 10, 2, 0, 0, 0, DateTimeKind.Utc), done.ReviewedAt);
    }

    [Fact]
    public async Task T12_ADeletedDemoShift_ComesBackOnTheNextTick_WhichTheRunbookSays()
    {
        var env = await NewEnvAsync();
        await TickAsync(env);
        Guid doomed;
        await using (var db = env.AdminDb())
        {
            var shift = await db.Shifts.Where(s => s.ShiftPatternId != null && s.Status == ShiftStatus.Published && s.ServiceDate > new DateOnly(2026, 10, 12)).FirstAsync();
            doomed = shift.Id;
            db.Shifts.Remove(shift);
            await db.SaveChangesAsync();
        }

        await TickAsync(env);

        await using var check = env.AdminDb();
        Assert.True(await check.Shifts.AnyAsync(s => s.Id == doomed));
    }

    [Fact]
    public async Task T12_AnOwnersEditToACredentialDateOrAParticipantsEmergencyContact_IsNeverRevertedEither()
    {
        var env = await NewEnvAsync();
        await TickAsync(env);
        var ownersDate = new DateOnly(2030, 5, 6);
        Guid contactRole;
        await using (var db = env.AdminDb())
        {
            var james = await db.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("james"));
            james.FirstAidExpiryDate = ownersDate;
            var role = await db.ParticipantContactRoles.Include(r => r.Person).FirstAsync(r => r.RoleType == ContactRoleType.EmergencyContact);
            contactRole = role.Id;
            role.Person!.Mobile = "0412 345 999";
            await db.SaveChangesAsync();
        }

        env.Clock.Set(new DateTimeOffset(2026, 11, 20, 0, 30, 0, TimeSpan.Zero));
        await TickAsync(env);

        await using var check = env.AdminDb();
        Assert.Equal(ownersDate, (await check.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("james"))).FirstAidExpiryDate);
        Assert.Equal("0412 345 999", (await check.ParticipantContactRoles.Include(r => r.Person).SingleAsync(r => r.Id == contactRole)).Person!.Mobile);
    }
}
