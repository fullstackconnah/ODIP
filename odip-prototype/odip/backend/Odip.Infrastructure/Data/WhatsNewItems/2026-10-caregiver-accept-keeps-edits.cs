using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_caregiver_accept_keeps_edits = new(6,
    new Item("2026-10-caregiver-accept-keeps-edits", "Accepting a caregiver's form keeps your team's newer edits",
        "Accepting a caregiver's form now applies only what the caregiver changed. Details your team edited after the caregiver opened the form are kept.\n\nIf your team and the caregiver changed the same detail, the caregiver's value is applied and the review screen flags that row.",
        Staff, false));
}
