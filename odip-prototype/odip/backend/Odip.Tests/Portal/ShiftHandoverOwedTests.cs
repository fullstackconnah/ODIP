using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Portal;

/// <summary>
/// A handover owed from a shift finished "details later": the next worker is told whose handover is still to come and sees the newest earlier
/// text instead; a blank handover needs no acknowledgement, and once it is filled in it does.
/// </summary>
public class ShiftHandoverOwedTests
{
    /// <summary>An earlier shift for the fixture's participant by another worker, already submitted, with the given handover facts.</summary>
    private static ShiftCompletion Earlier(ShiftPackageFixture f, int daysBefore, bool detailsRequired, string? text, bool nothing = false)
    {
        var worker = f.AddWorker("Priya", "Shah");
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, UserId = worker.Id,
            ServiceDate = ShiftPackageFixture.ServiceDate.AddDays(-daysBefore), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.PendingReview,
        };
        var at = ShiftPackageFixture.ActualStartUtc.AddDays(-daysBefore);
        var c = new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = shift.TenantId, ShiftId = shift.Id, ActualStart = at, ActualEnd = at.AddHours(8), TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = worker.Id, StartedAt = at, SubmittedAt = at.AddHours(8), IsActive = true,
            DetailsRequired = detailsRequired, HandoverText = text, NothingToHandOver = nothing,
        };
        f.Db.Shifts.Add(shift);
        f.Db.ShiftCompletions.Add(c);
        f.Db.SaveChanges();
        return c;
    }

    private static Task<HandoverView> ViewAsync(ShiftPackageFixture f) =>
        new ShiftHandoverService(f.Db).GetAsync(f.Shift, f.Worker.Id, default);

    [Fact]
    public async Task An_owed_handover_names_whose_it_is_and_carries_the_newest_earlier_text()
    {
        var f = ShiftPackageFixture.Create();
        Earlier(f, daysBefore: 2, detailsRequired: false, text: "Amy likes the red cup.");
        var owed = Earlier(f, daysBefore: 1, detailsRequired: true, text: null);

        var latest = (await ViewAsync(f)).Latest!;

        Assert.Equal(owed.Id, latest.CompletionId);
        Assert.Equal("Priya", latest.OwedFrom);
        Assert.Null(latest.Text);
        Assert.False(latest.RequiresAcknowledgement);
        Assert.Equal("Amy likes the red cup.", latest.EarlierHandover!.Text);
        Assert.Equal(ShiftPackageFixture.ServiceDate.AddDays(-2), latest.EarlierHandover.ShiftDate);
    }

    [Fact]
    public async Task A_handover_that_is_not_owed_has_neither_field()
    {
        var f = ShiftPackageFixture.Create();
        Earlier(f, daysBefore: 1, detailsRequired: true, text: null, nothing: true);   // answered "nothing to hand over": not owed

        var latest = (await ViewAsync(f)).Latest!;

        Assert.Null(latest.OwedFrom);
        Assert.Null(latest.EarlierHandover);
    }

    [Fact]
    public async Task Blank_needs_no_ack_and_once_filled_in_it_requires_one()
    {
        var f = ShiftPackageFixture.Create();
        var c = Earlier(f, daysBefore: 1, detailsRequired: true, text: null);
        Assert.False((await ViewAsync(f)).Latest!.RequiresAcknowledgement);

        c.HandoverText = "Please check the back door.";
        f.Db.SaveChanges();

        var latest = (await ViewAsync(f)).Latest!;
        Assert.True(latest.RequiresAcknowledgement);
        Assert.False(latest.IsRead);
        Assert.Null(latest.OwedFrom);
        Assert.Equal(HandoverAckOutcome.Ok, await new ShiftHandoverService(f.Db).AcknowledgeAsync(f.Shift, f.Worker.Id, latest.CompletionId, default));
        Assert.True((await ViewAsync(f)).Latest!.IsRead);
    }
}
