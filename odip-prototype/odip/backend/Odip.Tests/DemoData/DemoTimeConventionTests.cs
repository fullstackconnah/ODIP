using System.Globalization;
using System.Reflection;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Rostering;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Tests.Serialization;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// T7: the time convention (plan 2.0). Shift times and dose slots are provider-local wall clock typed as given; completions, requests and
/// decisions are UTC instants made only by LocalToUtc; "today" is the provider's calendar date. So: every instant the top-up writes is Kind
/// Utc and every wall-clock value has no kind; instants convert back to the local time they were meant for, in each zone and across the
/// daylight-saving days; and through the real API JSON options an instant ends in "Z" and a wall-clock field carries no zone. A bug of the
/// "UtcNow.Date" or "AddHours(-10)" sort (the old medication seed had it) shows here as a shifted hour.
/// </summary>
public class DemoTimeConventionTests
{
    private static readonly DateTimeOffset Friday = new(2026, 10, 2, 0, 30, 0, TimeSpan.Zero);

    private static async Task<DemoTestEnv> RunAsync(string state = "NSW", DateTimeOffset? at = null)
    {
        var env = new DemoTestEnv(at ?? Friday);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync(state);
        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        Assert.Empty(result.Failures);
        return env;
    }

    // ── kinds ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task T7_EveryInstantTheTopUpWritesIsUtc_AndTheOnlyWallClockDateTimesAreTheAvailabilityBounds()
    {
        var env = await RunAsync();
        // The legacy availability bounds are the calendar-date-in-a-DateTime wall-clock fields ([WallClock] on StaffAvailabilityDto).
        var wallClock = new HashSet<string> { "StaffAvailability.StartDateTime", "StaffAvailability.EndDateTime" };

        await using var db = env.AdminDb();
        var rows = new List<object>();
        rows.AddRange(await db.Shifts.ToListAsync());
        rows.AddRange(await db.ShiftPatterns.ToListAsync());
        rows.AddRange(await db.ShiftCompletions.ToListAsync());
        rows.AddRange(await db.LeaveRequests.ToListAsync());
        rows.AddRange(await db.RecurringUnavailabilities.ToListAsync());
        rows.AddRange(await db.StaffAvailabilities.ToListAsync());
        rows.AddRange(await db.StaffParticipantCompatibilities.ToListAsync());
        rows.AddRange(await db.BookingTasks.ToListAsync());
        rows.AddRange(await db.People.ToListAsync());
        rows.AddRange(await db.ParticipantContactRoles.ToListAsync());
        Assert.True(rows.Count > 200);

        var checkedFields = 0;
        foreach (var row in rows)
        {
            foreach (var property in row.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (property.PropertyType != typeof(DateTime) && property.PropertyType != typeof(DateTime?)) continue;
                var value = (DateTime?)property.GetValue(row);
                if (value is null) continue;
                var name = $"{row.GetType().Name}.{property.Name}";
                var expected = wallClock.Contains(name) ? DateTimeKind.Unspecified : DateTimeKind.Utc;
                Assert.True(value.Value.Kind == expected, $"{name} is {value.Value.Kind} ({value:O}) but should be {expected}");
                checkedFields++;
            }
        }
        Assert.True(checkedFields > 500, $"only {checkedFields} DateTime values were checked");
    }

    [Fact]
    public async Task T7_NothingIsEverInTheFuture_ThatHasAlreadyHappened()
    {
        var env = await RunAsync();
        var now = Friday.UtcDateTime;

        await using var db = env.AdminDb();
        Assert.All(await db.ShiftCompletions.ToListAsync(), c =>
        {
            Assert.True(c.ActualStart <= now && (c.ActualEnd ?? now) <= now && (c.SubmittedAt ?? now) <= now && (c.ReviewedAt ?? now) <= now, $"completion {c.Id} has an instant in the future");
            Assert.True(c.CreatedAt <= now && c.UpdatedAt <= now);
        });
        Assert.All(await db.LeaveRequests.ToListAsync(), l => Assert.True(l.RequestedAt <= now && (l.DecidedAt ?? now) <= now, $"leave {l.Id} has an instant in the future"));
        Assert.All(await db.RecurringUnavailabilities.ToListAsync(), r => Assert.True(r.RequestedAt <= now && (r.DecidedAt ?? now) <= now));
    }

