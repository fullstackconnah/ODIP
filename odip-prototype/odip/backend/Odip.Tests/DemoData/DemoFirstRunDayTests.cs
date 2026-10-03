using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// PR 2 review L9. The first run's day is remembered by the nine medications the top-up added: each was started on that day plus its own offset. It used to be
/// read from whichever of them the query returned first, so an owner who deleted one (to show a ceased medication, say) had it re-created with dates counted from
/// the new day, and the anchor could flip between ticks, moving every row that is keyed to it (the open flagged note, the wrong-medication window, the
/// notifications). The earliest of the nine is the first run, however many were re-created later.
/// </summary>
public class DemoFirstRunDayTests
{
    private static ParticipantMedication Medication(string key, DateOnly firstRun)
    {
        var spec = MedicationCatalog.New.Single(s => s.Key == key);
        return new ParticipantMedication { Id = MedicationCatalog.IdOf(key), StartDate = firstRun.AddDays(spec.StartOffset).ToDateTime(TimeOnly.MinValue) };
    }

    [Fact]
    public void TheFirstRunDay_IsTheEarliestThatAnyOfTheNineGivesAway_WhateverOrderTheyComeIn()
    {
        var first = new DateOnly(2026, 10, 2);
        var later = new DateOnly(2026, 10, 9);                                                     // a medication re-created a week on is counted from that day
        var original = Medication("olivia-vitamin-d", first);
        var recreated = Medication("dylan-ibuprofen", later);
        var foreign = new ParticipantMedication { Id = Guid.NewGuid(), StartDate = new DateTime(2020, 1, 1) };         // not one of the nine: says nothing

        Assert.Equal(first, MedicationCatalog.FirstRunDay(new[] { recreated, original }));
        Assert.Equal(first, MedicationCatalog.FirstRunDay(new[] { original, recreated }));
        Assert.Equal(first, MedicationCatalog.FirstRunDay(new[] { foreign, recreated, original, foreign }));
        Assert.Equal(later, MedicationCatalog.FirstRunDay(new[] { foreign, recreated }));
        Assert.Null(MedicationCatalog.FirstRunDay(new[] { foreign }));
        Assert.Null(MedicationCatalog.FirstRunDay(Array.Empty<ParticipantMedication>()));
    }

    [Fact]
    public async Task AMedicationTheOwnerDeletedAndThePackMadeAgain_DoesNotMoveTheFirstRunDay()
    {
        var env = await TickAsync(Friday1030);
        List<ParticipantMedication> chart;
        await using (var db = env.AdminDb()) chart = await db.ParticipantMedications.ToListAsync();
        Assert.Equal(Friday, MedicationCatalog.FirstRunDay(chart));

        await using (var db = env.AdminDb())
        {
            var deleted = await db.ParticipantMedications.SingleAsync(m => m.Id == MedicationCatalog.IdOf("olivia-vitamin-d"));
            db.ParticipantMedications.Remove(deleted);                                             // the owner deletes one of the nine
            await db.SaveChangesAsync();
        }
        await RunAsync(env, Friday1030.AddDays(2));                                                // and two days on the pack makes it again, counted from that day

        await using var check = env.AdminDb();
        var again = await check.ParticipantMedications.SingleAsync(m => m.Id == MedicationCatalog.IdOf("olivia-vitamin-d"));
        Assert.Equal(Friday.AddDays(2 - 120), DateOnly.FromDateTime(again.StartDate));                // made again, counted from the later day (its offset is minus 120)
        var after = await check.ParticipantMedications.ToListAsync();
        Assert.Equal(Friday, MedicationCatalog.FirstRunDay(after));                                // the anchor is where it was
        Assert.Equal(Friday, MedicationCatalog.FirstRunDay(after.AsEnumerable().Reverse()));        // in whatever order the query returns them
    }
}
