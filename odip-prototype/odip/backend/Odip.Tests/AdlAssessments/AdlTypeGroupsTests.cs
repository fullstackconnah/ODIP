using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.AdlAssessments;

/// <summary>
/// INTAKE sub-wave C2, review-round polish — partition-completeness coverage for
/// <see cref="AdlTypeGroups"/>: Personal and CommunityDomestic must together cover every
/// <see cref="AdlType"/> member exactly once (no omission, no overlap), so a future 21st
/// AdlType member that nobody remembers to add to either list fails loudly here instead of
/// silently misclassifying (falling through to CommunityDomestic by default in
/// <see cref="AdlTypeGroups.CategoryOf"/>, or simply never rendering in either of the
/// participant-detail/wizard's two grouped sections). Mirrors the Enum.GetValues&lt;T&gt;()
/// + HashSet completeness idiom this codebase already uses for fixed-enumerated-set grids
/// (see ParticipantHealthConditionsControllerTests/ParticipantAdlAssessmentsControllerTests'
/// GetForParticipant "synthesizes all N as unanswered" tests).
/// </summary>
public class AdlTypeGroupsTests
{
    [Fact]
    public void PersonalAndCommunityDomestic_TogetherCoverEveryAdlTypeMember_WithNoOmission()
    {
        var union = AdlTypeGroups.Personal.Concat(AdlTypeGroups.CommunityDomestic).ToHashSet();

        Assert.Equal(Enum.GetValues<AdlType>().ToHashSet(), union);
    }

    [Fact]
    public void PersonalAndCommunityDomestic_DoNotOverlap()
    {
        var overlap = AdlTypeGroups.Personal.Intersect(AdlTypeGroups.CommunityDomestic).ToList();

        Assert.Empty(overlap);
    }

    [Fact]
    public void PersonalAndCommunityDomestic_HaveNoInternalDuplicates()
    {
        Assert.Equal(AdlTypeGroups.Personal.Count, AdlTypeGroups.Personal.Distinct().Count());
        Assert.Equal(AdlTypeGroups.CommunityDomestic.Count, AdlTypeGroups.CommunityDomestic.Distinct().Count());
    }

    [Fact]
    public void CategoryOf_AgreesWithGroupMembership_ForEveryAdlTypeMember()
    {
        foreach (var type in Enum.GetValues<AdlType>())
        {
            var expected = AdlTypeGroups.Personal.Contains(type) ? AdlCategory.Personal : AdlCategory.CommunityDomestic;
            Assert.Equal(expected, AdlTypeGroups.CategoryOf(type));
        }
    }
}