    // ── the instants mean the local time they were meant for ─────────────────

    [Theory]
    [InlineData("NSW")]
    [InlineData("QLD")]
    [InlineData("SA")]
    public async Task T7_CompletionInstants_ConvertBackToTheRosteredLocalTimePlusTheVariance_InEveryZone(string state)
    {
        var env = await RunAsync(state, new DateTimeOffset(2026, 10, 9, 0, 30, 0, TimeSpan.Zero));
        var zone = DemoAnchors.Create(new DateTime(2026, 10, 9, 0, 30, 0, DateTimeKind.Utc), state).Zone;

        await using var db = env.AdminDb();
        var shifts = await db.Shifts.ToDictionaryAsync(s => s.Id);
        var completions = await db.ShiftCompletions.ToListAsync();
        Assert.NotEmpty(completions);
        foreach (var c in completions)
        {
            var (startLocal, endLocal) = ProviderLocalTime.RosteredWindowLocal(shifts[c.ShiftId]);
            Assert.Equal(startLocal.AddMinutes(c.VarianceMinutesStart), ProviderLocalTime.UtcToLocal(c.ActualStart, zone));
            if (c.ActualEnd is { } actualEnd) Assert.Equal(endLocal.AddMinutes(c.VarianceMinutesEnd), ProviderLocalTime.UtcToLocal(actualEnd, zone));
            Assert.Equal(DateTimeKind.Unspecified, ProviderLocalTime.UtcToLocal(c.ActualStart, zone).Kind);
        }
    }

    [Theory]
    [InlineData("NSW")]
    [InlineData("QLD")]
    [InlineData("SA")]
    public async Task T7_RequestAndDecisionInstants_AreTheTypedLocalClockTimes_InEveryZone(string state)
    {
        var env = await RunAsync(state);
        var zone = DemoAnchors.Create(Friday.UtcDateTime, state).Zone;
        var week = new DateOnly(2026, 10, 5);

        await using var db = env.AdminDb();
        var priya = await db.LeaveRequests.SingleAsync(l => l.Id == DemoIds.For("leave", "priya-annual", week));
        Assert.Equal(new TimeSpan(9, 10, 0), ProviderLocalTime.UtcToLocal(priya.RequestedAt, zone).TimeOfDay);
        Assert.Equal(new TimeSpan(14, 20, 0), ProviderLocalTime.UtcToLocal(priya.DecidedAt!.Value, zone).TimeOfDay);
        Assert.Equal(week.AddDays(-21), DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(priya.RequestedAt, zone)));
        var emily = await db.LeaveRequests.SingleAsync(l => l.Id == DemoIds.For("leave", "emily-personal", week));
        Assert.Equal(new TimeSpan(8, 45, 0), ProviderLocalTime.UtcToLocal(emily.RequestedAt, zone).TimeOfDay);
        var brendan = await db.LeaveRequests.SingleAsync(l => l.Id == DemoIds.For("leave", "brendan-annual", week));
        Assert.Equal(new TimeSpan(17, 30, 0), ProviderLocalTime.UtcToLocal(brendan.RequestedAt, zone).TimeOfDay);

