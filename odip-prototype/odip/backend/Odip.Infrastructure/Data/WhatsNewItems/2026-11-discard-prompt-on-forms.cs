using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_discard_prompt_on_forms = new(
    new Item("2026-11-discard-prompt-on-forms", "Bunya Support asks before it throws away what you typed",
        "Notes, risk entries and routines now ask before discarding what you typed. If you press Escape, tap outside the box or use the X, you are asked whether to keep editing or discard. The same goes for activities and contacts.\n\nCancel still closes straight away, and nothing is asked when you have not typed anything.",
        Staff, false));
}
