using FirebaseAdmin;
using FirebaseAdmin.Auth;
using Odip.Api.Services;
using Odip.Tests.Controllers;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>
/// What <see cref="FirebaseUserService"/> actually DOES to Firebase, observed through a fake <see cref="IFirebaseAdminGateway"/> that records every
/// call. The headline rule is the squatter-safe one: <see cref="FirebaseUserService.EnsureSignInAccountAsync"/> must never verify, update or delete
/// an account that already exists, because that account may be someone's own sign-up for an address they do not own. Until the gateway existed
/// this could only be checked by scanning the method's text (FirebaseAccountCreationWiringTests), which cannot see a helper elsewhere that sets a
/// password or calls an update; a behavioural test can.
/// </summary>
public class FirebaseUserServiceGatewayTests
{
    private const string Email = "jane.smith@acme.example.com";

    private sealed class RecordingGateway : IFirebaseAdminGateway
    {
        /// <summary>Every call, in order, as "get:email", "create:email", "update:uid", "delete:uid".</summary>
        public List<string> Calls { get; } = [];
        public List<UserRecordArgs> Created { get; } = [];
        public List<UserRecordArgs> Updated { get; } = [];

        public Func<string, Task<string>> OnGetUid { get; set; } = _ => throw FirebaseTestExceptions.WithCode(AuthErrorCode.UserNotFound);
        public Func<UserRecordArgs, Task<string>> OnCreate { get; set; } = _ => Task.FromResult("new-uid");
        public Func<string, Task> OnDelete { get; set; } = _ => Task.CompletedTask;

        public Task<string> GetUidByEmailAsync(string email, CancellationToken ct)
        {
            Calls.Add($"get:{email}");
            return OnGetUid(email);
        }

        public Task<string> CreateUserAsync(UserRecordArgs args, CancellationToken ct)
        {
            Calls.Add($"create:{args.Email}");
            Created.Add(args);
            return OnCreate(args);
        }

        public Task UpdateUserAsync(UserRecordArgs args, CancellationToken ct)
        {
            Calls.Add($"update:{args.Uid}");
            Updated.Add(args);
            return Task.CompletedTask;
        }

        public Task DeleteUserAsync(string uid, CancellationToken ct)
        {
            Calls.Add($"delete:{uid}");
            return OnDelete(uid);
        }
    }

    /// <summary>
    /// Whether EmailVerified was SET on these args. The SDK's public property reads false when it was never set, so it cannot tell "set to false" or
    /// "left alone" from "would be sent as verified"; the private nullable behind it can, and it is what decides whether the field is sent.
    /// </summary>
    private static bool? RawEmailVerified(UserRecordArgs args) =>
        (bool?)typeof(UserRecordArgs).GetField("emailVerified", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.GetValue(args);

    private static (FirebaseUserService Service, RecordingGateway Gateway) Build()
    {
        var gateway = new RecordingGateway();
        return (new FirebaseUserService(gateway), gateway);
    }

    // ── EnsureSignInAccountAsync ────────────────────────────────────────

    [Fact]
    public async Task Ensure_with_no_account_looks_first_then_creates_a_verified_passwordless_one()
    {
        var (service, gateway) = Build();

        var result = await service.EnsureSignInAccountAsync(Email, "Jane Smith", CancellationToken.None);

        Assert.Equal(SignInAccountResult.Created, result);
        Assert.Equal([$"get:{Email}", $"create:{Email}"], gateway.Calls);
        var args = Assert.Single(gateway.Created);
        Assert.Equal(Email, args.Email);
        Assert.Equal("Jane Smith", args.DisplayName);
        Assert.True(args.EmailVerified);
        Assert.Null(args.Password);
        Assert.False(args.Disabled);
        Assert.Empty(gateway.Updated);
    }

    [Fact]
    public async Task Ensure_with_an_existing_account_changes_nothing_about_it_it_is_neither_verified_nor_updated_nor_deleted_nor_recreated()
    {
        var (service, gateway) = Build();
        gateway.OnGetUid = _ => Task.FromResult("uid-someones-own-signup");

        var result = await service.EnsureSignInAccountAsync(Email, "Jane Smith", CancellationToken.None);

        Assert.Equal(SignInAccountResult.Existing, result);
        // The one and only thing done is the look-up: no create, no update (which is how an email gets verified or a password reset), no delete.
        Assert.Equal([$"get:{Email}"], gateway.Calls);
        Assert.Empty(gateway.Created);
        Assert.Empty(gateway.Updated);
    }

    [Fact]
    public async Task Ensure_that_loses_a_race_to_whoever_created_the_account_first_says_existing_and_still_updates_nothing()
    {
        var (service, gateway) = Build();
        gateway.OnCreate = _ => throw FirebaseTestExceptions.EmailAlreadyExists();

        var result = await service.EnsureSignInAccountAsync(Email, "Jane Smith", CancellationToken.None);

        Assert.Equal(SignInAccountResult.Existing, result);
        Assert.Equal([$"get:{Email}", $"create:{Email}"], gateway.Calls);
        Assert.Empty(gateway.Updated);
    }

    [Fact]
    public async Task Ensure_does_not_swallow_a_failure_of_the_look_up_and_creates_nothing_after_it()
    {
        var (service, gateway) = Build();
        gateway.OnGetUid = _ => throw FirebaseTestExceptions.PermissionDenied();

        await Assert.ThrowsAsync<FirebaseAuthException>(() => service.EnsureSignInAccountAsync(Email, "Jane Smith", CancellationToken.None));

        Assert.Equal([$"get:{Email}"], gateway.Calls);
    }

    [Fact]
    public async Task Ensure_does_not_swallow_a_failure_that_is_not_Firebases_either()
    {
        var (service, gateway) = Build();
        gateway.OnGetUid = _ => throw new InvalidOperationException("The default Firebase app does not exist.");

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.EnsureSignInAccountAsync(Email, "Jane Smith", CancellationToken.None));

        Assert.Empty(gateway.Created);
    }

