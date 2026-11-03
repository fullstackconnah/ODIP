using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_enquiries_next_step = new(
    new Item("2026-11-enquiries-next-step", "One next step on every enquiry",
        "Each enquiry in Bunya Support now shows a single next step: resume the intake, fix what's missing, book the intake visit or start the intake. Edit enquiry has moved into the ⋯ menu.",
        Staff, false));
}
