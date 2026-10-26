namespace Odip.Api.Services.Microsoft;

/// <summary>Where the callback sends the browser. Fixed paths, never a caller-supplied returnTo. A refusal adds ?microsoft=&lt;code&gt;, a link success adds ?microsoft=linked.</summary>
public static class MicrosoftSignInPaths
{
    public const string SignInSuccess = "/signin/microsoft";
    public const string SignInRefusal = "/login";
    public const string LinkTenant = "/settings?section=microsoft";
    public const string LinkAccount = "/account?section=microsoft";

    public static string For(string intent) => intent switch
    {
        MicrosoftIntent.LinkTenant => LinkTenant,
        MicrosoftIntent.LinkAccount => LinkAccount,
        _ => SignInRefusal,
    };

    /// <summary>The path with the outcome appended (the path may already carry a query).</summary>
    public static string WithOutcome(string path, string outcome) => path + (path.Contains('?') ? "&" : "?") + "microsoft=" + Uri.EscapeDataString(outcome);
}

public static class MicrosoftIntent
{
    public const string SignIn = "signin";
    public const string LinkTenant = "link-tenant";
    public const string LinkAccount = "link-account";
}
