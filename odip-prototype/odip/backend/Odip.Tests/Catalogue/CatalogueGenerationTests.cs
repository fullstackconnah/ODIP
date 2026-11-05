using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Catalogue.CatalogueImportTestSupport;

namespace Odip.Tests.Catalogue;

/// <summary>
/// CatalogueImportService.Generation is one static counter for the process, so an import in a test class running side by side moved it
/// between this test's two imports (CI, 2026-11-06). The test runs on its own.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class CatalogueGeneration { public const string Name = "Catalogue generation"; }

[Collection(CatalogueGeneration.Name)]
public class CatalogueGenerationTests
{
    [Fact]
    public async Task A_commit_that_changes_rows_moves_the_catalogue_generation_and_one_that_changes_nothing_does_not()
    {
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        var start = CatalogueImportService.Generation;

        await ImportAsync(db, CatalogueFixtures.File2026_27);
        var afterFirst = CatalogueImportService.Generation;
        await ImportAsync(db, CatalogueFixtures.File2026_27);

        Assert.True(afterFirst > start);
        Assert.Equal(afterFirst, CatalogueImportService.Generation);
    }
}
