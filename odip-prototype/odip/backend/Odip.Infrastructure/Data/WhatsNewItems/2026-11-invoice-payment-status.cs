using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_invoice_payment_status = new(
    new Item("2026-11-invoice-payment-status", "See which invoices are paid",
        "Invoices and each claim's invoices now have a Payment column: Outstanding, Part paid or Paid, from the payments recorded on the claim. On Invoices you can also filter by payment.",
        Staff, false));
}
