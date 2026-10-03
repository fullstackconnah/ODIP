using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// One live shift that cannot be written must not stop the others (PR 2 review H1, last sentence). A pack is one transaction, and a failure inside it,
/// whatever the cause (a person's row the script did not foresee, a race with somebody editing the same shift, a bug in one day's story), used to roll back
/// every shift the pack had worked in that tick and do the same on the next. Each live shift is now its own piece, whole or not at all.
/// </summary>
public class DemoLiveSetPiecesTests
{
    private static DateTimeOffset Utc(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    /// <summary>Refuses to save one note, as a database would refuse a row that breaks a constraint.</summary>
    private sealed class RefusesNote(string body) : SaveChangesInterceptor
    {
        public int Refusals { get; private set; }

        private void Check(DbContext? context)
        {
            if (context is null || !context.ChangeTracker.Entries<ShiftNote>().Any(n => n.State == EntityState.Added && n.Entity.Body == body)) return;
            Refusals++;
            throw new DbUpdateException("simulated: this note cannot be written", new InvalidOperationException("simulated constraint violation"));
        }

        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
        {
            Check(eventData.Context);
            return base.SavingChanges(eventData, result);
        }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Check(eventData.Context);
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    [Fact]
    public async Task OneLiveShiftThatCannotBeWritten_IsReportedByName_AndTheOtherShiftsAndPacksCarryOn_AndTheNextTickHealsIt()
    {
        var env = await TickAsync(Utc("2026-10-01T20:30:00Z"));                                    // Fri 06:30: today's three shifts are cast, nobody has started
        var refuses = new RefusesNote(LiveSetCatalog.MorningNote(Friday));                          // Sophie's note of today (the one at 10:05) cannot be saved
        var faulty = new DbContextOptionsBuilder<OdipDbContext>(env.Options).AddInterceptors(refuses).Options;

        env.Clock.Set(Utc("2026-10-02T00:30:00Z"));                                                // Fri 10:30
        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(faulty, CancellationToken.None);

        var failure = Assert.Single(result.Failures);
        Assert.StartsWith("live-set: live-morning 2026-10-02", failure.Pack, StringComparison.Ordinal);                                   // named by pack and piece
        Assert.False(failure.Conflict);
        Assert.True(refuses.Refusals >= 1);

        var insulin = await RequireDayAsync(env, LiveSetCatalog.Insulin, Friday);                    // Harrison's shift was worked as if Sophie's were not there
        Assert.NotNull(insulin.Completion);
        Assert.NotEmpty(insulin.Doses);
        Assert.Contains(insulin.Breaks, b => b.EndedAt is null);                                    // his running break (10:15)
        foreach (var story in LiveSetCatalog.Stories) Assert.NotNull((await RequireDayAsync(env, story, Friday.AddDays(-1))).Completion!.SubmittedAt);      // and yesterday's, all finished
        Assert.Contains(result.RowsAdded.Keys, k => k.StartsWith("medication-history/", StringComparison.Ordinal));                       // the packs after the live set ran
        Assert.Contains(result.RowsAdded.Keys, k => k.StartsWith("incidents/", StringComparison.Ordinal));
        // The note that could not be written was not written. (InMemory has no transactions, so what the piece had already saved before it failed, the
        // shift's start, stays; the database undoes the whole piece, which the Postgres test of the same name asserts.)
        var shiftNotes = (await RequireDayAsync(env, LiveSetCatalog.Morning, Friday)).Notes;
        Assert.DoesNotContain(shiftNotes, n => n.Body == LiveSetCatalog.MorningNote(Friday));
        Assert.Single(shiftNotes, n => n.Body == LiveSetCatalog.InjuryNote);                       // the incidents pack's own note of the shift, written after the live set failed

        // Nothing it left behind in memory is saved by the pack's last save, and the next tick, with the fault gone, works the shift as normal, from
        // wherever the failed attempt stopped: the note is written once, and the incidents pack's note is not written twice.
        await RunAsync(env, Utc("2026-10-02T00:35:00Z"));
        var healed = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        Assert.Single(healed.Notes, n => n.Body == LiveSetCatalog.MorningNote(Friday));
        Assert.Single(healed.Notes, n => n.Body == LiveSetCatalog.InjuryNote);
        Assert.NotNull(healed.Completion);
    }
}
