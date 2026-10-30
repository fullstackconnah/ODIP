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
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>The screening (clearance) number is read by managers and the person themselves only; everyone else sees whether one is on file.</summary>
public class StaffScreeningPrivacyTests
{
    private const string Number = "WWCC1234567";

    private static async Task<(OdipDbContext Db, Guid WorkerId, Guid OtherId)> SeedAsync()
    {
        var db = TestDb.ForTenant(Guid.NewGuid().ToString(), Guid.NewGuid());
        var worker = new User { FirstName = "Wendy", LastName = "Worker", Email = "wendy@example.com", Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = Number, WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1) };
        var other = new User { FirstName = "Sam", LastName = "Other", Email = "sam@example.com", Position = Position.SupportWorker, IsActive = true };
        db.Users.AddRange(worker, other);
        await db.SaveChangesAsync();
        return (db, worker.Id, other.Id);
    }

    private static StaffController As(OdipDbContext db, string role, Guid? userId = null)
    {
        var identity = new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, role), new Claim(ClaimTypes.NameIdentifier, (userId ?? Guid.NewGuid()).ToString()) }, "test");
        return new StaffController(db) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } } };
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Coordinator")]
    [InlineData("SuperAdmin")]
    public async Task ManagersSeeTheNumber_OnListAndDetail(string role)
    {
        var (db, workerId, _) = await SeedAsync();
        var c = As(db, role);

        var list = Assert.IsType<ApiResponse<List<StaffListDto>>>(Assert.IsType<OkObjectResult>((await c.GetAll(null, default)).Result).Value).Data!;
        var detail = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await c.GetById(workerId, default)).Result).Value).Data!;

        Assert.Equal(Number, list.Single(s => s.Id == workerId).WorkerScreeningNumber);
        Assert.Equal(Number, detail.WorkerScreeningNumber);
        Assert.True(detail.WorkerScreeningRecorded);
    }

    [Fact]
    public async Task ThePersonThemselves_SeeTheirOwnNumber_ButNotAColleaguesAsASupportWorker()
    {
        var (db, workerId, otherId) = await SeedAsync();

        var own = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await As(db, "SupportWorker", workerId).GetById(workerId, default)).Result).Value).Data!;
        var colleague = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await As(db, "SupportWorker", otherId).GetById(workerId, default)).Result).Value).Data!;

        Assert.Equal(Number, own.WorkerScreeningNumber);
        Assert.Null(colleague.WorkerScreeningNumber);
        Assert.True(colleague.WorkerScreeningRecorded);
        Assert.Equal(new DateOnly(2030, 1, 1), colleague.WorkerScreeningExpiryDate);
    }

    [Theory]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public async Task OthersGetNullPlusRecorded_OnListAndDetail(string role)
    {
        var (db, workerId, otherId) = await SeedAsync();
        var c = As(db, role);

        var list = Assert.IsType<ApiResponse<List<StaffListDto>>>(Assert.IsType<OkObjectResult>((await c.GetAll(null, default)).Result).Value).Data!;
        var detail = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await c.GetById(workerId, default)).Result).Value).Data!;

        var row = list.Single(s => s.Id == workerId);
        Assert.Null(row.WorkerScreeningNumber);
        Assert.True(row.WorkerScreeningRecorded);
        Assert.Null(detail.WorkerScreeningNumber);
        Assert.True(detail.WorkerScreeningRecorded);
        Assert.False(list.Single(s => s.Id == otherId).WorkerScreeningRecorded);
    }

    [Fact]
    public async Task AnUpdateFromACallerWhoCannotSeeTheNumber_KeepsTheStoredOne()
    {
        var (db, workerId, _) = await SeedAsync();

        await As(db, "SupportWorker").Update(workerId, new UpdateStaffDto
        {
            FirstName = "Wendy", LastName = "Worker", Email = "wendy@example.com", Position = Position.SupportWorker, IsActive = true,
            WorkerScreeningNumber = null, WorkerScreeningExpiryDate = new DateOnly(2031, 1, 1),
        }, default);

        var saved = await db.Users.SingleAsync(u => u.Id == workerId);
        Assert.Equal(Number, saved.WorkerScreeningNumber);
    }
}
