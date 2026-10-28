using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_phone_fixes_footer_pager_actions = new(
    new Item("2026-10-phone-fixes-footer-pager-actions", "Tidier buttons and table pages on phones",
        "On a phone, the enquiry booking panel's buttons now stay on one line, the page controls under tables no longer break their labels, and the edit and archive icons on lists like Staff light up when you tap them. On a wide screen the Trips table now fits without hiding the Lead column.",
        Staff, false));
}
