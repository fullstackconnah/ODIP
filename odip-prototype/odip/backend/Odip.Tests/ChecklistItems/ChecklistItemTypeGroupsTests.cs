using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.ChecklistItems;

/// <summary>
/// INTAKE-03/04, review-round polish — partition-completeness coverage for
/// <see cref="ChecklistItemTypeGroups"/>: CommunityMobilityRisk and CommunityBehaviourOfConcern
/// must together cover every <see cref="ChecklistItemType"/> member exactly once (no omission, no
/// overlap), so a future 22nd ChecklistItemType member that nobody remembers to add to either list
/// fails loudly here instead of silently misclassifying (falling through to
/// CommunityBehaviourOfConcern by default in <see cref="ChecklistType.CommunityBehaviourOfConcern"/>
/// derivation, or simply never rendering in either of the participant-detail/wizard's two grouped
/// checklist sections). Mirrors <c>AdlTypeGroupsTests</c> exactly, including the Enum.GetValues&lt;T&gt;()
/// + HashSet completeness idiom.
/// </summary>
public class ChecklistItemTypeGroupsTests
{
    [Fact]
    public void CommunityMobilityRiskAndCommunityBehaviourOfConcern_TogetherCoverEveryChecklistItemTypeMember_WithNoOmission()
    {
        var union = ChecklistItemTypeGroups.CommunityMobilityRisk.Concat(ChecklistItemTypeGroups.CommunityBehaviourOfConcern).ToHashSet();

        Assert.Equal(Enum.GetValues<ChecklistItemType>().ToHashSet(), union);
    }

    [Fact]
    public void CommunityMobilityRiskAndCommunityBehaviourOfConcern_DoNotOverlap()
    {
        var overlap = ChecklistItemTypeGroups.CommunityMobilityRisk.Intersect(ChecklistItemTypeGroups.CommunityBehaviourOfConcern).ToList();

        Assert.Empty(overlap);
    }

    [Fact]
    public void CommunityMobilityRiskAndCommunityBehaviourOfConcern_HaveNoInternalDuplicates()
    {
        Assert.Equal(ChecklistItemTypeGroups.CommunityMobilityRisk.Count, ChecklistItemTypeGroups.CommunityMobilityRisk.Distinct().Count());
        Assert.Equal(ChecklistItemTypeGroups.CommunityBehaviourOfConcern.Count, ChecklistItemTypeGroups.CommunityBehaviourOfConcern.Distinct().Count());
    }

    [Fact]
    public void CategoryOf_AgreesWithGroupMembership_ForEveryChecklistItemTypeMember()
    {
        foreach (var type in Enum.GetValues<ChecklistItemType>())
        {
            var expected = ChecklistItemTypeGroups.CommunityMobilityRisk.Contains(type)
                ? ChecklistType.CommunityMobilityRisk
                : ChecklistType.CommunityBehaviourOfConcern;
            Assert.Equal(expected, ChecklistItemTypeGroups.CategoryOf(type));
        }
    }
}
