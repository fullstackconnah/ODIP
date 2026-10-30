namespace Odip.Api.Services.Microsoft;

/// <summary>Codes in <c>/login?microsoft=&lt;code&gt;</c>. The first four are the ones the Firebase exchange already uses (<see cref="ExchangeRefusal"/>).</summary>
public static class MicrosoftRefusal
{
    public const string InvalidToken = ExchangeRefusal.InvalidToken;
    public const string NoOdipAccount = ExchangeRefusal.NoOdipAccount;
    public const string TenantInactive = ExchangeRefusal.TenantInactive;

    public const string MicrosoftNotLinked = "MicrosoftNotLinked";
    public const string MicrosoftPersonalAccount = "MicrosoftPersonalAccount";
    public const string MicrosoftGuest = "MicrosoftGuest";
    public const string MicrosoftLinkFromAccount = "MicrosoftLinkFromAccount";
    public const string MicrosoftNoEmail = "MicrosoftNoEmail";
    public const string MicrosoftCannotCreate = "MicrosoftCannotCreate";
    public const string MicrosoftCancelled = "MicrosoftCancelled";
    public const string SignInRequired = "SignInRequired";
    public const string MicrosoftAdminOnly = "MicrosoftAdminOnly";
    public const string MicrosoftOrgAlreadyLinked = "MicrosoftOrgAlreadyLinked";
    public const string MicrosoftTenantTaken = "MicrosoftTenantTaken";
    public const string MicrosoftSessionChanged = "MicrosoftSessionChanged";
    public const string MicrosoftWrongTenant = "MicrosoftWrongTenant";
    public const string MicrosoftAccountTaken = "MicrosoftAccountTaken";
    public const string MicrosoftAccountAlreadyLinked = "MicrosoftAccountAlreadyLinked";
    public const string MicrosoftOnlySignIn = "MicrosoftOnlySignIn";
    public const string MicrosoftSessionEnded = "MicrosoftSessionEnded";
}
