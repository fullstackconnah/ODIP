using ClosedXML.Excel;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Catalogue;

/// <summary>
/// Imported items are put in activity groups by family, and GRP_COMMUNITY_ACCESS (the only group that ever existed, and the one the
/// trip and shift claims read) keeps holding exactly the RG 0125 standard and ICBS items it holds today.
/// </summary>
public class CatalogueGroupsTests
{
    private static readonly string[] CommunityAccessToday =
    {
        "04_102_0125_6_1", "04_103_0125_6_1", "04_104_0125_6_1", "04_105_0125_6_1", "04_106_0125_6_1",
        "04_450_0125_1_1", "04_451_0125_1_1", "04_452_0125_1_1", "04_453_0125_1_1", "04_454_0125_1_1",
    };

    private static CatalogueGroupDefinition GroupOf(string code, string? registrationGroup = null) =>
        CatalogueGroups.For(CatalogueClassifier.Classify(code, registrationGroup));

    [Fact]
    public void The_community_access_group_code_is_the_one_the_claim_engines_have_always_used()
    {
        Assert.Equal("GRP_COMMUNITY_ACCESS", CatalogueGroups.CommunityAccessGroupCode);
    }

    [Theory]
    [InlineData("01_011_0107_1_1", "GRP_PERSONAL_CARE")]
    [InlineData("01_400_0104_1_1", "GRP_PERSONAL_CARE")]
    [InlineData("01_010_0107_1_1", "GRP_SLEEPOVER")]
    [InlineData("01_206_0115_1_1", "GRP_SLEEPOVER")]
    [InlineData("04_104_0125_6_1", "GRP_COMMUNITY_ACCESS")]
    [InlineData("04_450_0125_1_1", "GRP_COMMUNITY_ACCESS")]
    [InlineData("04_400_0104_1_1", "GRP_COMMUNITY_ACCESS_HI")]
    [InlineData("04_102_0136_6_1", "GRP_GROUP_ACTIVITIES")]
    [InlineData("04_600_0104_6_1", "GRP_GROUP_ACTIVITIES")]
    [InlineData("01_200_0115_1_1", "GRP_STA_SUPPORT")]
    [InlineData("01_252_0115_1_1", "GRP_STA_SUPPORT")]
    [InlineData("01_250_0115_1_1", "GRP_STA_ACCOMMODATION")]
    [InlineData("01_799_0107_1_1", "GRP_PROVIDER_TRAVEL")]
    [InlineData("04_799_0125_6_1", "GRP_PROVIDER_TRAVEL")]
    [InlineData("04_590_0125_6_1", "GRP_ACTIVITY_BASED_TRANSPORT")]
    [InlineData("04_599_0136_6_1", "GRP_CENTRE_CAPITAL")]
    [InlineData("04_210_0125_6_1", "GRP_OTHER")]       // RG 0125 but an Each item with no price: must never share a group with 04_104
    [InlineData("04_049_0125_1_1", "GRP_OTHER")]       // establishment fee
    [InlineData("01_801_0115_1_1", "GRP_OTHER")]       // SIL
    [InlineData("05_043306003_0103_1_2", "GRP_OTHER")] // assistive technology
    [InlineData("Bereavement", "GRP_OTHER")]
    public void Each_family_has_its_own_group(string code, string expectedGroupCode)
    {
        Assert.Equal(expectedGroupCode, GroupOf(code).GroupCode);
    }

    [Fact]
    public void The_community_access_group_holds_exactly_the_RG_0125_standard_and_ICBS_items_it_holds_today()
    {
        using var wb = new XLWorkbook(CatalogueFixtures.PathOf(CatalogueFixtures.File2026_27));
        var inCommunityAccess = new List<string>();
        foreach (var sheet in wb.Worksheets)
            foreach (var row in sheet.RowsUsed().Skip(1))
            {
                var code = row.Cell(1).GetString().Trim();
                var registrationGroup = row.Cell(3).GetString().Trim();
                if (GroupOf(code, registrationGroup).GroupCode == CatalogueGroups.CommunityAccessGroupCode)
                    inCommunityAccess.Add(code);
            }

        Assert.Equal(CommunityAccessToday.OrderBy(c => c), inCommunityAccess.OrderBy(c => c));
    }

    [Fact]
    public void Group_definitions_fit_their_columns_and_are_unique()
    {
        var all = CatalogueGroups.All;

        Assert.Equal(11, all.Count);
        Assert.Equal(all.Count, all.Select(g => g.GroupCode).Distinct(StringComparer.Ordinal).Count());
        Assert.All(all, g =>
        {
            Assert.InRange(g.GroupCode.Length, 1, 50);
            Assert.InRange(g.DisplayName.Length, 1, 200);
        });
        Assert.Contains(all, g => g.GroupCode == CatalogueGroups.CommunityAccessGroupCode && g.DisplayName == "Group Community Access" && g.SupportCategory == 4);
    }

    [Fact]
    public void Community_access_hourly_items_split_into_the_standard_group_and_the_high_intensity_group()
    {
        Assert.Equal("GRP_COMMUNITY_ACCESS_HI", GroupOf("04_400_0104_1_1", "0104").GroupCode);
        Assert.Equal("GRP_COMMUNITY_ACCESS", GroupOf("04_104_0125_6_1", "0125").GroupCode);
    }
}
