using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_shift_change_notice = new(
    new Item("2026-10-shift-change-notice", "We tell you when your shift changes",
        "When a coordinator changes the time, day or participant of a published shift you're on, Bunya Support now sends you a notice by email and in the bell, the same way it tells you about a cancelled shift. You can turn it off under Notification preferences.",
        Staff, false));
}
