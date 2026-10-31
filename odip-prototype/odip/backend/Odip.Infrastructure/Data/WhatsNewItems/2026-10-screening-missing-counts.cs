using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_screening_missing_counts = new(
    new Item("2026-10-screening-missing-counts", "People with no screening now show as an issue",
        "Anyone active with no worker screening on file now counts as an issue on Today (Credentials) and on Qualifications, so your Credentials figure may rise. The Staff page also marks them Screening missing and has a Screening missing tab.\n\nClearance numbers are now private: only managers and the person themselves can see them. Everyone else sees that one is on file, and the expiry date.",
        Staff, true));
}
