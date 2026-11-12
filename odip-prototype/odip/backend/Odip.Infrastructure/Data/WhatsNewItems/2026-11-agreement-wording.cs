using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_agreement_wording = new(
    new Item("2026-11-agreement-wording", "Your own wording in service agreements",
        "Open Settings, then Billing details. Under Agreement wording, add your organisation's responsibilities and cancellation wording, and how participants can raise a concern or complaint. They print as sections 6 and 7 of every service agreement PDF.\n\nLeave a field blank to keep the standard draft wording.",
        WhatsNewAudience.Admin, false));
}
