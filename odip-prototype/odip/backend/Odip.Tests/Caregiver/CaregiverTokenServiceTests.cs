using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Caregiver;

public class CaregiverTokenServiceTests
{
    [Fact]
    public void GenerateRawToken_Is43CharBase64Url()
    {
        var t = CaregiverTokenService.GenerateRawToken();
        Assert.Equal(43, t.Length);                       // 32 bytes → 43 chars unpadded
        Assert.Matches("^[A-Za-z0-9_-]+$", t);            // no '+', '/', '='
    }

    [Fact]
    public void GenerateRawToken_IsUniquePerCall()
    {
        var a = CaregiverTokenService.GenerateRawToken();
        var b = CaregiverTokenService.GenerateRawToken();
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Hash_IsDeterministicLowercaseHexSha256()
    {
        var h1 = CaregiverTokenService.Hash("abc");
        var h2 = CaregiverTokenService.Hash("abc");
        Assert.Equal(h1, h2);
        Assert.Equal(64, h1.Length);
        Assert.Matches("^[0-9a-f]+$", h1);
        // SHA-256("abc") is a known vector
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", h1);
    }

    [Fact]
    public void Hash_DiffersForDifferentInput()
    {
        Assert.NotEqual(CaregiverTokenService.Hash("a"), CaregiverTokenService.Hash("b"));
    }
}
