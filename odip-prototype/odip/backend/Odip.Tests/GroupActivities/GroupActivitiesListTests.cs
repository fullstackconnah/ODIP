using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>The group activities list (GET api/v1/rostering/group-activities): tenant-scoped, switch-gated, paged in SQL order, Cancelled only when asked for or when no status is given.</summary>
public class GroupActivitiesListTests
{
    private static readonly DateOnly From = GroupActivityFixture.Day, To = GroupActivityFixture.Day.AddDays(6);

    private static async Task<(int Status, ApiResponse<PagedResult<GroupActivityDto>> Body)> List(GroupActivitiesController c, DateOnly? from = null, DateOnly? to = null,
        ShiftStatus? status = null, int page = 1, int pageSize = 25)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>((await c.List(from ?? From, to ?? To, status, page, pageSize, default)).Result);
        return (obj.StatusCode ?? 200, Assert.IsType<ApiResponse<PagedResult<GroupActivityDto>>>(obj.Value));
    }

    [Fact]
    public async Task List_NeverShowsAnotherTenantsActivity()
    {
        var fx = new GroupActivityFixture();
        var mine = fx.AddActivity();
        fx.Seed.GroupActivities.Add(new GroupActivity
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ServiceDate = GroupActivityFixture.Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(10, 0), Title = "Theirs",
        });
        fx.Seed.SaveChanges();
        var (status, body) = await List(fx.Controller());
        Assert.Equal(200, status);
        Assert.Equal(mine.Id, Assert.Single(body.Data!.Items).Id);
        Assert.Equal(1, body.Data.TotalCount);
    }

    [Fact]
    public async Task List_RangeBoundsAreInclusive_AndOrderIsDateThenStart()
    {
        var fx = new GroupActivityFixture();
        var before = fx.AddActivity(day: From.AddDays(-1));
        var last = fx.AddActivity(day: To);
        var first = fx.AddActivity(day: From);
        var after = fx.AddActivity(day: To.AddDays(1));
        var (_, body) = await List(fx.Controller());
        Assert.Equal([first.Id, last.Id], body.Data!.Items.Select(i => i.Id));
        Assert.DoesNotContain(body.Data.Items, i => i.Id == before.Id || i.Id == after.Id);
    }

    [Fact]
    public async Task List_CancelledIsIncludedWithNoStatus_AndStatusFilters()
    {
        var fx = new GroupActivityFixture();
        var draft = fx.AddActivity();
        var cancelled = fx.AddActivity(ShiftStatus.Cancelled);
        Assert.Equal(2, (await List(fx.Controller())).Body.Data!.TotalCount);
        Assert.Equal([cancelled.Id], (await List(fx.Controller(), status: ShiftStatus.Cancelled)).Body.Data!.Items.Select(i => i.Id));
        Assert.Equal([draft.Id], (await List(fx.Controller(), status: ShiftStatus.Draft)).Body.Data!.Items.Select(i => i.Id));
    }

    [Fact]
    public async Task List_Pages_AndReportsTheTotal()
    {
        var fx = new GroupActivityFixture();
        for (var i = 0; i < 5; i++) fx.AddActivity(day: From.AddDays(i));
        var page2 = (await List(fx.Controller(), page: 2, pageSize: 2)).Body.Data!;
        Assert.Equal(5, page2.TotalCount);
        Assert.Equal(2, page2.Items.Count);
        Assert.Equal(From.AddDays(2), page2.Items[0].ServiceDate);
        Assert.Single((await List(fx.Controller(), page: 3, pageSize: 2)).Body.Data!.Items);
    }

    [Fact]
    public async Task List_ClampsPageSizeToOneHundred()
    {
        var fx = new GroupActivityFixture();
        fx.AddActivity();
        Assert.Equal(100, (await List(fx.Controller(), pageSize: 5000)).Body.Data!.PageSize);
    }

    [Fact]
    public async Task List_SwitchOff_409_AndNoOrganisation_400()
    {
        var off = new GroupActivityFixture(enabled: false);
        off.AddActivity();
        var (status, body) = await List(off.Controller());
        Assert.Equal(409, status);
        Assert.Equal("GA_DISABLED", body.Code);
        var (noOrg, noOrgBody) = await List(new GroupActivityFixture().Controller(superAdminNoTenant: true));
        Assert.Equal(400, noOrg);
        Assert.Equal("GA_CHOOSE_ORG", noOrgBody.Code);
    }

    [Fact]
    public async Task List_RefusesABackwardsOrTooLongRange()
    {
        var fx = new GroupActivityFixture();
        var (backwards, _) = await List(fx.Controller(), from: To, to: From);
        Assert.Equal(400, backwards);
        var (tooLong, body) = await List(fx.Controller(), from: From, to: From.AddDays(93));
        Assert.Equal(400, tooLong);
        Assert.Equal("Choose a range of 93 days or fewer.", Assert.Single(body.Errors!));
        Assert.Equal(200, (await List(fx.Controller(), from: From, to: From.AddDays(92))).Status);
    }

    [Fact]
    public async Task List_RefusesAMissingDate_AndAStatusNoActivityCanHold()
    {
        var fx = new GroupActivityFixture();
        var missing = Assert.IsAssignableFrom<ObjectResult>((await fx.Controller().List(null, To, null, 1, 25, default)).Result);
        Assert.Equal(400, missing.StatusCode);
        var unknown = Assert.IsAssignableFrom<ObjectResult>((await fx.Controller().List(From, To, (ShiftStatus)99, 1, 25, default)).Result);
        Assert.Equal(400, unknown.StatusCode);
    }

    [Fact]
    public async Task List_ReusesTheDto_ParticipantsFilledIn()
    {
        var fx = new GroupActivityFixture();
        var activity = fx.AddActivity();
        var p = fx.AddParticipant();
        var shift = fx.AddShift(p);
        shift.GroupActivityId = activity.Id;
        fx.Seed.SaveChanges();
        var item = Assert.Single((await List(fx.Controller())).Body.Data!.Items);
        Assert.Equal(1, item.StaffNeeded);
        Assert.Equal("Pat Test", Assert.Single(item.Participants).ParticipantName);
    }

    // Shared support needs one worker per its block's headcount (here six), so eight people over one worker is short; with no block it is 40, so one worker covers them.
    private static GroupActivity EightSharedSupport(GroupActivityFixture fx, bool withBlock)
    {
        var activity = fx.AddActivity();
        Guid? pattern = null;
        if (withBlock)
        {
            var draft = new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = fx.TenantId, ParticipantId = fx.AddParticipant().Id, Version = 1, State = "NSW" };
            var block = new Odip.Domain.Billing.Pricing.PlanBlock
            {
                Workers = 1, ParticipantsPresent = 6, Location = new Odip.Domain.Billing.Pricing.PlanLocation { State = "NSW", Zone = Odip.Domain.Enums.PriceZone.National, Mm = 1 },
            };
            fx.Seed.ServiceAgreementDrafts.Add(draft);
            fx.Seed.ServiceAgreementDraftBlocks.Add(new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, BlockKey = "blk", BlockJson = Odip.Infrastructure.Services.DraftJson.Write(block) });
            var row = new ShiftPattern
            {
                Id = Guid.NewGuid(), TenantId = fx.TenantId, ParticipantId = draft.ParticipantId, SourceDraftId = draft.Id, SourceBlockKey = "blk", DayOfWeek = GroupActivityFixture.Day.DayOfWeek,
                StartTime = activity.StartTime, EndTime = activity.EndTime, EffectiveFrom = GroupActivityFixture.Day,
            };
            fx.Seed.ShiftPatterns.Add(row);
            pattern = row.Id;
        }
        for (var i = 0; i < 8; i++)
        {
            var shift = fx.AddShift(fx.AddParticipant("P" + i), Odip.Domain.Enums.SupportRatio.SharedSupport);
            shift.GroupActivityId = activity.Id;
            shift.ShiftPatternId = pattern;
        }
        fx.Seed.GroupActivityStaff.Add(new GroupActivityStaff { Id = Guid.NewGuid(), TenantId = fx.TenantId, GroupActivityId = activity.Id, UserId = fx.AddUser().Id, StartTime = activity.StartTime, EndTime = activity.EndTime });
        fx.Seed.SaveChanges();
        return activity;
    }

    [Fact]
    public async Task List_SharedSupportOfASixBlock_EightAttending_OneWorker_IsShortOfStaff()
    {
        var fx = new GroupActivityFixture();
        EightSharedSupport(fx, withBlock: true);

        var item = Assert.Single((await List(fx.Controller())).Body.Data!.Items);

        Assert.Equal(2, item.StaffNeeded);   // ceil(8 / 6)
        Assert.Contains(item.Findings, f => f.Code == Odip.Domain.Rostering.Services.RosterConflictService.ActivityStaffShort);
    }

    [Fact]
    public async Task List_SharedSupportWithNoBlock_CapsAtForty_SoOneWorkerCoversEight()
    {
        var fx = new GroupActivityFixture();
        EightSharedSupport(fx, withBlock: false);

        var item = Assert.Single((await List(fx.Controller())).Body.Data!.Items);

        Assert.Equal(1, item.StaffNeeded);
        Assert.DoesNotContain(item.Findings, f => f.Code == Odip.Domain.Rostering.Services.RosterConflictService.ActivityStaffShort);
    }
}

/// <summary>The list read is office-only like the controller it sits on: SupportWorker and ReadOnly are refused, Coordinator, Admin and SuperAdmin pass (as the framework evaluates the role strings).</summary>
public class GroupActivitiesControllerRoleTests
{
    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    [Theory]
    [InlineData("SuperAdmin", true), InlineData("Admin", true), InlineData("Coordinator", true), InlineData("SupportWorker", false), InlineData("ReadOnly", false)]
    public void TheListGet_AdmitsOfficeRolesOnly(string role, bool allowed)
    {
        var action = typeof(GroupActivitiesController).GetMethod(nameof(GroupActivitiesController.List))!;
        Assert.Contains(action.GetCustomAttributes<HttpMethodAttribute>(), a => a.HttpMethods.Contains("GET") && a.Template is null);
        Assert.Empty(action.GetCustomAttributes<AllowAnonymousAttribute>());
        Assert.Equal(allowed, Allows(action, role));
    }
}
