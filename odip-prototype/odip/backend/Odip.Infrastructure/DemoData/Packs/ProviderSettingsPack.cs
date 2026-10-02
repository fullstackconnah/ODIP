using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The Demo tenant's organisation settings (decision D2): until now there was no row, so claim generation, the BPR CSV, the PRODA file and
/// invoices all refused with "Provider settings are not configured", and the app treated the provider as Victorian for holidays and prices
/// while times used the Sydney fallback. NSW (Sydney) equals that fallback and the CI browser zone, and shows daylight saving in the window.
///
/// Inserted only when the tenant has no row at all, and an existing row is never changed, whoever made it. Every identifier is obviously
/// fictional (all-zero ABN and BSB, "DEMO" in the registration number). Both modes stay on Warn, as for any new organisation.
/// </summary>
public sealed class ProviderSettingsPack : IDemoPack
{
    public string Name => "provider-settings";

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        if (await run.Db.ProviderSettings.AnyAsync(ct)) return;

        run.Db.ProviderSettings.Add(new ProviderSettings
        {
            Id = DemoIds.For("provider-settings"),
            TenantId = run.TenantId,
            OrganisationName = "Demo Disability Services (DEMO)",
            ABN = "00 000 000 000",
            RegistrationNumber = "DEMO-0000-01",
            Address = "Level 1, 1 Example Street, Sydney NSW 2000",
            State = "NSW",
            GSTRegistered = true,
            IsPaceProvider = false,
            BankAccountName = "Demo Disability Services (DEMO)",
            BSB = "000-000",
            AccountNumber = "00000000",
            InvoiceFooterNotes = "DEMO ORGANISATION: every detail on this document is fictional.",
            ManagerName = "Rachel Thompson",
            ManagerPhone = "0412 345 100",
            ParticipantReadinessMode = ParticipantReadinessMode.Warn,
            MedicationCompetencyMode = MedicationCompetencyMode.Warn,
        });
        await run.SaveAsync(ct);
        run.Added("provider-settings");
    }
}
