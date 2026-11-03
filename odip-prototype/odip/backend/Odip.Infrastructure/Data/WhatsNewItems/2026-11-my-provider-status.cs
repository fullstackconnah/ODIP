using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_my_provider_status = new(
    new Item("2026-11-my-provider-status", "Record whether you're a participant's my provider",
        "Each NDIS plan on a participant's Funding tab now shows whether you're recorded as their my provider: Not recorded, Requested or Recorded. Choose Update on the plan to change it.\n\nOn the Claims screen, an NDIA-managed line warns you when its plan isn't recorded, because the NDIA may reject it or pay it late. The warning doesn't stop you sending the file. The onboarding checklist has a new item for it too.",
        Staff, false));
}
