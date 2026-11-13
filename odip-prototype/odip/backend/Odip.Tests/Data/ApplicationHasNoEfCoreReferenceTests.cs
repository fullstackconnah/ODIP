using Odip.Application.Common;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>Odip.Application stays free of EF Core, so the build (not review) stops Application code from querying the database.</summary>
public class ApplicationHasNoEfCoreReferenceTests
{
    [Fact]
    public void ApplicationHasNoEfCoreReference()
    {
        var efRefs = typeof(PagedResult<>).Assembly.GetReferencedAssemblies()
            .Select(a => a.Name)
            .Where(n => n!.StartsWith("Microsoft.EntityFrameworkCore", StringComparison.Ordinal))
            .ToList();
        Assert.Empty(efRefs);
    }
}
