using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_agreements_bulk = new(39,
    new Item("2026-10-agreements-bulk", "Renew, reprice or extend agreements together",
        "On the Agreements page, tick the agreements you want, then choose Renew, Reprice or Extend. Bunya Support makes a draft for each one, which you then check and approve. Nothing changes on the roster until a draft is approved.",
        Staff, false));
}
