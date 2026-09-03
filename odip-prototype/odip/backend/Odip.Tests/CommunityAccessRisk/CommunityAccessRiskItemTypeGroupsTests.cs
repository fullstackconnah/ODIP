using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.CommunityAccessRisk;

/// <summary>
/// PF-10.2, review-round polish — partition-completeness coverage for
/// <see cref="CommunityAccessRiskItemTypeGroups"/>: RoadTraffic, BehavioursOfConcern, and
/// HealthAndPersonalSafety must together cover every <see cref="CommunityAccessRiskItemType"/>
/// member exactly once (no omission, no overlap), so a future 23rd item type that nobody
/// remembers to add to one of the three lists fails loudly here instead of silently
/// misclassifying. Mirrors <c>ChecklistItemTypeGroupsTests</c>/<c>AdlTypeGroupsTests</c> exactly,
/// including the Enum.GetValues&lt;T&gt;() + HashSet completeness idiom.
/// </summary>
public class CommunityAccessRiskItemTypeGroupsTests
{
    [Fact]
    public void AllThreeGroups_TogetherCoverEveryCommunityAccessRiskItemTypeMember_WithNoOmission()
    {
        var union = CommunityAccessRiskItemTypeGroups.RoadTraffic
            .Concat(CommunityAccessRiskItemTypeGroups.BehavioursOfConcern)
            .Concat(CommunityAccessRiskItemTypeGroups.HealthAndPersonalSafety)
            .ToHashSet();

        Assert.Equal(Enum.GetValues<CommunityAccessRiskItemType>().ToHashSet(), union);
    }

    [Fact]
    public void AllThreeGroups_DoNotOverlap()
    {
        var roadTraffic = CommunityAccessRiskItemTypeGroups.RoadTraffic;
        var boc = CommunityAccessRiskItemTypeGroups.BehavioursOfConcern;
        var health = CommunityAccessRiskItemTypeGroups.HealthAndPersonalSafety;

        Assert.Empty(roadTraffic.Intersect(boc));
        Assert.Empty(roadTraffic.Intersect(health));
        Assert.Empty(boc.Intersect(health));
    }

    [Fact]
    public void AllThreeGroups_HaveNoInternalDuplicates()
    {
        Assert.Equal(CommunityAccessRiskItemTypeGroups.RoadTraffic.Count, CommunityAccessRiskItemTypeGroups.RoadTraffic.Distinct().Count());
        Assert.Equal(CommunityAccessRiskItemTypeGroups.BehavioursOfConcern.Count, CommunityAccessRiskItemTypeGroups.BehavioursOfConcern.Distinct().Count());
        Assert.Equal(CommunityAccessRiskItemTypeGroups.HealthAndPersonalSafety.Count, CommunityAccessRiskItemTypeGroups.HealthAndPersonalSafety.Distinct().Count());
    }

    [Fact]
    public void IsExactlyTwentyTwoItemsTotal_FiveRoadTraffic_EightBoc_NineHealth()
    {
        Assert.Equal(22, Enum.GetValues<CommunityAccessRiskItemType>().Length);
        Assert.Equal(5, CommunityAccessRiskItemTypeGroups.RoadTraffic.Count);
        Assert.Equal(8, CommunityAccessRiskItemTypeGroups.BehavioursOfConcern.Count);
        Assert.Equal(9, CommunityAccessRiskItemTypeGroups.HealthAndPersonalSafety.Count);
    }

    [Fact]
    public void CategoryOf_AgreesWithGroupMembership_ForEveryCommunityAccessRiskItemTypeMember()
    {
        foreach (var type in Enum.GetValues<CommunityAccessRiskItemType>())
        {
            var expected = CommunityAccessRiskItemTypeGroups.RoadTraffic.Contains(type)
                ? CommunityAccessRiskCategory.RoadTraffic
                : CommunityAccessRiskItemTypeGroups.BehavioursOfConcern.Contains(type)
                    ? CommunityAccessRiskCategory.BehavioursOfConcern
                    : CommunityAccessRiskCategory.HealthAndPersonalSafety;
            Assert.Equal(expected, CommunityAccessRiskItemTypeGroups.CategoryOf(type));
        }
    }
}
