using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_rostering_rules = new(
    new Item("2026-11-rostering-rules", "Rostering rules and plan-expiry warnings",
        "Admins can now set how far a finished shift's start or finish can drift from the roster before it goes to review, and how many days before a participant's plan ends we warn you. Weekly hours has moved here too. Find them in Settings, under Organisation: Rostering rules and Alert windows.",
        Staff, false));
}
