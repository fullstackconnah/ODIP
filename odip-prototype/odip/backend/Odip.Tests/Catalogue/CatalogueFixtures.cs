namespace Odip.Tests.Catalogue;

/// <summary>
/// The catalogue workbooks the importer tests read. They are committed under <c>Catalogue/Fixtures</c> and copied beside the test
/// assembly (Odip.Tests.csproj), so nothing here reads outside the repository: the Docker image build runs these tests with
/// only the backend tree present.
/// <list type="bullet">
/// <item><c>support-catalogue-2026-27.xlsx</c>: the official NDIA "Support Catalogue 2026-27" workbook, byte for byte
/// (https://www.ndis.gov.au/media/8038/download?attachment, fetched 2026-10-02): sheets "Current Support Items" (976 rows) and
/// "Legacy Support Items" (41 rows), National / Remote / Very Remote prices.</item>
/// <item><c>support-catalogue-2025-26-trimmed.xlsx</c>: the 2025-26 workbook (eight per-state price columns) cut down by
/// <c>make_support_catalogue_2025_26_fixture.py</c> to its two visible sheets and about 280 rows, under 100 KB.</item>
/// </list>
/// </summary>
internal static class CatalogueFixtures
{
    public const string File2026_27 = "support-catalogue-2026-27.xlsx";
    public const string File2025_26Trimmed = "support-catalogue-2025-26-trimmed.xlsx";

    public static string PathOf(string fileName) => Path.Combine(AppContext.BaseDirectory, "Catalogue", "Fixtures", fileName);

    /// <summary>A fresh in-memory stream over the fixture, so a test can hand it to the importer without holding the file open.</summary>
    public static MemoryStream Open(string fileName) => new(System.IO.File.ReadAllBytes(PathOf(fileName)));
}
