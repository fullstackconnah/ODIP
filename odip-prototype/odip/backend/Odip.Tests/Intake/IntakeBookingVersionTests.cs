using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Xunit;
using static Odip.Tests.Intake.IntakeBookingsControllerTests;

namespace Odip.Tests.Intake;

/// <summary>
/// The enquiry table's booking panel and its Cancel dialog write with the version they loaded. The server REQUIRES it on Set, Cancel, Resend and Confirm:
/// a missing or stale one is the 409 "Someone else just changed this visit", with no email, no SEQUENCE bump, no outbox row and no change to the visit.
/// </summary>
public class IntakeBookingVersionTests
{
    private const string Changed = "Someone else just changed this visit. Reload and try again.";

    public static TheoryData<string> Routes => new() { "set", "cancel", "resend", "confirm" };

    /// <summary>A colleague saves the visit's notes (a real edit: UpdatedAt is the wall clock, so the version moves on).</summary>
    private static void ColleagueSaves(Fixture f)
    {
        var db = f.OtherDb();
        var row = db.ParticipantInquiries.Single(x => x.Id == f.Noah.Id);
        row.IntakeNotes = "Gate code changed";
        row.UpdatedAt = DateTime.UtcNow;
        db.SaveChanges();
    }

    private static async Task<IActionResult> R<T>(Task<ActionResult<T>> call) => (await call).Result!;

    /// <summary>One write from a panel that holds <paramref name="version"/>, as its own request (a new context, as the real one has).</summary>
    private static Task<IActionResult> Write(Fixture f, string route, DateTime? version)
    {
        var ct = CancellationToken.None;
        var c = f.Controller(db: f.OtherDb());
        return route switch
        {
            "set" => R(c.Set(f.Noah.Id, f.Body() with { StartsAt = Start.AddDays(1), ExpectedUpdatedAt = version }, ct)),
            "cancel" => R(c.Cancel(f.Noah.Id, ct, version)),
            "resend" => R(c.Resend(f.Noah.Id, ct, new InquiryVersionDto { ExpectedUpdatedAt = version })),
            "confirm" => R(c.Confirm(f.Noah.Id, new ConfirmIntakeBookingDto { Confirmed = true, ExpectedUpdatedAt = version }, ct)),
            _ => throw new ArgumentOutOfRangeException(nameof(route)),
        };
    }

    private static void AssertChangedByOther(IActionResult result)
    {
        var conflict = Assert.IsType<ConflictObjectResult>(result);
        Assert.Contains(Changed, JsonSerializer.Serialize(conflict.Value));
    }

    /// <summary>The visit, its SEQUENCE, its outbox and the emails sent are exactly as they were.</summary>
    private static void AssertNothingHappened(Fixture f, ParticipantInquiry before, int outbox, int sent)
    {
        var row = f.Row();
        Assert.Equal(before.IntakeStartsAt, row.IntakeStartsAt);
        Assert.Equal(before.IntakeIcsSequence, row.IntakeIcsSequence);
        Assert.Equal(before.IntakeConfirmedAt, row.IntakeConfirmedAt);
        Assert.Equal(before.IntakeNotes, row.IntakeNotes);
        Assert.Equal(before.UpdatedAt, row.UpdatedAt);
        Assert.Equal(outbox, f.Outbox().Count);
        Assert.Equal(sent, f.Channel.Sent.Count);
    }

    [Theory]
    [MemberData(nameof(Routes))]
    public async Task A_write_with_no_version_is_a_409_and_nothing_happens(string route)
    {
        var f = new Fixture(ChannelSendOutcome.Sent);
        await f.BookAsync();
        var (before, outbox, sent) = (f.Row(), f.Outbox().Count, f.Channel.Sent.Count);

        AssertChangedByOther(await Write(f, route, null));

        AssertNothingHappened(f, before, outbox, sent);
    }

    [Theory]
    [MemberData(nameof(Routes))]
    public async Task A_write_from_a_panel_opened_before_a_colleagues_save_is_a_409_and_nothing_happens(string route)
    {
        var f = new Fixture(ChannelSendOutcome.Sent);
        await f.BookAsync();
        var loaded = f.Row().UpdatedAt;
        ColleagueSaves(f);
        var (before, outbox, sent) = (f.Row(), f.Outbox().Count, f.Channel.Sent.Count);

        AssertChangedByOther(await Write(f, route, loaded));

        AssertNothingHappened(f, before, outbox, sent);
    }

    [Theory]
    [MemberData(nameof(Routes))]
    public async Task A_write_with_the_current_version_goes_through(string route)
    {
        var f = new Fixture(ChannelSendOutcome.Sent);
        await f.BookAsync();
        ColleagueSaves(f);

        var result = await Write(f, route, f.Row().UpdatedAt);

        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public async Task A_first_booking_with_no_version_is_a_409_and_books_nothing()
    {
        var f = new Fixture(ChannelSendOutcome.Sent);

        AssertChangedByOther(await R(f.Controller(db: f.OtherDb()).Set(f.Noah.Id, f.Body() with { ExpectedUpdatedAt = null }, CancellationToken.None)));

        Assert.Null(f.Row().IntakeStartsAt);
        Assert.Empty(f.Outbox());
        Assert.Empty(f.Channel.Sent);
    }
}
