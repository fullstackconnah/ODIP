using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_invoices_page = new(1,
    new Item("2026-10-invoices-page", "Invoices have their own page",
        "Open Invoices in the menu to see every invoice and credit note in one list, including those for claims that were later deleted.\n\nSearch by number, participant, bill-to or claim, and filter by type, status and issue date. Select an invoice number to download its PDF.",
        Staff, false));
}
