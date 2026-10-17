using Odip.Domain.Entities;
using Xunit;

namespace Odip.Tests.DomainTests;

/// <summary>A blank last name (a participant from an enquiry may have none) never leaves a trailing or double space in a display name.</summary>
public class FullNameTests
{
    [Theory]
    [InlineData("Jo", "Smith", "Jo Smith")]
    [InlineData("Jo", "", "Jo")]
    [InlineData("Jo", "   ", "Jo")]
    [InlineData("", "Smith", "Smith")]
    [InlineData("", "", "")]
    public void Participant_FullName_JoinsNonBlankParts(string first, string last, string expected) =>
        Assert.Equal(expected, new Participant { FirstName = first, LastName = last }.FullName);

    [Theory]
    [InlineData("Joey", "Smith", "Joey Smith")]
    [InlineData("Joey", "", "Joey")]
    [InlineData("Joey", "  ", "Joey")]
    public void Participant_FullName_UsesPreferredName(string preferred, string last, string expected) =>
        Assert.Equal(expected, new Participant { FirstName = "Jo", LastName = last, PreferredName = preferred }.FullName);

    [Theory]
    [InlineData("Jo", "", "Jo")]
    [InlineData("", "Smith", "Smith")]
    [InlineData("Jo", "Smith", "Jo Smith")]
    public void Contact_FullName_JoinsNonBlankParts(string first, string last, string expected) =>
        Assert.Equal(expected, new Contact { FirstName = first, LastName = last }.FullName);

    [Theory]
    [InlineData("Jo", "", "Jo")]
    [InlineData("", "Smith", "Smith")]
    [InlineData(" ", "Smith", "Smith")]
    [InlineData("Jo", "Smith", "Jo Smith")]
    public void Person_FullName_JoinsNonBlankParts(string first, string last, string expected) =>
        Assert.Equal(expected, new Person { FirstName = first, LastName = last }.FullName);

    [Theory]
    [InlineData("Jo", "", "Jo")]
    [InlineData("", "Smith", "Smith")]
    [InlineData("Jo", "Smith", "Jo Smith")]
    public void User_FullName_JoinsNonBlankParts(string first, string last, string expected) =>
        Assert.Equal(expected, new User { FirstName = first, LastName = last }.FullName);
}
