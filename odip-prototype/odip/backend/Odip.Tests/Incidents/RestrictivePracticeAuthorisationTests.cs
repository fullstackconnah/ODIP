using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>The one "authorised" rule for a register entry (owner decision 2026-10-14): active, with who authorised it and when. The incident's determination and the wizard's badges both use it.</summary>
public class RestrictivePracticeAuthorisationTests
{
    private static RestrictivePractice Entry(bool isActive = true, string? authorisedBy = "Dr Chen", DateOnly? authorisationDate = null, bool noDate = false) => new()
    {
        Id = Guid.NewGuid(), Type = RestrictivePracticeType.Seclusion, Description = "Seclusion room",
        IsActive = isActive, AuthorisedBy = authorisedBy, AuthorisationDate = noDate ? null : authorisationDate ?? new DateOnly(2026, 9, 1),
    };

    [Fact]
    public void ActiveWithAuthorisedByAndDate_IsAuthorised() => Assert.True(RestrictivePracticeAuthorisation.IsAuthorised(Entry()));

    [Fact]
    public void Inactive_IsNotAuthorised() => Assert.False(RestrictivePracticeAuthorisation.IsAuthorised(Entry(isActive: false)));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void BlankAuthorisedBy_IsNotAuthorised(string? authorisedBy) => Assert.False(RestrictivePracticeAuthorisation.IsAuthorised(Entry(authorisedBy: authorisedBy)));

    [Fact]
    public void NoAuthorisationDate_IsNotAuthorised() => Assert.False(RestrictivePracticeAuthorisation.IsAuthorised(Entry(noDate: true)));

    [Theory]
    [InlineData(RestrictivePracticeType.Seclusion, "seclusion")]
    [InlineData(RestrictivePracticeType.ChemicalRestraint, "chemical restraint")]
    [InlineData(RestrictivePracticeType.MechanicalRestraint, "mechanical restraint")]
    [InlineData(RestrictivePracticeType.PhysicalRestraint, "physical restraint")]
    [InlineData(RestrictivePracticeType.EnvironmentalRestraint, "environmental restraint")]
    [InlineData(RestrictivePracticeType.Unclassified, "an unclassified practice")]
    public void TypePhrase_IsSentenceCaseForUseMidSentence(RestrictivePracticeType type, string expected) =>
        Assert.Equal(expected, RestrictivePracticeAuthorisation.TypePhrase(type));
}
