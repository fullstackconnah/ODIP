using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.DataExport;
using Xunit;

namespace Odip.Tests.Registers;

/// <summary>The five register CSVs (EF InMemory; the provider zone is the default, Australia/Sydney). Postgres translation is RegistersPostgresTests.</summary>
public class RegistersControllerTests
{
    // 2026-10-31 13:00 in Sydney (AEDT), so the provider's today is 2026-10-31.
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => new(2026, 10, 31, 2, 0, 0, TimeSpan.Zero); }
    private static readonly Guid A = Guid.NewGuid();
    private static readonly Guid B = Guid.NewGuid();
    private static readonly DateOnly Aug1 = new(2026, 8, 1);
    private static readonly DateOnly Jul31 = new(2026, 7, 31);

    private static readonly Dictionary<string, string> Headers = new()
    {
        ["incidents"] = "Date and time,Title,Type,Severity,Status,Participant,Staff member involved,Reported by,Location,Description,Immediate actions,Emergency services called,Restrictive practice used,Reportable class,Notify the Commission by,Detailed report due,Commission reporting status,Commission notified,Commission reference,Detailed report sent,Final report sent,Reviewed by,Reviewed,Corrective actions,Resolved,Family notified",
        ["complaints"] = "Received,Channel,Complainant,Complainant name,Participant,Summary,Status,Acknowledged,Actions taken,Outcome,Outcome communicated,Told about the NDIS Commission,Told on,Closed,Handled by,Linked incident",
        ["restrictive-practices"] = "Participant,Practice type,Description,Use,Authorised by,Authorised on,Authorisation ends,First used,Review due,Interim behaviour support plan,Comprehensive behaviour support plan,Reportable to the Commission,Commission reference",
        ["risks"] = "Participant,Kind,Risk,Rating,Description,Mitigation or strategy,Recorded",
        ["staff-credentials"] = "Name,Role,Position,Employment started,Worker screening number,Worker screening expires,First aid,First aid expires,CPR,CPR expires,Manual handling,Manual handling expires,Medication competency,Medication competency expires,Driver,Driver licence expires,Anything expired today",
    };

    private sealed record Host(OdipDbContext Db, RegistersController Controller);

    private static Host Make(Guid? tenant, bool superAdmin = false, string role = "Admin", string? name = null)
    {
        var db = DataExportTestKit.InMemory(Guid.NewGuid().ToString(), DataExportTestKit.Tenant(tenant, superAdmin));
        db.Tenants.AddRange(new Tenant { Id = A, Name = "Alpha Care", EmailDomain = "a.example.com" }, new Tenant { Id = B, Name = "Bravo Care", EmailDomain = "b.example.com" });
        db.SaveChanges();
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, role), new Claim("fullName", name ?? "Jordan Lee") };
        var controller = new RegistersController(db, DataExportTestKit.Tenant(tenant, superAdmin), new Clock())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } },
        };
        return new Host(db, controller);
    }

    private static User AddUser(OdipDbContext db, Guid tenant, string first = "Sam", string last = "Carer", Action<User>? tweak = null)
    {
        var u = new User { Id = Guid.NewGuid(), TenantId = tenant, FirstName = first, LastName = last, Email = $"{Guid.NewGuid():N}@x.test", IsActive = true };
        tweak?.Invoke(u);
        db.Users.Add(u);
        db.SaveChanges();
        return u;
    }

    private static Participant AddParticipant(OdipDbContext db, Guid tenant, string first = "Sophie", string last = "Brown")
    {
        var p = new Participant { Id = Guid.NewGuid(), TenantId = tenant, FirstName = first, LastName = last, IsActive = true };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static IncidentReport AddIncident(OdipDbContext db, Guid tenant, User reporter, DateTime when, string title = "Fall", Guid? tenantColumn = null, Action<IncidentReport>? tweak = null)
    {
        var i = new IncidentReport { Id = Guid.NewGuid(), TenantId = tenantColumn ?? tenant, ReportedByUserId = reporter.Id, Title = title, IncidentDateTime = when, IsActive = true };
        tweak?.Invoke(i);
        db.IncidentReports.Add(i);
        db.SaveChanges();
        return i;
    }

    private static Task<IActionResult> Call(RegistersController c, string register, DateOnly? from = null, DateOnly? to = null, CancellationToken ct = default) => register switch
    {
        "incidents" => c.Incidents(from, to, ct),
        "complaints" => c.Complaints(from, to, ct),
        "restrictive-practices" => c.RestrictivePractices(from, to, ct),
        "risks" => c.Risks(ct),
        _ => c.StaffCredentials(ct),
    };

    private static Task<IActionResult> Dated(RegistersController c, string register) => Call(c, register, new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));

    private static List<string[]> Rows(IActionResult result) => DataExportTestKit.ParseCsv(System.Text.Encoding.UTF8.GetString(File(result).FileContents).TrimStart('﻿'));

    private static FileContentResult File(IActionResult result) => Assert.IsType<FileContentResult>(result);

    private static string[] Row(IActionResult result, int i = 1) => Rows(result)[i];

    private static int Col(string register, string header) => Array.IndexOf(Headers[register].Split(','), header);

    public static TheoryData<string> AllRegisters => new() { "incidents", "complaints", "restrictive-practices", "risks", "staff-credentials" };

    [Theory, MemberData(nameof(AllRegisters))]
    public async Task EachRegister_HasExactlyThePinnedHeaderRow(string register)
    {
        var h = Make(A);
        var result = await Dated(h.Controller, register);
        Assert.Equal(Headers[register], string.Join(',', Rows(result)[0]));
    }

    [Theory, MemberData(nameof(AllRegisters))]
    public async Task TenantA_SeesNothingOfTenantB(string register)
    {
        var h = Make(A);
        foreach (var (tenant, mark) in new[] { (A, "ALPHA"), (B, "BRAVO") })
        {
            var user = AddUser(h.Db, tenant, mark + "-First", "Staff", u => { u.WorkerScreeningNumber = mark + "-WSN"; });
            var p = AddParticipant(h.Db, tenant, mark + "-Pat", "Participant");
            AddIncident(h.Db, tenant, user, new DateTime(2026, 6, 1, 10, 0, 0), mark + "-incident");
            h.Db.Complaints.Add(new Complaint { Id = Guid.NewGuid(), TenantId = tenant, ReceivedOn = new DateOnly(2026, 6, 1), Summary = mark + "-complaint", ParticipantId = p.Id });
            h.Db.RestrictivePractices.Add(new RestrictivePractice { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = p.Id, Description = mark + "-practice" });
            h.Db.ParticipantRiskEntries.Add(new ParticipantRiskEntry { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = p.Id, Description = mark + "-risk" });
            h.Db.ParticipantCommunityAccessRiskItems.Add(new ParticipantCommunityAccessRiskItem { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = p.Id, StrategyNotes = mark + "-strategy" });
            h.Db.SaveChanges();
        }
        var rows = Rows(await Dated(h.Controller, register));
        Assert.True(rows.Count >= 2, "tenant A's own row is in the file");
        Assert.Contains(rows.Skip(1).SelectMany(r => r), c => c.Contains("ALPHA"));
        Assert.DoesNotContain(rows.SelectMany(r => r), c => c.Contains("BRAVO"));
    }

    [Fact]
    public async Task Incidents_ARowNeedsAReporterOfTheOrganisation_AndATenantColumnThatIsNullOrTheOrganisation()
    {
        var h = Make(A);
        var reporterA = AddUser(h.Db, A);
        var reporterB = AddUser(h.Db, B);
        var when = new DateTime(2026, 6, 1, 10, 0, 0);
        AddIncident(h.Db, A, reporterA, when, "own", tenantColumn: A);
        AddIncident(h.Db, A, reporterA, when, "no-tenant-column").TenantId = null;
        var orphan = AddIncident(h.Db, A, reporterB, when, "null-tenant-b-reporter");
        orphan.TenantId = null;
        AddIncident(h.Db, A, reporterA, when, "a-reporter-b-row", tenantColumn: B);
        AddIncident(h.Db, B, reporterB, when, "b-row");
        h.Db.SaveChanges();

        var titles = Rows(await Dated(h.Controller, "incidents")).Skip(1).Select(r => r[1]).Order().ToArray();
        // A null tenant column is hidden by the global filter for a tenant user as well, as in the raw export; the explicit predicate covers a context without it.
        Assert.Equal(new[] { "own" }, titles);
    }

    [Fact]
    public async Task SuperAdminWithNoOrganisation_Gets400WithTheNoOrganisationSentence()
    {
        var h = Make(null, superAdmin: true, role: "SuperAdmin");
        var result = Assert.IsAssignableFrom<ObjectResult>(await Dated(h.Controller, "incidents"));
        Assert.Equal(400, result.StatusCode);
        Assert.Contains(DataExportController.NoOrganisation, Assert.IsType<Odip.Application.Common.ApiResponse<bool>>(result.Value).Errors!);
        Assert.Empty(h.Db.AuditLogs);
    }

    [Fact]
    public async Task SuperAdminViewingA_GetsOnlyA()
    {
        var h = Make(A, role: "SuperAdmin"); // CurrentTenant sets TenantId to the chosen organisation and IsSuperAdmin to false
        AddIncident(h.Db, A, AddUser(h.Db, A), new DateTime(2026, 6, 1), "ALPHA-incident");
        AddIncident(h.Db, B, AddUser(h.Db, B), new DateTime(2026, 6, 1), "BRAVO-incident");
        var rows = Rows(await Dated(h.Controller, "incidents"));
        Assert.Equal(new[] { "ALPHA-incident" }, rows.Skip(1).Select(r => r[1]));
    }

    [Fact]
    public async Task AdminWithNoTenantClaim_Gets403_AndAChosenOrganisationThatDoesNotExist_Gets404_AndNeitherWritesAnAuditRow()
    {
        var none = Make(null);
        Assert.Equal(403, Assert.IsAssignableFrom<ObjectResult>(await Dated(none.Controller, "risks")).StatusCode);
        Assert.Empty(none.Db.AuditLogs);

        var ghost = Make(Guid.NewGuid());
        Assert.Equal(404, Assert.IsAssignableFrom<ObjectResult>(await Dated(ghost.Controller, "risks")).StatusCode);
        Assert.Empty(ghost.Db.AuditLogs);
    }

    [Fact]
    public async Task Incidents_RangeIsProviderLocalDays_AsStoredNoZoneConversion()
    {
        var h = Make(A);
        var user = AddUser(h.Db, A);
        AddIncident(h.Db, A, user, new DateTime(2026, 7, 31, 23, 59, 0), "last-minute");
        AddIncident(h.Db, A, user, new DateTime(2026, 8, 1, 0, 30, 0), "after-midnight");
        var jul = Rows(await Call(h.Controller, "incidents", Jul31, Jul31));
        Assert.Equal("last-minute", Assert.Single(jul.Skip(1))[1]);
        Assert.Equal("31/07/2026 23:59", jul[1][0]);
        var aug = Rows(await Call(h.Controller, "incidents", Aug1, Aug1));
        Assert.Equal("after-midnight", Assert.Single(aug.Skip(1))[1]);
    }

    [Fact]
    public async Task Incidents_LocalTimesAreWrittenAsStored_AndUtcTimesAreShownInTheProviderZone()
    {
        var h = Make(A);
        var user = AddUser(h.Db, A);
        // Sydney in October is AEDT (+11): the UTC due time 2026-10-04 20:00Z reads 05/10/2026 07:00, the local reported time stays 09:30.
        AddIncident(h.Db, A, user, new DateTime(2026, 10, 4, 9, 30, 0), tweak: i =>
        {
            i.NotifyDueAt = new DateTime(2026, 10, 4, 20, 0, 0, DateTimeKind.Utc);
            i.QscReportedAt = new DateTime(2026, 10, 4, 9, 30, 0);
            i.ReviewedAt = new DateTime(2026, 10, 4, 20, 0, 0, DateTimeKind.Utc);
        });
        var row = Row(await Call(h.Controller, "incidents", new DateOnly(2026, 10, 4), new DateOnly(2026, 10, 4)));
        Assert.Equal("05/10/2026 07:00", row[Col("incidents", "Notify the Commission by")]);
        Assert.Equal("04/10/2026 09:30", row[Col("incidents", "Commission notified")]);
        Assert.Equal("05/10/2026 07:00", row[Col("incidents", "Reviewed")]);
    }

    [Fact]
    public async Task Complaints_ReceivedOnBoundsAreInclusive()
    {
        var h = Make(A);
        var from = new DateOnly(2026, 8, 10);
        var to = new DateOnly(2026, 8, 20);
        foreach (var (day, mark) in new[] { (from.AddDays(-1), "before"), (from, "first"), (to, "last"), (to.AddDays(1), "after") })
            h.Db.Complaints.Add(new Complaint { Id = Guid.NewGuid(), TenantId = A, ReceivedOn = day, Summary = mark });
        h.Db.SaveChanges();
        var rows = Rows(await Call(h.Controller, "complaints", from, to));
        Assert.Equal(new[] { "first", "last" }, rows.Skip(1).Select(r => r[Col("complaints", "Summary")]));
    }

    [Fact]
    public async Task RestrictivePractices_InForceDuringTheRange()
    {
        var h = Make(A);
        var p = AddParticipant(h.Db, A);
        var from = new DateOnly(2026, 8, 10);
        var to = new DateOnly(2026, 8, 20);
        void Add(string mark, DateOnly? start, DateOnly? end, bool active = true) =>
            h.Db.RestrictivePractices.Add(new RestrictivePractice { Id = Guid.NewGuid(), TenantId = A, ParticipantId = p.Id, Description = mark, AuthorisationDate = start, AuthorisationEndDate = end, IsActive = active });
        Add("ended-before", new DateOnly(2026, 1, 1), from.AddDays(-1));
        Add("ends-on-from", new DateOnly(2026, 1, 1), from);
        Add("starts-after", to.AddDays(1), null);
        Add("no-start", null, null);
        Add("archived", new DateOnly(2026, 1, 1), null, active: false);
        h.Db.SaveChanges();
        var rows = Rows(await Call(h.Controller, "restrictive-practices", from, to));
        Assert.Equal(new[] { "ends-on-from", "no-start" }, rows.Skip(1).Select(r => r[Col("restrictive-practices", "Description")]).Order());
    }

    [Theory]
    [InlineData("incidents"), InlineData("complaints"), InlineData("restrictive-practices")]
    public async Task DatedRegisters_RefuseAMissingOrBackwardsRange(string register)
    {
        var h = Make(A);
        var noFrom = Assert.IsAssignableFrom<ObjectResult>(await Call(h.Controller, register, null, Aug1));
        var noTo = Assert.IsAssignableFrom<ObjectResult>(await Call(h.Controller, register, Aug1, null));
        var backwards = Assert.IsAssignableFrom<ObjectResult>(await Call(h.Controller, register, Aug1, Jul31));
        Assert.All(new[] { noFrom, noTo, backwards }, r => Assert.Equal(400, r.StatusCode));
        Assert.Contains("Choose a start and an end date.", Assert.IsType<Odip.Application.Common.ApiResponse<bool>>(noFrom.Value).Errors!);
        Assert.Contains("The start date must be on or before the end date.", Assert.IsType<Odip.Application.Common.ApiResponse<bool>>(backwards.Value).Errors!);
        Assert.Empty(h.Db.AuditLogs);
    }

    [Theory]
    [InlineData("=HYPERLINK(\"x\")", "'=HYPERLINK(\"x\")")]
    [InlineData("-1+2", "'-1+2")]
    public async Task TypedText_StartingWithAFormulaCharacter_IsNeutralised(string typed, string expected)
    {
        var h = Make(A);
        AddIncident(h.Db, A, AddUser(h.Db, A), new DateTime(2026, 6, 1), typed);
        h.Db.Complaints.Add(new Complaint { Id = Guid.NewGuid(), TenantId = A, ReceivedOn = new DateOnly(2026, 6, 1), Summary = "s", ActionsTaken = typed });
        h.Db.SaveChanges();
        Assert.Equal(expected, Row(await Dated(h.Controller, "incidents"))[Col("incidents", "Title")]);
        Assert.Equal(expected, Row(await Dated(h.Controller, "complaints"))[Col("complaints", "Actions taken")]);
    }

    [Fact]
    public async Task ADateIsNeverNeutralised()
    {
        var h = Make(A);
        AddIncident(h.Db, A, AddUser(h.Db, A), new DateTime(2026, 6, 1, 8, 5, 0));
        Assert.Equal("01/06/2026 08:05", Row(await Dated(h.Controller, "incidents"))[0]);
    }

    [Fact]
    public async Task EachDownload_WritesOneRegisterAuditRow()
    {
        var h = Make(A, name: "Riley Admin");
        AddIncident(h.Db, A, AddUser(h.Db, A), new DateTime(2026, 6, 1));
        await Call(h.Controller, "incidents", new DateOnly(2026, 5, 1), new DateOnly(2026, 6, 30));
        var row = Assert.Single(h.Db.AuditLogs);
        Assert.Equal("Register", row.EntityType);
        Assert.Equal(A, row.EntityId);
        Assert.Equal(AuditAction.Exported, row.Action);
        Assert.Equal("Riley Admin", row.ChangedByName);
        Assert.Equal(
            """[{"field":"register","old":null,"new":"incidents"},{"field":"from","old":null,"new":"2026-05-01"},{"field":"to","old":null,"new":"2026-06-30"},{"field":"rows","old":null,"new":"1"}]""",
            row.Changes);

        await Call(h.Controller, "staff-credentials");
        var snapshot = h.Db.AuditLogs.OrderBy(a => a.ChangedAt).ThenBy(a => a.Id).Last(a => a.Id != row.Id);
        using var json = JsonDocument.Parse(snapshot.Changes);
        Assert.Equal(new[] { "register", "rows" }, json.RootElement.EnumerateArray().Select(e => e.GetProperty("field").GetString()));
    }

    [Fact]
    public async Task ARegisterDownload_DoesNotMoveTheFullExportsLastLine()
    {
        var h = Make(A);
        await Dated(h.Controller, "risks");
        Assert.DoesNotContain(h.Db.AuditLogs, a => a.EntityType == nameof(Tenant));
    }

    [Fact]
    public async Task TheFile_IsNoStoreUtf8BomCrlfCsv()
    {
        var h = Make(A);
        AddIncident(h.Db, A, AddUser(h.Db, A), new DateTime(2026, 6, 1));
        var file = File(await Call(h.Controller, "incidents", new DateOnly(2026, 5, 1), new DateOnly(2026, 6, 30)));
        Assert.Equal("no-store", h.Controller.Response.Headers.CacheControl.ToString());
        Assert.Equal("text/csv", file.ContentType);
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, file.FileContents.Take(3));
        var text = System.Text.Encoding.UTF8.GetString(file.FileContents);
        Assert.EndsWith("\r\n", text);
        Assert.DoesNotContain("\n", text.Replace("\r\n", ""));
        Assert.Equal("bunya-support-incidents-alpha-care-2026-05-01-to-2026-06-30.csv", file.FileDownloadName);

        var snapshot = File(await Call(h.Controller, "risks"));
        Assert.Equal("bunya-support-risks-alpha-care-2026-10-31.csv", snapshot.FileDownloadName);
    }

    [Fact]
    public async Task StaffCredentials_AnythingExpiredToday_UsesProviderToday()
    {
        var h = Make(A);
        // The provider's today is 31/10/2026 (13:00 AEDT); the UTC date is the same here, so the test pins the rule: expired = before today.
        AddUser(h.Db, A, "Yesterday", "Expired", u => { u.IsFirstAidQualified = true; u.FirstAidExpiryDate = new DateOnly(2026, 10, 30); });
        AddUser(h.Db, A, "Today", "Expires", u => { u.IsFirstAidQualified = true; u.FirstAidExpiryDate = new DateOnly(2026, 10, 31); });
        var rows = Rows(await Call(h.Controller, "staff-credentials")).Skip(1).ToDictionary(r => r[0]);
        Assert.Equal("Yes", rows["Yesterday Expired"][Col("staff-credentials", "Anything expired today")]);
        Assert.Equal("No", rows["Today Expires"][Col("staff-credentials", "Anything expired today")]);
        Assert.Equal("31/10/2026", rows["Today Expires"][Col("staff-credentials", "First aid expires")]);
    }

    [Fact]
    public async Task Risks_ListsBothSources_WithAKindColumn()
    {
        var h = Make(A);
        var p = AddParticipant(h.Db, A);
        h.Db.ParticipantRiskEntries.Add(new ParticipantRiskEntry { Id = Guid.NewGuid(), TenantId = A, ParticipantId = p.Id, Description = "Falls", MitigationNotes = "Rail", IsActive = true });
        h.Db.ParticipantRiskEntries.Add(new ParticipantRiskEntry { Id = Guid.NewGuid(), TenantId = A, ParticipantId = p.Id, Description = "Archived", IsActive = false });
        h.Db.ParticipantCommunityAccessRiskItems.Add(new ParticipantCommunityAccessRiskItem { Id = Guid.NewGuid(), TenantId = A, ParticipantId = p.Id, Rating = RiskRatingLevel.High, StrategyNotes = "Escort" });
        h.Db.SaveChanges();
        var rows = Rows(await Call(h.Controller, "risks")).Skip(1).ToList();
        Assert.Equal(new[] { "Community access", "Risk" }, rows.Select(r => r[Col("risks", "Kind")]));
        Assert.Equal("High", rows[0][Col("risks", "Rating")]);
        Assert.Equal("Falls", rows[1][Col("risks", "Description")]);
        Assert.All(rows, r => Assert.Equal("Sophie Brown", r[0]));
    }
}
