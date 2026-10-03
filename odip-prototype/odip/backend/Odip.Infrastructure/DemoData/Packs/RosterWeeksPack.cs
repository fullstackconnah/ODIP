using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The roster itself (plan 2.0 to 2.2, 5.2, 5.3). Each tick:
///  1. Shifts for the weekly patterns across the window (two weeks back to the end of the third week ahead), from the pattern rows as they
///     stand, expanded by <see cref="ShiftPatternExpander"/>, one per (pattern, date).
///  2. The week pack for next week and the week after: designed shifts that trigger the roster checks, one per (story, week Monday).
///  3. Missing rows only. A row that exists is never rewritten, whatever its values (the owner's edits win); a row the owner deleted
///     inside the window comes back on the next tick (switch the flag off to stop it).
///  4. New shifts are born in the state their time implies: future ones Published, ones that have already been worked closed out with the
///     worker's completion (PendingReview for the last three days, then Completed and approved by Sarah), so nothing is ever left
///     Published after it ended.
///  5. Shifts created by an earlier tick are moved forward the same way (see <see cref="MoveForwardAsync"/>), each one only from the state
///     the top-up left it in.
/// Times are provider-local wall clock typed as given; every instant goes through <see cref="DemoAnchors.LocalToUtc(DateTime)"/>.
/// </summary>
public sealed class RosterWeeksPack : IDemoPack
{
    public string Name => "roster-weeks";

    private const int HistoryDays = 14;
    private const int AheadDays = 27;

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var reviewer = run.Directory.Staff("sarah");
        if (reviewer is null) run.Skipped("approval of old shifts", "Sarah Mitchell (the reviewer) is missing, so old shifts stay PendingReview");

        var expected = await BuildExpectedAsync(run, ct);
        var existing = await run.ExistingIdsAsync<Shift>(expected.Select(s => s.Id), ct);
        var fresh = expected.Where(s => !existing.Contains(s.Id)).ToList();

        // The app holds one shift per pattern and date (its own Generate skips a date that already carries one, whoever made it), and the id of the pack's own is not that key: a
        // Draft a coordinator generated for a date beyond this window has a random id, and the window reaches it weeks later. A date that has a shift of its pattern is not placed
        // again (third independent review R3).
        var patterned = fresh.Where(s => s.ShiftPatternId is not null).ToList();
        if (patterned.Count > 0)
        {
            var taken = (await DemoQueries.PatternDatesOf(run.Db, patterned.Select(s => s.ShiftPatternId!.Value).Distinct().ToList(), patterned.Min(s => s.ServiceDate), patterned.Max(s => s.ServiceDate))
                    .ToListAsync(ct)).Select(t => (t.PatternId, t.ServiceDate)).ToHashSet();
            fresh = fresh.Where(s => s.ShiftPatternId is not { } pattern || !taken.Contains((pattern, s.ServiceDate))).ToList();
        }

        var completions = new List<ShiftCompletion>();
        foreach (var shift in fresh) Place(run, shift, reviewer, completions);
        if (fresh.Count > 0)
        {
            run.Db.Shifts.AddRange(fresh);
            run.Db.ShiftCompletions.AddRange(completions);
            await run.SaveAsync(ct);
            run.Added("shifts", fresh.Count);
            run.Added("shift completions", completions.Count);
        }

