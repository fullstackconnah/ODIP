using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using Odip.Api.Services.Microsoft;
using Xunit;
using T = Odip.Tests.Auth.Microsoft.MicrosoftTestTokens;

namespace Odip.Tests.Auth.Microsoft;

public class MicrosoftIdTokenValidatorTests
{
    private static Task<MicrosoftIdTokenResult> Run(string token, string nonce = "n1", T.CountingMetadata? m = null) =>
        T.Validator(m).ValidateAsync(token, nonce, CancellationToken.None);

    private static void Refused(MicrosoftIdTokenResult r, string code)
    {
        Assert.Null(r.Identity);
        Assert.Equal(code, r.Refusal);
    }

    private static Dictionary<string, object> With(string k, object v) => new() { [k] = v };

    [Fact]
    public async Task V1_Valid_ReturnsTidOidEmail()
    {
        var oid = Guid.NewGuid();
        var r = await Run(T.Mint(oid: oid));
        Assert.Null(r.Refusal);
        Assert.Equal(T.OrgTid, r.Identity!.TenantId);
        Assert.Equal(oid, r.Identity.ObjectId);
        Assert.Equal("pat@contoso.example", r.Identity.Email);
        Assert.False(r.Identity.EmailDomainVerified);
    }

    [Fact] public async Task V2_WrongAudience_InvalidToken() => Refused(await Run(T.Mint(aud: "someone-else")), MicrosoftRefusal.InvalidToken);

    [Fact] public async Task V3_IssuerOfAnotherTenant_InvalidToken() => Refused(await Run(T.Mint(iss: $"https://login.microsoftonline.com/{T.OtherTid}/v2.0")), MicrosoftRefusal.InvalidToken);

    [Fact] public async Task V4_IssuerNotMicrosoft_InvalidToken() => Refused(await Run(T.Mint(iss: $"https://evil.example/{T.OrgTid}/v2.0")), MicrosoftRefusal.InvalidToken);

    [Fact] public async Task V5_MissingTid_InvalidToken() => Refused(await Run(T.Mint(omitTid: true)), MicrosoftRefusal.InvalidToken);

    [Fact]
    public async Task V6_UnknownSigningKey_InvalidToken_AfterOneRefresh()
    {
        var m = new T.CountingMetadata();
        var stranger = new RsaSecurityKey(RSA.Create(2048)) { KeyId = "other-kid" };
        Refused(await Run(T.Mint(key: stranger), m: m), MicrosoftRefusal.InvalidToken);
        Assert.Equal(1, m.Refreshes);
    }

    [Fact]
    public async Task V6b_KeyRollover_RefreshThenValid()
    {
        var newKey = new RsaSecurityKey(RSA.Create(2048)) { KeyId = "new-kid" };
        var m = new T.CountingMetadata();
        m.OnRefresh = () => m.Keys.Add(newKey);
        var r = await Run(T.Mint(key: newKey), m: m);
        Assert.Null(r.Refusal);
        Assert.Equal(1, m.Refreshes);
    }

    [Fact] public async Task V7_Expired_InvalidToken() => Refused(await Run(T.Mint(expires: DateTime.UtcNow.AddMinutes(-10))), MicrosoftRefusal.InvalidToken);

    [Fact]
    public async Task V8_Unsigned_InvalidToken()
    {
        static string B64(string s) => Base64UrlEncoder.Encode(Encoding.UTF8.GetBytes(s));
        var exp = DateTimeOffset.UtcNow.AddMinutes(30).ToUnixTimeSeconds();
        var payload = B64($"{{\"iss\":\"https://login.microsoftonline.com/{T.OrgTid}/v2.0\",\"aud\":\"{T.ClientId}\",\"tid\":\"{T.OrgTid}\",\"oid\":\"{Guid.NewGuid()}\",\"nonce\":\"n1\",\"exp\":{exp}}}");
        Refused(await Run($"{B64("{\"alg\":\"none\"}")}.{payload}."), MicrosoftRefusal.InvalidToken);
    }

    [Fact]
    public async Task V9_Hs256_InvalidToken()
    {
        var sym = new SymmetricSecurityKey(new byte[64]) { KeyId = "test-kid" };
        Refused(await Run(T.Mint(key: sym, alg: SecurityAlgorithms.HmacSha256)), MicrosoftRefusal.InvalidToken);
    }

    [Fact] public async Task V10_NonceMismatch_InvalidToken() => Refused(await Run(T.Mint(nonce: "other")), MicrosoftRefusal.InvalidToken);
    [Fact] public async Task V11_NonceMissing_InvalidToken() => Refused(await Run(T.Mint(nonce: null)), MicrosoftRefusal.InvalidToken);

    [Fact] public async Task V12_ConsumerTenant_MicrosoftPersonalAccount() => Refused(await Run(T.Mint(tid: T.Consumer)), MicrosoftRefusal.MicrosoftPersonalAccount);

    [Fact]
    public async Task V13_IdpDiffersFromIssuer_MicrosoftGuest() =>
        Refused(await Run(T.Mint(extra: With("idp", "https://sts.windows.net/other/"))), MicrosoftRefusal.MicrosoftGuest);

    [Fact]
    public async Task V14_IdpEqualsIssuer_Accepted() =>
        Assert.Null((await Run(T.Mint(extra: With("idp", $"https://login.microsoftonline.com/{T.OrgTid}/v2.0")))).Refusal);

    [Theory]
    [InlineData("1")]
    [InlineData(1)]
    public async Task V15_AcctOne_MicrosoftGuest(object acct) =>
        Refused(await Run(T.Mint(extra: With("acct", acct))), MicrosoftRefusal.MicrosoftGuest);

    [Fact] public async Task V16_AcctZero_Accepted() => Assert.Null((await Run(T.Mint(extra: With("acct", 0)))).Refusal);

    [Fact] public async Task V17_MissingOid_InvalidToken() => Refused(await Run(T.Mint(omitOid: true)), MicrosoftRefusal.InvalidToken);

    [Fact]
    public async Task V18_NoEmail_FallsBackToPreferredUsername() =>
        Assert.Equal("pat@contoso.example", (await Run(T.Mint(email: null, upn: "pat@contoso.example"))).Identity!.Email);

    [Fact] public async Task V19_UpnWithoutAt_EmailNull() => Assert.Null((await Run(T.Mint(email: null, upn: "pat"))).Identity!.Email);

    [Theory]
    [InlineData(true, true)]
    [InlineData("true", true)]
    [InlineData(1, true)]
    [InlineData("1", true)]
    [InlineData("0", false)]
    [InlineData(false, false)]
    public async Task V20_XmsEdov_SetsEmailDomainVerified(object edov, bool expected) =>
        Assert.Equal(expected, (await Run(T.Mint(extra: With("xms_edov", edov)))).Identity!.EmailDomainVerified);

    [Fact]
    public async Task V21_Wids_ReadFromArrayClaimAndFromJsonStringClaim()
    {
        var id = MicrosoftAuthRig.GlobalAdmin;
        Assert.Equal(new[] { Guid.Parse(id) }, (await Run(T.Mint(extra: With("wids", new[] { id })))).Identity!.DirectoryRoles);
        Assert.Equal(new[] { Guid.Parse(id) }, (await Run(T.Mint(extra: With("wids", $"[\"{id}\"]")))).Identity!.DirectoryRoles);
        Assert.Empty((await Run(T.Mint())).Identity!.DirectoryRoles!);
    }
}
