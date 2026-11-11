using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// A pattern's Regular worker cannot be one marked No for its participant (polish batch 86, H90-N2): create, and an update that changes the worker or participant, refuse it and save nothing.
/// An update that keeps the stored pair still saves, because the No may have been set after the pattern was.
/// </summary>
public class RosteringPatternRegularNoTests
{
    private static RosteringController Controller(Odip.Infrastructure.Data.OdipDbContext db) => new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    private static async Task<(Fixture F, ShiftPattern Monday, Guid Staff)> RigAsync(CompatibilityLevel? level)
    {
        var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, CancellationToken.None);
        var monday = await f.Db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.SourceDraftId == draft.Id && p.DayOfWeek == DayOfWeek.Monday);
        var staff = Guid.NewGuid();
        f.Db.Users.Add(new User { Id = staff, TenantId = TenantA, FirstName = "Ben", LastName = "Turner", Username = "ben", Email = "ben@example.com", Role = UserRole.SupportWorker, IsActive = true });
        if (level is { } l)
            f.Db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility { Id = Guid.NewGuid(), TenantId = TenantA, UserId = staff, ParticipantId = f.ParticipantId, Level = l });
        await f.Db.SaveChangesAsync();
        return (f, monday, staff);
    }

    private static CreateShiftPatternDto NewPattern(ShiftPattern monday, Guid? staff) => new()
    {
        ParticipantId = monday.ParticipantId, DefaultStaffId = staff, DayOfWeek = DayOfWeek.Saturday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = monday.Ratio,
        NightType = monday.NightType, EffectiveFrom = monday.EffectiveFrom,
    };

    private static UpdateShiftPatternDto Edit(ShiftPattern p) => new()
    {
        ParticipantId = p.ParticipantId, DefaultStaffId = p.DefaultUserId, DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, EndsNextDay = p.EndsNextDay,
        Ratio = p.Ratio, NightType = p.NightType, EffectiveFrom = p.EffectiveFrom, EffectiveTo = p.EffectiveTo, IsActive = p.IsActive, Notes = p.Notes,
    };

    private static string Said<T>(ActionResult<ApiResponse<T>> result) => Assert.Single(Assert.IsType<ApiResponse<T>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors!);

    private static async Task<string> SentenceAsync(Fixture f, Guid staff)
    {
        var person = await f.Db.Participants.AsNoTracking().SingleAsync(p => p.Id == f.ParticipantId);
        return $"Ben Turner is marked No for {person.FullName}, so they can't be this pattern's Regular worker.";
    }

    [Fact]
    public async Task CreatePattern_WithAWorkerMarkedNo_Is400_AndSavesNothing()
    {
        var (f, monday, staff) = await RigAsync(CompatibilityLevel.Excluded);
        await using var _ = f;
        await using var db = NewDb(f.DbName);
        var before = await db.ShiftPatterns.CountAsync();

        var result = await Controller(db).CreatePattern(NewPattern(monday, staff), CancellationToken.None);

        Assert.Equal(await SentenceAsync(f, staff), Said(result));
        Assert.Equal(before, await db.ShiftPatterns.CountAsync());
    }

    [Fact]
    public async Task CreatePattern_WithABackupWorker_Saves()
    {
        var (f, monday, staff) = await RigAsync(CompatibilityLevel.Backup);
        await using var _ = f;
        await using var db = NewDb(f.DbName);

        Assert.IsType<CreatedAtActionResult>((await Controller(db).CreatePattern(NewPattern(monday, staff), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task UpdatePattern_ChangingTheRegularToAWorkerMarkedNo_Is400_AndLeavesTheRowAlone()
    {
        var (f, monday, staff) = await RigAsync(CompatibilityLevel.Excluded);
        await using var _ = f;
        await using var db = NewDb(f.DbName);

        var result = await Controller(db).UpdatePattern(monday.Id, Edit(monday) with { DefaultStaffId = staff }, CancellationToken.None);

        Assert.Equal(await SentenceAsync(f, staff), Said(result));
        Assert.Null((await db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.Id == monday.Id)).DefaultUserId);
    }

    [Fact]
    public async Task UpdatePattern_KeepingAStoredRegularNowMarkedNo_StillSavesTheOtherFields()
    {
        var (f, monday, staff) = await RigAsync(level: null);
        await using var _ = f;
        await using var db = NewDb(f.DbName);
        var ok = await Controller(db).UpdatePattern(monday.Id, Edit(monday) with { DefaultStaffId = staff }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(ok.Result);
        // The No is set after the pattern was saved with this worker.
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility { Id = Guid.NewGuid(), TenantId = TenantA, UserId = staff, ParticipantId = f.ParticipantId, Level = CompatibilityLevel.Excluded });
        await db.SaveChangesAsync();
        var stored = await db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.Id == monday.Id);

        var result = await Controller(db).UpdatePattern(monday.Id, Edit(stored) with { Notes = "Mornings only" }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ShiftPatternDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal((staff, "Mornings only"), ((Guid)body.Data!.DefaultStaffId!, body.Data.Notes));
    }
}
