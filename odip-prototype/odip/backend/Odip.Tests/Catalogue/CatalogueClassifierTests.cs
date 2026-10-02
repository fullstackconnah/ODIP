using ClosedXML.Excel;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Catalogue;

/// <summary>
/// The code classification map (phase A item 2). The expected values are NDIS-CODES section 11.1, row by row: the support type and
/// intensity of each table row, and the codes in the table's day-type order (Weekday Daytime, Weekday Evening, Weekday Night,
/// Saturday, Sunday, Public Holiday). The classifier must not look at item names, and a sequence digit must never be read
/// without its registration group: the same digits mean different days in RG 0125 and RG 0136.
/// </summary>
public class CatalogueClassifierTests
{
    private const ClaimDayType W = ClaimDayType.Weekday, E = ClaimDayType.WeekdayEvening, N = ClaimDayType.WeekdayNight,
        Sa = ClaimDayType.Saturday, Su = ClaimDayType.Sunday, P = ClaimDayType.PublicHoliday;

    private static readonly List<object?[]> Table11_1 = BuildTable();

    private static List<object?[]> BuildTable()
    {
        var rows = new List<object?[]>();

        // A banded support type: codes in the order Weekday, Evening, Night, Saturday, Sunday, Public Holiday (null = the table has "-").
        void Banded(SupportFamily family, SupportIntensity intensity, string suffix, params string?[] codes)
        {
            ClaimDayType[] days = { W, E, N, Sa, Su, P };
            for (var i = 0; i < codes.Length; i++)
                if (codes[i] is { } code) rows.Add(new object?[] { code + suffix, family, intensity, days[i] });
        }
        void Single(string code, SupportFamily family, SupportIntensity? intensity) => rows.Add(new object?[] { code, family, intensity, null });

        // PersonalCare | Standard | 01_011, 01_015, 01_002, 01_013, 01_014, 01_012 + sleepover 01_010 (all _0107_1_1)
        Banded(SupportFamily.PersonalCare, SupportIntensity.Standard, "_0107_1_1", "01_011", "01_015", "01_002", "01_013", "01_014", "01_012");
        Single("01_010_0107_1_1", SupportFamily.Sleepover, SupportIntensity.Standard);
        // PersonalCare | High | 01_400, 01_401, 01_405, 01_402, 01_403, 01_404 (_0104_1_1)
        Banded(SupportFamily.PersonalCare, SupportIntensity.HighIntensity, "_0104_1_1", "01_400", "01_401", "01_405", "01_402", "01_403", "01_404");
        // CommunityAccess (RG 0125) | Standard | 04_104, 04_103, -, 04_105, 04_106, 04_102 (_0125_6_1)
        Banded(SupportFamily.CommunityAccess, SupportIntensity.Standard, "_0125_6_1", "04_104", "04_103", null, "04_105", "04_106", "04_102");
        // CommunityAccess | High | 04_400, 04_401, -, 04_402, 04_403, 04_404 (_0104_1_1)
        Banded(SupportFamily.CommunityAccess, SupportIntensity.HighIntensity, "_0104_1_1", "04_400", "04_401", null, "04_402", "04_403", "04_404");
        // GroupActivity (RG 0136) | Standard | 04_102, 04_103, -, 04_104, 04_105, 04_106 (_0136_6_1)
        Banded(SupportFamily.GroupActivity, SupportIntensity.Standard, "_0136_6_1", "04_102", "04_103", null, "04_104", "04_105", "04_106");
        // GroupActivity | High | 04_600, 04_601, -, 04_602, 04_603, 04_604 (_0104_6_1)
        Banded(SupportFamily.GroupActivity, SupportIntensity.HighIntensity, "_0104_6_1", "04_600", "04_601", null, "04_602", "04_603", "04_604");
        // StaSupport (RG 0115) | Standard | 01_200, 01_201, 01_205, 01_202, 01_203, 01_204 + sleepover 01_206 (_0115_1_1)
        Banded(SupportFamily.StaSupport, SupportIntensity.Standard, "_0115_1_1", "01_200", "01_201", "01_205", "01_202", "01_203", "01_204");
        Single("01_206_0115_1_1", SupportFamily.Sleepover, SupportIntensity.Standard);
        // StaSupport | High | 01_252, 01_253, 01_254, 01_255, 01_256, 01_257 (_0115_1_1)
        Banded(SupportFamily.StaSupport, SupportIntensity.HighIntensity, "_0115_1_1", "01_252", "01_253", "01_254", "01_255", "01_256", "01_257");
        // StaAccommodation | - | 01_250 participant, 01_251 support worker (Day)
        Single("01_250_0115_1_1", SupportFamily.StaAccommodation, null);
        Single("01_251_0115_1_1", SupportFamily.StaAccommodation, null);
        // Companions | - | 01_799_0107/0104/0115, 04_799_0125/0136/0104 (non-labour); 04_590/591/592 (ABT); 04_599 (centre)
        foreach (var code in new[] { "01_799_0107_1_1", "01_799_0104_1_1", "01_799_0115_1_1", "04_799_0125_6_1", "04_799_0136_6_1", "04_799_0104_6_1" })
            Single(code, SupportFamily.ProviderTravel, null);
        foreach (var code in new[] { "04_590_0125_6_1", "04_591_0136_6_1", "04_592_0104_6_1" })
            Single(code, SupportFamily.ActivityBasedTransport, null);
        foreach (var code in new[] { "04_599_0136_6_1", "04_599_0104_6_1" })
            Single(code, SupportFamily.CentreCapital, null);

        return rows;
    }

