using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Imports;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>Approving a shift queues its timesheet in the same save, only for a connected organisation and only from the day it connected.</summary>
public class EmploymentHeroEnqueueTests
{
    private static readonly Guid Tenant = Guid.NewGuid();

    /// <summary>Records what each save carried, so a test can see the approval and the outbox row travel together.</summary>
    private sealed class SaveRecorder : SaveChangesInterceptor
    {
        public List<(int Shifts, int Rows)> Saves { get; } = [];

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            var entries = eventData.Context!.ChangeTracker.Entries().Where(e => e.State is EntityState.Added or EntityState.Modified).ToList();
            Saves.Add((entries.Count(e => e.Entity is Shift), entries.Count(e => e.Entity is EmploymentHeroOutbox && e.State == EntityState.Added)));
            return base.SavingChangesAsync(eventData, result, ct);
        }
    }

    private static OdipDbContext Db(string name, Guid tenantId, SaveRecorder? recorder = null)
    {
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).AddInterceptors(new AuditInterceptor(new HttpContextAccessor()));
        if (recorder is not null) options.AddInterceptors(recorder);
        return new OdipDbContext(options.Options, ImportTestSupport.Tenant(tenantId));
    }

    private static RosteringController Controller(OdipDbContext db) => new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), null)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test")) },
        },
    };

    /// <summary>A shift in PendingReview with an active completion, on the given day, in the organisation.</summary>
    private static async Task<Shift> PendingAsync(OdipDbContext db, Guid tenantId, DateOnly day)
    {
        var staff = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Turner", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true, ExternalPayrollId = "42" };
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Amy", LastName = "Ng", IsActive = true };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.PendingReview,
        };
        var start = day.ToDateTime(new TimeOnly(9, 0)).AddHours(-11);
        db.AddRange(staff, participant, shift, new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ShiftId = shift.Id, ActualStart = start, ActualEnd = start.AddHours(6), TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = staff.Id, StartedAt = start, SubmittedAt = start.AddHours(6), IsActive = true,
        });
        await db.SaveChangesAsync();
        return shift;
    }

    private static Task<List<EmploymentHeroOutbox>> RowsAsync(OdipDbContext db) => db.EmploymentHeroOutbox.IgnoreQueryFilters().ToListAsync();

    [Fact]
    public async Task Approving_one_shift_queues_its_timesheet_in_the_same_save()
    {
        var name = Guid.NewGuid().ToString();
        var recorder = new SaveRecorder();
        using var db = Db(name, Tenant, recorder);
        await EhFixture.ConnectAsync(db, Tenant);
        var shift = await PendingAsync(db, Tenant, new DateOnly(2026, 10, 14));
        var completionId = (await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id)).Id;
        recorder.Saves.Clear();

        var result = await Controller(db).ApproveCompletion(shift.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal([(1, 1)], recorder.Saves);   // one save, carrying the approval and the row
        var row = Assert.Single(await RowsAsync(db));
        Assert.Equal((Tenant, EmploymentHeroOutboxKind.Timesheet, completionId, EmploymentHeroOutboxStatus.Pending), (row.TenantId, row.Kind, row.EntityId, row.Status));
        Assert.Equal(0, row.Attempts);
        Assert.Null(row.ExternalId);
    }

    [Fact]
    public async Task Approving_a_batch_queues_only_the_shifts_that_were_approved()
    {
        using var db = Db(Guid.NewGuid().ToString(), Tenant);
        await EhFixture.ConnectAsync(db, Tenant);
        var a = await PendingAsync(db, Tenant, new DateOnly(2026, 10, 14));
        var b = await PendingAsync(db, Tenant, new DateOnly(2026, 10, 14));
        var notPending = await PendingAsync(db, Tenant, new DateOnly(2026, 10, 14));
        notPending.Status = ShiftStatus.Published;
        await db.SaveChangesAsync();
        var dto = new ApproveBatchDto([a.Id, b.Id, notPending.Id]);

        await Controller(db).ApproveBatch(dto, CancellationToken.None);
        await Controller(db).ApproveBatch(dto, CancellationToken.None);   // repeating adds none

        Assert.Equal(2, (await RowsAsync(db)).Count);
    }

    [Fact]
    public async Task Nothing_is_queued_for_an_organisation_that_is_not_connected_or_for_shifts_before_it_connected()
    {
        using var unconnected = Db(Guid.NewGuid().ToString(), Tenant);
        var shift = await PendingAsync(unconnected, Tenant, new DateOnly(2026, 10, 14));
        await Controller(unconnected).ApproveCompletion(shift.Id, CancellationToken.None);
        Assert.Empty(await RowsAsync(unconnected));

        using var db = Db(Guid.NewGuid().ToString(), Tenant);
        await EhFixture.ConnectAsync(db, Tenant);   // connected 2026-10-13T00:00Z = 13 Oct in Sydney
        var before = await PendingAsync(db, Tenant, new DateOnly(2026, 10, 12));
        var onTheDay = await PendingAsync(db, Tenant, new DateOnly(2026, 10, 13));

        await Controller(db).ApproveCompletion(before.Id, CancellationToken.None);
        Assert.Empty(await RowsAsync(db));
        await Controller(db).ApproveCompletion(onTheDay.Id, CancellationToken.None);
        Assert.Single(await RowsAsync(db));
    }

    [Fact]
    public async Task Another_organisations_connection_does_not_queue_this_one()
    {
        var name = Guid.NewGuid().ToString();
        var other = Guid.NewGuid();
        using (var otherDb = Db(name, other)) await EhFixture.ConnectAsync(otherDb, other);
        using var db = Db(name, Tenant);
        var shift = await PendingAsync(db, Tenant, new DateOnly(2026, 10, 14));

        await Controller(db).ApproveCompletion(shift.Id, CancellationToken.None);

        Assert.Empty(await RowsAsync(db));
    }
}
