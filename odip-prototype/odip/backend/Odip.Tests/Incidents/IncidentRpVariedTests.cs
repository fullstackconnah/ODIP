using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Medications;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>
/// The "varied?" answer and the single Authorised rule at incident entry (RP PR 1): an authorised use that went as planned is not reportable;
/// a varied one, an unanswered one and an unauthorised one are. The clock is 2026-10-31 02:00 UTC (13:00 in Sydney), so the provider's today is 2026-10-31.
/// </summary>
public class IncidentRpVariedTests
{
    private static readonly DateTime Oct21 = new(2026, 10, 21, 9, 0, 0, DateTimeKind.Utc);

    private static FakeClock Clock() => FakeClock.AtUtc(2026, 10, 31, 2, 0);

    private static IncidentsController Controller(OdipDbContext db) => new(db, clock: Clock());

    private static (User reporter, Participant participant) Seed(OdipDbContext db, Guid? tenantId = null)
    {
        var tenant = tenantId ?? Guid.NewGuid();
        var reporter = new User
        {
            Id = Guid.NewGuid(), TenantId = tenant, FirstName = "Alex", LastName = "Rivera", Username = "alex.rivera", Email = "alex.rivera@example.com", IsActive = true,
        };
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenant, FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Users.Add(reporter);
        db.Participants.Add(participant);
        db.SaveChanges();
        return (reporter, participant);
    }

    private static RestrictivePractice Practice(OdipDbContext db, Participant p, Action<RestrictivePractice>? tweak = null)
    {
        var rp = new RestrictivePractice
        {
            Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id, Type = RestrictivePracticeType.Seclusion, Description = "Seclusion room",
            IsActive = true, AuthorisedBy = "Dr Chen", AuthorisationDate = new DateOnly(2026, 8, 1),
        };
        tweak?.Invoke(rp);
        db.RestrictivePractices.Add(rp);
        db.SaveChanges();
        return rp;
    }

    private static CreateIncidentDto Create(User reporter, Participant p, RestrictivePractice? rp, bool? varied, DateTime? at = null, bool withoutAuth = false) => new()
    {
        ReportedByStaffId = reporter.Id, IncidentType = IncidentType.RestrictivePracticeUse, RestrictivePracticeType = RestrictivePracticeType.Seclusion,
        InvolvedParticipantId = p.Id, RestrictivePracticeId = rp?.Id, RestrictivePracticeUseVaried = varied, UsedWithoutAuthorisation = withoutAuth,
        Severity = IncidentSeverity.Low, Title = "Use of seclusion", Description = "What happened.", IncidentDateTime = at ?? Oct21,
    };

    private static UpdateIncidentDto Update(User reporter, Participant p, RestrictivePractice? rp, bool withoutAuth = false, bool? varied = null,
        QscReportingStatus status = QscReportingStatus.NotRequired, ReportableClass? cls = null, string? reason = null) => new()
    {
        ReportedByStaffId = reporter.Id, IncidentType = IncidentType.RestrictivePracticeUse, RestrictivePracticeType = RestrictivePracticeType.Seclusion,
        InvolvedParticipantId = p.Id, RestrictivePracticeId = rp?.Id, UsedWithoutAuthorisation = withoutAuth, RestrictivePracticeUseVaried = varied,
        Severity = IncidentSeverity.Low, Title = "Updated", Description = "Updated.", IncidentDateTime = Oct21, Status = IncidentStatus.Draft,
        QscReportingStatus = status, ReportableClass = cls, ReportableClassReason = reason,
    };

    private static async Task<IncidentReport> CreateOk(IncidentsController c, OdipDbContext db, CreateIncidentDto dto)
    {
        Assert.IsType<OkObjectResult>((await c.Create(dto, CancellationToken.None)).Result);
        return await db.IncidentReports.SingleAsync();
    }

