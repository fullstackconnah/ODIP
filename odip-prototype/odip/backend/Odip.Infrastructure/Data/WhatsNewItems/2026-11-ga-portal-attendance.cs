using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_ga_portal_attendance = new(
    new Item("2026-11-ga-portal-attendance", "Mark who didn't attend a group activity",
        "Running a group activity? Once you've started it, open its card in My shifts, tap Participants, then tap Didn't attend beside anyone who didn't come. Tap Undo to take it back while the activity is in progress. Your coordinator sees the mark straight away. You need a connection to mark attendance.",
        WhatsNewAudience.SupportWorker, false));
}