        await MoveForwardAsync(run, reviewer, ct);
    }

    private static async Task<List<Shift>> BuildExpectedAsync(DemoRun run, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var shifts = new List<Shift>();

        // Pattern shifts, from the demo patterns as the owner left them. Not published by a coordinator in the app's own generator (it makes
        // Drafts), but the demo roster is a published one.
        var patternIds = RosterCatalog.Patterns.Select(p => RosterCatalog.PatternId(p.Key)).ToList();
        var patterns = await DemoQueries.PatternsByIds(run.Db, patternIds).ToListAsync(ct);
        var expander = new ShiftPatternExpander();
        foreach (var pattern in patterns)
        {
            foreach (var date in expander.Occurrences(pattern, anchors.W0.AddDays(-HistoryDays), anchors.W0.AddDays(AheadDays)))
            {
                shifts.Add(new Shift
                {
                    Id = RosterCatalog.PatternShiftId(pattern.Id, date),
                    TenantId = run.TenantId,
                    ParticipantId = pattern.ParticipantId,
                    UserId = pattern.DefaultUserId,
                    ServiceDate = date,
                    StartTime = pattern.StartTime,
                    EndTime = pattern.EndTime,
                    EndsNextDay = pattern.EndsNextDay,
                    Ratio = pattern.Ratio,
                    NightType = pattern.NightType,
                    Status = ShiftStatus.Published,
                    ShiftPatternId = pattern.Id,
                });
            }
        }

        // The week packs.
        foreach (var week in RosterCatalog.PackWeeks(anchors))
        {
            foreach (var story in RosterCatalog.Stories)
            {
                var participant = run.Directory.Participant(story.Participant);
                var staff = story.Staff is null ? null : run.Directory.Staff(story.Staff);
                if (participant is null || (story.Staff is not null && staff is null))
                {
                    run.Skipped($"week pack {week.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} shift {story.Key}", "staff member or participant missing");
                    continue;
                }

                shifts.Add(new Shift
                {
                    Id = RosterCatalog.StoryShiftId(story.Key, week),
                    TenantId = run.TenantId,
                    ParticipantId = participant.Id,
                    UserId = staff?.Id,
                    ServiceDate = week.AddDays(story.DayOffset),
                    StartTime = story.Start,
                    EndTime = story.End,
                    EndsNextDay = story.EndsNextDay,
                    Ratio = story.Ratio,
                    NightType = story.Night,
                    Status = story.Status,
                    Notes = story.Notes,
                    OverrideReason = story.OverrideReason,
                    AcknowledgedFindingCodes = story.AcknowledgedCodes,
                });
            }
        }
        return shifts;
    }

    /// <summary>Puts a new shift in the state its time implies, and makes the completion of one that has already been worked.</summary>
    private static void Place(DemoRun run, Shift shift, User? reviewer, List<ShiftCompletion> completions)
    {
        var anchors = run.Anchors;
        var pastDate = shift.ServiceDate < anchors.D0;

        // A past shift was rostered about a fortnight before it happened; a future one is created now. So is one of today that has been worked: its completion began before now,
        // and a shift is not created after its own completion started (third independent review Q8).
        var createdAt = pastDate || ShiftLifecycle.HasEnded(anchors, shift) ? anchors.LocalToUtc(shift.ServiceDate.AddDays(-14), new TimeOnly(9, 0)) : anchors.NowUtc;
        shift.CreatedAt = createdAt;
        shift.UpdatedAt = createdAt;

        if (shift.Status == ShiftStatus.Draft && pastDate) shift.Status = ShiftStatus.Cancelled;     // an unpublished draft whose day has gone
        if (shift.Status != ShiftStatus.Published || !ShiftLifecycle.HasEnded(anchors, shift)) return;

        if (shift.UserId is null)
        {
            shift.Status = ShiftStatus.Cancelled;                                                      // nobody worked it
            shift.UpdatedAt = anchors.NowUtc;
            return;
        }

        var closed = ShiftLifecycle.ClosedStatus(anchors, shift);
        if (closed == ShiftStatus.Completed && reviewer is null) closed = ShiftStatus.PendingReview;
        var completion = ShiftLifecycle.BuildCompletion(run, shift);
        if (closed == ShiftStatus.Completed) ShiftLifecycle.Approve(run, shift, completion, reviewer!.Id);
        shift.Status = closed;
        shift.UpdatedAt = completion.UpdatedAt;
        completions.Add(completion);
    }

    /// <summary>
    /// The forward-only moves for shifts this top-up created on an earlier tick (found by their ids: a pattern's for a date it has an occurrence on, and
    /// the pack weeks it could have made): a Published shift that has ended is closed out (or cancelled if nobody was rostered), an unpublished draft whose day
    /// has gone is cancelled, and a PendingReview shift three days old is approved. Each move is made only from the state this top-up
    /// leaves things in; a shift somebody else changed (cancelled by hand, returned for correction, started) is not in that state and is
    /// left alone. Completion rows that exist are never replaced.
    /// </summary>
    private static async Task MoveForwardAsync(DemoRun run, User? reviewer, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var patternIds = RosterCatalog.Patterns.Select(p => RosterCatalog.PatternId(p.Key)).ToList();
        var storyIds = RosterCatalog.StoryShiftIds(RosterCatalog.PackWeeksEverCreated(anchors)).ToHashSet();

        // Ask the database only for the few shifts that could still need moving (past, and Published, Draft or PendingReview): those of this
        // top-up's patterns, and the ones with no pattern, which are then matched against the ids of every pack week in memory. The id set grows
        // with the weeks, so it is never sent to the database.
        var open = await DemoQueries.OpenShifts(run.Db, anchors.D0, patternIds).ToListAsync(ct);

        // The shifts this top-up made, and no others: a pattern shift is its own when its id is the one the pack gives the pattern and date (a Draft the app's Generate made for a demo
        // pattern has a random id, and is a person's), and a pack week's by the ids of the weeks it could have made (third independent review R3).
        var candidates = open.Where(s => (s.ShiftPatternId is { } pattern && s.Id == RosterCatalog.PatternShiftId(pattern, s.ServiceDate)) || storyIds.Contains(s.Id)).ToList();
        if (candidates.Count == 0) return;

        var candidateIds = candidates.Select(s => s.Id).ToList();
        var completions = (await DemoQueries.CompletionsOf(run.Db, candidateIds).ToListAsync(ct))
            .GroupBy(c => c.ShiftId).ToDictionary(g => g.Key, g => g.ToList());

        var moved = 0;
        var newCompletions = new List<ShiftCompletion>();
        foreach (var shift in candidates)
        {
            var mine = completions.GetValueOrDefault(shift.Id) ?? new List<ShiftCompletion>();
            switch (shift.Status)
            {
                case ShiftStatus.Draft when shift.ServiceDate < anchors.D0:
                    shift.Status = ShiftStatus.Cancelled;
                    shift.UpdatedAt = anchors.NowUtc;
                    moved++;
                    break;

                case ShiftStatus.Published when ShiftLifecycle.HasEnded(anchors, shift) && shift.ReturnCount == 0 && mine.Count == 0:
                    if (shift.UserId is null)
                    {
                        shift.Status = ShiftStatus.Cancelled;
                    }
                    else
                    {
                        var closed = ShiftLifecycle.ClosedStatus(anchors, shift);
                        if (closed == ShiftStatus.Completed && reviewer is null) closed = ShiftStatus.PendingReview;
                        var completion = ShiftLifecycle.BuildCompletion(run, shift);
                        if (closed == ShiftStatus.Completed) ShiftLifecycle.Approve(run, shift, completion, reviewer!.Id);
                        shift.Status = closed;
                        newCompletions.Add(completion);
                    }
                    shift.UpdatedAt = anchors.NowUtc;
                    moved++;
                    break;

                case ShiftStatus.PendingReview when reviewer is not null
                                                     && anchors.D0.DayNumber - shift.ServiceDate.DayNumber >= ShiftLifecycle.ApproveAfterDays:
                    // The completion this top-up closed it out with, and no other: a shift a coordinator returned (its worker finishes it again under a completion of their own), or a
                    // worker started and finished themselves, is left to its reviewer (third independent review Q1).
                    var waiting = mine.SingleOrDefault(c => c.Id == DemoIds.For("shift-completion", shift.Id) && c.IsActive && c.ReviewOutcome is null && c.ReviewedByUserId is null
                                                            && c.SubmittedAt is not null);
                    if (waiting is null) break;
                    ShiftLifecycle.Approve(run, shift, waiting, reviewer.Id);
                    shift.Status = ShiftStatus.Completed;
                    shift.UpdatedAt = anchors.NowUtc;
                    moved++;
                    break;
            }
        }

        if (moved == 0) return;
        run.Db.ShiftCompletions.AddRange(newCompletions);
        await run.SaveAsync(ct);
        run.Changed("shift status moves", moved);
        run.Added("shift completions", newCompletions.Count);
    }
}