        // The pattern shifts and story shifts are wall clock: the digits are exactly what the plan typed, whatever the zone.
        var ratio = await db.Shifts.SingleAsync(s => s.Id == DemoIds.For("shift", "story", "ratio-a", week));
        Assert.Equal((new TimeOnly(7, 0), new TimeOnly(15, 0)), (ratio.StartTime, ratio.EndTime));
    }

    [Fact]
    public async Task T7_TheSameLocalTimeIsAnHourApartInUtc_EitherSideOfDaylightSaving()
    {
        // Priya's request is 09:10 local, three weeks before her pack week. Built on 2 Oct the request date is 14 Sep (AEST, +10); built on 2 Dec the
        // request date is 16 Nov (AEDT, +11). The wall clock is the same, the instant is an hour earlier in UTC after the clocks went forward.
        var autumn = await RunAsync();
        var summer = await RunAsync(at: new DateTimeOffset(2026, 12, 2, 0, 30, 0, TimeSpan.Zero));

        await using var a = autumn.AdminDb();
        await using var b = summer.AdminDb();
        var before = await a.LeaveRequests.SingleAsync(l => l.Id == DemoIds.For("leave", "priya-annual", new DateOnly(2026, 10, 5)));
        var after = await b.LeaveRequests.SingleAsync(l => l.Id == DemoIds.For("leave", "priya-annual", new DateOnly(2026, 12, 7)));
        Assert.Equal(new DateTime(2026, 9, 13, 23, 10, 0, DateTimeKind.Utc), before.RequestedAt);      // 14 Sep 09:10 AEST = 13 Sep 23:10Z
        Assert.Equal(new DateTime(2026, 11, 15, 22, 10, 0, DateTimeKind.Utc), after.RequestedAt);      // 16 Nov 09:10 AEDT = 15 Nov 22:10Z
    }

    // ── on the wire ──────────────────────────────────────────────────────────

    [Fact]
    public async Task T7_ThroughTheRealApiJsonOptions_InstantsEndInZ_AndWallClockFieldsCarryNoZone()
    {
        var env = await RunAsync();
        var options = WireTypeWalker.ApiOptions();

        await using var db = env.AdminDb();
        var leave = await db.LeaveRequests.Where(l => l.Status == LeaveStatus.Approved).OrderBy(l => l.StartDate).LastAsync();
        var dto = new LeaveRequestDto
        {
            Id = leave.Id, UserId = leave.UserId, LeaveType = leave.LeaveType, StartDate = leave.StartDate, EndDate = leave.EndDate, Status = leave.Status,
            RequestedByUserId = leave.RequestedByUserId, RequestedAt = leave.RequestedAt, DecidedByUserId = leave.DecidedByUserId, DecidedAt = leave.DecidedAt,
        };
        using (var json = JsonDocument.Parse(JsonSerializer.Serialize(dto, options)))
        {
            Assert.EndsWith("Z", json.RootElement.GetProperty("requestedAt").GetString());
            Assert.EndsWith("Z", json.RootElement.GetProperty("decidedAt").GetString());
            Assert.Equal(leave.RequestedAt, json.RootElement.GetProperty("requestedAt").GetDateTime().ToUniversalTime());
            Assert.Equal(leave.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), json.RootElement.GetProperty("startDate").GetString());   // a date, no time, no zone
        }

        var availability = await db.StaffAvailabilities.FirstAsync(a => a.AvailabilityType == AvailabilityType.Unavailable);
        var availabilityDto = new StaffAvailabilityDto
        {
            Id = availability.Id, StaffId = availability.UserId, StartDateTime = availability.StartDateTime, EndDateTime = availability.EndDateTime,
            AvailabilityType = availability.AvailabilityType, Notes = availability.Notes,
        };
        using (var json = JsonDocument.Parse(JsonSerializer.Serialize(availabilityDto, options)))
        {
            var start = json.RootElement.GetProperty("startDateTime").GetString()!;
            var end = json.RootElement.GetProperty("endDateTime").GetString()!;
            Assert.False(start.EndsWith('Z') || end.EndsWith('Z'), $"wall-clock bounds must carry no zone: {start} / {end}");
            Assert.EndsWith("T00:00:00", start);
            Assert.EndsWith("T23:59:59", end);
        }

        // The review screen's own model of a completion, built by the real mapper.
        var completion = await db.ShiftCompletions.OrderBy(c => c.ActualStart).FirstAsync();
        var shift = await db.Shifts.SingleAsync(s => s.Id == completion.ShiftId);
        await using var tenantDb = DemoBoardAssertions.TenantDb(env);
        var completionDto = await ShiftCompletionMapper.ToDtoAsync(tenantDb, completion, 15, shift.ReturnCount, CancellationToken.None, nowUtc: Friday.UtcDateTime);
        using var completionJson = JsonDocument.Parse(JsonSerializer.Serialize(completionDto, options));
        Assert.EndsWith("Z", completionJson.RootElement.GetProperty("actualStart").GetString());
        Assert.EndsWith("Z", completionJson.RootElement.GetProperty("actualEnd").GetString());
        Assert.EndsWith("Z", completionJson.RootElement.GetProperty("submittedAt").GetString());
        Assert.Equal(completion.ActualStart, completionJson.RootElement.GetProperty("actualStart").GetDateTime().ToUniversalTime());
    }
}
