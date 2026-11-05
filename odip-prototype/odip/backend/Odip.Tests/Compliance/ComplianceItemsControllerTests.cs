using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Tasks;
using Xunit;

namespace Odip.Tests.Compliance;

/// <summary>Settings > Compliance dates: the list, add, change and delete of an organisation's dates, each tenant-scoped, with the Admin task kept in step in the same save. Who may call each is in <see cref="ComplianceItemsControllerRoleTests"/>.</summary>
public class ComplianceItemsControllerTests
{
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly Guid _otherTenantId = Guid.NewGuid();
    private readonly string _dbName = Guid.NewGuid().ToString();
    // 6 Nov 2026 01:30 in Sydney while it is still 5 Nov in UTC.
    private readonly TimeProvider _clock = new FixedClock(new DateTimeOffset(2026, 11, 5, 14, 30, 0, TimeSpan.Zero));
    private static readonly DateOnly Today = new(2026, 11, 6);

    private OdipDbContext Db(Guid? tenantId = null, bool superAdmin = true)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(t => t.TenantId).Returns(tenantId);
        tenant.SetupGet(t => t.IsSuperAdmin).Returns(superAdmin);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(_dbName).Options, tenant.Object);
    }

    // A SuperAdmin caller has no query filter, so the controller's own tenant checks are what these cases prove.
    private ComplianceItemsController Controller(Guid? tenantId, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(t => t.TenantId).Returns(tenantId);
        tenant.SetupGet(t => t.IsSuperAdmin).Returns(superAdmin);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, "Admin")], "test");
        return new ComplianceItemsController(Db(tenantId, superAdmin), tenant.Object, _clock)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    public ComplianceItemsControllerTests()
    {
        using var db = Db();
        foreach (var id in new[] { _tenantId, _otherTenantId }) db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = id, State = "NSW" });
        db.SaveChanges();
    }

    private ComplianceItem Seed(Guid tenantId, string label, DateOnly on, ComplianceKind kind = ComplianceKind.Registration)
    {
        using var db = Db();
        var row = new ComplianceItem { Id = Guid.NewGuid(), TenantId = tenantId, Kind = kind, Label = label, ExpiresOn = on };
        db.ComplianceItems.Add(row);
        db.SaveChanges();
        return row;
    }

    private static SaveComplianceItemDto Valid(DateOnly? on = null, string label = "NDIS registration") => new() { Kind = ComplianceKind.Registration, Label = label, ExpiresOn = on ?? Today.AddDays(200) };

    private static T Data<T>(IActionResult? result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result).Value).Data!;

    private static string Refusal<T>(ObjectResult result) => Assert.Single(Assert.IsType<ApiResponse<T>>(result.Value).Errors!);

    private List<BookingTask> Tasks()
    {
        using var db = Db();
        return db.BookingTasks.IgnoreQueryFilters().AsNoTracking().Where(t => t.TaskType == TaskType.ComplianceDue).ToList();
    }

    [Fact]
    public async Task GetAll_returns_only_this_tenants_dates_soonest_first_with_days_left_from_the_providers_today()
    {
        Seed(_tenantId, "Insurance", Today.AddDays(21), ComplianceKind.Insurance);
        Seed(_tenantId, "Registration", Today.AddDays(-3));
        Seed(_otherTenantId, "Other tenant's date", Today);

        var rows = Data<List<ComplianceItemDto>>((await Controller(_tenantId).GetAll(CancellationToken.None)).Result);

        Assert.Equal(["Registration", "Insurance"], rows.Select(r => r.Label));
        Assert.Equal([-3, 21], rows.Select(r => r.DaysLeft)); // today is the 6th in Sydney, though it is the 5th in UTC
    }

    [Fact]
    public async Task A_superadmin_with_an_organisation_still_sees_only_that_organisation()
    {
        Seed(_tenantId, "Mine", Today.AddDays(5));
        Seed(_otherTenantId, "Theirs", Today.AddDays(5));

        var rows = Data<List<ComplianceItemDto>>((await Controller(_tenantId, superAdmin: true).GetAll(CancellationToken.None)).Result);

        Assert.Equal(["Mine"], rows.Select(r => r.Label));
    }

    [Fact]
    public async Task Another_tenants_date_cannot_be_changed_or_deleted_and_stays_as_it_was()
    {
        var theirs = Seed(_otherTenantId, "Theirs", Today.AddDays(50));

        Assert.IsType<NotFoundObjectResult>((await Controller(_tenantId).Update(theirs.Id, Valid(label: "Hijacked"), CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await Controller(_tenantId).Delete(theirs.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await Controller(_tenantId, superAdmin: true).Delete(theirs.Id, CancellationToken.None)).Result);

        using var db = Db();
        var after = await db.ComplianceItems.IgnoreQueryFilters().SingleAsync(i => i.Id == theirs.Id);
        Assert.Equal(("Theirs", Today.AddDays(50), _otherTenantId), (after.Label, after.ExpiresOn, after.TenantId));
        Assert.Empty(Tasks());
    }

    [Fact]
    public async Task Without_an_organisation_every_call_is_refused()
    {
        var c = Controller(null, superAdmin: true);
        Assert.IsType<BadRequestObjectResult>((await c.GetAll(CancellationToken.None)).Result);
        Assert.IsType<BadRequestObjectResult>((await c.Create(Valid(), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Create_refuses_a_blank_name_or_an_unknown_kind_and_writes_nothing()
    {
        var c = Controller(_tenantId);
        Assert.Equal("Enter a name.", Refusal<ComplianceItemDto>(Assert.IsType<BadRequestObjectResult>((await c.Create(Valid(label: "   "), CancellationToken.None)).Result)));
        Assert.Equal("Choose a kind.", Refusal<ComplianceItemDto>(Assert.IsType<BadRequestObjectResult>((await c.Create(Valid() with { Kind = (ComplianceKind)99 }, CancellationToken.None)).Result)));
        using var db = Db();
        Assert.Equal(0, await db.ComplianceItems.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task Create_refuses_a_year_outside_2000_to_2100_and_over_long_fields_with_the_screens_sentences()
    {
        var c = Controller(_tenantId);
        Assert.Equal("Use a date between 2000 and 2100.", Refusal<ComplianceItemDto>(Assert.IsType<BadRequestObjectResult>((await c.Create(Valid(new DateOnly(1999, 12, 31)), CancellationToken.None)).Result)));
        Assert.Equal("Use a date between 2000 and 2100.", Refusal<ComplianceItemDto>(Assert.IsType<BadRequestObjectResult>((await c.Create(Valid(new DateOnly(2101, 1, 1)), CancellationToken.None)).Result)));
        Assert.Equal("Use 120 characters or fewer for the name.", Refusal<ComplianceItemDto>(Assert.IsType<BadRequestObjectResult>((await c.Create(Valid(label: new string('a', 121)), CancellationToken.None)).Result)));
        Assert.Equal("Use 100 characters or fewer for the reference.", Refusal<ComplianceItemDto>(Assert.IsType<BadRequestObjectResult>((await c.Create(Valid() with { Reference = new string('r', 101) }, CancellationToken.None)).Result)));
        Assert.Equal("Use 1000 characters or fewer for the notes.", Refusal<ComplianceItemDto>(Assert.IsType<BadRequestObjectResult>((await c.Create(Valid() with { Notes = new string('n', 1001) }, CancellationToken.None)).Result)));
    }

    [Fact]
    public async Task Create_trims_stores_blank_optional_fields_as_null_and_a_date_past_90_days_opens_no_task()
    {
        var dto = Valid(label: "  NDIS registration  ") with { Reference = "   ", Notes = "" };

        var saved = Data<ComplianceItemDto>((await Controller(_tenantId).Create(dto, CancellationToken.None)).Result);

        Assert.Equal(("NDIS registration", null, null, 200), (saved.Label, saved.Reference, saved.Notes, saved.DaysLeft));
        Assert.Empty(Tasks());
    }

    [Fact]
    public async Task Create_of_a_date_10_days_out_opens_the_admin_task_in_the_same_request()
    {
        var saved = Data<ComplianceItemDto>((await Controller(_tenantId).Create(Valid(Today.AddDays(10), "Public liability insurance"), CancellationToken.None)).Result);

        var task = Assert.Single(Tasks());
        Assert.Equal(("Public liability insurance expires within 30 days, on 16 Nov 2026", Today.AddDays(10), ComplianceDueTasks.LinkTo, _tenantId),
            (task.Title, task.DueDate, task.LinkTo, task.TenantId));
        Assert.Equal(ComplianceDueTasks.SourceKey(saved.Id, Today.AddDays(10)), task.SourceKey);
    }

    [Fact]
    public async Task Update_that_moves_the_date_completes_the_old_dates_task_and_opens_the_new_ones()
    {
        var created = Data<ComplianceItemDto>((await Controller(_tenantId).Create(Valid(Today.AddDays(40)), CancellationToken.None)).Result);

        Data<ComplianceItemDto>((await Controller(_tenantId).Update(created.Id, Valid(Today.AddDays(60)), CancellationToken.None)).Result);

        var tasks = Tasks();
        Assert.Equal(TaskItemStatus.Completed, Assert.Single(tasks, t => t.DueDate == Today.AddDays(40)).Status);
        Assert.Equal(TaskItemStatus.NotStarted, Assert.Single(tasks, t => t.DueDate == Today.AddDays(60)).Status);
    }

    [Fact]
    public async Task Update_that_moves_the_date_past_90_days_only_completes_the_old_task()
    {
        var created = Data<ComplianceItemDto>((await Controller(_tenantId).Create(Valid(Today.AddDays(40)), CancellationToken.None)).Result);

        Data<ComplianceItemDto>((await Controller(_tenantId).Update(created.Id, Valid(Today.AddDays(400)), CancellationToken.None)).Result);

        Assert.Equal(TaskItemStatus.Completed, Assert.Single(Tasks()).Status);
    }

    [Fact]
    public async Task Update_that_keeps_the_date_retitles_the_open_task_in_place()
    {
        var created = Data<ComplianceItemDto>((await Controller(_tenantId).Create(Valid(Today.AddDays(40), "Old name"), CancellationToken.None)).Result);

        Data<ComplianceItemDto>((await Controller(_tenantId).Update(created.Id, Valid(Today.AddDays(40), "New name"), CancellationToken.None)).Result);

        var task = Assert.Single(Tasks());
        Assert.Equal("New name expires on 16 Dec 2026", task.Title);
        Assert.Equal(TaskItemStatus.NotStarted, task.Status);
    }

    [Fact]
    public async Task Delete_removes_the_row_and_completes_its_task()
    {
        var created = Data<ComplianceItemDto>((await Controller(_tenantId).Create(Valid(Today.AddDays(40)), CancellationToken.None)).Result);

        Assert.IsType<OkObjectResult>((await Controller(_tenantId).Delete(created.Id, CancellationToken.None)).Result);

        using var db = Db();
        Assert.Equal(0, await db.ComplianceItems.IgnoreQueryFilters().CountAsync());
        Assert.Equal(TaskItemStatus.Completed, Assert.Single(Tasks()).Status);
    }
}
