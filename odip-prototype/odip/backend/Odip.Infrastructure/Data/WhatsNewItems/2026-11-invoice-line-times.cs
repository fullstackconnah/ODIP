using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_invoice_line_times = new(
    new Item("2026-11-invoice-line-times", "Invoices now show the shift's start and finish times",
        "On the invoice PDF, each shift line now shows its start and finish times under the date. They are the times the claim was priced from: the worked times once the shift is completed, otherwise the rostered times.\n\nKilometre, trip and manual lines have no times, and invoices issued before this change stay as they were.",
        Staff, false));
}
