using System.Text.RegularExpressions;
using Xunit;

namespace Odip.Tests.Common;

/// <summary>
/// Source-scan guard for the verified-email fix, in the style of ShiftErrorCodesTests. The tests in FirebaseUserServiceTests assert what the
/// builder produces, but nothing there stops a later change from creating a Firebase account some other way: an inline
/// <c>new UserRecordArgs</c> without <c>EmailVerified = true</c> keeps every one of them green, and an account created unverified can never sign
/// in (AuthController.Exchange refuses it, and nothing sends the person a verification link). The sites that create accounts, and how they
/// must be wired, are properties of the source, so they are checked there:
/// every account is created through <c>FirebaseUserService.BuildCreateUserArgs</c> (from <c>CreateUserAsync</c> and
/// <c>EnsureSignInAccountAsync</c>), the controllers reach Firebase only through <c>IFirebaseUserService</c>, the service reaches the Admin SDK only
/// through <c>IFirebaseAdminGateway</c> (the one file that touches <c>FirebaseAuth.DefaultInstance</c> for accounts), and the one place that builds
/// <c>UserRecordArgs</c> for an UPDATE (<c>UpdateUserByEmailAsync</c>) never marks an email verified. What the service then DOES with the gateway
/// is checked by behaviour, in FirebaseUserServiceGatewayTests: this file only guards what a behavioural test cannot see.
/// </summary>
public class FirebaseAccountCreationWiringTests
{
    private static readonly string ApiRoot = Path.Combine(FindBackendRoot(), "Odip.Api");
    private const string ServicePath = "Services/FirebaseUserService.cs";
    private const string GatewayPath = "Services/FirebaseAdminGateway.cs";
    private const string TokenVerifierPath = "Services/FirebaseTokenVerifier.cs";

