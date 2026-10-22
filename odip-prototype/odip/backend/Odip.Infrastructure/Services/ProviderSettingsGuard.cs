using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Setup makes the provider row with the registration number and ABN blank until Organisation profile is filled in, so "the row exists" no longer means
/// "the organisation is configured". Every claim, BPR CSV and invoice path asks here.
/// </summary>
public static class ProviderSettingsGuard
{
    public static ProviderSettings Require(ProviderSettings? settings) =>
        settings is null || string.IsNullOrWhiteSpace(settings.RegistrationNumber) || string.IsNullOrWhiteSpace(settings.ABN)
            ? throw new InvalidOperationException("Provider settings are not configured. Please configure them in Settings before generating claims.")
            : settings;
}
