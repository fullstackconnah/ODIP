using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_results_file_amounts = new(
    new Item("2026-11-results-file-amounts", "Results files with a bad amount still import",
        "If an NDIA results file has an amount that can't be right, that row's result still applies and the amount is flagged for you to check, instead of the whole file failing.",
        WhatsNewAudience.Admin, false));
}
