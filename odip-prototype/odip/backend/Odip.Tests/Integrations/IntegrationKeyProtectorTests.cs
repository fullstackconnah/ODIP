using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Odip.Infrastructure.Integrations;
using Odip.Tests.EarlyAccess;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>The key store: AES-GCM under the master key, bound to the organisation; a missing or malformed master key turns integrations off and never stops the app.</summary>
public class IntegrationKeyProtectorTests
{
    private const string Secret = "eh-api-key-5f2a9c";
    private static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();

    internal static string NewMasterKey() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    private static IConfiguration Config(string? masterKey) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Integrations:MasterKey"] = masterKey }).Build();

    /// <summary>A key store that never reads this machine's real INTEGRATIONS_MASTER_KEY: a runner or CI job that sets it must not change a test.</summary>
    internal static IntegrationKeyProtector Protector(string? masterKey, ILogger<IntegrationKeyProtector>? logger = null) =>
        new(Config(masterKey), logger, _ => null);

    [Fact]
    public void A_key_round_trips_and_the_stored_bytes_do_not_contain_it()
    {
        var keys = Protector(NewMasterKey());
        var (cipher, nonce) = keys.Protect(Secret, TenantA);

        Assert.True(keys.IsConfigured);
        Assert.Equal(12, nonce.Length);
        Assert.DoesNotContain(Secret, Encoding.UTF8.GetString(cipher));
        Assert.Equal(Secret, keys.Unprotect(cipher, nonce, TenantA));
    }

    [Fact]
    public void Each_protect_uses_a_fresh_nonce()
    {
        var keys = Protector(NewMasterKey());
        var first = keys.Protect(Secret, TenantA);
        var second = keys.Protect(Secret, TenantA);

        Assert.NotEqual(first.Nonce, second.Nonce);
        Assert.NotEqual(first.Ciphertext, second.Ciphertext);
    }

    [Fact]
    public void Another_master_key_or_another_organisation_cannot_read_it()
    {
        var (cipher, nonce) = Protector(NewMasterKey()).Protect(Secret, TenantA);

        Assert.Null(Protector(NewMasterKey()).Unprotect(cipher, nonce, TenantA));
        var sameKey = Protector(NewMasterKey());
        var (own, ownNonce) = sameKey.Protect(Secret, TenantA);
        Assert.Null(sameKey.Unprotect(own, ownNonce, TenantB));
    }

    [Fact]
    public void A_missing_master_key_turns_integrations_off()
    {
        var keys = Protector(null);

        Assert.False(keys.IsConfigured);
        var refusal = Assert.Throws<InvalidOperationException>(() => keys.Protect(Secret, TenantA));
        Assert.Equal(IntegrationKeyProtector.NotConfiguredMessage, refusal.Message);
        Assert.Null(keys.Unprotect(new byte[40], new byte[12], TenantA));
    }

    [Fact]
    public void The_environment_variable_is_read_when_configuration_has_no_master_key()
    {
        var masterKey = NewMasterKey();
        var keys = new IntegrationKeyProtector(Config(null), null, name => name == "INTEGRATIONS_MASTER_KEY" ? masterKey : null);

        Assert.True(keys.IsConfigured);
        var (cipher, nonce) = keys.Protect(Secret, TenantA);
        Assert.Equal(Secret, Protector(masterKey).Unprotect(cipher, nonce, TenantA));
    }

    [Theory]
    [InlineData("not base64 at all!")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAA==")] // 16 bytes
    public void A_malformed_master_key_counts_as_not_configured_and_is_never_logged(string malformed)
    {
        var logger = new CapturingLogger<IntegrationKeyProtector>();
        var keys = Protector(malformed, logger);

        Assert.False(keys.IsConfigured);
        var warning = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Warning, warning.Level);
        Assert.DoesNotContain(malformed, warning.Message);
    }
}
