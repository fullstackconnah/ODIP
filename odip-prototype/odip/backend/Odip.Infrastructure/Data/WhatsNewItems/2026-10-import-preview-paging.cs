using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_import_preview_paging = new(
    new Item("2026-10-import-preview-paging", "Large import previews now show 50 rows a page",
        "When an import file has more than 50 rows, the preview and the list of rows that could not be imported now show 50 rows at a time. Use Previous and Next under the table to move through them. Switching between All, Ready, Skipped and Can't import starts again at the first page.",
        Staff, false));
}
