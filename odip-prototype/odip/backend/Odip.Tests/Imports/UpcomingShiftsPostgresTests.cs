using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Odip.Tests.Rostering;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

/// <summary>The Upcoming shifts import's commit, locks and partial undo against a real PostgreSQL: foreign keys, row locks and the roster board lock do not exist on EF InMemory.</summary>
public class UpcomingShiftsPostgresTests : IClassFixture<PostgresFixture>
{
    private const string Header = "NDIS number,Weekday,Start time,End time,Staff email";
    private readonly PostgresFixture _pg;
    public UpcomingShiftsPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private sealed record Org(OdipDbContext Db, Guid TenantId, Guid StaffId, string StaffEmail, string Ndis, Guid ParticipantId, DateOnly Today);

    private async Task<Org> SeedOrg()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = "NSW" });
        var ndis = "43" + Random.Shared.Next(1_000_000, 9_999_999);
        var participant = db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Mia", LastName = "Test", NdisNumber = ndis, IsActive = true }).Entity;
        var email = $"{Guid.NewGuid():N}@example.com";
        var staff = db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Ng", Username = Guid.NewGuid().ToString(), Email = email, Role = UserRole.SupportWorker,
            Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2035, 1, 1),
        }).Entity;
        await db.SaveChangesAsync();
        return new Org(db, tenantId, staff.Id, email, ndis, participant.Id, await ProviderTimeZoneResolver.TodayAsync(db, TimeProvider.System, CancellationToken.None));
    }

    // A real user as the caller, because the week's StartedByUserId and the batch's CreatedById are foreign keys to Users.
    private static ClaimsPrincipal Caller(Org o) => new(new ClaimsIdentity(
        [new Claim(ClaimTypes.Role, "Admin"), new Claim(ClaimTypes.NameIdentifier, o.StaffId.ToString()), new Claim("fullName", "Sam Ng")], "Test"));

    private static Task<ImportResultDto> CommitAsync(Org o, string weekday, int weeks, string key, bool withStaff = false) =>
        Service(o.Db, o.TenantId).CommitAsync(ImportKind.UpcomingShifts,
            Csv(Header, $"{o.Ndis},{weekday},9:00 am,3:00 pm,{(withStaff ? o.StaffEmail : "")}"), "shifts.csv", null, null, key, Caller(o), CancellationToken.None,
            new ImportShiftOptions(ImportShiftShape.Pattern, o.Today, weeks));

    private static async Task<(Guid BatchId, List<Shift> Shifts)> ImportFourAsync(Org o)
    {
        var result = await CommitAsync(o, o.Today.DayOfWeek.ToString(), 4, "undo");
        return (result.BatchId, await o.Db.Shifts.OrderBy(s => s.ServiceDate).ToListAsync());
    }

    [SkippableTheory]
    [InlineData("completion")]
    [InlineData("handover")]
    [InlineData("claim")]
    [InlineData("task")]
    [InlineData("incident")]
    public async Task Undo_ShiftWithAReferrer_IsKept_AndNothingThrows(string referrer)
    {
        RequirePostgres();
        var o = await SeedOrg();
        await using var _ = o.Db;
        var (batchId, shifts) = await ImportFourAsync(o);
        var kept = shifts[0];
        var at = DateTime.UtcNow;
        switch (referrer)
        {
            case "completion":
                o.Db.ShiftCompletions.Add(new ShiftCompletion { Id = Guid.NewGuid(), TenantId = o.TenantId, ShiftId = kept.Id, ActualStart = at, TimeZoneId = "Australia/Sydney", SubmittedByUserId = o.StaffId, StartedAt = at, IsActive = true });
                break;
            case "handover":
                var previous = o.Db.Shifts.Add(new Shift
                {
                    Id = Guid.NewGuid(), TenantId = o.TenantId, ParticipantId = o.ParticipantId, ServiceDate = o.Today.AddDays(-30), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
                    Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
                }).Entity;
                var source = o.Db.ShiftCompletions.Add(new ShiftCompletion { Id = Guid.NewGuid(), TenantId = o.TenantId, ShiftId = previous.Id, ActualStart = at, TimeZoneId = "Australia/Sydney", SubmittedByUserId = o.StaffId, StartedAt = at, IsActive = true, HandoverText = "Quiet." }).Entity;
                await o.Db.SaveChangesAsync();
                o.Db.HandoverAcknowledgements.Add(new HandoverAcknowledgement { Id = Guid.NewGuid(), TenantId = o.TenantId, SourceCompletionId = source.Id, ShiftId = kept.Id, UserId = o.StaffId, AcknowledgedAt = at });
                break;
            case "claim":
                var claim = o.Db.TripClaims.Add(new TripClaim { Id = Guid.NewGuid(), TenantId = o.TenantId, Kind = ClaimKind.Shift, ParticipantId = o.ParticipantId, PeriodFrom = o.Today, PeriodTo = o.Today, Status = TripClaimStatus.Draft, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 100m }).Entity;
                o.Db.ClaimLineItems.Add(new ClaimLineItem
                {
                    TenantId = claim.TenantId,
                    Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = kept.Id, SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday, SupportsDeliveredFrom = o.Today, SupportsDeliveredTo = o.Today,
                    Hours = 1m, UnitPrice = 100m, TotalAmount = 100m, GSTCode = GSTCode.P2,
                });
                break;
            case "task":
                o.Db.BookingTasks.Add(new BookingTask { Id = Guid.NewGuid(), TenantId = o.TenantId, ShiftId = kept.Id, TaskType = TaskType.Other, Title = "Follow up" });
                break;
            default:
                o.Db.IncidentReports.Add(new IncidentReport
                {
                    Id = Guid.NewGuid(), TenantId = o.TenantId, ReportedByUserId = o.StaffId, ShiftId = kept.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.High,
                    Status = IncidentStatus.Submitted, Title = "Incident", Description = "What happened.", IncidentDateTime = at, IsActive = true,
                });
                break;
        }
        await o.Db.SaveChangesAsync();

        var outcome = await Service(o.Db, o.TenantId).UndoAsync(batchId, Caller(o), CancellationToken.None);

        Assert.Equal(1, outcome.Batch!.KeptCount);
        Assert.NotNull(outcome.Batch.UndoneAt);
        var batchIds = shifts.Select(s => s.Id).ToList();
        Assert.Equal([kept.Id], await o.Db.Shifts.Where(s => batchIds.Contains(s.Id)).Select(s => s.Id).ToListAsync());
    }

    [SkippableFact]
    public async Task Undo_OtherOrgsBatch_NotFound()
    {
        RequirePostgres();
        var a = await SeedOrg();
        var b = await SeedOrg();
        await using var _a = a.Db;
        await using var _b = b.Db;
        var (batchId, _) = await ImportFourAsync(b);

        var outcome = await Service(a.Db, a.TenantId).UndoAsync(batchId, Caller(a), CancellationToken.None);

        Assert.True(outcome.NotFound);
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString, Tenant(b.TenantId));
        Assert.Equal(4, await check.Shifts.CountAsync());
        Assert.Null((await check.ImportBatches.SingleAsync()).UndoneAt);
    }

    [SkippableFact]
    public async Task Commit_BoardLockHeld_409_NothingWritten()
    {
        RequirePostgres();
        var o = await SeedOrg();
        await using var _ = o.Db;
        await using var holder = PostgresFixture.NewContext(_pg.ConnectionString, Tenant(o.TenantId));
        await using var held = await RosterGenerationLock.AcquireAsync(holder, o.TenantId, CancellationToken.None, scope: "roster-board");

        var ex = await Assert.ThrowsAsync<ImportException>(() => CommitAsync(o, o.Today.DayOfWeek.ToString(), 2, "busy"));

        Assert.Equal((RosterGenerationLock.RosterBoardBusyMessage, 409), (ex.Message, ex.StatusCode));
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString, Tenant(o.TenantId));
        Assert.Equal((0, 0, 0), (await check.Shifts.CountAsync(), await check.ImportBatches.CountAsync(), await check.RosterWeeks.CountAsync()));
    }

    [SkippableFact]
    public async Task Commit_OrgWithAgreementPattern_GetsAgreementShiftsToo()
    {
        RequirePostgres();
        var o = await SeedOrg();
        await using var _ = o.Db;
        var bo = o.Db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = o.TenantId, FirstName = "Bo", LastName = "Test", IsActive = true }).Entity;
        var revision = o.Db.ServiceAgreementDrafts.Add(ApprovalTestSupport.BuildRevision(o.TenantId, bo.Id, 1, [ApprovalTestSupport.WeekdayBlock()])).Entity;
        var blocks = 0;
        ShiftPattern Pattern(DayOfWeek day, int from, int to, bool overnight = false) => o.Db.ShiftPatterns.Add(new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = o.TenantId, ParticipantId = bo.Id, DayOfWeek = day, StartTime = new TimeOnly(from, 0), EndTime = new TimeOnly(to, 0), EndsNextDay = overnight,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true, DefaultUserId = o.StaffId,
            SourceDraftId = revision.Id, SourceBlockKey = $"b{++blocks}", WorkerSlot = 1,   // one block each: the unique index is block, day and slot
        }).Entity;
        Pattern(DayOfWeek.Monday, 9, 13);               // overlaps the imported Monday 9 to 3 for the same worker
        Pattern(DayOfWeek.Sunday, 22, 6, overnight: true);
        Pattern(DayOfWeek.Monday, 5, 8);                // clashes only with the previous Sunday night, made when the week before was started
        await o.Db.SaveChangesAsync();

        await CommitAsync(o, "Monday", 3, "agreement", withStaff: true);

        var imported = await o.Db.Shifts.Where(s => s.ParticipantId == o.ParticipantId).OrderBy(s => s.ServiceDate).ToListAsync();
        Assert.Equal(3, imported.Count);
        Assert.All(imported, s => Assert.Equal(o.StaffId, s.UserId));
        var agreement = await o.Db.Shifts.Where(s => s.ParticipantId == bo.Id).ToListAsync();
        Assert.NotEmpty(agreement);
        var overlapping = agreement.Where(s => s.StartTime == new TimeOnly(9, 0)).ToList();
        Assert.Equal(3, overlapping.Count);
        Assert.All(overlapping, s => Assert.Equal((null, o.StaffId, "booked on another shift"), (s.UserId, s.RegularUserId, s.RegularAwayReason)));
        // Week 2's early Monday clashes with week 1's Sunday night, which is only seen because week 1 was saved before week 2 was started.
        var early = Assert.Single(agreement, s => s.StartTime == new TimeOnly(5, 0) && s.ServiceDate == imported[1].ServiceDate);
        Assert.Equal((null, o.StaffId, "booked on another shift"), (early.UserId, early.RegularUserId, early.RegularAwayReason));
    }

    [SkippableFact]
    public async Task Commit_StartedWeekAlready_IsNoOp_Postgres()
    {
        RequirePostgres();
        var o = await SeedOrg();
        await using var _ = o.Db;
        var day = o.Today.DayOfWeek.ToString();
        await CommitAsync(o, day, 1, "first");
        Assert.Equal(1, await o.Db.RosterWeeks.CountAsync());

        // Later in the same day, over two weeks: this week is already started, so only next week gets a row.
        await Service(o.Db, o.TenantId).CommitAsync(ImportKind.UpcomingShifts, Csv(Header, $"{o.Ndis},{day},4:00 pm,6:00 pm,"), "shifts.csv", null, null, "second", Caller(o),
            CancellationToken.None, new ImportShiftOptions(ImportShiftShape.Pattern, o.Today, 2));

        Assert.Equal((2, 3), (await o.Db.RosterWeeks.CountAsync(), await o.Db.Shifts.CountAsync()));
    }

    [SkippableFact]
    public async Task Undo_LeavesAgreementShiftsFromStart()
    {
        RequirePostgres();
        var o = await SeedOrg();
        await using var _ = o.Db;
        var bo = o.Db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = o.TenantId, FirstName = "Bo", LastName = "Test", IsActive = true }).Entity;
        var revision = o.Db.ServiceAgreementDrafts.Add(ApprovalTestSupport.BuildRevision(o.TenantId, bo.Id, 1, [ApprovalTestSupport.WeekdayBlock()])).Entity;
        o.Db.ShiftPatterns.Add(new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = o.TenantId, ParticipantId = bo.Id, DayOfWeek = DayOfWeek.Wednesday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true, DefaultUserId = o.StaffId,
            SourceDraftId = revision.Id, SourceBlockKey = "b1", WorkerSlot = 1,
        });
        await o.Db.SaveChangesAsync();
        var result = await CommitAsync(o, o.Today.DayOfWeek.ToString(), 3, "agreement-undo");
        var agreement = await o.Db.Shifts.Where(s => s.ParticipantId == bo.Id).Select(s => s.Id).ToListAsync();
        Assert.NotEmpty(agreement);
        var weeks = await o.Db.RosterWeeks.CountAsync();

        var outcome = await Service(o.Db, o.TenantId).UndoAsync(result.BatchId, Caller(o), CancellationToken.None);

        Assert.Equal(0, outcome.Batch!.KeptCount);
        Assert.Equal(0, await o.Db.Shifts.CountAsync(s => s.ParticipantId == o.ParticipantId));
        Assert.Equal(agreement.Order(), (await o.Db.Shifts.Where(s => s.ParticipantId == bo.Id).Select(s => s.Id).ToListAsync()).Order());
        Assert.Equal(weeks, await o.Db.RosterWeeks.CountAsync());
    }

    [SkippableFact]
    public async Task CrossTenant_SameEmailAndNameInOtherOrg_NotMatched_Postgres()
    {
        RequirePostgres();
        var a = await SeedOrg();
        var b = await SeedOrg();
        await using var _a = a.Db;
        await using var _b = b.Db;
        var zedEmail = $"zed.{Guid.NewGuid():N}@example.com";
        b.Db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = b.TenantId, FirstName = "Zed", LastName = "Quill", Username = Guid.NewGuid().ToString(), Email = zedEmail, Role = UserRole.SupportWorker,
            Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-2", WorkerScreeningExpiryDate = new DateOnly(2035, 1, 1),
        });
        b.Db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = b.TenantId, FirstName = "Zoe", LastName = "Vance", DateOfBirth = new DateOnly(1991, 1, 1), IsActive = true });
        var bShift = b.Db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = b.TenantId, ParticipantId = b.ParticipantId, ServiceDate = b.Today, StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(9, 0), Status = ShiftStatus.Draft }).Entity;
        await b.Db.SaveChangesAsync();

        // Org A's import over a context with no tenant filter at all, so only the service's own tenant predicates keep org B's people out.
        var everything = new Mock<ICurrentTenant>();
        everything.Setup(t => t.IsSuperAdmin).Returns(true);
        await using var wide = PostgresFixture.NewContext(_pg.ConnectionString, everything.Object);
        var service = Service(wide, a.TenantId);
        var day = a.Today.DayOfWeek;
        var file = Csv("NDIS number,Participant name,Date of birth,Weekday,Start time,End time,Staff email,Staff name",
            $"{a.Ndis},,,{day},9:00 am,10:00 am,{zedEmail},", $"{a.Ndis},,,{day},11:00 am,12:00 pm,,Zed Quill", $"{b.Ndis},,,{day},1:00 pm,2:00 pm,,", $",Zoe Vance,1991-01-01,{day},3:00 pm,4:00 pm,,");
        var options = new ImportShiftOptions(ImportShiftShape.Pattern, a.Today, 1);

        var preview = await service.PreviewAsync(ImportKind.UpcomingShifts, file, "shifts.csv", null, CancellationToken.None, Caller(a), options);

        Assert.Equal([ImportRowStatus.Ready, ImportRowStatus.Ready, ImportRowStatus.Invalid, ImportRowStatus.Invalid], preview.Rows.Select(r => r.Status));
        Assert.All(preview.Rows.Take(2), r => Assert.Contains(r.Warnings, w => w.StartsWith("No staff member") && w.EndsWith("so the shift imports unfilled.")));
        Assert.StartsWith("No participant with NDIS number", preview.Rows[2].Reasons.Single());
        Assert.StartsWith("No participant named Zoe Vance", preview.Rows[3].Reasons.Single());

        await service.CommitAsync(ImportKind.UpcomingShifts, file, "shifts.csv", null, null, "cross-tenant", Caller(a), CancellationToken.None, options);

        var made = await wide.Shifts.Where(s => s.TenantId == a.TenantId).ToListAsync();
        Assert.Equal(2, made.Count);
        Assert.All(made, s => Assert.Equal((a.ParticipantId, (Guid?)null), (s.ParticipantId, s.UserId)));
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString, Tenant(b.TenantId));
        // Org B keeps exactly the one shift it had, untouched, and no roster week appears.
        var bShifts = await check.Shifts.ToListAsync();
        var kept = Assert.Single(bShifts);
        Assert.Equal((bShift.Id, bShift.StartTime, bShift.EndTime, bShift.Status), (kept.Id, kept.StartTime, kept.EndTime, kept.Status));
        Assert.Equal(0, await check.RosterWeeks.CountAsync());
    }
}
