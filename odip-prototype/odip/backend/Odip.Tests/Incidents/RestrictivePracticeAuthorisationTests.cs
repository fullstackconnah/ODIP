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

    private static readonly DateOnly Today = new(2026, 10, 30);

    [Fact]
    public void ActiveWithAuthorisedByAndDate_IsAuthorised() => Assert.True(RestrictivePracticeAuthorisation.IsAuthorised(Entry(), Today));

    [Fact]
    public void Inactive_IsNotAuthorised() => Assert.False(RestrictivePracticeAuthorisation.IsAuthorised(Entry(isActive: false), Today));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void BlankAuthorisedBy_IsNotAuthorised(string? authorisedBy) => Assert.False(RestrictivePracticeAuthorisation.IsAuthorised(Entry(authorisedBy: authorisedBy), Today));

    [Fact]
    public void NoAuthorisationDate_IsNotAuthorised() => Assert.False(RestrictivePracticeAuthorisation.IsAuthorised(Entry(noDate: true), Today));

    // Today is the organisation's date: dated today or earlier is in force, dated after it is not yet.
    [Theory]
    [InlineData(-1, true)]
    [InlineData(0, true)]
    [InlineData(1, false)]
    public void AuthorisationDate_IsInForceFromItsOwnDay(int daysFromToday, bool expected) =>
        Assert.Equal(expected, RestrictivePracticeAuthorisation.IsAuthorised(Entry(authorisationDate: Today.AddDays(daysFromToday)), Today));

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
