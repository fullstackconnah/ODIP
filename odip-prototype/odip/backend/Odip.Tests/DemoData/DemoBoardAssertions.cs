using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// What the roster board (the real RosteringController, with the test's fixed clock) must say about the week packs the top-up builds:
/// each designed story shift shows its designed finding codes, and nothing else apart from what a lapsing credential adds. Shared by the
/// roster tests and the clock-replay test (T2), which runs it at many clocks, zones and across both daylight-saving days.
/// </summary>
internal static class DemoBoardAssertions
{
    public static Guid Story(string key, DateOnly week) => DemoIds.For("shift", "story", key, week);

    // The plan's 2.2 table, with the knock-on findings the data really produces (a pending leave covers Saturday too, an expired first
    // aid is on every Emily shift, the board's ASSIGNEE_ON_LEAVE badge covers an approved recurring rule as well as approved leave).
    public static readonly Dictionary<string, string[]> Designed = new()
    {
        ["wsc-expired"] = new[] { "WSC_EXPIRED" },
        ["wsc-missing"] = new[] { "WSC_MISSING" },
        ["double-a"] = new[] { "DOUBLE_BOOKED_SHIFT" },
        ["double-b"] = new[] { "DOUBLE_BOOKED_SHIFT" },
        ["unavailable"] = new[] { "STAFF_UNAVAILABLE" },
        ["on-leave"] = new[] { "STAFF_ON_LEAVE", "CREDENTIAL_EXPIRED", "ASSIGNEE_ON_LEAVE" },
        ["recurring"] = new[] { "STAFF_RECURRING_UNAVAILABLE", "ASSIGNEE_ON_LEAVE" },
        ["leave-pending"] = new[] { "STAFF_LEAVE_PENDING", "CREDENTIAL_EXPIRED" },
        ["recurring-pending"] = new[] { "STAFF_RECURRING_PENDING", "CREDENTIAL_EXPIRED" },
        ["excluded"] = new[] { "COMPATIBILITY_EXCLUDED", "STAFF_LEAVE_PENDING", "CREDENTIAL_EXPIRED" },
        ["needs-mh"] = new[] { "COMPETENCY_MISSING" },
        ["needs-night"] = new[] { "COMPETENCY_MISSING" },
        ["needs-fa"] = new[] { "WSC_EXPIRED", "COMPETENCY_MISSING" },
        ["ratio-a"] = new[] { "RATIO_SHORTFALL" },
        ["hours-mon"] = new[] { "OVER_HOURS" },
        ["hours-tue"] = new[] { "OVER_HOURS" },
        ["hours-wed"] = new[] { "OVER_HOURS" },
        ["hours-thu"] = new[] { "OVER_HOURS" },
        ["hours-fri"] = new[] { "OVER_HOURS" },
    };

    public static readonly string[] Unfilled = { "ratio-b", "draft", "cancelled" };

    /// <summary>Codes a lapsing credential adds to any shift of that worker once its date has passed: the plan's "near ones age into expired".</summary>
    public static HashSet<string> AgingCodes(User u, DateOnly date)
    {
        var codes = new HashSet<string>();
        if (u.WorkerScreeningExpiryDate is null) codes.Add("WSC_MISSING");
        else if (u.WorkerScreeningExpiryDate < date) codes.Add("WSC_EXPIRED");
        if ((u.IsFirstAidQualified && u.FirstAidExpiryDate < date) || (u.IsDriverEligible && u.DriverLicenceExpiryDate < date)
            || (u.IsManualHandlingCompetent && u.ManualHandlingExpiryDate < date) || (u.IsMedicationCompetent && u.MedicationCompetencyExpiryDate < date))
            codes.Add("CREDENTIAL_EXPIRED");
        return codes;
    }

    public static OdipDbContext TenantDb(DemoTestEnv env) =>
        new(env.Options, new ScopedTenantOverride { TenantId = DemoTestEnv.DemoTenantId });

    public static async Task<RosterBoardDto> BoardAsync(DemoTestEnv env, DateOnly week)
    {
        await using var db = TenantDb(env);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: env.Clock);
        var result = await controller.GetBoard(week, "participant", CancellationToken.None);
        return Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    /// <summary>
    /// Asserts the designed findings for the pack made for <paramref name="week"/>. <paramref name="holiday"/> is a date with a public holiday
    /// row for the provider's state, if the test inserted one: shifts on it also carry PUBLIC_HOLIDAY.
    /// </summary>
    public static async Task AssertDesignedWeekAsync(DemoTestEnv env, DateOnly week, DateOnly? holiday = null)
    {
        var board = await BoardAsync(env, week);

        await using var db = env.AdminDb();
        var users = await db.Users.ToDictionaryAsync(u => u.Id);
        var shifts = await db.Shifts.Where(s => s.ServiceDate >= week && s.ServiceDate <= week.AddDays(6)).ToListAsync();
        var codesByShift = board.Exceptions.Where(e => e.ShiftId != null).GroupBy(e => e.ShiftId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(e => e.Finding.Code).ToHashSet());

        foreach (var (key, designed) in Designed)
        {
            var shift = shifts.SingleOrDefault(s => s.Id == Story(key, week));
            Assert.True(shift is not null, $"story shift '{key}' is missing from the week of {week}");
            var actual = codesByShift.GetValueOrDefault(shift!.Id) ?? new HashSet<string>();
            var expected = designed.ToHashSet();
            if (shift.ServiceDate == holiday) expected.Add("PUBLIC_HOLIDAY");
            Assert.True(expected.IsSubsetOf(actual), $"{key} on {shift.ServiceDate}: expected {string.Join(",", expected)} but the board says {string.Join(",", actual)}");
            var extra = actual.Except(expected).ToHashSet();
            Assert.True(extra.IsSubsetOf(AgingCodes(users[shift.UserId!.Value], shift.ServiceDate)), $"{key}: unexpected findings {string.Join(",", extra)}");
        }

        foreach (var key in Unfilled)
        {
            var shift = shifts.Single(s => s.Id == Story(key, week));
            Assert.Null(shift.UserId);
            var codes = codesByShift.GetValueOrDefault(shift.Id) ?? new HashSet<string>();
            Assert.False(codes.Except(new[] { "PUBLIC_HOLIDAY" }).Any(), $"{key} is unfilled, so no staff finding applies");
        }

        // Pattern shifts carry only what the staff's own credentials and the holiday produce.
        foreach (var shift in shifts.Where(s => s.ShiftPatternId != null && s.UserId != null))
        {
            var actual = codesByShift.GetValueOrDefault(shift.Id) ?? new HashSet<string>();
            var allowed = AgingCodes(users[shift.UserId!.Value], shift.ServiceDate);
            if (shift.ServiceDate == holiday) allowed.Add("PUBLIC_HOLIDAY");
            Assert.True(actual.IsSubsetOf(allowed), $"pattern shift {shift.Id} on {shift.ServiceDate}: unexpected {string.Join(",", actual.Except(allowed))}");
        }
    }
}
