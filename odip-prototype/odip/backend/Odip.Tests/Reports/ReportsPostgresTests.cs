using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Reports;

/// <summary>The three reports against a real PostgreSQL, where the LINQ must translate and the foreign keys are enforced. Skipped when no database is configured.</summary>
public class ReportsPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly DateOnly From = new(2026, 10, 19);
    private static readonly DateOnly To = new(2026, 11, 1);
    private readonly PostgresFixture _pg;
    public ReportsPostgresTests(PostgresFixture pg) => _pg = pg;

    private static ReportsController Controller(Odip.Infrastructure.Data.OdipDbContext db, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new ReportsController(db, tenant.Object);
    }

    private static List<T> Rows<T>(ActionResult<ApiResponse<List<T>>> r)
    {
        var o = Assert.IsType<OkObjectResult>(r.Result);
        return ((ApiResponse<List<T>>)o.Value!).Data!;
    }

    /// <summary>Seeds a participant, a worker, a Completed shift with an approved 8h completion, and an approved leave week for that worker.</summary>
    private static async Task SeedAsync(Odip.Infrastructure.Data.OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        var user = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = "Ben", LastName = "Turner", Role = UserRole.SupportWorker, IsActive = true,
        };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = user.Id, ServiceDate = From.AddDays(1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.Completed,
        };
        var start = new DateTime(2026, 10, 19, 23, 0, 0, DateTimeKind.Utc);
        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = start, ActualEnd = start.AddHours(8), TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = user.Id, StartedAt = start, ReviewOutcome = ReviewOutcome.Approved, IsActive = true,
        };
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = From.AddDays(3), EndDate = From.AddDays(5),
            Status = LeaveStatus.Approved, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        };
        db.AddRange(participant, user, shift, completion, leave);
        await db.SaveChangesAsync();
    }

    [SkippableFact]
    public async Task AllThreeReports_TranslateToSql_AndReturnTheSeededRows()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        await SeedAsync(db);
        var c = Controller(db, tenantId);

        var hours = Assert.Single(Rows(await c.HoursByWorker(From, To, CancellationToken.None)));
        Assert.Equal(("Ben Turner", 1, 8.00m), (hours.WorkerName, hours.ApprovedShifts, hours.ApprovedHours));

        var weeks = Rows(await c.ShiftFulfilment(From, To, CancellationToken.None));
        Assert.Equal(2, weeks.Count);
        Assert.Equal((1, 1), (weeks[0].Shifts, weeks[0].Filled));

        var leave = Assert.Single(Rows(await c.LeaveTaken(From, To, CancellationToken.None)));
        Assert.Equal(("Ben Turner", 3), (leave.WorkerName, leave.DaysInRange));
    }
}
