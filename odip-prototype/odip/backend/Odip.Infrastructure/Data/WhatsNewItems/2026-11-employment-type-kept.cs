using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_employment_type_kept = new(
    new Item("2026-11-employment-type-kept", "Employment type is kept when you update a staff member",
        "Restoring or switching a staff member on or off, or editing a qualification date, no longer clears their employment type.",
        Staff, false));
}