    public static IEnumerable<object?[]> Rows11_1() => Table11_1;

    [Theory]
    [MemberData(nameof(Rows11_1))]
    public void Every_item_in_the_11_1_table_classifies_to_its_family_intensity_and_day_type(
        string code, SupportFamily family, SupportIntensity? intensity, ClaimDayType? dayType)
    {
        var result = CatalogueClassifier.Classify(code);

        Assert.Equal(family, result.Family);
        Assert.Equal(intensity, result.Intensity);
        Assert.Equal(dayType, result.DayType);
    }

    [Fact]
    public void The_11_1_table_has_all_59_items_the_test_expects()
    {
        Assert.Equal(59, Table11_1.Count);
        Assert.Equal(59, Table11_1.Select(r => (string)r[0]!).Distinct().Count());
    }

    [Theory]
    [InlineData("04_450_0125_1_1", W)]
    [InlineData("04_451_0125_1_1", E)]
    [InlineData("04_452_0125_1_1", Sa)]
    [InlineData("04_453_0125_1_1", Su)]
    [InlineData("04_454_0125_1_1", P)]
    public void The_ICBS_community_access_items_the_importer_has_always_kept_are_intensive_community_access(string code, ClaimDayType dayType)
    {
        var result = CatalogueClassifier.Classify(code);

        Assert.Equal(SupportFamily.CommunityAccess, result.Family);
        Assert.Equal(SupportIntensity.Icbs, result.Intensity);
        Assert.Equal(dayType, result.DayType);
        Assert.True(result.IsIntensive);
    }

    [Theory]
    [InlineData("04_102_0125_6_1", SupportFamily.CommunityAccess, P)]
    [InlineData("04_102_0136_6_1", SupportFamily.GroupActivity, W)]
    [InlineData("04_104_0125_6_1", SupportFamily.CommunityAccess, W)]
    [InlineData("04_104_0136_6_1", SupportFamily.GroupActivity, Sa)]
    [InlineData("04_106_0125_6_1", SupportFamily.CommunityAccess, Su)]
    [InlineData("04_106_0136_6_1", SupportFamily.GroupActivity, P)]
    public void The_same_sequence_digits_mean_different_days_in_different_registration_groups(string code, SupportFamily family, ClaimDayType dayType)
    {
        var result = CatalogueClassifier.Classify(code);

        Assert.Equal(family, result.Family);
        Assert.Equal(dayType, result.DayType);
    }

