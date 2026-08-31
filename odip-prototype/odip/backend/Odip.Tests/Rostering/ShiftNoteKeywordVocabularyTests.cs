using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// NOTES-02 — partition-completeness style coverage for
/// <see cref="ShiftNoteKeywordVocabulary"/>: same "every enum member must be represented, no
/// gaps, no internal duplicates" idiom as <c>ChecklistItemTypeGroupsTests</c>/<c>AdlTypeGroupsTests</c>,
/// adapted for a stem-list-per-category shape instead of a category-of-member shape.
/// </summary>
public class ShiftNoteKeywordVocabularyTests
{
    [Fact]
    public void Stems_HasAnEntryForEveryNonNoneCategory_WithNoOmission()
    {
        Assert.Equal(
            ShiftNoteKeywordVocabulary.Categories.ToHashSet(),
            ShiftNoteKeywordVocabulary.Stems.Keys.ToHashSet());
    }

    [Fact]
    public void Categories_CoversEveryNonNoneShiftNoteFlagCategoryMember()
    {
        var nonNoneMembers = Enum.GetValues<ShiftNoteFlagCategory>()
            .Where(c => c != ShiftNoteFlagCategory.None)
            .ToHashSet();

        Assert.Equal(nonNoneMembers, ShiftNoteKeywordVocabulary.Categories.ToHashSet());
    }

    [Fact]
    public void EveryCategoryMember_IsASingleBit()
    {
        // A future combined value (e.g. Falls | Injury) accidentally added to Categories would
        // corrupt ToCategoryNames' HasFlag-based expansion — guard against that here.
        foreach (var category in ShiftNoteKeywordVocabulary.Categories)
        {
            var value = (int)category;
            Assert.True(value != 0 && (value & (value - 1)) == 0, $"{category} is not a single bit.");
        }
    }

    [Theory]
    [InlineData(ShiftNoteFlagCategory.Falls)]
    [InlineData(ShiftNoteFlagCategory.Medication)]
    [InlineData(ShiftNoteFlagCategory.Injury)]
    [InlineData(ShiftNoteFlagCategory.BehaviourOfConcern)]
    public void EveryCategorysStemList_IsNonEmptyWithNoDuplicates(ShiftNoteFlagCategory category)
    {
        var stems = ShiftNoteKeywordVocabulary.Stems[category];
        Assert.NotEmpty(stems);
        Assert.Equal(stems.Count, stems.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public void NoStemIsSharedAcrossTwoCategories()
    {
        // Not a hard product requirement, but an accidental duplicate stem across categories would
        // usually indicate a copy-paste mistake rather than a deliberate multi-category word.
        var seen = new Dictionary<string, ShiftNoteFlagCategory>(StringComparer.OrdinalIgnoreCase);
        foreach (var (category, stems) in ShiftNoteKeywordVocabulary.Stems)
        {
            foreach (var stem in stems)
            {
                Assert.False(seen.TryGetValue(stem, out var owner) && owner != category,
                    $"Stem '{stem}' appears in both {seen.GetValueOrDefault(stem)} and {category}.");
                seen[stem] = category;
            }
        }
    }

    [Fact]
    public void ToCategoryNames_ReturnsEmptyForNone()
    {
        Assert.Empty(ShiftNoteKeywordVocabulary.ToCategoryNames(ShiftNoteFlagCategory.None));
    }

    [Fact]
    public void ToCategoryNames_ExpandsACombinedFlagsValue()
    {
        var names = ShiftNoteKeywordVocabulary.ToCategoryNames(ShiftNoteFlagCategory.Falls | ShiftNoteFlagCategory.Medication);

        Assert.Equal(new[] { "Falls", "Medication" }, names);
    }
}
