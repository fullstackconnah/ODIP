using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_address_lookup = new(
    new Item("2026-11-address-lookup", "Address fields suggest as you type",
        "Address fields on the participant record and the intake form now suggest Australian addresses as you type. Pick one to fill the street, suburb, state and postcode, or keep typing.",
        Staff, false));
}
