using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_register_exports = new(
    new Item("2026-11-register-exports", "Download registers for an audit",
        "Settings › Data export now has a Registers for auditors card. Pick a register, choose the dates and download a CSV with names, labels and dates in your organisation's time: incidents, restrictive practices, risks and staff credentials. Admins can also download the complaints register. Every download is recorded.",
        Staff, false));
}
