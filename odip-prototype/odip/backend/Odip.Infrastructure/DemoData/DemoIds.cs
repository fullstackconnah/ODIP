using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Odip.Infrastructure.DemoData;

/// <summary>
/// Name-based ids for every row the demo top-up creates: SHA-256 of <c>odip-demo/v1/{kind}/{key}</c>, first 16 bytes, version 8
/// (custom) and the RFC 4122 variant. A rolling row is keyed on its story plus the date or week it belongs to, a static one on its story
/// alone, so "already inserted" is a primary-key lookup and the maintainer needs no marker table (and so no migration). Key parts are
/// joined with '/', formatted in the invariant culture, and must not contain '/'.
/// </summary>
public static class DemoIds
{
    public const string Namespace = "odip-demo/v1";

    public static Guid For(string kind, params object[] keyParts)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(kind);

        var name = string.Concat(Namespace, "/", kind, "/", string.Join('/', keyParts.Select(Format)));
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(name)).AsSpan(0, 16).ToArray();

        // Guid(byte[]) lays the first three fields out little-endian, so byte 7 holds the version nibble and byte 8 the variant bits.
        bytes[7] = (byte)((bytes[7] & 0x0F) | 0x80);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes);
    }

    /// <summary>
    /// A number in [min, max] that depends only on the id and the salt: how a row gets its "random" variance (a few minutes late, a
    /// handover wording) without a seeded <see cref="Random"/>, whose sequence would shift whenever the order of rows did.
    /// </summary>
    public static int Pick(Guid id, string salt, int minInclusive, int maxInclusive)
    {
        if (maxInclusive < minInclusive) throw new ArgumentOutOfRangeException(nameof(maxInclusive), "max must not be below min");

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(string.Concat(Namespace, "/pick/", id.ToString("N"), "/", salt)));
        var span = (uint)(maxInclusive - minInclusive) + 1u;
        return minInclusive + (int)(BinaryPrimitives.ReadUInt32LittleEndian(hash) % span);
    }

    private static string Format(object part) => part switch
    {
        null => throw new ArgumentNullException(nameof(part), "a demo id key part must not be null"),
        string text => text,
        DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTime dateTime => dateTime.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture),
        TimeOnly time => time.ToString("HH:mm", CultureInfo.InvariantCulture),
        Guid guid => guid.ToString("N"),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => part.ToString() ?? string.Empty,
    };
}