    [Fact]
    public async Task Ensure_lets_a_refusal_of_the_new_account_reach_the_caller_so_it_can_say_what_is_wrong_with_the_address()
    {
        var (service, gateway) = Build();
        gateway.OnCreate = _ => throw FirebaseTestExceptions.InvalidEmail();

        var failure = await Assert.ThrowsAsync<FirebaseAuthException>(() => service.EnsureSignInAccountAsync("jane@acme", "Jane Smith", CancellationToken.None));

        Assert.True(FirebaseFailures.IsInvalidEmail(failure));
    }

    // ── CreateUserAsync ─────────────────────────────────────────────────

    [Fact]
    public async Task Create_builds_its_args_through_the_builder_and_returns_the_uid()
    {
        var (service, gateway) = Build();

        var uid = await service.CreateUserAsync(Email, "Jane Smith", "Winter-2026!", CancellationToken.None);

        Assert.Equal("new-uid", uid);
        var args = Assert.Single(gateway.Created);
        Assert.True(args.EmailVerified);
        Assert.Equal("Winter-2026!", args.Password);
        Assert.Equal(Email, args.Email);
        Assert.Empty(gateway.Updated);
    }

    // ── UpdateUserByEmailAsync ──────────────────────────────────────────

    [Fact]
    public async Task Update_changes_only_the_name_and_the_disabled_state_of_the_account_it_finds_never_its_verification_or_password()
    {
        var (service, gateway) = Build();
        gateway.OnGetUid = _ => Task.FromResult("uid-9");

        await service.UpdateUserByEmailAsync(Email, "Jane Q Smith", disabled: true, CancellationToken.None);

        Assert.Equal([$"get:{Email}", "update:uid-9"], gateway.Calls);
        var args = Assert.Single(gateway.Updated);
        Assert.Equal("uid-9", args.Uid);
        Assert.Equal("Jane Q Smith", args.DisplayName);
        Assert.True(args.Disabled);
        // An account that pre-dates the app, or is someone else's own sign-up, must not be verified or have its password set from here.
        Assert.Null(RawEmailVerified(args));
        Assert.Null(args.Password);
        Assert.Null(args.Email);
        Assert.Empty(gateway.Created);
    }

    [Fact]
    public async Task Update_passes_on_that_there_is_no_account_so_callers_can_skip_users_created_before_Firebase_sync()
    {
        var (service, gateway) = Build();

        var failure = await Assert.ThrowsAsync<FirebaseAuthException>(() => service.UpdateUserByEmailAsync(Email, "Jane Smith", disabled: false, CancellationToken.None));

        Assert.Equal(AuthErrorCode.UserNotFound, failure.AuthErrorCode);
        Assert.Empty(gateway.Updated);
    }

    // ── DeleteUserAsync ─────────────────────────────────────────────────

    [Fact]
    public async Task Delete_is_cleanup_so_a_Firebase_failure_is_swallowed()
    {
        var (service, gateway) = Build();
        gateway.OnDelete = _ => throw FirebaseTestExceptions.PermissionDenied();

        await service.DeleteUserAsync("uid-3", CancellationToken.None);

        Assert.Equal(["delete:uid-3"], gateway.Calls);
    }
}
