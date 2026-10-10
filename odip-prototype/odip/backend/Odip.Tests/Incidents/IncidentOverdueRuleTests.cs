using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>
/// "QSC report overdue" is defined once (<see cref="QscReporting"/>: active, Required, not yet
/// reported, created over 24 hours ago) and the dashboard count, the overdue list and the
/// participant alert all use it. Every incident list the controller builds carries an
/// <c>IsOverdue24h</c> flag, which must say the same thing about the same incident, and the item
/// Create and Update return must be the item the list shows.
/// </summary>
public class IncidentOverdueRuleTests
{
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private static User SeedUser(OdipDbContext db)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = "Alex", LastName = "Rivera",
            Username = "alex.rivera", Email = "alex.rivera@example.com", IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static IncidentReport SeedIncident(
        OdipDbContext db, Guid reporterId, TimeSpan age, QscReportingStatus qsc = QscReportingStatus.Required,
        DateTime? reportedAt = null, bool isActive = true, Guid? tripId = null, Guid? shiftId = null)
    {
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), ReportedByUserId = reporterId, IncidentType = IncidentType.PropertyDamage,
            Severity = IncidentSeverity.Low, Status = IncidentStatus.Draft, Title = "Incident", Description = "What happened.",
            IncidentDateTime = DateTime.UtcNow.AddDays(-3), CreatedAt = DateTime.UtcNow - age,
            QscReportingStatus = qsc, QscReportedAt = reportedAt, IsActive = isActive, TripInstanceId = tripId, ShiftId = shiftId,
        };
        db.IncidentReports.Add(incident);
        db.SaveChanges();
        return incident;
    }

    private static async Task<List<IncidentListDto>> GetAllItems(IncidentsController controller, bool? isActive = null, bool? isOverdueQsc = null)
    {
        var result = await controller.GetAll(
            tripId: null, status: null, severity: null, qscStatus: null, isActive: isActive, isOverdueQsc: isOverdueQsc,
            shiftId: null, involvedUserId: null, ct: CancellationToken.None);
        return Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Items.ToList();
    }

    [Fact]
    public async Task GetAll_InactiveIncidentPastTheWindow_IsNotFlaggedOverdue()
    {
        using var db = CreateDb();
        var incident = SeedIncident(db, SeedUser(db).Id, TimeSpan.FromHours(25), isActive: false);
        var controller = new IncidentsController(db);

        var item = Assert.Single(await GetAllItems(controller, isActive: false));

        Assert.Equal(incident.Id, item.Id);
        Assert.False(QscReporting.IsOverdue(incident, DateTime.UtcNow)); // the rule: an inactive incident is never overdue
        Assert.False(item.IsOverdue24h);
    }

    [Fact]
    public async Task GetAll_OverdueFilter_LeavesOutInactiveIncidents()
    {
        using var db = CreateDb();
        SeedIncident(db, SeedUser(db).Id, TimeSpan.FromHours(25), isActive: false);
        var controller = new IncidentsController(db);

        Assert.Empty(await GetAllItems(controller, isActive: false, isOverdueQsc: true));
    }

    [Fact]
    public async Task EveryListSite_FlagsExactlyTheIncidentsTheRuleCallsOverdue()
    {
        using var db = CreateDb();
        var reporterId = SeedUser(db).Id;
        var tripId = Guid.NewGuid();
        var shiftId = Guid.NewGuid();
        var cases = new[]
        {
            SeedIncident(db, reporterId, TimeSpan.FromHours(25), tripId: tripId, shiftId: shiftId),                                    // overdue
            SeedIncident(db, reporterId, TimeSpan.FromHours(1), tripId: tripId, shiftId: shiftId),                                     // inside the window
            SeedIncident(db, reporterId, TimeSpan.FromHours(30), reportedAt: DateTime.UtcNow.AddHours(-10), tripId: tripId, shiftId: shiftId), // already reported
            SeedIncident(db, reporterId, TimeSpan.FromHours(48), qsc: QscReportingStatus.NotRequired, tripId: tripId, shiftId: shiftId), // not QSC-required
            SeedIncident(db, reporterId, TimeSpan.FromHours(25), isActive: false, tripId: tripId, shiftId: shiftId),                   // inactive
        };
        var controller = new IncidentsController(db);
        var now = DateTime.UtcNow;

        static List<IncidentListDto> Items(ActionResult<ApiResponse<List<IncidentListDto>>> r) =>
            Assert.IsType<ApiResponse<List<IncidentListDto>>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;
        var active = await GetAllItems(controller);
        var inactive = await GetAllItems(controller, isActive: false);
        var byTrip = Items(await controller.GetByTrip(tripId, CancellationToken.None));
        var byShift = Items(await controller.GetByShift(shiftId, CancellationToken.None));
        var overdueList = Items(await controller.GetOverdueQsc(CancellationToken.None));

        foreach (var incident in cases)
        {
            var expected = QscReporting.IsOverdue(incident, now);
            var detail = Assert.IsType<ApiResponse<IncidentDetailDto>>(Assert.IsType<OkObjectResult>((await controller.GetById(incident.Id, CancellationToken.None)).Result).Value).Data!;
            var listed = (incident.IsActive ? active : inactive).Single(i => i.Id == incident.Id);
            string Why(string site) => $"{site}: {incident.Title} age={now - incident.CreatedAt} active={incident.IsActive} qsc={incident.QscReportingStatus} reported={incident.QscReportedAt != null}";

            Assert.True(expected == listed.IsOverdue24h, Why("GetAll"));
            Assert.True(expected == detail.IsOverdue24h, Why("GetById"));
            Assert.True(expected == (byTrip.SingleOrDefault(i => i.Id == incident.Id)?.IsOverdue24h ?? false), Why("GetByTrip"));
            Assert.True(expected == (byShift.SingleOrDefault(i => i.Id == incident.Id)?.IsOverdue24h ?? false), Why("GetByShift"));
            Assert.True(expected == overdueList.Any(i => i.Id == incident.Id), Why("GetOverdueQsc"));
        }
    }

    [Fact]
    public async Task CreateAndUpdate_ReturnTheItemTheListShows()
    {
        using var db = CreateDb();
        var reporter = SeedUser(db);
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        var controller = new IncidentsController(db);

        var created = Assert.IsType<ApiResponse<IncidentListDto>>(Assert.IsType<OkObjectResult>((await controller.Create(new CreateIncidentDto
        {
            ReportedByStaffId = reporter.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Low,
            InvolvedParticipantId = participant.Id, Title = "Broken window", Description = "What happened.",
            IncidentDateTime = new DateTime(2026, 8, 30, 10, 0, 0, DateTimeKind.Utc),
        }, CancellationToken.None)).Result).Value).Data!;

        Assert.Equal(Assert.Single(await GetAllItems(controller)), created);
        Assert.Equal("Sophie Brown", created.InvolvedParticipantName);

        var updated = Assert.IsType<ApiResponse<IncidentListDto>>(Assert.IsType<OkObjectResult>((await controller.Update(created.Id, new UpdateIncidentDto
        {
            ReportedByStaffId = reporter.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.High,
            InvolvedParticipantId = participant.Id, Title = "Broken window, replaced", Description = "What happened.",
            IncidentDateTime = new DateTime(2026, 8, 30, 10, 0, 0, DateTimeKind.Utc),
            Status = IncidentStatus.Submitted, QscReportingStatus = QscReportingStatus.Required,
        }, CancellationToken.None)).Result).Value).Data!;

        Assert.Equal(Assert.Single(await GetAllItems(controller)), updated);
        Assert.Equal("Broken window, replaced", updated.Title);
    }

    /// <summary>
    /// The InMemory provider quietly evaluates in memory what Npgsql cannot translate, so compile the shared
    /// projection to SQL on the real provider (no server needed): the list must select its columns (plus the
    /// four the overdue flag reads), not fetch whole rows to build the item on the client.
    /// </summary>
    [Fact]
    public void ListProjection_TranslatesOnNpgsql_SelectingColumnsNotWholeRows()
    {
        using var db = new OdipDbContext(
            new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql("Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x").Options,
            new ScopedTenantOverride { TenantId = Guid.NewGuid() });

        var sql = db.IncidentReports.Select(IncidentProjections.ToListDto(DateTime.UtcNow)).ToQueryString();

        Assert.True(sql.Contains("\"QscReportedAt\"", StringComparison.Ordinal), sql);
        Assert.False(sql.Contains("\"Description\"", StringComparison.Ordinal), "the list must select columns, not whole rows: " + sql);
    }
}
