using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Imports;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The approval hold: a shift finished "details later" cannot be approved - singly, in a batch or by the dashboard's clean-only batch - while
/// its missing list is non-empty. A shift finished the usual way is untouched.
/// </summary>
public class CompletionApproveDetailsHoldTests
{
    private static readonly Guid Tenant = Guid.NewGuid();

    private static OdipDbContext Db() =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, ImportTestSupport.Tenant(Tenant));

    private static RosteringController Controller(OdipDbContext db) => new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), null)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test")) },
        },
    };

    /// <summary>A PendingReview shift. With <paramref name="detailsRequired"/> it was finished "details later" and has nothing filled in: all six are missing.</summary>
    private static async Task<Shift> PendingAsync(OdipDbContext db, bool detailsRequired)
    {
        var staff = new User { Id = Guid.NewGuid(), TenantId = Tenant, FirstName = "Ben", LastName = "Turner", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true };
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = Tenant, FirstName = "Amy", LastName = "Ng", IsActive = true };
        var day = new DateOnly(2026, 10, 14);
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.PendingReview,
        };
        var start = day.ToDateTime(new TimeOnly(9, 0)).AddHours(-11);
        db.AddRange(staff, participant, shift, new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = Tenant, ShiftId = shift.Id, ActualStart = start, ActualEnd = start.AddHours(6), TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = staff.Id, StartedAt = start, SubmittedAt = start.AddHours(6), IsActive = true, DetailsRequired = detailsRequired,
        });
        await db.SaveChangesAsync();
        return shift;
    }

    [Fact]
    public async Task Single_approve_is_409_details_missing_and_changes_nothing()
    {
        using var db = Db();
        var shift = await PendingAsync(db, detailsRequired: true);

        var result = await Controller(db).ApproveCompletion(shift.Id, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(ShiftErrorCodes.ShiftDetailsMissing, Assert.IsType<ApiResponse<ShiftCompletionDto>>(conflict.Value).Code);
        Assert.Equal(ShiftStatus.PendingReview, (await db.Shifts.SingleAsync()).Status);
        Assert.Null((await db.ShiftCompletions.SingleAsync()).ReviewedAt);
    }

    [Fact]
    public async Task Single_approve_of_a_shift_finished_the_usual_way_still_works()
    {
        using var db = Db();
        var shift = await PendingAsync(db, detailsRequired: false);

        var result = await Controller(db).ApproveCompletion(shift.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(ShiftStatus.Completed, (await db.Shifts.SingleAsync()).Status);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Batch_approve_leaves_out_a_needs_details_shift_with_or_without_clean_only_and_approves_the_rest(bool cleanOnly)
    {
        using var db = Db();
        var held = await PendingAsync(db, detailsRequired: true);
        var clean = await PendingAsync(db, detailsRequired: false);

        var result = await Controller(db).ApproveBatch(new ApproveBatchDto([held.Id, clean.Id], cleanOnly), CancellationToken.None);

        var results = Assert.IsType<ApiResponse<List<ApproveBatchResultDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var heldResult = results.Single(r => r.ShiftId == held.Id);
        Assert.False(heldResult.Approved);
        Assert.Equal(ShiftErrorCodes.ShiftDetailsMissing, heldResult.Code);
        Assert.True(results.Single(r => r.ShiftId == clean.Id).Approved);
        Assert.Equal(ShiftStatus.PendingReview, (await db.Shifts.SingleAsync(s => s.Id == held.Id)).Status);
        Assert.Equal(ShiftStatus.Completed, (await db.Shifts.SingleAsync(s => s.Id == clean.Id)).Status);
    }

    [Fact]
    public async Task Single_approve_with_require_clean_is_also_held()
    {
        using var db = Db();
        var shift = await PendingAsync(db, detailsRequired: true);

        var result = await Controller(db).ApproveCompletion(shift.Id, CancellationToken.None, requireClean: true);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(ShiftErrorCodes.ShiftDetailsMissing, Assert.IsType<ApiResponse<ShiftCompletionDto>>(conflict.Value).Code);
    }

    [Fact]
    public async Task The_queue_item_carries_the_missing_list()
    {
        using var db = Db();
        var held = await PendingAsync(db, detailsRequired: true);
        var clean = await PendingAsync(db, detailsRequired: false);

        var items = await ShiftCompletionMapper_QueueAsync(db);

        Assert.Equal(["kilometres", "tripTo", "tripAfter", "notes", "handover", "report"], items.Single(i => i.ShiftId == held.Id).MissingDetails);
        Assert.Empty(items.Single(i => i.ShiftId == clean.Id).MissingDetails);
    }

    private static Task<List<CompletionQueueItemDto>> ShiftCompletionMapper_QueueAsync(OdipDbContext db) =>
        Odip.Api.Rostering.ShiftCompletionMapper.BuildQueueItemsAsync(db, db.Shifts, CancellationToken.None);
}
