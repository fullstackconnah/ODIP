using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_medication_correction_reason = new(
    new Item("2026-11-medication-correction-reason", "Corrections to recorded medication now need a reason",
        "When you amend a recorded dose on the MAR, choose why: wrong time, wrong dose, recorded for the wrong person, entered in error, or other. Other needs a short note.\n\nThe reason, who made the correction and when now show in the participant's recent administrations.",
        Staff, false));
}