    private static string FindBackendRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
        {
            var parent = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
            if (parent == dir) break;
            dir = parent;
        }
        if (dir is null || !File.Exists(Path.Combine(dir, "Odip.sln")))
            throw new InvalidOperationException($"Could not locate Odip.sln above {AppContext.BaseDirectory}");
        return dir;
    }

    private static string Read(string relativePath) => File.ReadAllText(Path.Combine(ApiRoot, relativePath));

    /// <summary>The source with its // comments removed, so a scan for a call is not fooled by a comment that names it.</summary>
    private static string WithoutComments(string source) => Regex.Replace(source, "//.*$", "", RegexOptions.Multiline);

    /// <summary>Every production source file in Odip.Api as (path relative to the project, text), build output excluded.</summary>
    private static IEnumerable<(string Path, string Text)> ApiSources() =>
        Directory.EnumerateFiles(ApiRoot, "*.cs", SearchOption.AllDirectories)
            .Select(path => (Path: Path.GetRelativePath(ApiRoot, path).Replace('\\', '/'), Text: File.ReadAllText(path)))
            .Where(file => !file.Path.StartsWith("obj/") && !file.Path.StartsWith("bin/"));

    /// <summary>The text of a member of FirebaseUserService, from its signature to the end of its braces (or to the semicolon of an expression body).</summary>
    private static string MemberBody(string signaturePattern)
    {
        var source = Read(ServicePath);
        var match = Regex.Match(source, signaturePattern);
        Assert.True(match.Success, $"Could not find a member matching /{signaturePattern}/ in {ServicePath}");

        var start = match.Index;
        var open = source.IndexOf('{', match.Index + match.Length - 1);
        var arrow = source.IndexOf("=>", match.Index, StringComparison.Ordinal);
        // An expression-bodied member ends at its first ";" outside any braces (an object initialiser it returns has its own); a block body at
        // its matching brace.
        if (arrow >= 0 && (open < 0 || arrow < open))
        {
            var braces = 0;
            for (var index = arrow; index < source.Length; index++)
            {
                if (source[index] == '{') braces++;
                else if (source[index] == '}') braces--;
                else if (source[index] == ';' && braces == 0) return source[start..(index + 1)];
            }
            throw new InvalidOperationException($"No end to the expression body after {signaturePattern}");
        }

        var depth = 0;
        for (var index = open; index < source.Length; index++)
        {
            if (source[index] == '{') depth++;
            else if (source[index] == '}' && --depth == 0) return source[start..(index + 1)];
        }
        throw new InvalidOperationException($"Unbalanced braces after {signaturePattern}");
    }

    private static string CreateUserAsyncBody() => MemberBody(@"public Task<string> CreateUserAsync\(");
    private static string EnsureSignInAccountBody() => MemberBody(@"public async Task<SignInAccountResult> EnsureSignInAccountAsync\(");
    private static string BuilderBody() => MemberBody(@"public static UserRecordArgs BuildCreateUserArgs\(");
    private static string UpdateBody() => MemberBody(@"public async Task UpdateUserByEmailAsync\(");

    [Fact]
    public void The_scan_finds_the_members_it_checks()
    {
        // A guard that matched nothing would pass for the wrong reason.
        Assert.Contains("_gateway.CreateUserAsync", CreateUserAsyncBody());
        Assert.Contains("SignInAccountResult.Created", EnsureSignInAccountBody());
        Assert.Contains("EmailVerified", BuilderBody());
        Assert.Contains("UpdateUserAsync", UpdateBody());
        Assert.True(ApiSources().Count() > 20, "Expected to find the Odip.Api sources");
    }

    [Fact]
    public void Both_account_creating_members_build_their_args_through_BuildCreateUserArgs()
    {
        var create = CreateUserAsyncBody();
        var ensure = EnsureSignInAccountBody();

        Assert.Matches(@"_gateway\.CreateUserAsync\(\s*BuildCreateUserArgs\(", create);
        Assert.Matches(@"_gateway\.CreateUserAsync\(\s*BuildCreateUserArgs\(", ensure);
        Assert.DoesNotContain("UserRecordArgs", create);
        Assert.DoesNotContain("UserRecordArgs", ensure.Replace("BuildCreateUserArgs", ""));
    }

    [Fact]
    public void UserRecordArgs_is_only_ever_built_inside_FirebaseUserService_and_only_named_by_the_gateway()
    {
        var builtElsewhere = ApiSources()
            .Where(file => file.Path != ServicePath && Regex.IsMatch(file.Text, @"new\s+UserRecordArgs\b"))
            .Select(file => file.Path)
            .ToList();
        Assert.True(builtElsewhere.Count == 0,
            $"UserRecordArgs is built outside FirebaseUserService (so possibly without EmailVerified = true): {string.Join(", ", builtElsewhere)}");

        var namedElsewhere = ApiSources()
            .Where(file => file.Path != ServicePath && file.Path != GatewayPath && file.Text.Contains("UserRecordArgs"))
            .Select(file => file.Path)
            .ToList();
        Assert.True(namedElsewhere.Count == 0,
            $"UserRecordArgs is named outside FirebaseUserService and the gateway: {string.Join(", ", namedElsewhere)}");
    }

    [Fact]
    public void Only_the_gateway_and_the_token_verifier_touch_FirebaseAuth_DefaultInstance()
    {
        // The Admin SDK's account methods (create, read, update, delete) are reachable only through IFirebaseAdminGateway, so a helper elsewhere
        // cannot set a password, verify an email or update an account behind the back of FirebaseUserService and its behavioural tests.
        var callers = ApiSources()
            .Where(file => file.Path != GatewayPath && file.Path != TokenVerifierPath && Regex.IsMatch(WithoutComments(file.Text), @"FirebaseAuth\.DefaultInstance\s*\.\s*\w+"))
            .Select(file => file.Path)
            .ToList();

        Assert.True(callers.Count == 0,
            $"These use FirebaseAuth.DefaultInstance directly instead of going through IFirebaseAdminGateway: {string.Join(", ", callers)}");

        // The token verifier only verifies a token: it makes no account call.
        var verifierCalls = Regex.Matches(Read(TokenVerifierPath), @"FirebaseAuth\.DefaultInstance\s*\.\s*(\w+)");
        Assert.NotEmpty(verifierCalls);
        Assert.All(verifierCalls.Select(call => call.Groups[1].Value), method => Assert.Equal("VerifyIdTokenAsync", method));
    }

    [Fact]
    public void Inside_the_service_every_account_creation_takes_the_builders_args_and_the_gateway_decides_nothing()
    {
        var calls = Regex.Matches(Read(ServicePath), @"_gateway\.CreateUserAsync\(\s*(\w+)");
        Assert.Equal(2, calls.Count);
        Assert.All(calls.Select(c => c.Groups[1].Value), first => Assert.Equal("BuildCreateUserArgs", first));

        // The gateway is a pass-through: exactly one SDK create call, handing on the args it was given untouched.
        var gatewayCreates = Regex.Matches(Read(GatewayPath), @"DefaultInstance\.CreateUserAsync\(\s*(\w+)");
        Assert.Single(gatewayCreates);
        Assert.Equal("args", gatewayCreates[0].Groups[1].Value);
    }

    [Theory]
    [InlineData("Controllers/AdminUsersController.cs")]
    [InlineData("Controllers/TenantsController.cs")]
    public void The_controllers_that_create_accounts_go_through_the_service(string relativePath)
    {
        var source = Read(relativePath);

        Assert.Contains("_firebaseUserService.CreateUserAsync(", source);
        Assert.DoesNotContain("FirebaseAuth.DefaultInstance", source);
    }

    [Fact]
    public void Only_the_builder_marks_an_email_verified_and_the_update_path_never_does()
    {
        var assignments = ApiSources()
            .Where(file => Regex.IsMatch(file.Text, @"\bEmailVerified\s*="))
            .Select(file => file.Path)
            .ToList();

        Assert.Equal(new[] { ServicePath }, assignments);
        Assert.Matches(@"\bEmailVerified\s*=\s*true", BuilderBody());
        Assert.DoesNotContain("EmailVerified", UpdateBody());
        // The builder is the only member of the service that sets it: not CreateUserAsync, not EnsureSignInAccountAsync.
        Assert.DoesNotContain("EmailVerified", CreateUserAsyncBody());
        Assert.DoesNotContain("EmailVerified", EnsureSignInAccountBody());
    }

    [Fact]
    public void EnsureSignInAccountAsync_never_touches_an_account_that_already_exists()
    {
        // The squatter-safe rule: an existing account is left exactly as it is, never verified and its password untouched.
        var ensure = EnsureSignInAccountBody();

        Assert.DoesNotContain("UpdateUserAsync", ensure);
        Assert.DoesNotContain("EmailVerified", ensure);
        Assert.Contains("return SignInAccountResult.Existing", ensure);
    }
}
