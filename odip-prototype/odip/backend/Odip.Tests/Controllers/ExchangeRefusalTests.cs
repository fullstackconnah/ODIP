using System.Reflection;
using Odip.Api.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The refusal codes are a contract with the sign-in page (frontend/src/lib/signInRefusal.ts holds the same list and words each one for the person),
/// and the two sides live in separate Docker builds, so no test can compare them. Pinning the list here makes a change to it a deliberate one: whoever
/// edits it is pointed at the page that has to follow. What each code means and when it is used is pinned in AuthControllerExchangeTests.
/// </summary>
public class ExchangeRefusalTests
{
    private static readonly string[] Codes =
        ["InvalidToken", "EmailNotVerified", "ProviderNotAllowed", "NoOdipAccount", "Ambiguous", "TenantInactive", "LockedOut"];

    [Fact]
    public void The_codes_are_exactly_the_ones_the_sign_in_page_knows_so_a_change_to_them_is_deliberate()
    {
        var declared = typeof(ExchangeRefusal).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(field => field.IsLiteral && field.FieldType == typeof(string))
            .Select(field => (string)field.GetRawConstantValue()!)
            .ToArray();

        Assert.Equal(Codes.Order(), declared.Order());
    }

    [Fact]
    public void Every_code_has_a_sentence_of_its_own_and_anything_else_gets_the_generic_one()
    {
        var sentences = Codes.Select(ExchangeRefusal.MessageFor).ToArray();

        Assert.Equal(Codes.Length, sentences.Distinct().Count());
        Assert.Equal("Invalid or expired token", ExchangeRefusal.MessageFor(ExchangeRefusal.InvalidToken));
        Assert.Equal("Invalid or expired token", ExchangeRefusal.MessageFor("SomethingNobodyHasMetYet"));
    }

    [Fact]
    public void Ambiguous_says_no_more_than_to_ask_the_administrator_and_not_that_other_accounts_share_the_address()
    {
        var sentence = ExchangeRefusal.MessageFor(ExchangeRefusal.Ambiguous);

        Assert.Equal("We can't sign you in with this email address yet. Ask your administrator to check your account.", sentence);
        Assert.DoesNotContain("more than one", sentence, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("another", sentence, StringComparison.OrdinalIgnoreCase);
    }
}
