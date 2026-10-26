using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Odip.Infrastructure.Integrations;

/// <summary>
/// Encrypts an integration's API key at rest with AES-GCM under one master key: <c>Integrations:MasterKey</c>, else the
/// <c>INTEGRATIONS_MASTER_KEY</c> environment variable (32 bytes, base64), the house config-then-env pattern (Program.cs JWT_SECRET).
/// With no usable master key <see cref="IsConfigured"/> is false: connecting is refused and the rest of ODIP runs. The organisation's
/// id is the associated data, so a ciphertext copied into another organisation's row does not decrypt.
/// shortcut: one master key in the environment, no rotation tooling; move to a managed secret store with P1-03 when it lands.
/// </summary>
public sealed class IntegrationKeyProtector
{
    // What an Admin is told; the variable to set is named only in the server's log (below).
    public const string NotConfiguredMessage = "Integrations aren't set up on this server yet. Contact Bunya Support.";
    private const int TagBytes = 16;
    private readonly byte[]? _key;

    // environment: a test seam, so a test never reads the machine's real variable. DI leaves it null.
    public IntegrationKeyProtector(IConfiguration config, ILogger<IntegrationKeyProtector>? logger = null, Func<string, string?>? environment = null)
    {
        var raw = config["Integrations:MasterKey"];
        if (string.IsNullOrWhiteSpace(raw)) raw = environment is null ? Environment.GetEnvironmentVariable("INTEGRATIONS_MASTER_KEY") : environment("INTEGRATIONS_MASTER_KEY");
        if (string.IsNullOrWhiteSpace(raw))
        {
            logger?.LogWarning("Neither Integrations:MasterKey nor INTEGRATIONS_MASTER_KEY is set (32 bytes, base64); integrations stay off until one is");
            return;
        }
        try
        {
            var key = Convert.FromBase64String(raw.Trim());
            if (key.Length == 32) { _key = key; return; }
        }
        catch (FormatException) { }
        // Never the value itself: only that it cannot be used.
        logger?.LogWarning("Integrations:MasterKey is set but is not 32 bytes of base64; integrations stay off until it is fixed");
    }

    public bool IsConfigured => _key is not null;

    public (byte[] Ciphertext, byte[] Nonce) Protect(string secret, Guid tenantId)
    {
        var key = _key ?? throw new InvalidOperationException(NotConfiguredMessage);
        var plain = Encoding.UTF8.GetBytes(secret);
        var nonce = RandomNumberGenerator.GetBytes(AesGcm.NonceByteSizes.MaxSize);
        var output = new byte[plain.Length + TagBytes];
        using var aes = new AesGcm(key, TagBytes);
        aes.Encrypt(nonce, plain, output.AsSpan(0, plain.Length), output.AsSpan(plain.Length), tenantId.ToByteArray());
        return (output, nonce);
    }

    /// <summary>The plain key, or null when there is no master key or it cannot read this one (a lost or changed master key, another organisation's row).</summary>
    public string? Unprotect(byte[] ciphertext, byte[] nonce, Guid tenantId)
    {
        if (_key is null || ciphertext.Length < TagBytes) return null;
        var plain = new byte[ciphertext.Length - TagBytes];
        try
        {
            using var aes = new AesGcm(_key, TagBytes);
            aes.Decrypt(nonce, ciphertext.AsSpan(0, plain.Length), ciphertext.AsSpan(plain.Length), plain, tenantId.ToByteArray());
            return Encoding.UTF8.GetString(plain);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }
}
