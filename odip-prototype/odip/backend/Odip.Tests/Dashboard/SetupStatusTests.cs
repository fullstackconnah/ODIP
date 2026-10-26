using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Funding;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Tests.Integrations;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Dashboard;

/// <summary>The Get set up card's facts: every count holds only the caller's organisation, and "first week published" means a shift that has left Draft.</summary>
public class SetupStatusTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static ICurrentTenant Caller(Guid? tenantId, bool isSuperAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(isSuperAdmin);
        return tenant.Object;
    }

    private static async Task<SetupStatusDto> Get(OdipDbContext db, bool keyConfigured = false)
    {
        var keys = IntegrationKeyProtectorTests.Protector(keyConfigured ? IntegrationKeyProtectorTests.NewMasterKey() : null);
        var result = await new DashboardController(db).GetSetup(Caller(A), keys, Ct);
        return Assert.IsType<ApiResponse<SetupStatusDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    private static void AddShift(OdipDbContext db, Guid tenant, string date, ShiftStatus status)
    {
        db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = Guid.NewGuid(), ServiceDate = DateOnly.Parse(date), Status = status });
        db.SaveChanges();
    }

    private static void PlanFor(OdipDbContext db, Guid tenant, Participant p)
    {
        db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = p.Id, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30) });
        db.SaveChanges();
    }

    private static void AddInvoice(OdipDbContext db, Guid tenant, InvoiceStatus status = InvoiceStatus.Issued)
    {
        db.Invoices.Add(new Invoice { Id = Guid.NewGuid(), TenantId = tenant, Number = 1, DisplayNumber = "INV-0001", Status = status, IssueDate = new DateOnly(2026, 10, 20) });
        db.SaveChanges();
    }

    private static void Plant(OdipDbContext db, Guid tenant)
    {
        User(db, tenant);
        PlanFor(db, tenant, Participant(db, tenant));
        AddShift(db, tenant, "2026-11-04", ShiftStatus.Published);
        AddInvoice(db, tenant);
    }

    [Fact]
    public async Task Setup_CountsOnlyCallersOrganisation()
    {
        var db = Db(A);
        Plant(db, B);
        var none = await Get(db);
        Assert.Equal((0, 0, 0, (DateOnly?)null, false), (none.StaffCount, none.ParticipantCount, none.ParticipantsWithPlanCount, none.FirstPublishedWeekStart, none.HasInvoice));

        Plant(db, A);
        var mine = await Get(db);
        Assert.Equal((1, 1, 1, (DateOnly?)new DateOnly(2026, 11, 2), true), (mine.StaffCount, mine.ParticipantCount, mine.ParticipantsWithPlanCount, mine.FirstPublishedWeekStart, mine.HasInvoice));
    }

    [Fact]
    public async Task Setup_DraftShiftIsNotFinishLine()
    {
        var db = Db(A);
        AddShift(db, A, "2026-11-04", ShiftStatus.Draft);
        Assert.Null((await Get(db)).FirstPublishedWeekStart);
        db.Shifts.Single().Status = ShiftStatus.Published;
        db.SaveChanges();
        Assert.Equal(new DateOnly(2026, 11, 2), (await Get(db)).FirstPublishedWeekStart);
    }

    [Fact]
    public async Task Setup_CompletedShiftIsFinishLine()
    {
        var db = Db(A);
        AddShift(db, A, "2026-11-04", ShiftStatus.Completed);
        Assert.Equal(new DateOnly(2026, 11, 2), (await Get(db)).FirstPublishedWeekStart);
    }

    [Fact]
    public async Task Setup_InProgressAndPendingReviewAreFinishLine()
    {
        var db = Db(A);
        AddShift(db, A, "2026-11-11", ShiftStatus.InProgress);
        AddShift(db, A, "2026-11-18", ShiftStatus.PendingReview);
        Assert.Equal(new DateOnly(2026, 11, 9), (await Get(db)).FirstPublishedWeekStart);
    }

    [Fact]
    public async Task Setup_CancelledOnlyIsNotFinishLine()
    {
        var db = Db(A);
        AddShift(db, A, "2026-11-04", ShiftStatus.Cancelled);
        Assert.Null((await Get(db)).FirstPublishedWeekStart);
    }

    [Fact]
    public async Task Setup_FirstPublishedWeekIsTheEarliestPublishedShift()
    {
        var db = Db(A);
        AddShift(db, A, "2026-11-18", ShiftStatus.Published);
        AddShift(db, A, "2026-11-04", ShiftStatus.Completed);
        AddShift(db, A, "2026-10-28", ShiftStatus.Draft);
        AddShift(db, A, "2026-10-21", ShiftStatus.Cancelled);
        Assert.Equal(new DateOnly(2026, 11, 2), (await Get(db)).FirstPublishedWeekStart);
    }

    [Fact]
    public async Task Setup_AdminsDoNotCountAsStaff()
    {
        var db = Db(A);
        var admin = User(db, A);
        admin.Role = UserRole.Admin;
        var inactive = User(db, A);
        inactive.IsActive = false;
        db.SaveChanges();
        Assert.Equal(0, (await Get(db)).StaffCount);

        User(db, A).Role = UserRole.Coordinator;
        db.SaveChanges();
        Assert.Equal(1, (await Get(db)).StaffCount);
    }

    [Fact]
    public async Task Setup_DraftParticipantsCount()
    {
        var db = Db(A);
        Participant(db, A).IsDraft = true;
        db.SaveChanges();
        Assert.Equal(1, (await Get(db)).ParticipantCount);
    }

    [Fact]
    public async Task Setup_PlansOfArchivedParticipantsDoNotCount()
    {
        var db = Db(A);
        PlanFor(db, A, Participant(db, A));
        var archived = Participant(db, A);
        PlanFor(db, A, archived);
        archived.IsActive = false;
        db.SaveChanges();
        var status = await Get(db);
        Assert.Equal((1, 1), (status.ParticipantCount, status.ParticipantsWithPlanCount));
    }

    [Fact]
    public void Setup_RefusesCoordinatorAndReadOnly()
    {
        var authorize = typeof(DashboardController).GetMethod(nameof(DashboardController.GetSetup))!.GetCustomAttribute<AuthorizeAttribute>()!;
        Assert.Equal("Admin,SuperAdmin", authorize.Roles);
    }

    [Fact]
    public async Task Setup_SuperAdminWithoutOrganisationIsRefused()
    {
        var keys = IntegrationKeyProtectorTests.Protector(null);
        var result = await new DashboardController(Db(A)).GetSetup(Caller(null, isSuperAdmin: true), keys, Ct);
        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains(DashboardController.ChooseOrganisation, Assert.IsType<ApiResponse<SetupStatusDto>>(bad.Value).Errors!);
    }

    // The token's own tenant_id with no view-as header: CurrentTenant keeps IsSuperAdmin = true, so every query filter is bypassed. The tenant half of the guard is not enough.
    [Fact]
    public async Task Setup_SuperAdminWithTheirOwnTenantAndNoViewAsIsRefused()
    {
        var keys = IntegrationKeyProtectorTests.Protector(null);
        var result = await new DashboardController(Db(A)).GetSetup(Caller(A, isSuperAdmin: true), keys, Ct);
        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains(DashboardController.ChooseOrganisation, Assert.IsType<ApiResponse<SetupStatusDto>>(bad.Value).Errors!);
    }

    [Fact]
    public async Task Setup_VoidedInvoiceDoesNotCountAsFirstInvoice()
    {
        var db = Db(A);
        AddInvoice(db, A, InvoiceStatus.Voided);
        Assert.False((await Get(db)).HasInvoice);
        AddInvoice(db, A, InvoiceStatus.Credited);
        Assert.True((await Get(db)).HasInvoice);
    }

    [Fact]
    public async Task Setup_EmploymentHeroAvailableFollowsServerKey()
    {
        var db = Db(A);
        Assert.True((await Get(db, keyConfigured: true)).EmploymentHeroAvailable);
        Assert.False((await Get(db, keyConfigured: false)).EmploymentHeroAvailable);
    }
}
