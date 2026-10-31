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

    // The end date is inclusive; a use on it is still authorised, the next day is not.
    [Theory]
    [InlineData("2026-10-19", true)]
    [InlineData("2026-10-20", true)]
    [InlineData("2026-10-21", false)]
    public void EndDate_IsInclusive(string onDate, bool expected)
    {
        var entry = Entry();
        entry.AuthorisationEndDate = new DateOnly(2026, 10, 20);
        Assert.Equal(expected, RestrictivePracticeAuthorisation.IsAuthorised(entry, DateOnly.Parse(onDate)));
    }

    [Fact]
    public void NoEndDate_IsOpenEnded() => Assert.True(RestrictivePracticeAuthorisation.IsAuthorised(Entry(), new DateOnly(2100, 1, 1)));

    [Fact]
    public void OnDateBeforeAuthorisationDate_IsNotAuthorised() =>
        Assert.False(RestrictivePracticeAuthorisation.IsAuthorised(Entry(authorisationDate: new DateOnly(2026, 10, 25)), new DateOnly(2026, 10, 24)));

    private static RestrictivePractice Linked(MedicationType type, RestrictivePracticeUseKind stored, bool loadNav = true)
    {
        var rp = Entry();
        rp.UseKind = stored;
        rp.RelatedMedicationId = Guid.NewGuid();
        if (loadNav) rp.RelatedMedication = new ParticipantMedication { Id = rp.RelatedMedicationId.Value, Type = type };
        return rp;
    }

    [Fact]
    public void UseKindOf_LinkedPrnMedicine_IsPrn() =>
        Assert.Equal(RestrictivePracticeUseKind.Prn, RestrictivePracticeAuthorisation.UseKindOf(Linked(MedicationType.Prn, RestrictivePracticeUseKind.Routine)));

    [Fact]
    public void UseKindOf_LinkedRegularMedicine_IsRoutine_EvenWhenStoredPrn() =>
        Assert.Equal(RestrictivePracticeUseKind.Routine, RestrictivePracticeAuthorisation.UseKindOf(Linked(MedicationType.Regular, RestrictivePracticeUseKind.Prn)));

    [Fact]
    public void UseKindOf_Unlinked_IsStored()
    {
        var rp = Entry();
        rp.UseKind = RestrictivePracticeUseKind.Prn;
        Assert.Equal(RestrictivePracticeUseKind.Prn, RestrictivePracticeAuthorisation.UseKindOf(rp));
    }

    [Fact]
    public void UseKindOf_LinkedWithoutNavigation_Throws() =>
        Assert.Throws<InvalidOperationException>(() => RestrictivePracticeAuthorisation.UseKindOf(Linked(MedicationType.Prn, RestrictivePracticeUseKind.Routine, loadNav: false)));

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
