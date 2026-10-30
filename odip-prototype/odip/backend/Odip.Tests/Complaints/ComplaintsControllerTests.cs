using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Complaints;

/// <summary>Controller-level coverage of the complaints register (EF InMemory + Moq&lt;ICurrentTenant&gt;, as the other register controllers).</summary>
public class ComplaintsControllerTests
{
    // 2026-10-31 13:00 in Sydney, so "today" is 2026-10-31 in every Australian zone.
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => new(2026, 10, 31, 2, 0, 0, TimeSpan.Zero); }
    private static readonly DateOnly Today = new(2026, 10, 31);

    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();

    private static ComplaintsController Controller(OdipDbContext db, Guid? tenant, bool superAdmin = false)
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns(tenant);
        current.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return new ComplaintsController(db, current.Object, new Clock());
    }

    private static Participant AddParticipant(OdipDbContext db, Guid tenant, string first = "Sophie", string last = "Brown")
    {
        var p = new Participant { Id = Guid.NewGuid(), TenantId = tenant, FirstName = first, LastName = last, IsActive = true };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static User AddUser(OdipDbContext db, Guid tenant, bool active = true)
    {
        var u = new User { Id = Guid.NewGuid(), TenantId = tenant, FirstName = "Sam", LastName = "Carer", Email = $"{Guid.NewGuid():N}@x.test", IsActive = active };
        db.Users.Add(u);
        db.SaveChanges();
        return u;
    }

    private static IncidentReport AddIncident(OdipDbContext db, Guid? tenant)
    {
        var i = new IncidentReport { Id = Guid.NewGuid(), TenantId = tenant, Title = "Fall in the kitchen", IncidentDateTime = DateTime.UtcNow };
        db.IncidentReports.Add(i);
        db.SaveChanges();
        return i;
    }

    private static SaveComplaintDto Save(Action<Dictionary<string, object?>>? tweak = null)
    {
        var v = new Dictionary<string, object?>
        {
            ["ReceivedOn"] = Today.AddDays(-3), ["Channel"] = ComplaintChannel.Phone, ["ComplainantKind"] = ComplainantKind.Other,
            ["ComplainantName"] = "Pat Neighbour", ["Summary"] = "The support worker arrived late three times.", ["Status"] = ComplaintStatus.Open,
        };
        tweak?.Invoke(v);
        return new SaveComplaintDto
        {
            ReceivedOn = (DateOnly)v["ReceivedOn"]!, Channel = (ComplaintChannel)v["Channel"]!, ComplainantKind = (ComplainantKind)v["ComplainantKind"]!,
            ParticipantId = (Guid?)v.GetValueOrDefault("ParticipantId"), ComplainantName = (string?)v["ComplainantName"], Summary = (string?)v["Summary"],
            Status = (ComplaintStatus)v["Status"]!, AcknowledgedOn = (DateOnly?)v.GetValueOrDefault("AcknowledgedOn"),
            ActionsTaken = (string?)v.GetValueOrDefault("ActionsTaken"), Outcome = (string?)v.GetValueOrDefault("Outcome"),
            OutcomeCommunicatedOn = (DateOnly?)v.GetValueOrDefault("OutcomeCommunicatedOn"),
            ToldAboutCommission = (bool?)v.GetValueOrDefault("ToldAboutCommission") ?? false,
            ToldAboutCommissionOn = (DateOnly?)v.GetValueOrDefault("ToldAboutCommissionOn"), ClosedOn = (DateOnly?)v.GetValueOrDefault("ClosedOn"),
            HandledByUserId = (Guid?)v.GetValueOrDefault("HandledByUserId"), IncidentReportId = (Guid?)v.GetValueOrDefault("IncidentReportId"),
            ExpectedUpdatedAt = (DateTime?)v.GetValueOrDefault("ExpectedUpdatedAt"),
        };
    }

    private static Complaint Row(Guid tenant, ComplaintStatus status = ComplaintStatus.Open, int receivedDaysAgo = 1, DateOnly? closedOn = null,
        string summary = "Late arrivals", string? name = "Pat", Guid? participantId = null, bool active = true) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenant, ReceivedOn = Today.AddDays(-receivedDaysAgo), Channel = ComplaintChannel.Email,
        ComplainantKind = participantId.HasValue ? ComplainantKind.Participant : ComplainantKind.Other, ComplainantName = name,
        ParticipantId = participantId, Summary = summary, Status = status, ClosedOn = closedOn, IsActive = active,
    };

    private static T Value<T>(ActionResult<ApiResponse<T>> result) => ((ApiResponse<T>)((OkObjectResult)result.Result!).Value!).Data!;
    private static string BadRequestMessage<T>(ActionResult<ApiResponse<T>> result) =>
        ((ApiResponse<T>)Assert.IsType<BadRequestObjectResult>(result.Result).Value!).Errors!.Single();

    // ── Tenant scope ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task List_NeverReturnsAnotherTenantsRow_AndGetAndPutOfItAre404()
    {
        var name = Guid.NewGuid().ToString();
        using var seed = TestDb.Create(name);
        var other = Row(TenantB);
        seed.Complaints.AddRange(Row(TenantA), other);
        seed.SaveChanges();
        using var db = TestDb.ForTenant(name, TenantA);
        var controller = Controller(db, TenantA);

        var list = Value(await controller.List(null, null, null, null, ct: default));
        Assert.Single(list.Items);
        Assert.DoesNotContain(list.Items, i => i.Id == other.Id);
        Assert.IsType<NotFoundObjectResult>((await controller.Get(other.Id, default)).Result);
        Assert.IsType<NotFoundObjectResult>((await controller.Update(other.Id, Save(), default)).Result);
    }

    // ── Create validation ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_Valid_SavesOpen_IgnoresStatus_AndReturnsOpenDays()
    {
        using var db = TestDb.Create();
        var dto = Save(v => { v["Status"] = ComplaintStatus.Resolved; });
        var created = Value(await Controller(db, TenantA).Create(dto, default));
        Assert.Equal(ComplaintStatus.Open, created.Status);
        Assert.Equal(3, created.OpenDays);
        Assert.Null(created.ClosedOn);
        Assert.Equal(TenantA, db.Complaints.Single().TenantId);
    }

    [Fact]
    public async Task Create_WithNoTenantContext_Is400()
    {
        using var db = TestDb.Create();
        Assert.Equal("A tenant context is required.", BadRequestMessage(await Controller(db, null, true).Create(Save(), default)));
    }

    public static IEnumerable<object[]> BadSaves() => new[]
    {
        new object[] { "empty summary", (Action<Dictionary<string, object?>>)(v => v["Summary"] = "  "), "Describe the complaint." },
        new object[] { "long summary", v => v["Summary"] = new string('x', 4001), "Keep it to 4,000 characters." },
        new object[] { "long name", v => v["ComplainantName"] = new string('n', 201), "Keep the name to 200 characters." },
        new object[] { "bad channel", v => v["Channel"] = (ComplaintChannel)99, "Choose an option from the list." },
        new object[] { "bad kind", v => v["ComplainantKind"] = (ComplainantKind)99, "Choose an option from the list." },
        new object[] { "anonymous with a name", v => v["ComplainantKind"] = ComplainantKind.Anonymous, "Anonymous complaints keep no name and no participant." },
        new object[] { "participant kind, no participant", v => { v["ComplainantKind"] = ComplainantKind.Participant; v["ComplainantName"] = null; }, "Choose the participant." },
        new object[] { "received tomorrow", v => v["ReceivedOn"] = Today.AddDays(1), "The date can't be in the future." },
        new object[] { "acknowledged before received", v => v["AcknowledgedOn"] = Today.AddDays(-5), "That date can't be before the complaint was received." },
        new object[] { "outcome told in the future", v => v["OutcomeCommunicatedOn"] = Today.AddDays(1), "The date can't be in the future." },
        new object[] { "commission ticked, no date", v => v["ToldAboutCommission"] = true, "Add the date they were told." },
        new object[] { "closed date on an open complaint", v => v["ClosedOn"] = Today, "Only a closed complaint has a closing date." },
    };

    [Theory]
    [MemberData(nameof(BadSaves))]
    public async Task Create_Invalid_Is400_AndSavesNothing(string _, Action<Dictionary<string, object?>> tweak, string message)
    {
        using var db = TestDb.Create();
        Assert.Equal(message, BadRequestMessage(await Controller(db, TenantA).Create(Save(tweak), default)));
        Assert.Empty(db.Complaints);
    }

    [Fact]
    public async Task Create_AnonymousWithNeitherNameNorParticipant_Saves()
    {
        using var db = TestDb.Create();
        var created = Value(await Controller(db, TenantA).Create(Save(v => { v["ComplainantKind"] = ComplainantKind.Anonymous; v["ComplainantName"] = null; }), default));
        Assert.Null(created.ComplainantName);
        Assert.Null(created.ParticipantId);
    }

    [Fact]
    public async Task Create_UntickedCommission_NullsItsDate()
    {
        using var db = TestDb.Create();
        var created = Value(await Controller(db, TenantA).Create(Save(v => { v["ToldAboutCommission"] = false; v["ToldAboutCommissionOn"] = Today; }), default));
        Assert.Null(created.ToldAboutCommissionOn);
    }

    // ── Cross-tenant links (the filter is bypassed by a SuperAdmin, so the controller checks) ─────

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Create_LinkingAnotherTenantsRecords_Is400(bool asSuperAdminViewingA)
    {
        var name = Guid.NewGuid().ToString();
        using var seed = TestDb.Create(name);
        var foreignParticipant = AddParticipant(seed, TenantB);
        var foreignIncident = AddIncident(seed, TenantB);
        var nullTenantIncident = AddIncident(seed, null);
        var foreignUser = AddUser(seed, TenantB);
        var inactiveUser = AddUser(seed, TenantA, active: false);
        using var db = asSuperAdminViewingA ? TestDb.Create(name, TenantA) : TestDb.ForTenant(name, TenantA);
        var controller = Controller(db, TenantA, asSuperAdminViewingA);

        Assert.Equal("That participant isn't in this organisation.", BadRequestMessage(await controller.Create(
            Save(v => { v["ComplainantKind"] = ComplainantKind.FamilyOrCarer; v["ParticipantId"] = foreignParticipant.Id; }), default)));
        Assert.Equal("That incident isn't in this organisation.", BadRequestMessage(await controller.Create(Save(v => v["IncidentReportId"] = foreignIncident.Id), default)));
        Assert.Equal("That incident isn't in this organisation.", BadRequestMessage(await controller.Create(Save(v => v["IncidentReportId"] = nullTenantIncident.Id), default)));
        Assert.Equal("That staff member isn't in this organisation.", BadRequestMessage(await controller.Create(Save(v => v["HandledByUserId"] = foreignUser.Id), default)));
        Assert.Equal("That staff member isn't in this organisation.", BadRequestMessage(await controller.Create(Save(v => v["HandledByUserId"] = inactiveUser.Id), default)));
        Assert.Empty(db.Complaints);
    }

    [Fact]
    public async Task Create_LinkingOwnRecords_ReturnsTheirNames()
    {
        using var db = TestDb.Create();
        var participant = AddParticipant(db, TenantA);
        var incident = AddIncident(db, TenantA);
        var user = AddUser(db, TenantA);
        var created = Value(await Controller(db, TenantA).Create(Save(v =>
        {
            v["ComplainantKind"] = ComplainantKind.Participant; v["ParticipantId"] = participant.Id;
            v["IncidentReportId"] = incident.Id; v["HandledByUserId"] = user.Id;
        }), default));
        Assert.Equal("Sophie Brown", created.ParticipantName);
        Assert.Equal("Fall in the kitchen", created.IncidentReportTitle);
        Assert.Equal("Sam Carer", created.HandledByName);
    }

    // ── Update, closing, concurrency ──────────────────────────────────────────────────

    [Fact]
    public async Task Update_Closed_RequiresClosedOn_AndOtherStatusesRefuseOne()
    {
        using var db = TestDb.Create();
        var row = Row(TenantA);
        db.Complaints.Add(row);
        db.SaveChanges();
        var controller = Controller(db, TenantA);

        Assert.Equal("Add the date it was closed.", BadRequestMessage(await controller.Update(row.Id, Save(v => v["Status"] = ComplaintStatus.Closed), default)));
        var closed = Value(await controller.Update(row.Id, Save(v => { v["Status"] = ComplaintStatus.Closed; v["ClosedOn"] = Today; }), default));
        Assert.Equal(ComplaintStatus.Closed, closed.Status);
        Assert.Null(closed.OpenDays);
        Assert.Equal(Today, closed.ClosedOn);
    }

    [Fact]
    public async Task Update_StaleExpectedUpdatedAt_Is409_AndWritesNothing()
    {
        using var db = TestDb.Create();
        var row = Row(TenantA);
        db.Complaints.Add(row);
        db.SaveChanges();
        var stale = row.UpdatedAt.AddMinutes(-1);

        var result = await Controller(db, TenantA).Update(row.Id, Save(v => { v["ExpectedUpdatedAt"] = stale; v["Summary"] = "Changed"; }), default);

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal("Late arrivals", db.Complaints.Single().Summary);
    }

    [Fact]
    public async Task Update_CurrentExpectedUpdatedAt_Saves_AndBumpsTheVersion()
    {
        using var db = TestDb.Create();
        var row = Row(TenantA);
        db.Complaints.Add(row);
        db.SaveChanges();
        var before = row.UpdatedAt;

        var saved = Value(await Controller(db, TenantA).Update(row.Id, Save(v => { v["ExpectedUpdatedAt"] = before; v["Summary"] = "Changed"; }), default));

        Assert.Equal("Changed", saved.Summary);
        Assert.True(saved.UpdatedAt > before);
    }

    // ── Archive and restore ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Archive_HidesFromDefaultList_ShowsInArchived_RefusesEdits_AndRestoreBringsItBack()
    {
        using var db = TestDb.Create();
        var row = Row(TenantA);
        db.Complaints.Add(row);
        db.SaveChanges();
        var controller = Controller(db, TenantA);

        Assert.False(Value(await controller.Archive(row.Id, default)).IsActive);
        Assert.Empty(Value(await controller.List(null, null, null, null, ct: default)).Items);
        Assert.Single(Value(await controller.List(null, null, null, false, ct: default)).Items);
        Assert.Equal("This complaint is archived. Restore it to change it.", BadRequestMessage(await controller.Update(row.Id, Save(), default)));

        Assert.True(Value(await controller.Restore(row.Id, default)).IsActive);
        Assert.Single(Value(await controller.List(null, null, null, null, ct: default)).Items);
    }

    [Fact]
    public async Task Archive_AlreadyArchived_IsANoOp()
    {
        using var db = TestDb.Create();
        var row = Row(TenantA, active: false);
        db.Complaints.Add(row);
        db.SaveChanges();
        var before = row.UpdatedAt;
        Assert.False(Value(await Controller(db, TenantA).Archive(row.Id, default)).IsActive);
        Assert.Equal(before, db.Complaints.Single().UpdatedAt);
    }

    // ── List ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task List_FiltersByStatus()
    {
        using var db = TestDb.Create();
        db.Complaints.AddRange(Row(TenantA), Row(TenantA, ComplaintStatus.Investigating), Row(TenantA, ComplaintStatus.Resolved));
        db.SaveChanges();
        var items = Value(await Controller(db, TenantA).List(ComplaintStatus.Investigating, null, null, null, ct: default)).Items;
        Assert.Single(items);
        Assert.Equal(ComplaintStatus.Investigating, items[0].Status);
    }

    [Fact]
    public async Task List_LongOpen_KeepsOnlyOpenRowsOlderThan21Days()
    {
        using var db = TestDb.Create();
        var at21 = Row(TenantA, receivedDaysAgo: 21, summary: "at 21");
        var at22 = Row(TenantA, ComplaintStatus.Investigating, receivedDaysAgo: 22, summary: "at 22");
        var resolved = Row(TenantA, ComplaintStatus.Resolved, receivedDaysAgo: 40, summary: "resolved");
        db.Complaints.AddRange(at21, at22, resolved);
        db.SaveChanges();

        var items = Value(await Controller(db, TenantA).List(null, true, null, null, ct: default)).Items;

        var only = Assert.Single(items);
        Assert.Equal("at 22", only.Summary);
        Assert.Equal(22, only.OpenDays);
    }

    [Fact]
    public async Task List_Search_MatchesSummaryNameAndParticipant_CaseInsensitively_AndAnonymousRowsDontThrow()
    {
        using var db = TestDb.Create();
        var participant = AddParticipant(db, TenantA, "Maximilian", "Okafor");
        db.Complaints.AddRange(
            Row(TenantA, summary: "Broken WHEELCHAIR ramp", name: null),
            Row(TenantA, summary: "x", name: "Priya Raman"),
            Row(TenantA, summary: "y", name: null, participantId: participant.Id),
            Row(TenantA, summary: "anonymous one", name: null));
        db.SaveChanges();
        var controller = Controller(db, TenantA);

        async Task<int> Count(string term) => Value(await controller.List(null, null, term, null, ct: default)).Items.Count;

        Assert.Equal(1, await Count("wheelchair"));
        Assert.Equal(1, await Count("PRIYA"));
        Assert.Equal(1, await Count("okafor"));
        Assert.Equal(1, await Count("anonymous"));
        Assert.Equal(0, await Count("zzz"));
    }

    [Fact]
    public async Task List_Sort_OpenOldestFirst_ThenClosedNewestFirst_ResolvedByReceived_AndPagingTotals()
    {
        using var db = TestDb.Create();
        var openOld = Row(TenantA, receivedDaysAgo: 10, summary: "open-old");
        var investigating = Row(TenantA, ComplaintStatus.Investigating, receivedDaysAgo: 5, summary: "investigating");
        var openNew = Row(TenantA, receivedDaysAgo: 1, summary: "open-new");
        var closedRecent = Row(TenantA, ComplaintStatus.Closed, receivedDaysAgo: 30, closedOn: Today.AddDays(-2), summary: "closed-recent");
        var resolved = Row(TenantA, ComplaintStatus.Resolved, receivedDaysAgo: 4, summary: "resolved-4");
        var closedOld = Row(TenantA, ComplaintStatus.Closed, receivedDaysAgo: 40, closedOn: Today.AddDays(-20), summary: "closed-old");
        db.Complaints.AddRange(closedOld, openNew, resolved, closedRecent, investigating, openOld);
        db.SaveChanges();
        var controller = Controller(db, TenantA);

        var page = Value(await controller.List(null, null, null, null, ct: default));

        Assert.Equal(new[] { "open-old", "investigating", "open-new", "closed-recent", "resolved-4", "closed-old" }, page.Items.Select(i => i.Summary).ToArray());
        Assert.Equal(6, page.TotalCount);
        var second = Value(await controller.List(null, null, null, null, 2, 4, default));
        Assert.Equal(2, second.Items.Count);
        Assert.Equal(6, second.TotalCount);
    }

    [Fact]
    public async Task List_TruncatesSummaryTo200_AndNamesTheParticipant()
    {
        using var db = TestDb.Create();
        var participant = AddParticipant(db, TenantA);
        db.Complaints.Add(Row(TenantA, summary: new string('a', 500), participantId: participant.Id));
        db.SaveChanges();
        var item = Value(await Controller(db, TenantA).List(null, null, null, null, ct: default)).Items.Single();
        Assert.Equal(200, item.Summary.Length);
        Assert.Equal("Sophie Brown", item.ParticipantName);
    }
}
