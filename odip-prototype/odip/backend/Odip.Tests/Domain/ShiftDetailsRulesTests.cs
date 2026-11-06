using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.DomainTests;

/// <summary>The "Needs details" rule (finish-later). The same case table runs in the frontend's checklist.missingDetails.test.ts, so the two copies cannot drift.</summary>
public class ShiftDetailsRulesTests
{
    /// <summary>C1: everything answered, the organisation claims travel.</summary>
    private static ShiftDetailsFacts Answered() =>
        new(true, true, true, 0m, 20, 5m, false, 20, 5m, false, "Quiet day.", false, false, false);

    public static TheoryData<string, ShiftDetailsFacts, string[]> Cases()
    {
        var a = Answered();
        return new()
        {
            { "C1 all answered", a, [] },
            { "C2 km null", a with { Kilometres = null }, ["kilometres"] },
            { "C3 pre minutes only", a with { PreKm = null }, ["tripTo"] },
            { "C4 post No trip, no values", a with { PostMinutes = null, PostKm = null, PostNone = true }, [] },
            { "C5 travel not asked, legs null", a with { TravelAsked = false, PreMinutes = null, PreKm = null, PostMinutes = null, PostKm = null }, [] },
            { "C6a no note, not confirmed", a with { HasNote = false }, ["notes"] },
            { "C6b no note, confirmed", a with { HasNote = false, NothingToNoteConfirmed = true }, [] },
            { "C7a handover blank", a with { HandoverText = "  " }, ["handover"] },
            { "C7b handover nothing ticked", a with { HandoverText = null, NothingToHandOver = true }, [] },
            { "C8 report null", a with { AnythingToReport = null }, ["report"] },
            { "C9 not required, everything null", new(false, true, false, null, null, null, false, null, null, false, null, false, false, null), [] },
            { "C10 everything missing", new(true, true, false, null, null, null, false, null, null, false, null, false, false, null), ["kilometres", "tripTo", "tripAfter", "notes", "handover", "report"] },
        };
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Missing_follows_the_case_table(string name, ShiftDetailsFacts facts, string[] expected)
    {
        Assert.True(expected.SequenceEqual(ShiftDetailsRules.Missing(facts)), name);
    }
}
