using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_organisation_contact_details = new(
    new Item("2026-11-organisation-contact-details", "Keep your organisation's contact details",
        "In Settings, Organisation profile can now hold your organisation's trading name, contact email, contact phone and website. They are optional, and your legal name stays as it is.",
        WhatsNewAudience.Admin, false));
}
