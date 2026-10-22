using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Tests.Integrations;

/// <summary>Approved shifts for the timesheet tests: the participant Jane Park, a Completed shift and an active Approved completion in Sydney.</summary>
internal static class EhTimesheetFixture
{
    public static readonly TimeZoneInfo Sydney = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");

    public static async Task<User> WorkerAsync(OdipDbContext db, Guid tenantId, string? payrollId = "42")
    {
        var worker = EhFixture.Staff(tenantId, "Ben", "Turner", $"ben.{Guid.NewGuid():N}@acme.org.au", payrollId);
        db.Users.Add(worker);
        await db.SaveChangesAsync();
        return worker;
    }

    /// <summary>
    /// The shift runs <paramref name="start"/> to <paramref name="end"/> local time on <paramref name="date"/>; the completion has exactly those actuals.
    /// A break is (minutes after the start, length in minutes).
    /// </summary>
    public static async Task<(Shift Shift, ShiftCompletion Completion)> ApprovedShiftAsync(OdipDbContext db, Guid tenantId, User worker, DateOnly date, TimeOnly start, TimeOnly end,
        SleepoverType night = SleepoverType.None, (int After, int Length)[]? breaks = null, ShiftStatus status = ShiftStatus.Completed, ReviewOutcome outcome = ReviewOutcome.Approved)
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Jane", LastName = "Park", IsActive = true };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, UserId = worker.Id, ServiceDate = date, StartTime = start, EndTime = end,
            EndsNextDay = end <= start, Ratio = SupportRatio.OneToOne, NightType = night, Status = status,
        };
        var from = ProviderLocalTime.LocalToUtc(date.ToDateTime(start), Sydney);
        var to = ProviderLocalTime.LocalToUtc(date.AddDays(end <= start ? 1 : 0).ToDateTime(end), Sydney);
        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ShiftId = shift.Id, ActualStart = from, ActualEnd = to, TimeZoneId = Sydney.Id, SubmittedByUserId = worker.Id,
            StartedAt = from, SubmittedAt = to, IsActive = true, ReviewOutcome = outcome, ReviewedAt = to,
        };
        db.AddRange(participant, shift, completion);
        foreach (var (after, length) in breaks ?? [])
            db.ShiftBreaks.Add(new ShiftBreak { Id = Guid.NewGuid(), TenantId = tenantId, ShiftCompletionId = completion.Id, StartedAt = from.AddMinutes(after), EndedAt = from.AddMinutes(after + length), CreatedByUserId = worker.Id });
        await db.SaveChangesAsync();
        return (shift, completion);
    }

}
