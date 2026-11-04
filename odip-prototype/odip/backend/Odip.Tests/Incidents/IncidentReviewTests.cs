using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>IC7: the Admin review. Admins write it, Coordinators read it, support workers never see it, and the date is the server's.</summary>
public class IncidentReviewTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 4, 3, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private static IncidentsController As(OdipDbContext db, string role, Guid? userId = null)
    {
        var claims = new List<Claim> { new(ClaimTypes.Role, role) };
        if (userId is { } id) claims.Add(new Claim(ClaimTypes.NameIdentifier, id.ToString()));
        return new IncidentsController(db, clock: new FixedClock(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } },
        };
    }

    private static (User Admin, IncidentReport Incident) Seed(OdipDbContext db, bool reviewed = true)
    {
        var tenant = Guid.NewGuid();
        var admin = new User { Id = Guid.NewGuid(), TenantId = tenant, FirstName = "Ada", LastName = "Admin", Username = "ada", Email = "ada@example.com", IsActive = true };
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = tenant, ReportedByUserId = admin.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Medium,
            Status = IncidentStatus.Submitted, Title = "Fall", Description = "What happened.", IncidentDateTime = Now.UtcDateTime.AddDays(-1), CreatedAt = Now.UtcDateTime.AddDays(-1), IsActive = true,
            ReviewedByUserId = reviewed ? admin.Id : null, ReviewedAt = reviewed ? Now.UtcDateTime.AddHours(-5) : null,
            ReviewNotes = reviewed ? "Secret review notes." : null, CorrectiveActions = reviewed ? "Secret actions." : null,
        };
        db.Users.Add(admin);
        db.IncidentReports.Add(incident);
        db.SaveChanges();
        return (admin, incident);
    }

    private static async Task<IncidentDetailDto> DetailAsync(IncidentsController c, Guid id) =>
        Assert.IsType<ApiResponse<IncidentDetailDto>>(Assert.IsType<OkObjectResult>((await c.GetById(id, CancellationToken.None)).Result).Value).Data!;

    [Theory]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public async Task GetById_AsSupportWorkerOrReadOnly_ReturnsNoReviewFields(string role)
    {
        using var db = TestDb.Create();
        var (_, incident) = Seed(db);

        var dto = await DetailAsync(As(db, role, Guid.NewGuid()), incident.Id);

        Assert.Null(dto.ReviewedByStaffId);
        Assert.Null(dto.ReviewedByName);
        Assert.Null(dto.ReviewedAt);
        Assert.Null(dto.ReviewNotes);
        Assert.Null(dto.CorrectiveActions);
    }

    [Theory]
    [InlineData("Coordinator")]
    [InlineData("Admin")]
    [InlineData("SuperAdmin")]
    public async Task GetById_AsTheOfficeRoles_ReturnsTheReview(string role)
    {
        using var db = TestDb.Create();
        var (admin, incident) = Seed(db);

        var dto = await DetailAsync(As(db, role, Guid.NewGuid()), incident.Id);

        Assert.Equal("Secret review notes.", dto.ReviewNotes);
        Assert.Equal("Secret actions.", dto.CorrectiveActions);
        Assert.Equal(admin.Id, dto.ReviewedByStaffId);
        Assert.Equal("Ada Admin", dto.ReviewedByName);
        Assert.Equal(Now.UtcDateTime.AddHours(-5), dto.ReviewedAt);
    }

    [Fact]
    public async Task Update_CarryingReviewValues_LeavesTheStoredReviewUnchanged()
    {
        using var db = TestDb.Create();
        var (admin, incident) = Seed(db);
        // An old client still sends the review keys; the server DTO has no such members, so they are ignored on the wire.
        Assert.Null(typeof(UpdateIncidentDto).GetProperty("ReviewNotes"));
        Assert.Null(typeof(UpdateIncidentDto).GetProperty("ReviewedByStaffId"));
        Assert.Null(typeof(UpdateIncidentDto).GetProperty("CorrectiveActions"));

        var update = new UpdateIncidentDto
        {
            ReportedByStaffId = admin.Id, IncidentType = incident.IncidentType, Severity = incident.Severity, Status = IncidentStatus.UnderReview,
            Title = "Renamed", Description = incident.Description, IncidentDateTime = incident.IncidentDateTime,
        };
        Assert.IsType<OkObjectResult>((await As(db, "Coordinator", Guid.NewGuid()).Update(incident.Id, update, CancellationToken.None)).Result);

        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal("Renamed", saved.Title);
        Assert.Equal("Secret review notes.", saved.ReviewNotes);
        Assert.Equal("Secret actions.", saved.CorrectiveActions);
        Assert.Equal(admin.Id, saved.ReviewedByUserId);
        Assert.Equal(Now.UtcDateTime.AddHours(-5), saved.ReviewedAt);
    }

    [Fact]
    public async Task Review_AsAdmin_StampsTheServerClock_TheCallerAndTheStatus()
    {
        using var db = TestDb.Create();
        var (admin, incident) = Seed(db, reviewed: false);

        var result = await As(db, "Admin", admin.Id).RecordReview(incident.Id, new RecordIncidentReviewDto { ReviewNotes = "  Looked into it.  ", CorrectiveActions = "New rail.", Status = IncidentStatus.Resolved }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal(Now.UtcDateTime, saved.ReviewedAt);
        Assert.Equal(admin.Id, saved.ReviewedByUserId);
        Assert.Equal("Looked into it.", saved.ReviewNotes);
        Assert.Equal("New rail.", saved.CorrectiveActions);
        Assert.Equal(IncidentStatus.Resolved, saved.Status);
        Assert.Equal(Now.UtcDateTime, saved.ResolvedAt);
    }

    [Fact]
    public void Review_TakesNoDateAndNoReviewerFromTheBody() =>
        Assert.Equal(["CorrectiveActions", "ReviewNotes", "Status"], typeof(RecordIncidentReviewDto).GetProperties().Select(p => p.Name).Order(StringComparer.Ordinal));

    [Fact]
    public async Task Review_BlankNotes_IsABadRequest_AndSavesNothing()
    {
        using var db = TestDb.Create();
        var (admin, incident) = Seed(db, reviewed: false);

        var result = await As(db, "Admin", admin.Id).RecordReview(incident.Id, new RecordIncidentReviewDto { ReviewNotes = "   ", Status = IncidentStatus.UnderReview }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Null((await db.IncidentReports.SingleAsync()).ReviewedAt);
    }

    [Fact]
    public async Task Review_BySuperAdminViewingAsATenant_SavesAndReadsTheFields()
    {
        var tenant = Guid.NewGuid();
        using var db = TestDb.Create(viewingAs: tenant);
        var (admin, incident) = Seed(db, reviewed: false);
        db.ChangeTracker.Clear();
        // The seeded rows carry their own tenant; move them to the one being viewed so the SuperAdmin context sees them.
        var rows = await db.IncidentReports.IgnoreQueryFilters().ToListAsync();
        rows.ForEach(r => r.TenantId = tenant);
        await db.SaveChangesAsync();
        var controller = As(db, "SuperAdmin", admin.Id);

        Assert.IsType<OkObjectResult>((await controller.RecordReview(incident.Id, new RecordIncidentReviewDto { ReviewNotes = "Super review.", Status = IncidentStatus.UnderReview }, CancellationToken.None)).Result);

        Assert.Equal("Super review.", (await DetailAsync(controller, incident.Id)).ReviewNotes);
    }

    [Fact]
    public async Task Review_UnknownIncident_IsNotFound()
    {
        using var db = TestDb.Create();
        var (admin, _) = Seed(db);

        Assert.IsType<NotFoundObjectResult>((await As(db, "Admin", admin.Id).RecordReview(Guid.NewGuid(), new RecordIncidentReviewDto { ReviewNotes = "x", Status = IncidentStatus.UnderReview }, CancellationToken.None)).Result);
    }

    private static void Audit(OdipDbContext db, Guid incidentId, DateTimeOffset at, string by, string changes) =>
        db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = "IncidentReport", EntityId = incidentId, Action = AuditAction.Updated, ChangedAt = at, ChangedByName = by, Changes = changes });

    [Fact]
    public async Task StatusHistory_ListsOnlyStatusChanges_NewestFirst_AndNeverTheReviewText()
    {
        using var db = TestDb.Create();
        var (_, incident) = Seed(db);
        Audit(db, incident.Id, Now.AddDays(-2), "Reporter", "[{\"Field\":\"Status\",\"Old\":null,\"New\":\"Draft\"},{\"Field\":\"Title\",\"Old\":null,\"New\":\"Fall\"}]");
        Audit(db, incident.Id, Now.AddDays(-1), "Cora Coordinator", "[{\"Field\":\"Status\",\"Old\":\"Draft\",\"New\":\"Submitted\"}]");
        Audit(db, incident.Id, Now.AddHours(-9), "Cora Coordinator", "[{\"Field\":\"Title\",\"Old\":\"Fall\",\"New\":\"Fall at the pool\"}]");
        Audit(db, incident.Id, Now.AddHours(-5), "Ada Admin", "[{\"Field\":\"Status\",\"Old\":\"Submitted\",\"New\":\"Resolved\"},{\"Field\":\"ReviewNotes\",\"Old\":null,\"New\":\"Secret review notes.\"}]");
        db.SaveChanges();

        var result = await As(db, "Coordinator", Guid.NewGuid()).GetStatusHistory(incident.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var items = Assert.IsType<ApiResponse<List<IncidentStatusChangeDto>>>(ok.Value).Data!;
        Assert.Equal([IncidentStatus.Resolved, IncidentStatus.Submitted, IncidentStatus.Draft], items.Select(i => i.To));
        Assert.Equal([IncidentStatus.Submitted, IncidentStatus.Draft, null], items.Select(i => i.From));
        Assert.Equal("Ada Admin", items[0].ByName);
        Assert.DoesNotContain("Secret", System.Text.Json.JsonSerializer.Serialize(items));
    }

    [Fact]
    public async Task StatusHistory_AnotherTenantsIncident_IsNotFound()
    {
        var name = Guid.NewGuid().ToString();
        Guid incidentId;
        using (var seed = TestDb.Create(name)) { incidentId = Seed(seed).Incident.Id; }
        using var other = TestDb.ForTenant(name, Guid.NewGuid());

        Assert.IsType<NotFoundObjectResult>((await As(other, "Admin", Guid.NewGuid()).GetStatusHistory(incidentId, CancellationToken.None)).Result);
    }

    // ── who may call what: the role strings as the framework evaluates them ──

    private static bool Allows(string action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var method = typeof(IncidentsController).GetMethod(action)!;
        var attributes = method.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(method.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    [Theory]
    [InlineData("Admin", true, true, true)]
    [InlineData("SuperAdmin", true, true, true)]
    [InlineData("Coordinator", false, true, true)]
    [InlineData("SupportWorker", false, false, false)]
    [InlineData("ReadOnly", false, false, false)]
    public void ReviewAndHistory_AdmitOnlyTheDocumentedRoles(string role, bool writes, bool reads, bool readsHistory)
    {
        Assert.Equal(writes, Allows(nameof(IncidentsController.RecordReview), role));
        Assert.Equal(readsHistory, Allows(nameof(IncidentsController.GetStatusHistory), role));
        // Reading the review itself is through GetById, which strips it by role rather than refusing the call.
        Assert.Equal(reads, role is "Admin" or "SuperAdmin" or "Coordinator");
    }

    [Fact]
    public void TheNewActionsAreRoutedUnderTheIncident()
    {
        Assert.Equal("{id:guid}/review", typeof(IncidentsController).GetMethod(nameof(IncidentsController.RecordReview))!.GetCustomAttribute<HttpMethodAttribute>()!.Template);
        Assert.Equal("{id:guid}/status-history", typeof(IncidentsController).GetMethod(nameof(IncidentsController.GetStatusHistory))!.GetCustomAttribute<HttpMethodAttribute>()!.Template);
    }
}
