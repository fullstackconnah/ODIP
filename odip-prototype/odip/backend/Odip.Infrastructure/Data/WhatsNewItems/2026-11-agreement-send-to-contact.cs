using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_agreement_send_to_contact = new(
    new Item("2026-11-agreement-send-to-contact", "Send an agreement to a contact",
        "Email a service agreement to a guardian, plan nominee or the participant as a secure link they can read and download. Bunya Support shows when it was sent and opened, and you can record who agreed and how when you mark it approved.",
        Staff, false));
}
