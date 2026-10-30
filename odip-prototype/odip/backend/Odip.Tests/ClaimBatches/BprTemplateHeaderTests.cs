using Odip.Infrastructure.Services;
using Odip.Tests.TestSupport;
using Xunit;

namespace Odip.Tests.ClaimBatches;

public class BprTemplateHeaderTests
{
    // The NDIA's own bulk payment request template, once the owner drops it into docs/ndia, is the last word on the column names and their order.
    [SkippableFact]
    public void Bpr_header_matches_the_official_template_when_present()
    {
        var root = RepositoryPaths.RepositoryRoot();
        var dir = root is null ? null : Path.Combine(root, "docs", "ndia");
        var template = dir is not null && Directory.Exists(dir) ? Directory.GetFiles(dir, "*template*.csv").OrderBy(p => p, StringComparer.Ordinal).FirstOrDefault() : null;
        Skip.If(template is null, "no official template in docs/ndia yet");

        var firstLine = File.ReadLines(template!).First().TrimStart('\uFEFF').Trim();

        Assert.Equal(firstLine, BprCsvService.Header);
    }
}
