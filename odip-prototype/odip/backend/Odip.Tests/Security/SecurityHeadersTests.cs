using Xunit;

namespace Odip.Tests.Security;

/// <summary>
/// Issue #122 — the served SPA must be allowed to use the Geolocation API on its own origin.
///
/// Both places that emit <c>Permissions-Policy</c> previously sent <c>geolocation=()</c>, an empty
/// allowlist that denies the feature to every origin including the document's own, so
/// <c>navigator.geolocation.getCurrentPosition</c> rejected unconditionally with no per-call or
/// prompt-level override. These are source-text assertions (same style as
/// <c>ParticipantFieldEntryMapTests.AgreesWithFrontendDocumentMappingTs</c>) because the header
/// values are inline literals with no shared constant to assert against.
///
/// Each test asserts both the presence of <c>(self)</c> and the absence of <c>geolocation=()</c> —
/// presence alone would still pass if a second, later <c>Permissions-Policy</c> line re-added the
/// empty allowlist and overrode it.
/// </summary>
public class SecurityHeadersTests
{
    private const string ExpectedPolicy = "geolocation=(self), microphone=(), camera=(), payment=()";
    private const string DeniedGeolocation = "geolocation=()";

    [Fact]
    public void ProgramCsPermissionsPolicyAllowsSelfGeolocation()
    {
        var path = ResolveRepoRelativePath(Path.Combine("Odip.Api", "Program.cs"));
        Assert.NotNull(path);

        var source = File.ReadAllText(path!);

        Assert.Contains(ExpectedPolicy, source);
        Assert.DoesNotContain(DeniedGeolocation, source);
    }

    // SkippableFact, not Fact: the API image's Docker build context is backend/ only
    // (deploy/compose.yaml), so the nginx/ tree this test reads from disk is never present in CI.
    // This is a local-only cross-tree check — it skips (not fails) when the nginx tree can't be
    // found, and still runs + asserts normally wherever the whole tree is checked out (i.e.
    // locally). Do not change this back to [Fact] (it would fail the deploy build) or add a static
    // Skip="..." (which would skip it locally too, defeating the point).
    [SkippableFact]
    public void NginxConfPermissionsPolicyAllowsSelfGeolocation()
    {
        var path = ResolveRepoRelativePath(Path.Combine("nginx", "default.conf"));
        Skip.If(path is null, "nginx/default.conf not reachable — this cross-tree consistency check only runs where the whole tree is checked out (locally); the API Docker build context is backend/ only.");

        var conf = File.ReadAllText(path!);

        Assert.Contains(ExpectedPolicy, conf);
        Assert.DoesNotContain(DeniedGeolocation, conf);
    }

    private static string? ResolveRepoRelativePath(string relativePath)
    {
        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < 10; i++)
        {
            var candidate = Path.Combine(dir, relativePath);
            if (File.Exists(candidate))
                return candidate;
            dir = Path.GetFullPath(Path.Combine(dir, ".."));
        }

        return null;
    }
}
