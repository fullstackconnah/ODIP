using System.Net.Http.Json;
using FirebaseAdmin;
using FirebaseAdmin.Auth;
using Google.Apis.Auth.OAuth2;

namespace Odip.Api.Services;

/// <summary>
/// The Firebase Admin SDK's account calls, behind a seam so a test can record them. <see cref="FirebaseAuth.DefaultInstance"/> is static and
/// cannot run offline, so without this the one piece of logic that must never verify or change an account that already exists
/// (<see cref="FirebaseUserService.EnsureSignInAccountAsync"/>) could only be text-scanned, and a scan cannot see a helper that sets a password or
/// calls an update from outside the method it reads. Like <see cref="IFirebaseTokenVerifier"/> it is not registered in DI:
/// <see cref="FirebaseUserService"/> falls back to the real one, and a unit test hands it a fake.
///
/// It is a thin pass-through with no decisions in it. Every decision (what to create, when to look first, what an existing account means) is in
/// <see cref="FirebaseUserService"/>, where a fake gateway can observe it. Nothing else in Odip.Api may call the SDK's account methods (a source-scan
/// test pins that), so this is the only place an account is ever created, read, updated or deleted.
/// </summary>
public interface IFirebaseAdminGateway
{
    /// <summary>
    /// The uid of the account with this email. Throws <see cref="FirebaseAuthException"/> with <see cref="AuthErrorCode.UserNotFound"/> when there
    /// is none, and another exception for any other failure, exactly as the SDK does.
    /// </summary>
    Task<string> GetUidByEmailAsync(string email, CancellationToken ct);

    /// <summary>Creates an account from <paramref name="args"/> and returns its uid. Throws as the SDK does (for example <see cref="AuthErrorCode.EmailAlreadyExists"/>).</summary>
    Task<string> CreateUserAsync(UserRecordArgs args, CancellationToken ct);

    /// <summary>Updates the account named by <paramref name="args"/>.Uid, changing only the fields <paramref name="args"/> sets.</summary>
    Task UpdateUserAsync(UserRecordArgs args, CancellationToken ct);

    /// <summary>Deletes the account with this uid.</summary>
    Task DeleteUserAsync(string uid, CancellationToken ct);

    /// <summary>Removes every enrolled second factor from the account (Identity Toolkit accounts:update with an empty mfa object). Throws on any failure.</summary>
    Task ClearSecondFactorsAsync(string uid, CancellationToken ct);

    /// <summary>Revokes the account's refresh tokens, so its next renewal fails and the person signs in again.</summary>
    Task RevokeRefreshTokensAsync(string uid, CancellationToken ct);
}

/// <inheritdoc cref="IFirebaseAdminGateway"/>
public sealed class FirebaseAdminGateway : IFirebaseAdminGateway
{
    public async Task<string> GetUidByEmailAsync(string email, CancellationToken ct) =>
        (await FirebaseAuth.DefaultInstance.GetUserByEmailAsync(email, ct)).Uid;

    public async Task<string> CreateUserAsync(UserRecordArgs args, CancellationToken ct) =>
        (await FirebaseAuth.DefaultInstance.CreateUserAsync(args, ct)).Uid;

    public async Task UpdateUserAsync(UserRecordArgs args, CancellationToken ct) =>
        await FirebaseAuth.DefaultInstance.UpdateUserAsync(args, ct);

    public Task DeleteUserAsync(string uid, CancellationToken ct) =>
        FirebaseAuth.DefaultInstance.DeleteUserAsync(uid, ct);

    public Task RevokeRefreshTokensAsync(string uid, CancellationToken ct) =>
        FirebaseAuth.DefaultInstance.RevokeRefreshTokensAsync(uid);

    // shortcut: the Admin SDK for .NET has no multi-factor API, so this calls the Identity Toolkit REST endpoint with the app's own credential and a
    // static client; upgrade when FirebaseAdmin gains one. The body is the Node Admin SDK's way of clearing a user's factors.
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    public async Task ClearSecondFactorsAsync(string uid, CancellationToken ct)
    {
        var app = FirebaseApp.DefaultInstance ?? throw new InvalidOperationException("Firebase is not initialised.");
        var credential = app.Options.Credential.CreateScoped("https://www.googleapis.com/auth/cloud-platform");
        var projectId = app.Options.ProjectId ?? (credential.UnderlyingCredential as ServiceAccountCredential)?.ProjectId
            ?? throw new InvalidOperationException("The Firebase project id is unknown.");
        var token = await credential.UnderlyingCredential.GetAccessTokenForRequestAsync(cancellationToken: ct);

        using var request = BuildClearSecondFactorsRequest(projectId, token, uid);
        using var response = await Http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>The Identity Toolkit call that clears an account's second factors: POST projects/{id}/accounts:update with {"localId":uid,"mfa":{}}.</summary>
    public static HttpRequestMessage BuildClearSecondFactorsRequest(string projectId, string accessToken, string uid) =>
        new(HttpMethod.Post, $"https://identitytoolkit.googleapis.com/v1/projects/{Uri.EscapeDataString(projectId)}/accounts:update")
        {
            Headers = { Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken) },
            Content = JsonContent.Create(new { localId = uid, mfa = new { } }),
        };
}