    [Fact]
    public void Intensity_is_intensive_for_high_intensity_and_ICBS_only()
    {
        Assert.False(CatalogueClassifier.Classify("01_011_0107_1_1").IsIntensive);
        Assert.True(CatalogueClassifier.Classify("01_400_0104_1_1").IsIntensive);
        Assert.False(CatalogueClassifier.Classify("01_010_0107_1_1").IsIntensive);   // sleepover
        Assert.False(CatalogueClassifier.Classify("01_250_0115_1_1").IsIntensive);   // intensity does not apply
    }

    [Theory]
    [InlineData("")]
    [InlineData("Bereavement")]                // the catalogue's one row with no structured code
    [InlineData("01_011")]                     // no registration group
    [InlineData("01_011_0999_1_1")]            // a mapped prefix under a registration group the map does not know
    [InlineData("01_801_0115_1_1")]            // SIL standard weekday: shares RG 0115 with STA but is not an STA item
    [InlineData("01_058_0115_1_1")]            // legacy per-day STA
    [InlineData("01_082_0115_1_1")]            // medium term accommodation
    [InlineData("04_210_0125_6_1")]            // Each, no price: not an hourly community access item
    [InlineData("01_450_0107_1_1")]            // ICBS in personal care: not in 11.1, so not guessed
    [InlineData("04_049_0125_1_1")]            // establishment fee
    [InlineData("01_650_0118_1_3_PT")]         // therapy provider travel
    [InlineData("05_043306003_0103_1_2")]      // assistive technology
    public void Anything_the_map_does_not_name_is_Other_and_never_guessed(string code)
    {
        var result = CatalogueClassifier.Classify(code);

        Assert.Equal(SupportFamily.Other, result.Family);
        Assert.Null(result.Intensity);
        Assert.Null(result.DayType);
        Assert.False(result.IsIntensive);
    }

    [Fact]
    public void A_registration_group_passed_in_from_the_file_column_decides_over_the_code()
    {
        // 05_222903111_0103_1_2 is the one row whose RG column (0123) disagrees with its code (0103): the column is what the provider is registered for.
        Assert.Equal(SupportFamily.PersonalCare, CatalogueClassifier.Classify("01_011_0107_1_1", "0107").Family);
        Assert.Equal(SupportFamily.Other, CatalogueClassifier.Classify("01_011_0107_1_1", "0104").Family);
        Assert.Equal(SupportFamily.PersonalCare, CatalogueClassifier.Classify("01_011_0107_1_1", null).Family);
    }

    [Fact]
    public void A_trailing_space_in_the_item_number_does_not_change_the_answer()
    {
        // Two rows in the real catalogues carry a trailing space in their code.
        Assert.Equal(SupportFamily.PersonalCare, CatalogueClassifier.Classify(" 01_011_0107_1_1 ").Family);
    }

    [Fact]
    public void Against_the_real_2026_27_catalogue_the_map_names_exactly_the_11_1_items_and_the_five_ICBS_items_and_every_one_exists_in_the_file()
    {
        using var wb = new XLWorkbook(CatalogueFixtures.PathOf(CatalogueFixtures.File2026_27));
        var fileCodes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var sheet in wb.Worksheets)
            foreach (var row in sheet.RowsUsed().Skip(1))
                fileCodes.Add(row.Cell(1).GetString().Trim());

        var expected = Table11_1.Select(r => (string)r[0]!)
            .Concat(new[] { "04_450_0125_1_1", "04_451_0125_1_1", "04_452_0125_1_1", "04_453_0125_1_1", "04_454_0125_1_1" })
            .ToHashSet();
        var classified = fileCodes.Where(c => CatalogueClassifier.Classify(c).Family != SupportFamily.Other).ToHashSet();

        Assert.Equal(64, expected.Count);
        Assert.Equal(expected.OrderBy(c => c), classified.OrderBy(c => c));
        Assert.Equal(64, CatalogueClassifier.ClassifiedKeys.Count);   // no entry in the map that the file lacks
    }
}
