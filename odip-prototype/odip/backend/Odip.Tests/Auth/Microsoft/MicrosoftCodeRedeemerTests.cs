using System.Net;
using Microsoft.Extensions.Configuration;
using Odip.Api.Services.Microsoft;
using Xunit;

namespace Odip.Tests.Auth.Microsoft;

public class MicrosoftCodeRedeemerTests
{
    private sealed class Stub(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? Form { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            Form = await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status) { Content = new StringContent(body) };
        }
    }

    private static MicrosoftCodeRedeemer Redeemer(Stub stub) => new(new HttpClient(stub),
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Microsoft:ClientId"] = "cid", ["Microsoft:ClientSecret"] = "sec" }).Build());

    [Fact]
    public async Task PostsCodeVerifierAndSecret_ReturnsIdToken()
    {
        var stub = new Stub(HttpStatusCode.OK, "{\"id_token\":\"the.id.token\"}");
        var token = await Redeemer(stub).RedeemAsync("code1", "verifier1", "https://x.example/cb", default);

        Assert.Equal("the.id.token", token);
        Assert.Equal(MicrosoftCodeRedeemer.TokenEndpoint, stub.Request!.RequestUri!.ToString());
        var fields = System.Web.HttpUtility.ParseQueryString(stub.Form!);
        Assert.Equal("cid", fields["client_id"]);
        Assert.Equal("sec", fields["client_secret"]);
        Assert.Equal("authorization_code", fields["grant_type"]);
        Assert.Equal("code1", fields["code"]);
        Assert.Equal("https://x.example/cb", fields["redirect_uri"]);
        Assert.Equal("verifier1", fields["code_verifier"]);
        Assert.Equal("openid profile email", fields["scope"]);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, "{\"error\":\"invalid_grant\"}")]
    [InlineData(HttpStatusCode.OK, "{\"access_token\":\"x\"}")]
    [InlineData(HttpStatusCode.OK, "not json")]
    public async Task Non2xxOrNoIdToken_ReturnsNull(HttpStatusCode status, string body) =>
        Assert.Null(await Redeemer(new Stub(status, body)).RedeemAsync("c", "v", "https://x.example/cb", default));
}