    private static IncidentsController AsRole(IncidentsController c, string role, Guid userId)
    {
        c.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, role), new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "Test")),
            },
        };
        return c;
    }

    [Fact]
    public async Task Create_AuthorisedUse_AsPlanned_IsNotReportable()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var saved = await CreateOk(Controller(db), db, Create(u, p, Practice(db, p), varied: false));

        Assert.True(saved.IsRestrictivePracticeAuthorised);
        Assert.False(saved.RestrictivePracticeUseVaried);
        Assert.Equal(ReportableClass.None, saved.ReportableClass);
        Assert.Equal(QscReportingStatus.NotRequired, saved.QscReportingStatus);
        Assert.False(await db.BookingTasks.AnyAsync(t => t.TaskType == TaskType.IncidentQscReport));
    }

    [Fact]
    public async Task Create_AuthorisedUse_Varied_IsReportable()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var saved = await CreateOk(Controller(db), db, Create(u, p, Practice(db, p), varied: true));

        Assert.True(saved.RestrictivePracticeUseVaried);
        Assert.Equal(ReportableClass.Within24h, saved.ReportableClass);
        Assert.Equal(QscReportingStatus.Required, saved.QscReportingStatus);
        Assert.True(await db.BookingTasks.AnyAsync(t => t.TaskType == TaskType.IncidentQscReport));
    }

    [Fact]
    public async Task Create_AuthorisedUse_NoAnswer_IsReportable()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var saved = await CreateOk(Controller(db), db, Create(u, p, Practice(db, p), varied: null));

        Assert.Null(saved.RestrictivePracticeUseVaried);
        Assert.Equal(ReportableClass.Within24h, saved.ReportableClass);
    }

    [Fact]
    public async Task Create_UseAfterEndDate_IsUnauthorised_AndStoresNoAnswer()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var rp = Practice(db, p, r => r.AuthorisationEndDate = new DateOnly(2026, 10, 20));
        var saved = await CreateOk(Controller(db), db, Create(u, p, rp, varied: false));

        Assert.False(saved.IsRestrictivePracticeAuthorised);
        Assert.Null(saved.RestrictivePracticeUseVaried);
        Assert.Equal(ReportableClass.Within24h, saved.ReportableClass);
    }

    [Fact]
    public async Task Create_UseOnEndDate_JudgedOnTheIncidentDate_IsAuthorised()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var rp = Practice(db, p, r => r.AuthorisationEndDate = new DateOnly(2026, 10, 20)); // expired by the provider's today, 10-31
        var saved = await CreateOk(Controller(db), db, Create(u, p, rp, varied: false, at: new DateTime(2026, 10, 20, 23, 30, 0, DateTimeKind.Utc)));

        Assert.True(saved.IsRestrictivePracticeAuthorised);
        Assert.Equal(ReportableClass.None, saved.ReportableClass);
    }

    [Fact]
    public async Task Create_UseBeforeAuthorisationDate_IsUnauthorised()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var rp = Practice(db, p, r => r.AuthorisationDate = new DateOnly(2026, 10, 25));
        var saved = await CreateOk(Controller(db), db, Create(u, p, rp, varied: false, at: new DateTime(2026, 10, 24, 10, 0, 0, DateTimeKind.Utc)));

        Assert.False(saved.IsRestrictivePracticeAuthorised);
    }

    [Fact]
    public async Task Create_NoLink_JudgesEveryEntryOfTheTypeOnTheIncidentDate()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        Practice(db, p, r => r.AuthorisationEndDate = new DateOnly(2026, 10, 20));
        Practice(db, p, r => r.IsActive = false);
        var saved = await CreateOk(Controller(db), db, Create(u, p, null, varied: false));

        Assert.False(saved.IsRestrictivePracticeAuthorised);
    }

    [Fact]
    public async Task Create_AsSupportWorker_StoresVariedAnswer()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var c = AsRole(Controller(db), "SupportWorker", u.Id);
        var saved = await CreateOk(c, db, Create(u, p, Practice(db, p), varied: false));

        Assert.False(saved.RestrictivePracticeUseVaried);
    }

    [Fact]
    public async Task Create_LinkToOtherTenantsPractice_Rejected()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var (_, other) = Seed(db);
        var theirs = Practice(db, other);

        var result = await Controller(db).Create(Create(u, p, theirs, varied: false), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(db.IncidentReports);
    }

    [Fact]
    public async Task Update_IgnoresVariedAnswer()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var rp = Practice(db, p);
        var c = Controller(db);
        var saved = await CreateOk(c, db, Create(u, p, rp, varied: false));

        var result = await c.Update(saved.Id, Update(u, p, rp, varied: true, cls: ReportableClass.None), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.False((await db.IncidentReports.SingleAsync()).RestrictivePracticeUseVaried);
    }

    [Fact]
    public async Task Update_AsPlannedIncident_MarkedNotAuthorised_BecomesReportable()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var rp = Practice(db, p);
        var c = Controller(db);
        var saved = await CreateOk(c, db, Create(u, p, rp, varied: false));

        var result = await c.Update(saved.Id, Update(u, p, rp, withoutAuth: true, cls: ReportableClass.None), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var after = await db.IncidentReports.SingleAsync();
        Assert.False(after.IsRestrictivePracticeAuthorised);
        Assert.Equal(ReportableClass.Within24h, after.ReportableClass);
        Assert.Equal(QscReportingStatus.Required, after.QscReportingStatus);
        Assert.True(await db.BookingTasks.AnyAsync(t => t.TaskType == TaskType.IncidentQscReport));
    }

    [Fact]
    public async Task Update_AsPlannedIncident_RelinkToUnauthorisedEntry_BecomesReportable()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var good = Practice(db, p);
        var c = Controller(db);
        var saved = await CreateOk(c, db, Create(u, p, good, varied: false));
        var notAuthorised = Practice(db, p, r => { r.AuthorisedBy = null; r.AuthorisationDate = null; });

        await c.Update(saved.Id, Update(u, p, notAuthorised, cls: ReportableClass.None), CancellationToken.None);

        var after = await db.IncidentReports.SingleAsync();
        Assert.False(after.IsRestrictivePracticeAuthorised);
        Assert.Equal(ReportableClass.Within24h, after.ReportableClass);
    }

    [Fact]
    public async Task Update_LoweredWithExplicitOverride_StillNeedsReason()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var rp = Practice(db, p);
        var c = Controller(db);
        var saved = await CreateOk(c, db, Create(u, p, rp, varied: true)); // Within24h

        var result = await c.Update(saved.Id, Update(u, p, rp, cls: ReportableClass.None, status: QscReportingStatus.NotRequired), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_RelinkToEntryEndedBeforeTheIncidentDate_LowersToUnauthorised()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var good = Practice(db, p);
        var c = Controller(db);
        var saved = await CreateOk(c, db, Create(u, p, good, varied: false));
        var ended = Practice(db, p, r => r.AuthorisationEndDate = new DateOnly(2026, 10, 20));

        await c.Update(saved.Id, Update(u, p, ended, cls: ReportableClass.None), CancellationToken.None);

        Assert.False((await db.IncidentReports.SingleAsync()).IsRestrictivePracticeAuthorised);
    }

    [Fact]
    public async Task Update_RelinkToEntryEndedAfterTheIncidentDate_KeepsTheDetermination()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var (u, p) = Seed(db);
        var good = Practice(db, p);
        var c = Controller(db);
        var saved = await CreateOk(c, db, Create(u, p, good, varied: false));
        var endsLater = Practice(db, p, r => r.AuthorisationEndDate = new DateOnly(2026, 10, 25)); // still in force on 10-21, ended by today

        await c.Update(saved.Id, Update(u, p, endsLater, cls: ReportableClass.None), CancellationToken.None);

        Assert.True((await db.IncidentReports.SingleAsync()).IsRestrictivePracticeAuthorised);
    }
}
