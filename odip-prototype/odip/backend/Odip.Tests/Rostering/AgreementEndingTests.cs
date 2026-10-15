using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Agreement PR 2: which agreements are ending or have ended (<see cref="AgreementEnding.FindAsync"/>), and what is said about them. The approval fixture's day, Saturday 10 October 2026.
/// A revision is approved here by its approval row alone, as the approval writes it: the rule reads approvals, not patterns.
/// </summary>
public class AgreementEndingTests
{
    private static async Task<Guid> ParticipantAsync(Fixture f, string name)
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = name, LastName = "Ng", IsActive = true };
        f.Db.Participants.Add(participant);
        await f.Db.SaveChangesAsync();
        return participant.Id;
    }

    /// <summary>A revision ending on <paramref name="end"/> (four weeks long unless a start is given), approved or not.</summary>
    private static async Task<ServiceAgreementDraft> RevisionAsync(Fixture f, Guid participantId, int version, DateOnly end, bool approved, DateOnly? start = null)
    {
        var draft = await AddRevisionAsync(f, version, new[] { WeekdayBlock() }, start: start ?? end.AddDays(-27), end: end, participantId: participantId);
        if (approved) await MarkApprovedAsync(f.Db, draft);
        return draft;
    }

    private static Task<List<AgreementEndingRow>> FindAsync(Fixture f, params Guid[] participants) => AgreementEnding.FindAsync(f.Db, participants, Today, CancellationToken.None);


    [Fact]
    public async Task The_window_is_sixty_days_and_today_and_yesterday_read_as_people_say_them()
    {
        await using var f = await SetUpAsync();
        var (sixty, sixtyOne, ending, ended, one) = (await ParticipantAsync(f, "Sixty"), await ParticipantAsync(f, "SixtyOne"), await ParticipantAsync(f, "Ending"), await ParticipantAsync(f, "Ended"), await ParticipantAsync(f, "One"));
        await RevisionAsync(f, sixty, 1, Today.AddDays(60), approved: true);
        await RevisionAsync(f, sixtyOne, 1, Today.AddDays(61), approved: true);
        await RevisionAsync(f, ending, 1, Today, approved: true);
        await RevisionAsync(f, ended, 1, Today.AddDays(-1), approved: true);
        await RevisionAsync(f, one, 1, Today.AddDays(1), approved: true);

        var rows = await FindAsync(f, sixty, sixtyOne, ending, ended, one);

        // Soonest end first; 61 days out is not listed.
        Assert.Equal(new[] { (ended, -1), (ending, 0), (one, 1), (sixty, 60) }, rows.Select(r => (r.ParticipantId, r.DaysLeft)));
        Assert.Equal(new[] { "Agreement ended 2026-10-09: shifts stop after it", "Agreement ends today", "Agreement ends in 1 day", "Agreement ends in 60 days" }, rows.Select(AgreementEnding.Describe));
    }

    [Fact]
    public async Task The_newest_approved_revision_counts_a_renewal_in_progress_hides_ending_and_an_ended_one_says_its_renewal_waits()
    {
        await using var f = await SetUpAsync();
        var renewed = await ParticipantAsync(f, "Renewed");
        await RevisionAsync(f, renewed, 1, new DateOnly(2026, 10, 20), approved: true);
        await RevisionAsync(f, renewed, 2, new DateOnly(2027, 3, 31), approved: true, start: new DateOnly(2026, 10, 21));     // its renewal is approved: nothing is ending
        var renewing = await ParticipantAsync(f, "Renewing");
        await RevisionAsync(f, renewing, 1, new DateOnly(2026, 10, 30), approved: true);
        await RevisionAsync(f, renewing, 2, new DateOnly(2027, 3, 31), approved: false, start: new DateOnly(2026, 10, 31));   // a renewal waiting: not flagged as ending
        var ended = await ParticipantAsync(f, "Ended");
        await RevisionAsync(f, ended, 1, new DateOnly(2026, 10, 5), approved: true);
        await RevisionAsync(f, ended, 2, new DateOnly(2027, 3, 31), approved: false, start: new DateOnly(2026, 10, 6));       // ended with its renewal waiting: still flagged
        var changing = await ParticipantAsync(f, "Changing");
        await RevisionAsync(f, changing, 1, new DateOnly(2026, 10, 30), approved: true);
        await RevisionAsync(f, changing, 2, new DateOnly(2026, 10, 30), approved: false, start: new DateOnly(2026, 10, 20));  // a change inside the term, not a renewal

        var rows = await FindAsync(f, renewed, renewing, ended, changing);

        Assert.Equal(new[] { (ended, 1, -5, (int?)2), (changing, 1, 20, (int?)null) }, rows.Select(r => (r.ParticipantId, r.Version, r.DaysLeft, r.RenewalVersion)));
        Assert.Equal("Agreement ended 2026-10-05: shifts stop after it. Renewal v2 is waiting for approval", AgreementEnding.Describe(rows[0]));
    }

    [Fact]
    public async Task A_participant_with_no_approved_revision_or_not_asked_about_is_not_listed()
    {
        await using var f = await SetUpAsync();
        var draftOnly = await ParticipantAsync(f, "Draft");
        await RevisionAsync(f, draftOnly, 1, new DateOnly(2026, 10, 20), approved: false);
        var notAsked = await ParticipantAsync(f, "NotAsked");
        await RevisionAsync(f, notAsked, 1, new DateOnly(2026, 10, 20), approved: true);

        Assert.Empty(await FindAsync(f, draftOnly));                                                  // notAsked would be listed, but was not asked about
        Assert.Empty(await AgreementEnding.FindAsync(f.Db, Array.Empty<Guid>(), Today, CancellationToken.None));
        Assert.Equal(notAsked, Assert.Single(await FindAsync(f, notAsked)).ParticipantId);
    }
}
