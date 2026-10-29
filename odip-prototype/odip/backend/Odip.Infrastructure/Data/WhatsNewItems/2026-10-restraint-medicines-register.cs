using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_restraint_medicines_register = new(
    new Item("2026-10-restraint-medicines-register", "Restraint medicines now go on the register",
        "Ticking Chemical restraint on a medicine now adds it to the participant's restrictive practices register and keeps the two in step. Ceasing the medicine or unticking the box deactivates the entry.\n\nAuthorisation is now recorded on the entry: add who authorised it and when. If it isn't authorised, say whether it needs reporting to the NDIS Commission.\n\nMedicines with no authoriser on file now show \"Restraint not authorised\". Open each from the Flags column on the Register tab and record it. If you already had an entry for one, record it on the new linked entry and deactivate the old one.",
        Staff, true));
}
