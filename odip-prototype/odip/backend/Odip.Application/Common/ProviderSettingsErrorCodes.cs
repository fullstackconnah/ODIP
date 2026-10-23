namespace Odip.Application.Common;

/// <summary>The PROVIDER_SETTINGS_* ApiResponse.Fail codes ProviderSettingsController answers with, so a client can branch on the refusal (ShiftErrorCodes' pattern).</summary>
public static class ProviderSettingsErrorCodes
{
    /// <summary>A save was refused because another Admin saved the settings after this form loaded (the 409 whose copy says to reload). The frontend reseeds on this, with the sentence as a fallback.</summary>
    public const string ProviderSettingsChanged = "PROVIDER_SETTINGS_CHANGED";
}
