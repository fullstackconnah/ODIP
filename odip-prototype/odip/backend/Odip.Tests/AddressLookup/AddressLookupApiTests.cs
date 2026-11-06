using System.Net;
using System.Text.Json;
using Odip.Api.RateLimiting;
using Odip.Tests.Integrations;
using Xunit;

namespace Odip.Tests.AddressLookup;

/// <summary>
/// POST /api/v1/address/suggest and GET /api/v1/address/details against a fake Google. The order of the answers is the contract: 401, 403, 429 (all before the action),
/// then 404 for no key, then the hand-checked input (400), then Google.
/// </summary>
public class AddressLookupApiTests
{
    private const string Session = "abcdefghijklmnopqrstuv";   // 22 URL-safe characters, as the browser makes them
    private const string SuggestUrl = "/v1/places:autocomplete";
    private const string DetailsUrl = "/v1/places/PLACE1?sessionToken=" + Session + "&languageCode=en-AU&regionCode=au";

    private const string Suggestions =
        """{"suggestions":[{"placePrediction":{"placeId":"PLACE1","structuredFormat":{"mainText":{"text":"12 Example Street"},"secondaryText":{"text":"Southport QLD, Australia"}}}},{"queryPrediction":{"text":{"text":"ignored"}}}]}""";

    private const string Place =
        """{"formattedAddress":"3/12 Example St, Southport QLD 4215, Australia","addressComponents":[{"longText":"3","shortText":"3","types":["subpremise"]},{"longText":"12","shortText":"12","types":["street_number"]},{"longText":"Example Street","shortText":"Example St","types":["route"]},{"longText":"Southport","shortText":"Southport","types":["locality","political"]},{"longText":"Queensland","shortText":"QLD","types":["administrative_area_level_1","political"]},{"longText":"4215","shortText":"4215","types":["postal_code"]}]}""";

    private static string Body(string q, string session = Session) => JsonSerializer.Serialize(new { q, session });

    private static StubHttpHandler FakeGoogle() => new StubHttpHandler()
        .On(HttpMethod.Post, SuggestUrl, HttpStatusCode.OK, Suggestions)
        .On(HttpMethod.Get, DetailsUrl, HttpStatusCode.OK, Place);

    // ── Who may call, and the key ─────────────────────────────────────────────────

