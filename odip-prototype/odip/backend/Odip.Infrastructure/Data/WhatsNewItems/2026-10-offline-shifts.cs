using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_offline_shifts = new(36,
    new Item("2026-10-offline-shifts", "Your shifts work without signal",
        "Today's shifts in My shifts keep working if you lose signal: you can start the shift, write notes, take breaks, tick routines and finish. Bunya Support saves them on your phone and sends them when you're back online. Recording a dose still needs a connection.",
        WhatsNewAudience.SupportWorker, false));
}
