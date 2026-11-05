using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.RestrictivePractices;

/// <summary>
/// The monthly restrictive practice report API. The clock is fixed at 2026-11-03 02:00 UTC (13:00 Tuesday in Sydney) unless a test says otherwise, so October is the
/// last ended month, due Fri 6 Nov. The database is a SuperAdmin context viewing as <see cref="Rig.Tenant"/> (no tenant query filter), so every cross-tenant test also
/// proves the controller's own explicit TenantId filter.
/// </summary>
public class RestrictivePracticeReportsControllerTests
{
    private static readonly DateOnly Oct = new(2026, 10, 1);
    private static readonly DateOnly Nov = new(2026, 11, 1);

    internal sealed class Rig : IDisposable
    {
        public Guid Tenant = Guid.NewGuid();
        public Guid OtherTenant = Guid.NewGuid();
        public OdipDbContext Db = null!;
        public RestrictivePracticeReportsController C = null!;
        public Participant P = null!;

        public static Rig Create(DateTimeOffset? now = null, bool noTenant = false, Func<DbContextOptionsBuilder<OdipDbContext>, DbContextOptionsBuilder<OdipDbContext>>? options = null, string? state = null)
        {
            var rig = new Rig();
            var tenant = new Mock<ICurrentTenant>();
            tenant.Setup(t => t.TenantId).Returns(noTenant ? null : rig.Tenant);
            tenant.Setup(t => t.IsSuperAdmin).Returns(true);
            var builder = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString());
            rig.Db = new OdipDbContext((options?.Invoke(builder) ?? builder).Options, tenant.Object);
            var clock = new FakeClock(now ?? new DateTimeOffset(2026, 11, 3, 2, 0, 0, TimeSpan.Zero));
            rig.C = new RestrictivePracticeReportsController(rig.Db, tenant.Object, clock);
            rig.C.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };
            if (state != null)
                rig.Db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = rig.Tenant, RegistrationNumber = "PR1", ABN = "12345678901", OrganisationName = "Test", Address = "1 Test St", State = state });
            rig.P = rig.Participant(rig.Tenant);
            return rig;
        }

        public Participant Participant(Guid tenantId, string first = "Sophie", string last = "Brown")
        {
            var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = last, IsActive = true };
            Db.Participants.Add(p);
            Db.SaveChanges();
            return p;
        }

        public RestrictivePractice Practice(Participant? p = null, Action<RestrictivePractice>? tweak = null)
        {
            p ??= P;
            var rp = new RestrictivePractice
            {
                Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id, Type = RestrictivePracticeType.PhysicalRestraint, Description = "Hold",
                AuthorisedBy = "Dr Lee", AuthorisationDate = new DateOnly(2026, 1, 1), ReportingFromMonth = Oct, IsActive = true,
            };
            tweak?.Invoke(rp);
            Db.RestrictivePractices.Add(rp);
            Db.SaveChanges();
            return rp;
        }

        public RestrictivePractice PrnPractice(Participant? p = null, Action<RestrictivePractice>? tweak = null) =>
            Practice(p, rp => { rp.UseKind = RestrictivePracticeUseKind.Prn; tweak?.Invoke(rp); });

        public IncidentReport Incident(RestrictivePractice rp, DateTime at, bool? authorised = true, IncidentStatus status = IncidentStatus.Draft, bool active = true)
        {
            var i = new IncidentReport
            {
                Id = Guid.NewGuid(), TenantId = rp.TenantId, ReportedByUserId = Guid.NewGuid(), IncidentType = IncidentType.RestrictivePracticeUse, RestrictivePracticeId = rp.Id,
                IsRestrictivePracticeAuthorised = authorised, Severity = IncidentSeverity.Low, Status = status, Title = "Use", Description = "Use", IncidentDateTime = at,
                CreatedAt = at, IsActive = active,
            };
            Db.IncidentReports.Add(i);
            Db.SaveChanges();
            return i;
        }

        public ParticipantMedication Medication(Participant p, MedicationType type)
        {
            var m = new ParticipantMedication { Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id, Name = "Risperidone", DoseDescription = "1 tablet", Type = type, IsChemicalRestraint = true };
            Db.ParticipantMedications.Add(m);
            Db.SaveChanges();
            return m;
        }

        public MedicationAdministration Dose(ParticipantMedication m, DateTime utc, MedicationAdministrationStatus status = MedicationAdministrationStatus.Administered)
        {
            var d = new MedicationAdministration { Id = Guid.NewGuid(), TenantId = m.TenantId, ParticipantMedicationId = m.Id, ParticipantId = m.ParticipantId, Status = status, AdministeredAt = utc };
            Db.MedicationAdministrations.Add(d);
            Db.SaveChanges();
            return d;
        }

        public RestrictivePracticeMonthlyReport Report(RestrictivePractice rp, DateOnly month, RestrictivePracticeReportType type = RestrictivePracticeReportType.NotUsed)
        {
            var r = new RestrictivePracticeMonthlyReport
            {
                Id = Guid.NewGuid(), TenantId = rp.TenantId, RestrictivePracticeId = rp.Id, Month = month, ReportType = type, LodgedOn = month.AddMonths(1).AddDays(1), LodgedByName = "Sam Hill",
                PracticeType = rp.Type, PracticeDescription = rp.Description,
            };
            Db.RestrictivePracticeMonthlyReports.Add(r);
            Db.SaveChanges();
            return r;
        }

        public void Dispose() => Db.Dispose();
    }

    internal static T Data<T>(ActionResult<ApiResponse<T>> r) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;

    internal static (int Status, string Error) Failure<T>(ActionResult<ApiResponse<T>> r)
    {
        var o = Assert.IsAssignableFrom<ObjectResult>(r.Result);
        return (o.StatusCode ?? 200, Assert.IsType<ApiResponse<T>>(o.Value).Errors![0]);
    }

    private static Task<ActionResult<ApiResponse<List<RestrictivePracticeReportLineDto>>>> Lines(Rig rig, Guid? participantId = null) => rig.C.GetLines(participantId, CancellationToken.None);

    private static LodgeRestrictivePracticeReportDto Lodge(RestrictivePractice rp, DateOnly? month = null, RestrictivePracticeReportType type = RestrictivePracticeReportType.NotUsed, DateOnly? on = null) =>
        new() { RestrictivePracticeId = rp.Id, Month = month ?? Oct, ReportType = type, LodgedOn = on ?? new DateOnly(2026, 11, 2) };

    // ── GetLines ──────────────────────────────────────────────

    [Fact]
    public async Task GetLines_Routine_NoUses_NoSuggestion()
    {
        using var rig = Rig.Create();
        rig.Practice();

        var line = Assert.Single(Data(await Lines(rig)));

        Assert.Empty(line.Uses);
        Assert.Null(line.SuggestedType);
        Assert.Equal((Oct, new DateOnly(2026, 11, 6), MonthlyReportState.Due), (line.Month, line.DueOn, line.State));
        Assert.Equal("Sophie Brown", line.ParticipantName);
        Assert.Equal(RestrictivePracticeUseKind.Routine, line.UseKind);
    }

    [Fact]
    public async Task GetLines_PrnUnlinked_CountsAuthorisedIncidentsIncludingDrafts()
    {
        using var rig = Rig.Create();
        var rp = rig.PrnPractice();
        var other = rig.PrnPractice();
        rig.Incident(rp, new DateTime(2026, 10, 10, 9, 0, 0));
        rig.Incident(rp, new DateTime(2026, 10, 12, 9, 0, 0), status: IncidentStatus.Submitted);
        rig.Incident(rp, new DateTime(2026, 10, 13, 9, 0, 0), authorised: false);
        rig.Incident(rp, new DateTime(2026, 10, 14, 9, 0, 0), authorised: null);
        rig.Incident(rp, new DateTime(2026, 10, 15, 9, 0, 0), active: false);
        rig.Incident(other, new DateTime(2026, 10, 16, 9, 0, 0));

        var line = Data(await Lines(rig)).Single(l => l.RestrictivePracticeId == rp.Id);

        Assert.Equal(2, line.Uses.Count);
        Assert.All(line.Uses, u => Assert.NotNull(u.IncidentReportId));
        Assert.Equal(RestrictivePracticeReportType.UsesReported, line.SuggestedType);
    }

    [Fact]
    public async Task GetLines_PrnZeroUses_SuggestsNotUsed()
    {
        using var rig = Rig.Create();
        rig.PrnPractice();

        var line = Assert.Single(Data(await Lines(rig)));

        Assert.Empty(line.Uses);
        Assert.Equal(RestrictivePracticeReportType.NotUsed, line.SuggestedType);
    }

    [Fact]
    public async Task GetLines_ChemicalLinkedPrnMedicine_CountsAdministeredDosesOnly()
    {
        using var rig = Rig.Create();
        var med = rig.Medication(rig.P, MedicationType.Prn);
        var rp = rig.Practice(tweak: p => { p.Type = RestrictivePracticeType.ChemicalRestraint; p.RelatedMedicationId = med.Id; });
        rig.Dose(med, new DateTime(2026, 10, 5, 1, 0, 0, DateTimeKind.Utc));
        rig.Dose(med, new DateTime(2026, 10, 6, 1, 0, 0, DateTimeKind.Utc), MedicationAdministrationStatus.Refused);
        rig.Dose(med, new DateTime(2026, 10, 7, 1, 0, 0, DateTimeKind.Utc), MedicationAdministrationStatus.Missed);
        rig.Incident(rp, new DateTime(2026, 10, 8, 9, 0, 0));

        var line = Assert.Single(Data(await Lines(rig)));

        Assert.Equal(RestrictivePracticeUseKind.Prn, line.UseKind);
        var use = Assert.Single(line.Uses);
        Assert.NotNull(use.MedicationAdministrationId);
        Assert.Null(use.IncidentReportId);
    }

    [Fact]
    public async Task GetLines_ChemicalLinkedRegularMedicine_IsRoutine()
    {
        using var rig = Rig.Create();
        var med = rig.Medication(rig.P, MedicationType.Regular);
        rig.Practice(tweak: p => { p.Type = RestrictivePracticeType.ChemicalRestraint; p.RelatedMedicationId = med.Id; p.UseKind = RestrictivePracticeUseKind.Prn; });
        rig.Dose(med, new DateTime(2026, 10, 5, 1, 0, 0, DateTimeKind.Utc));

        var line = Assert.Single(Data(await Lines(rig)));

        Assert.Equal(RestrictivePracticeUseKind.Routine, line.UseKind);
        Assert.Empty(line.Uses);
    }

    private static readonly DateTimeOffset Dec3 = new(2026, 12, 3, 2, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task GetLines_SydneyMonthBoundary_Dose()
    {
        using var rig = Rig.Create(Dec3);
        var med = rig.Medication(rig.P, MedicationType.Prn);
        rig.Practice(tweak: p => { p.Type = RestrictivePracticeType.ChemicalRestraint; p.RelatedMedicationId = med.Id; });
        rig.Dose(med, new DateTime(2026, 10, 31, 12, 30, 0, DateTimeKind.Utc));
        rig.Dose(med, new DateTime(2026, 10, 31, 13, 30, 0, DateTimeKind.Utc));

        var lines = Data(await Lines(rig));

        var oct = Assert.Single(lines.Single(l => l.Month == Oct).Uses);
        Assert.Equal(new DateTime(2026, 10, 31, 23, 30, 0), oct.LocalDateTime);
        Assert.Single(lines.Single(l => l.Month == Nov).Uses);
    }

    [Fact]
    public async Task GetLines_SydneyMonthBoundary_IncidentWallClock()
    {
        using var rig = Rig.Create(Dec3);
        var rp = rig.PrnPractice();
        rig.Incident(rp, new DateTime(2026, 10, 31, 23, 30, 0));
        rig.Incident(rp, new DateTime(2026, 11, 1, 0, 0, 0));

        var lines = Data(await Lines(rig));

        Assert.Equal(new DateTime(2026, 10, 31, 23, 30, 0), Assert.Single(lines.Single(l => l.Month == Oct).Uses).LocalDateTime);
        Assert.Equal(new DateTime(2026, 11, 1, 0, 0, 0), Assert.Single(lines.Single(l => l.Month == Nov).Uses).LocalDateTime);
    }

    [Fact]
    public async Task GetLines_PerthOrg_BucketsInItsOwnZone()
    {
        using var rig = Rig.Create(Dec3, state: "WA");
        var med = rig.Medication(rig.P, MedicationType.Prn);
        rig.Practice(tweak: p => { p.Type = RestrictivePracticeType.ChemicalRestraint; p.RelatedMedicationId = med.Id; });
        rig.Dose(med, new DateTime(2026, 10, 31, 15, 30, 0, DateTimeKind.Utc));
        rig.Dose(med, new DateTime(2026, 10, 31, 16, 30, 0, DateTimeKind.Utc));

        var lines = Data(await Lines(rig));

        Assert.Equal(new DateTime(2026, 10, 31, 23, 30, 0), Assert.Single(lines.Single(l => l.Month == Oct).Uses).LocalDateTime);
        Assert.Equal(new DateTime(2026, 11, 1, 0, 30, 0), Assert.Single(lines.Single(l => l.Month == Nov).Uses).LocalDateTime);
    }

    [Fact]
    public async Task GetLines_RequiresReportingFalse_Excluded_NullIncluded()
    {
        using var rig = Rig.Create();
        rig.Practice(tweak: p => p.RequiresReporting = false);
        var unanswered = rig.Practice(tweak: p => p.RequiresReporting = null);
        var yes = rig.Practice(tweak: p => p.RequiresReporting = true);

        var ids = Data(await Lines(rig)).Select(l => l.RestrictivePracticeId).ToHashSet();

        Assert.Equal(new HashSet<Guid> { unanswered.Id, yes.Id }, ids);
    }

    // ── Deactivated practices (PLAN-AMEND 1, 9, 10) ───────────

    [Fact]
    public async Task GetLines_DeactivatedAfterOctoberUse_OctoberStillListedUntilLodged()
    {
        using var rig = Rig.Create();
        var rp = rig.PrnPractice();
        rig.Incident(rp, new DateTime(2026, 10, 10, 9, 0, 0));
        rp.IsActive = false;
        rig.Db.SaveChanges();

        var line = Assert.Single(Data(await Lines(rig)));
        Assert.Equal((Oct, MonthlyReportState.Due, 1), (line.Month, line.State, line.Uses.Count));

        rig.Report(rp, Oct);
        Assert.Equal(MonthlyReportState.Lodged, Assert.Single(Data(await Lines(rig))).State);
    }

    [Fact]
    public async Task GetLines_DeactivatedPractice_MonthWithNoUse_NotListed()
    {
        using var rig = Rig.Create();
        rig.PrnPractice(tweak: p => p.IsActive = false);
        rig.Practice(tweak: p => p.IsActive = false);

        Assert.Empty(Data(await Lines(rig)));
    }

    [Fact]
    public async Task GetLines_LodgedOutsideOwedWindow_StillListed()
    {
        using var rig = Rig.Create();
        var rp = rig.Practice();
        Assert.IsType<OkObjectResult>((await rig.C.Lodge(Lodge(rp), CancellationToken.None)).Result);
        rp.AuthorisationDate = new DateOnly(2026, 12, 15);
        rig.Db.SaveChanges();

        var line = Assert.Single(Data(await Lines(rig)));

        Assert.Equal((Oct, MonthlyReportState.Lodged), (line.Month, line.State));
    }

    [Fact]
    public async Task GetLines_Order_OverdueThenDueThenLodged()
    {
        using var rig = Rig.Create(Dec3);
        rig.Practice();
        var second = rig.Practice();
        rig.Report(second, Oct);

        var lines = Data(await Lines(rig));

        Assert.Equal([MonthlyReportState.Overdue, MonthlyReportState.Due, MonthlyReportState.Due, MonthlyReportState.Lodged], lines.Select(l => l.State));
        Assert.Equal(Oct, lines[0].Month);
    }

    [Fact]
    public async Task GetLines_ParticipantFilter()
    {
        using var rig = Rig.Create();
        var other = rig.Participant(rig.Tenant, "Ben", "Lee");
        rig.Practice();
        var mine = rig.Practice(other);

        var line = Assert.Single(Data(await Lines(rig, other.Id)));

        Assert.Equal(mine.Id, line.RestrictivePracticeId);
    }

    [Fact]
    public async Task GetLines_OtherTenantsPracticesNeverListed_EvenForASuperAdminContext()
    {
        using var rig = Rig.Create();
        var theirs = rig.Participant(rig.OtherTenant);
        var theirPractice = rig.Practice(theirs);
        rig.Report(theirPractice, Oct);
        var mine = rig.Practice();

        var line = Assert.Single(Data(await Lines(rig)));

        Assert.Equal(mine.Id, line.RestrictivePracticeId);
    }

    [Fact]
    public async Task AllActions_NoTenant_Answer400ChooseOrganisation()
    {
        using var rig = Rig.Create(noTenant: true);
        var rp = rig.Practice();
        var msg = RestrictivePracticeReportsController.ChooseOrganisation;

        Assert.Equal((400, msg), Failure(await Lines(rig)));
        Assert.Equal(msg, Assert.IsType<ApiResponse<bool>>(Assert.IsType<BadRequestObjectResult>(await rig.C.GetCsv(null, CancellationToken.None)).Value).Errors![0]);
        Assert.Equal((400, msg), Failure(await rig.C.Lodge(Lodge(rp), CancellationToken.None)));
        Assert.Equal((400, msg), Failure(await rig.C.Delete(Guid.NewGuid(), CancellationToken.None)));
    }

    // ── Lodge ─────────────────────────────────────────────────

    private static ControllerContext As(Guid userId) => new()
    {
        HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "test")) },
    };

    [Fact]
    public async Task Lodge_Routine_SavesSnapshotsAndName_ReturnsLodgedLine()
    {
        using var rig = Rig.Create();
        var rp = rig.Practice();
        var user = new User { Id = Guid.NewGuid(), TenantId = rig.Tenant, FirstName = "Sam", LastName = "Hill", Username = "sam", Email = "sam@example.com", Role = UserRole.Coordinator, IsActive = true };
        rig.Db.Users.Add(user);
        rig.Db.SaveChanges();
        rig.C.ControllerContext = As(user.Id);

        var line = Data(await rig.C.Lodge(Lodge(rp), CancellationToken.None));

        var row = rig.Db.RestrictivePracticeMonthlyReports.Single();
        Assert.Equal((rp.TenantId, "Sam Hill", (Guid?)user.Id, RestrictivePracticeType.PhysicalRestraint, "Hold"), (row.TenantId, row.LodgedByName, row.LodgedByUserId, row.PracticeType, row.PracticeDescription));
        Assert.Null(row.UseCount);
        Assert.Null(row.VariedKind);
        Assert.Equal(MonthlyReportState.Lodged, line.State);
        Assert.Equal(row.Id, line.Report!.Id);
    }

    [Fact]
    public async Task Lodge_NoUserClaim_NamesAStaffMember()
    {
        using var rig = Rig.Create();
        var rp = rig.Practice();

        Data(await rig.C.Lodge(Lodge(rp), CancellationToken.None));

        Assert.Equal("A staff member", rig.Db.RestrictivePracticeMonthlyReports.Single().LodgedByName);
    }

    [Fact]
    public async Task Lodge_Prn_StoresServerUseCount()
    {
        using var rig = Rig.Create();
        var rp = rig.PrnPractice();
        rig.Incident(rp, new DateTime(2026, 10, 10, 9, 0, 0));
        rig.Incident(rp, new DateTime(2026, 10, 11, 9, 0, 0));

        Data(await rig.C.Lodge(Lodge(rp, type: RestrictivePracticeReportType.UsesReported), CancellationToken.None));

        Assert.Equal(2, rig.Db.RestrictivePracticeMonthlyReports.Single().UseCount);
    }

    [Fact]
    public async Task Lodge_VariedUse_KeepsVariedFields_OtherTypesClearThem()
    {
        using var rig = Rig.Create(Dec3);
        var rp = rig.Practice();

        Data(await rig.C.Lodge(Lodge(rp) with { ReportType = RestrictivePracticeReportType.VariedUse, VariedKind = RestrictivePracticeVariedKind.Increased, VariedAlsoUnauthorised = true }, CancellationToken.None));
        Data(await rig.C.Lodge(Lodge(rp, Nov, on: new DateOnly(2026, 12, 2)) with { VariedKind = RestrictivePracticeVariedKind.Other, VariedAlsoUnauthorised = false }, CancellationToken.None));

        var rows = rig.Db.RestrictivePracticeMonthlyReports.OrderBy(r => r.Month).ToList();
        Assert.Equal((RestrictivePracticeVariedKind.Increased, true), (rows[0].VariedKind, rows[0].VariedAlsoUnauthorised));
        Assert.Equal((null, null), (rows[1].VariedKind, rows[1].VariedAlsoUnauthorised));
    }

    public static TheoryData<int> ValidationRows => new() { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 };

    [Theory, MemberData(nameof(ValidationRows))]
    public async Task Lodge_Validation(int row)
    {
        using var rig = Rig.Create(noTenant: row == 1);
        var routine = rig.Practice();
        var prn = rig.PrnPractice();
        var dto = Lodge(routine);
        (int Status, string Error) expected;
        switch (row)
        {
            case 1: expected = (400, RestrictivePracticeReportsController.ChooseOrganisation); break;
            case 2: dto = dto with { RestrictivePracticeId = Guid.NewGuid() }; expected = (404, "Restrictive practice entry not found"); break;
            case 3: dto = dto with { Month = new DateOnly(2026, 10, 2) }; expected = (400, "Choose a month."); break;
            case 4: dto = dto with { Month = Nov }; expected = (400, "This practice has no monthly report for that month."); break;
            case 5: rig.Report(routine, Oct); expected = (409, "This month has already been lodged. Reload to see it."); break;
            case 6: dto = Lodge(prn, type: RestrictivePracticeReportType.UsedAsPerPlan); expected = (400, "Used as per plan and varied use are for routine practices only."); break;
            case 7: dto = dto with { ReportType = RestrictivePracticeReportType.UsesReported }; expected = (400, "Uses reported is for as-needed practices only."); break;
            case 8: dto = dto with { ReportType = RestrictivePracticeReportType.VariedUse, VariedAlsoUnauthorised = false }; expected = (400, "Choose how the use was varied."); break;
            case 9: dto = dto with { ReportType = RestrictivePracticeReportType.VariedUse, VariedKind = RestrictivePracticeVariedKind.Other }; expected = (400, "Say whether the varied use was also unauthorised."); break;
            case 10: dto = dto with { LodgedOn = new DateOnly(2026, 11, 4) }; expected = (400, "The lodged date can't be in the future."); break;
            case 11: dto = dto with { LodgedOn = new DateOnly(2026, 10, 31) }; expected = (400, "The lodged date must be after the month ends."); break;
            default: dto = dto with { Note = new string('x', 2001) }; expected = (400, "Keep the note under 2,000 characters."); break;
        }

        Assert.Equal(expected, Failure(await rig.C.Lodge(dto, CancellationToken.None)));
    }

    [Fact]
    public async Task Lodge_OtherTenantsPractice_404()
    {
        using var rig = Rig.Create();
        var theirs = rig.Practice(rig.Participant(rig.OtherTenant));

        Assert.Equal(404, Failure(await rig.C.Lodge(Lodge(theirs), CancellationToken.None)).Status);
        Assert.Empty(rig.Db.RestrictivePracticeMonthlyReports);
    }

    [Fact]
    public async Task Lodge_EliminatedStopsNextMonth()
    {
        using var rig = Rig.Create(new DateTimeOffset(2026, 12, 15, 2, 0, 0, TimeSpan.Zero));
        var rp = rig.Practice();

        Data(await rig.C.Lodge(Lodge(rp, type: RestrictivePracticeReportType.Eliminated, on: new DateOnly(2026, 11, 5)), CancellationToken.None));

        Assert.Equal(Oct, Assert.Single(Data(await Lines(rig))).Month);
        Assert.Equal((400, "This practice has no monthly report for that month."), Failure(await rig.C.Lodge(Lodge(rp, Nov, on: new DateOnly(2026, 12, 8)), CancellationToken.None)));
    }

    [Fact]
    public async Task Lodge_Twice_Second409()
    {
        using var rig = Rig.Create();
        var rp = rig.Practice();
        Data(await rig.C.Lodge(Lodge(rp), CancellationToken.None));

        Assert.Equal(409, Failure(await rig.C.Lodge(Lodge(rp), CancellationToken.None)).Status);
        Assert.Single(rig.Db.RestrictivePracticeMonthlyReports);
    }

    /// <summary>Throws when a monthly report is saved: the pre-check passed, so this is the race where another request lodged first.</summary>
    private sealed class FailingSave(Exception inner) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default) =>
            eventData.Context!.ChangeTracker.Entries<RestrictivePracticeMonthlyReport>().Any(e => e.State == EntityState.Added)
                ? throw new DbUpdateException("save failed", inner) : base.SavingChangesAsync(eventData, result, ct);
    }

    [Fact]
    public async Task Lodge_SaveThrowsUniqueViolation_Maps409()
    {
        using var rig = Rig.Create(options: o => o.AddInterceptors(new FailingSave(new PostgresException("duplicate", "ERROR", "ERROR", "23505"))));
        var rp = rig.Practice();

        Assert.Equal((409, "This month has already been lodged. Reload to see it."), Failure(await rig.C.Lodge(Lodge(rp), CancellationToken.None)));
    }

    [Fact]
    public async Task Lodge_SaveThrowsAnyOtherDbUpdateException_IsNotMislabelledAsDuplicate()
    {
        using var rig = Rig.Create(options: o => o.AddInterceptors(new FailingSave(new PostgresException("fk", "ERROR", "ERROR", "23503"))));
        var rp = rig.Practice();

        await Assert.ThrowsAsync<DbUpdateException>(() => rig.C.Lodge(Lodge(rp), CancellationToken.None));
    }

    [Fact]
    public async Task Lodge_DeactivatedPractice_MonthWithUse_Succeeds()
    {
        using var rig = Rig.Create();
        var rp = rig.PrnPractice();
        rig.Incident(rp, new DateTime(2026, 10, 10, 9, 0, 0));
        rp.IsActive = false;
        rig.Db.SaveChanges();

        var line = Data(await rig.C.Lodge(Lodge(rp, type: RestrictivePracticeReportType.UsesReported), CancellationToken.None));

        Assert.Equal(MonthlyReportState.Lodged, line.State);
    }

    [Fact]
    public async Task Lodge_DeactivatedPractice_MonthWithoutUse_400()
    {
        using var rig = Rig.Create();
        var rp = rig.PrnPractice(tweak: p => p.IsActive = false);

        Assert.Equal((400, "This practice has no monthly report for that month."), Failure(await rig.C.Lodge(Lodge(rp), CancellationToken.None)));
    }

    // ── Delete (undo) ─────────────────────────────────────────

    [Fact]
    public async Task Delete_RemovesReport_LineBackToDue()
    {
        using var rig = Rig.Create();
        var rp = rig.Practice();
        var report = rig.Report(rp, Oct);

        Assert.True(Data(await rig.C.Delete(report.Id, CancellationToken.None)));

        Assert.Empty(rig.Db.RestrictivePracticeMonthlyReports);
        Assert.Equal(MonthlyReportState.Due, Assert.Single(Data(await Lines(rig))).State);
    }

    [Fact]
    public async Task Delete_OtherTenant_404()
    {
        using var rig = Rig.Create();
        var theirs = rig.Practice(rig.Participant(rig.OtherTenant));
        var report = rig.Report(theirs, Oct);

        Assert.Equal((404, "Monthly report not found"), Failure(await rig.C.Delete(report.Id, CancellationToken.None)));
        Assert.Single(rig.Db.RestrictivePracticeMonthlyReports);
    }

    // ── CSV ───────────────────────────────────────────────────

    private const string Header = "Participant,Practice type,Description,Use,Authorised from,Authorised to,Month,Due by,Status,Report type,Varied,Also unauthorised,Use date,Use time,Lodged on,Lodged by,Note";

    private static async Task<(string[] Rows, string FileName)> CsvAsync(Rig rig, DateOnly? month = null)
    {
        var file = Assert.IsType<FileContentResult>(await rig.C.GetCsv(month, CancellationToken.None));
        Assert.Equal("text/csv", file.ContentType);
        var text = new UTF8Encoding(true).GetString(file.FileContents).TrimStart('﻿');
        return (text.TrimEnd('\r', '\n').Split("\r\n"), file.FileDownloadName);
    }

    [Fact]
    public async Task Csv_OneMonth_HeaderAndRows()
    {
        using var rig = Rig.Create();
        var prn = rig.PrnPractice();
        rig.Incident(prn, new DateTime(2026, 10, 10, 9, 5, 0));
        rig.Incident(prn, new DateTime(2026, 10, 12, 21, 40, 0));
        rig.Practice();

        var (rows, _) = await CsvAsync(rig);

        Assert.Equal(Header, rows[0]);
        Assert.Equal(4, rows.Length);
        Assert.Single(rows, r => r.Contains("Routine") && r.Contains("October 2026") && r.Contains("06/11/2026") && r.Contains(",Due,") && r.Contains("Physical restraint"));
        Assert.Single(rows, r => r.Contains("As needed") && r.Contains("10/10/2026,09:05"));
        Assert.Single(rows, r => r.Contains("As needed") && r.Contains("12/10/2026,21:40"));
    }

    [Fact]
    public async Task Csv_TypedTextIsInjectionSafe()
    {
        using var rig = Rig.Create();
        rig.Practice(tweak: p => p.Description = "=HYPERLINK(1)");

        var (rows, _) = await CsvAsync(rig);

        Assert.Contains("'=HYPERLINK(1)", rows[1]);
    }

    [Fact]
    public async Task Csv_DefaultMonth_IsLastEndedMonth()
    {
        using var rig = Rig.Create(Dec3);
        rig.Practice();

        var (rows, name) = await CsvAsync(rig);

        Assert.Equal("rp-monthly-reports-2026-11.csv", name);
        Assert.Equal(2, rows.Length);
        Assert.Contains("November 2026", rows[1]);
    }

    [Fact]
    public async Task Csv_MonthNotFirstOfMonth_400()
    {
        using var rig = Rig.Create();

        var bad = Assert.IsType<BadRequestObjectResult>(await rig.C.GetCsv(new DateOnly(2026, 10, 15), CancellationToken.None));

        Assert.Equal("Choose a month.", Assert.IsType<ApiResponse<bool>>(bad.Value).Errors![0]);
    }
}