    [Fact]
    public async Task Unsigned_Is401_AndGoogleIsNotCalled()
    {
        var google = FakeGoogle();
        await using var host = await AddressLookupHost.StartAsync(google);

        Assert.Equal(HttpStatusCode.Unauthorized, (await host.SuggestAsync(Body("12 Example"), role: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.DetailsAsync("?placeId=PLACE1&session=" + Session, role: null)).StatusCode);
        Assert.Empty(google.Requests);
    }

    [Theory]
    [InlineData("SupportWorker"), InlineData("ReadOnly")]
    public async Task ARoleThatMayNotEditAddresses_Is403(string role)
    {
        var google = FakeGoogle();
        await using var host = await AddressLookupHost.StartAsync(google);

        Assert.Equal(HttpStatusCode.Forbidden, (await host.SuggestAsync(Body("12 Example"), role)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.DetailsAsync("?placeId=PLACE1&session=" + Session, role)).StatusCode);
        Assert.Empty(google.Requests);
    }

    [Theory]
    [InlineData("Admin"), InlineData("Coordinator"), InlineData("SuperAdmin")]
    public async Task TheThreeAddressRoles_AreAdmitted(string role)
    {
        await using var host = await AddressLookupHost.StartAsync(FakeGoogle());
        Assert.Equal(HttpStatusCode.OK, (await host.SuggestAsync(Body("12 Example"), role)).StatusCode);
    }

    [Theory]
    [InlineData(null), InlineData(""), InlineData("   ")]
    public async Task WithNoKey_BothEndpointsAre404_BeforeAnyValidation_AndGoogleIsNotCalled(string? key)
    {
        var google = FakeGoogle();
        await using var host = await AddressLookupHost.StartAsync(google, key);

        Assert.Equal(HttpStatusCode.NotFound, (await host.SuggestAsync(Body("12 Example"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await host.SuggestAsync("not json")).StatusCode);   // the 404 comes before the 400 a bad body would get
        Assert.Equal(HttpStatusCode.NotFound, (await host.DetailsAsync("?placeId=PLACE1&session=" + Session)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await host.DetailsAsync("")).StatusCode);
        Assert.Empty(google.Requests);
    }

    // ── Input ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("{}"), InlineData("{\"q\":\"12 Example\"}"), InlineData("{\"q\":\"12 Example\",\"session\":\"has space\"}")]
    [InlineData("{\"q\":\"12 Example\",\"session\":\"abcdefghijklmnopqrstuvwxyz0123456789ABC\"}")]   // 39 characters: over Google's 36
    [InlineData("{\"session\":\"abcdefghijklmnopqrstuv\"}")]
    public async Task ABadSessionOrAMissingQ_Is400_AndGoogleIsNotCalled(string body)
    {
        var google = FakeGoogle();
        await using var host = await AddressLookupHost.StartAsync(google);

        Assert.Equal(HttpStatusCode.BadRequest, (await host.SuggestAsync(body)).StatusCode);
        Assert.Empty(google.Requests);
    }

    [Fact]
    public async Task ATextOver200Characters_Is400_AndUnder3CharactersIsAnEmptyList_WithoutCallingGoogle()
    {
        var google = FakeGoogle();
        await using var host = await AddressLookupHost.StartAsync(google);

        Assert.Equal(HttpStatusCode.BadRequest, (await host.SuggestAsync(Body(new string('a', 201)))).StatusCode);
        var short12 = await host.SuggestAsync(Body("  12 "));
        Assert.Equal(HttpStatusCode.OK, short12.StatusCode);
        Assert.Empty(Data(await short12.Content.ReadAsStringAsync()).EnumerateArray());
        Assert.Empty(google.Requests);
    }

    [Theory]
    [InlineData("?session=" + Session), InlineData("?placeId=P%2F1&session=" + Session), InlineData("?placeId=PLACE1"), InlineData("?placeId=PLACE1&session=bad%20token")]
    public async Task ABadPlaceIdOrSession_Is400_AndGoogleIsNotCalled(string query)
    {
        var google = FakeGoogle();
        await using var host = await AddressLookupHost.StartAsync(google);

        Assert.Equal(HttpStatusCode.BadRequest, (await host.DetailsAsync(query)).StatusCode);
        Assert.Empty(google.Requests);
    }

    // ── Suggest ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Suggest_ReturnsTheListWithoutTheCountry_AndAsksGoogleForAustraliaOnlyWithTheSessionAndTheFieldMask()
    {
        var google = FakeGoogle();
        await using var host = await AddressLookupHost.StartAsync(google);

        var response = await host.SuggestAsync(Body("12 Example"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rows = Data(await response.Content.ReadAsStringAsync()).EnumerateArray().ToList();
        var row = Assert.Single(rows);   // the query prediction in the fixture is dropped
        Assert.Equal(("PLACE1", "12 Example Street", "Southport QLD"),
            (row.GetProperty("placeId").GetString(), row.GetProperty("mainText").GetString(), row.GetProperty("secondaryText").GetString()));

        var sent = Assert.Single(google.Requests);
        Assert.Equal(HttpMethod.Post, sent.Method);
        Assert.Equal("https://places.googleapis.com" + SuggestUrl, sent.RequestUri!.GetLeftPart(UriPartial.Path));
        Assert.Equal(AddressLookupHost.Key, Assert.Single(sent.Headers.GetValues("X-Goog-Api-Key")));
        Assert.Equal("suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat", Assert.Single(sent.Headers.GetValues("X-Goog-FieldMask")));
        using var body = JsonDocument.Parse(Assert.Single(google.Bodies)!);
        var root = body.RootElement;
        Assert.Equal("12 Example", root.GetProperty("input").GetString());
        Assert.Equal(new[] { "au" }, root.GetProperty("includedRegionCodes").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal(Session, root.GetProperty("sessionToken").GetString());
        Assert.False(root.TryGetProperty("locationBias", out _) || root.TryGetProperty("locationRestriction", out _) || root.TryGetProperty("origin", out _));
    }

    [Fact]
    public async Task Suggest_WhenGoogleFails_Is200WithAnEmptyList_ForA500_ABadBody_ANetworkError_AndATimeout()
    {
        var failures = new[]
        {
            new StubHttpHandler().On(HttpMethod.Post, SuggestUrl, HttpStatusCode.InternalServerError),
            new StubHttpHandler().On(HttpMethod.Post, SuggestUrl, HttpStatusCode.OK, "<html>not json"),
            new StubHttpHandler().On(HttpMethod.Post, SuggestUrl, HttpStatusCode.OK, """{"suggestions":"nope"}"""),
            new StubHttpHandler().OnThrow(SuggestUrl, new HttpRequestException("no route to host")),
            new StubHttpHandler().OnThrow(SuggestUrl, new TaskCanceledException("the 5 s timeout")),
        };
        foreach (var google in failures)
        {
            await using var host = await AddressLookupHost.StartAsync(google);
            var response = await host.SuggestAsync(Body("12 Example"));
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Empty(Data(await response.Content.ReadAsStringAsync()).EnumerateArray());
        }
    }

    [Fact]
    public async Task Suggest_NoMessageEverLogged_ContainsTheTypedText()
    {
        var google = new StubHttpHandler().On(HttpMethod.Post, SuggestUrl, HttpStatusCode.InternalServerError);
        await using var host = await AddressLookupHost.StartAsync(google);

        await host.SuggestAsync(Body("77 Secretname Crescent"));
        await host.SuggestAsync("{\"q\":\"88 Secretname Crescent\",\"session\":\"bad session\"}");

        Assert.NotEmpty(host.Logs);   // the warning for the failure is there
        Assert.DoesNotContain(host.Logs, l => l.Contains("Secretname", StringComparison.OrdinalIgnoreCase));
    }

    // ── Details ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Details_SplitsThePlaceIntoTheFourFields_WithTheSessionAndAFieldMaskThatHasNoLocation()
    {
        var google = FakeGoogle();
        await using var host = await AddressLookupHost.StartAsync(google);

        var response = await host.DetailsAsync("?placeId=PLACE1&session=" + Session);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var d = Data(await response.Content.ReadAsStringAsync());
        Assert.Equal(("3/12 Example Street", "Southport", "QLD", "4215", "3/12 Example St, Southport QLD 4215"),
            (d.GetProperty("street").GetString(), d.GetProperty("suburb").GetString(), d.GetProperty("state").GetString(), d.GetProperty("postcode").GetString(), d.GetProperty("formattedAddress").GetString()));

        var sent = Assert.Single(google.Requests);
        Assert.Equal(HttpMethod.Get, sent.Method);
        Assert.Equal(AddressLookupHost.Key, Assert.Single(sent.Headers.GetValues("X-Goog-Api-Key")));
        var mask = Assert.Single(sent.Headers.GetValues("X-Goog-FieldMask"));
        Assert.Equal("addressComponents,formattedAddress", mask);
        Assert.DoesNotContain("location", mask);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError), InlineData(HttpStatusCode.NotFound)]
    public async Task Details_WhenGoogleFails_Is502_WithAMessageThatNamesNoAddress(HttpStatusCode google)
    {
        var stub = new StubHttpHandler().On(HttpMethod.Get, DetailsUrl, google);
        await using var host = await AddressLookupHost.StartAsync(stub);

        var response = await host.DetailsAsync("?placeId=PLACE1&session=" + Session);

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Contains("Address details are unavailable.", await response.Content.ReadAsStringAsync());
    }

    // ── The per-user limit ────────────────────────────────────────────────────────

    [Fact]
    public async Task TheSecondCallInTheWindow_Is429_ForTheSameUser_BothEndpointsShareTheBudget_AndAnotherUserIsNotAffected()
    {
        var google = FakeGoogle();
        await using var host = await AddressLookupHost.StartAsync(google, limits: new AddressLookupRateLimits(1, TimeSpan.FromMinutes(1)));

        Assert.Equal(HttpStatusCode.OK, (await host.SuggestAsync(Body("12 Example"), user: "u1")).StatusCode);
        var limited = await host.DetailsAsync("?placeId=PLACE1&session=" + Session, user: "u1");
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Contains("Too many address lookups. Wait a minute and try again.", await limited.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, (await host.SuggestAsync(Body("12 Example"), user: "u2")).StatusCode);
        Assert.Equal(2, google.Requests.Count);   // the refused call never reached Google
    }

    [Fact]
    public async Task TheLimitIsAppliedBeforeTheKeyCheck_SoANoKeyHostStillCountsCalls()
    {
        await using var host = await AddressLookupHost.StartAsync(FakeGoogle(), key: null, limits: new AddressLookupRateLimits(1, TimeSpan.FromMinutes(1)));

        Assert.Equal(HttpStatusCode.NotFound, (await host.SuggestAsync(Body("12 Example"))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await host.SuggestAsync(Body("12 Example"))).StatusCode);
    }

    [Fact]
    public async Task ASuggestBodyOver4096Bytes_Is413_AndANormalBodyIs200()
    {
        await using var host = await AddressLookupHost.StartAsync(FakeGoogle());

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await host.SuggestAsync(Body(new string('a', 5000)))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await host.SuggestAsync(Body("12 Example"))).StatusCode);
    }

    private static JsonElement Data(string json) => JsonDocument.Parse(json).RootElement.GetProperty("data");
}
