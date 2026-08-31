using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>NOTES-02 — word-boundary/case/multi-category/no-match/stem-edge coverage for <see cref="ShiftNoteKeywordScanner"/>.</summary>
public class ShiftNoteKeywordScannerTests
{
    [Fact]
    public void NoMatch_ReturnsNone()
    {
        var result = ShiftNoteKeywordScanner.Scan("Quiet shift — watched a movie and had an early night.");

        Assert.Equal(ShiftNoteFlagCategory.None, result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void EmptyOrWhitespaceBody_ReturnsNone(string? body)
    {
        Assert.Equal(ShiftNoteFlagCategory.None, ShiftNoteKeywordScanner.Scan(body));
    }

    [Theory]
    [InlineData("She had a fall near the bathroom.")]
    [InlineData("SHE HAD A FALL NEAR THE BATHROOM.")] // case-insensitive
    [InlineData("she had a FaLl near the bathroom.")] // mixed case
    public void FallsKeyword_MatchesCaseInsensitively(string body)
    {
        Assert.Equal(ShiftNoteFlagCategory.Falls, ShiftNoteKeywordScanner.Scan(body));
    }

    [Theory]
    [InlineData("She fell getting out of bed.")]
    [InlineData("She slipped on the wet floor.")]
    [InlineData("He stumbled on the front step.")]
    [InlineData("He collapsed in the hallway.")]
    [InlineData("She tumbled down the last two stairs.")]
    public void FallsStems_MatchDifferentWordForms(string body)
    {
        Assert.Equal(ShiftNoteFlagCategory.Falls, ShiftNoteKeywordScanner.Scan(body));
    }

    [Theory]
    [InlineData("She falls sometimes.")]
    [InlineData("Watch for falling hazards.")]
    [InlineData("She has fallen twice this week.")]
    public void FallStem_MatchesPluralAndParticipleForms(string body)
    {
        Assert.Equal(ShiftNoteFlagCategory.Falls, ShiftNoteKeywordScanner.Scan(body));
    }

    [Fact]
    public void WordBoundary_DoesNotMatchAWordThatMerelyContainsAStemMidWord()
    {
        // "waterfall" contains "fall" but not as its own word — the scanner is a whole-word
        // (well, whole-word-onward) matcher, not a bare substring search.
        Assert.Equal(ShiftNoteFlagCategory.None, ShiftNoteKeywordScanner.Scan("We watched the waterfall on the outing."));
    }

    [Theory]
    [InlineData("Gave her medication at 8am as scheduled.")]
    [InlineData("Reminded him to take his tablets after lunch.")]
    [InlineData("She refused her PRN pill this afternoon.")]
    [InlineData("Picked up a new script from the pharmacy.")]
    public void MedicationStems_MatchDifferentWordForms(string body)
    {
        Assert.Equal(ShiftNoteFlagCategory.Medication, ShiftNoteKeywordScanner.Scan(body));
    }

    [Theory]
    [InlineData("Small bruise on his left arm, no other injury.")]
    [InlineData("She has a minor wound on her knee.")]
    [InlineData("He fractured his wrist last month, cast comes off soon.")]
    [InlineData("Sprained her ankle during the walk.")]
    [InlineData("Burned her hand slightly on the kettle.")]
    public void InjuryStems_MatchDifferentWordForms(string body)
    {
        Assert.Equal(ShiftNoteFlagCategory.Injury, ShiftNoteKeywordScanner.Scan(body));
    }

    [Theory]
    [InlineData("Became quite agitated during the transition.")]
    [InlineData("Had an outburst before dinner, settled after 10 minutes.")]
    [InlineData("She was aggressive towards staff this morning.")]
    [InlineData("Showed signs of distress when the routine changed.")]
    public void BehaviourOfConcernStems_MatchDifferentWordForms(string body)
    {
        Assert.Equal(ShiftNoteFlagCategory.BehaviourOfConcern, ShiftNoteKeywordScanner.Scan(body));
    }

    [Fact]
    public void MultipleCategoriesInOneNote_AreCombinedAsFlags()
    {
        var result = ShiftNoteKeywordScanner.Scan("She slipped reaching for her tablets and now has a small bruise.");

        Assert.Equal(ShiftNoteFlagCategory.Falls | ShiftNoteFlagCategory.Medication | ShiftNoteFlagCategory.Injury, result);
        Assert.True(result.HasFlag(ShiftNoteFlagCategory.Falls));
        Assert.True(result.HasFlag(ShiftNoteFlagCategory.Medication));
        Assert.True(result.HasFlag(ShiftNoteFlagCategory.Injury));
        Assert.False(result.HasFlag(ShiftNoteFlagCategory.BehaviourOfConcern));
    }

    [Fact]
    public void NeutralHandoverNote_TripsNothing()
    {
        var result = ShiftNoteKeywordScanner.Scan(
            "Reminded Sophie about her hair appointment next week with Marie — she's looking forward to it.");

        Assert.Equal(ShiftNoteFlagCategory.None, result);
    }
}
