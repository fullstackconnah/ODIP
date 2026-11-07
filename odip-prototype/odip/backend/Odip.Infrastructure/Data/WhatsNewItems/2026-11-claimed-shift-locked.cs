using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claimed_shift_locked = new(
    new Item("2026-11-claimed-shift-locked", "A claimed shift shows its claim",
        "A shift that's on a claim now shows which claim, and its support type, ratio and night type are locked. Delete that claim to change them.",
        Staff, false));
}
