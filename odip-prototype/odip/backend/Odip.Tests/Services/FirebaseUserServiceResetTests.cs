using System.Text.Json;
using FirebaseAdmin.Auth;
using Odip.Api.Services;
using Odip.Tests.Controllers;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>
/// ResetSecondFactorsAsync through a fake <see cref="IFirebaseAdminGateway"/>: look the uid up, clear the factors, THEN revoke refresh tokens, and say
/// NoAccount (touching nothing) when there is no Firebase account. The Identity Toolkit request itself is built by
/// <see cref="FirebaseAdminGateway.BuildClearSecondFactorsRequest"/>.
/// </summary>
public class FirebaseUserServiceResetTests
{
    private const string Email = "pat.target@acme.example.com";

    private sealed class Gateway : IFirebaseAdminGateway
    {
        public List<string> Calls { get; } = [];
        public Exception? FailClear { get; set; }
        public bool NoAccount { get; set; }
        public Exception? FailRevoke { get; set; }

        public Task<string> GetUidByEmailAsync(string email, CancellationToken ct)
        {
            Calls.Add($"get:{email}");
            return NoAccount ? throw FirebaseTestExceptions.WithCode(AuthErrorCode.UserNotFound) : Task.FromResult("uid-9");
        }

        public Task<string> CreateUserAsync(UserRecordArgs args, CancellationToken ct) => throw new NotSupportedException();
        public Task UpdateUserAsync(UserRecordArgs args, CancellationToken ct) => throw new NotSupportedException();
        public Task DeleteUserAsync(string uid, CancellationToken ct) => throw new NotSupportedException();

        public Task ClearSecondFactorsAsync(string uid, CancellationToken ct)
        {
            Calls.Add($"clear-mfa:{uid}");
            return FailClear is null ? Task.CompletedTask : throw FailClear;
        }

        public Task RevokeRefreshTokensAsync(string uid, CancellationToken ct)
        {
            Calls.Add($"revoke:{uid}");
            return FailRevoke is null ? Task.CompletedTask : throw FailRevoke;
        }
    }

    [Fact]
    public async Task Reset_looks_the_uid_up_clears_the_factors_then_revokes_the_tokens()
    {
        var gateway = new Gateway();

        var result = await new FirebaseUserService(gateway).ResetSecondFactorsAsync(Email, CancellationToken.None);

        Assert.Equal(SecondFactorResetResult.Done, result);
        Assert.Equal([$"get:{Email}", "clear-mfa:uid-9", "revoke:uid-9"], gateway.Calls);
    }

    [Fact]
    public async Task Reset_with_no_firebase_account_is_NoAccount_and_changes_nothing()
    {
        var gateway = new Gateway { NoAccount = true };

        var result = await new FirebaseUserService(gateway).ResetSecondFactorsAsync(Email, CancellationToken.None);

        Assert.Equal(SecondFactorResetResult.NoAccount, result);
        Assert.Equal([$"get:{Email}"], gateway.Calls);
    }

    [Fact]
    public async Task A_failed_clear_throws_and_does_not_revoke()
    {
        var gateway = new Gateway { FailClear = new HttpRequestException("503") };

        await Assert.ThrowsAsync<HttpRequestException>(() => new FirebaseUserService(gateway).ResetSecondFactorsAsync(Email, CancellationToken.None));

        Assert.DoesNotContain("revoke:uid-9", gateway.Calls);
    }

    [Fact]
    public async Task A_failed_revoke_after_the_clear_is_RevokeFailed_not_a_throw()
    {
        var gateway = new Gateway { FailRevoke = new HttpRequestException("503") };

        var result = await new FirebaseUserService(gateway).ResetSecondFactorsAsync(Email, CancellationToken.None);

        Assert.Equal(SecondFactorResetResult.RevokeFailed, result);
    }

    [Fact]
    public async Task The_identity_toolkit_request_posts_localId_and_an_empty_mfa_object_with_a_bearer_token()
    {
        var request = FirebaseAdminGateway.BuildClearSecondFactorsRequest("odip-test", "tok-123", "uid-9");

        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://identitytoolkit.googleapis.com/v1/projects/odip-test/accounts:update", request.RequestUri!.ToString());
        Assert.Equal(("Bearer", "tok-123"), (request.Headers.Authorization!.Scheme, request.Headers.Authorization.Parameter));
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal("uid-9", body.RootElement.GetProperty("localId").GetString());
        Assert.Equal(JsonValueKind.Object, body.RootElement.GetProperty("mfa").ValueKind);
        Assert.Empty(body.RootElement.GetProperty("mfa").EnumerateObject());
    }
}
