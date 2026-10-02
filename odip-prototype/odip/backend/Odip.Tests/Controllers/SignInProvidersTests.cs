using System.Collections.Immutable;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json.Linq;
using Odip.Api.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// How the exchange reads the sign-in provider out of a verified token, and which providers it lets in. The reader is exercised on claims built by
/// the Admin SDK's own decoding (<see cref="FirebaseTestClaims"/>), because a hand-made dictionary is a shape production never produces: an
/// unreadable provider is a refusal, so a reader written for the wrong shape would turn every sign-in into a 401.
/// </summary>
public class SignInProvidersTests
{
    private static IReadOnlyDictionary<string, object> Payload(string json) => FirebaseTestClaims.FromPayload(json);

    private static IConfiguration Config(Dictionary<string, string?> settings) => new ConfigurationBuilder().AddInMemoryCollection(settings).Build();

    // ── Reading the provider ────────────────────────────────────────────

    [Fact]
    public void The_SDKs_own_decoding_hands_over_the_firebase_claim_as_a_JObject_which_is_the_shape_the_reader_is_written_for()
    {
        // A canary for an SDK upgrade: if this stops being a JObject, SignInProviders.From has to be looked at before anyone signs in.
        var claims = FirebaseTestClaims.For("jane.smith@gmail.com", signInProvider: "password");

        Assert.IsType<JObject>(claims["firebase"]);
        Assert.Equal("password", SignInProviders.From(claims));
    }

    [Theory]
    [InlineData("password")]
    [InlineData("custom")]
    [InlineData("google.com")]
    [InlineData("microsoft.com")]
    [InlineData("saml.acme")]
    public void It_reads_the_provider_of_a_token_the_way_the_SDK_hands_it_over(string provider)
    {
        Assert.Equal(provider, SignInProviders.From(FirebaseTestClaims.For("jane.smith@gmail.com", signInProvider: provider)));
    }

    [Fact]
    public void It_trims_the_provider()
    {
        Assert.Equal("password", SignInProviders.From(Payload("""{"firebase":{"sign_in_provider":" password "}}""")));
    }

    [Theory]
    [InlineData("""{"email":"a@b.com"}""")]                                         // no firebase claim
    [InlineData("""{"firebase":null}""")]
    [InlineData("""{"firebase":"password"}""")]                                     // not an object
    [InlineData("""{"firebase":["password"]}""")]
    [InlineData("""{"firebase":{}}""")]                                             // no provider in it
    [InlineData("""{"firebase":{"identities":{"email":["a@b.com"]}}}""")]
    [InlineData("""{"firebase":{"sign_in_provider":null}}""")]
    [InlineData("""{"firebase":{"sign_in_provider":5}}""")]                         // not a string
    [InlineData("""{"firebase":{"sign_in_provider":true}}""")]
    [InlineData("""{"firebase":{"sign_in_provider":{"name":"password"}}}""")]
    [InlineData("""{"firebase":{"sign_in_provider":""}}""")]                        // blank
    [InlineData("""{"firebase":{"sign_in_provider":"  "}}""")]
    [InlineData("""{"firebase":{"Sign_In_Provider":"password"}}""")]               // the claim's name is exact
    public void It_reads_nothing_from_a_token_that_does_not_carry_a_readable_provider(string payload)
    {
        Assert.Null(SignInProviders.From(Payload(payload)));
    }

    [Fact]
    public void It_reads_a_firebase_claim_held_as_a_dictionary()
    {
        // Not what the SDK produces today; what another decoder, or a fake, would.
        var asDictionary = new Dictionary<string, object> { ["sign_in_provider"] = "google.com" };
        var asImmutable = ImmutableDictionary<string, object>.Empty.Add("sign_in_provider", "google.com");

        Assert.Equal("google.com", SignInProviders.From(new Dictionary<string, object> { ["firebase"] = asDictionary }));
        Assert.Equal("google.com", SignInProviders.From(new Dictionary<string, object> { ["firebase"] = asImmutable }));
        Assert.Null(SignInProviders.From(new Dictionary<string, object> { ["firebase"] = new Dictionary<string, object> { ["sign_in_provider"] = 5 } }));
    }

    [Fact]
    public void It_reads_a_firebase_claim_held_as_a_JsonElement()
    {
        // What the SDK would hand over if it moved to System.Text.Json.
        static IReadOnlyDictionary<string, object> Claims(string json) => new Dictionary<string, object> { ["firebase"] = JsonDocument.Parse(json).RootElement.Clone() };

        Assert.Equal("microsoft.com", SignInProviders.From(Claims("""{"sign_in_provider":"microsoft.com"}""")));
        Assert.Null(SignInProviders.From(Claims("""{"sign_in_provider":5}""")));
        Assert.Null(SignInProviders.From(Claims("""{}""")));
        Assert.Null(SignInProviders.From(Claims("\"password\"")));
    }

    // ── The providers allowed ───────────────────────────────────────────

    [Fact]
    public void Nothing_configured_allows_email_and_password_and_custom_tokens_and_no_other()
    {
        Assert.True(SignInProviders.Allowed(null).SetEquals(["password", "custom"]));
        Assert.True(SignInProviders.Allowed(Config([])).SetEquals(["password", "custom"]));
    }

    [Fact]
    public void A_list_in_the_configuration_replaces_the_default_it_does_not_add_to_it()
    {
        var allowed = SignInProviders.Allowed(Config(new() { ["Auth:AllowedSignInProviders:0"] = "microsoft.com", ["Auth:AllowedSignInProviders:1"] = "google.com" }));

        Assert.True(allowed.SetEquals(["microsoft.com", "google.com"]));
    }

    [Theory]
    [InlineData("password,google.com")]
    [InlineData("password, google.com")]
    [InlineData(" password ;google.com; ")]
    [InlineData("password,,google.com,")]
    public void One_value_with_commas_or_semicolons_is_a_list_the_way_an_environment_variable_gives_one(string value)
    {
        var allowed = SignInProviders.Allowed(Config(new() { ["Auth:AllowedSignInProviders"] = value }));

        Assert.True(allowed.SetEquals(["password", "google.com"]));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(",")]
    public void A_setting_with_nothing_in_it_falls_back_to_the_default_rather_than_locking_everyone_out(string value)
    {
        Assert.True(SignInProviders.Allowed(Config(new() { ["Auth:AllowedSignInProviders"] = value })).SetEquals(["password", "custom"]));
    }

    [Fact]
    public void Membership_ignores_case()
    {
        var allowed = SignInProviders.Allowed(Config(new() { ["Auth:AllowedSignInProviders:0"] = "Microsoft.COM" }));

        Assert.Contains("microsoft.com", allowed);
        Assert.Contains("MICROSOFT.com", allowed);
        Assert.DoesNotContain("password", allowed);
    }
}
