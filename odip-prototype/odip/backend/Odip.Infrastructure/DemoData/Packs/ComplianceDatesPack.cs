using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// Three synthetic compliance dates for the Demo tenant (Settings > Compliance dates), dated from the provider's today so the list shows one Current, one Due soon in the 30-day band and one Due soon at 75 days.
/// Inserted only when the tenant has no compliance date at all and nobody holds the ids; an existing row is never changed. The nightly compliance scan raises the Admin tasks.
/// </summary>
public sealed class ComplianceDatesPack : IDemoPack
{
    public string Name => "compliance-dates";

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        if (await run.Db.ComplianceItems.AnyAsync(ct)) return;

        var today = run.Anchors.D0;
        var rows = new (string Key, ComplianceKind Kind, string Label, int Days, string? Reference)[]
        {
            ("registration", ComplianceKind.Registration, "NDIS registration", 400, "REG-000123"),
            ("insurance", ComplianceKind.Insurance, "Public liability insurance", 21, null),
            ("mid-term-audit", ComplianceKind.MidTermAudit, "Mid-term audit", 75, null),
        };
        var ids = rows.ToDictionary(r => r.Key, r => DemoIds.For("compliance-date", r.Key));
        if ((await run.ExistingIdsAsync<ComplianceItem>(ids.Values, ct)).Count > 0)
        {
            run.Skipped("compliance dates", "another tenant's row holds an id (a recreated Demo tenant: the old one's rows are removed by the runbook's purge)");
            return;
        }

        foreach (var r in rows)
            run.Db.ComplianceItems.Add(new ComplianceItem { Id = ids[r.Key], TenantId = run.TenantId, Kind = r.Kind, Label = r.Label, ExpiresOn = today.AddDays(r.Days), Reference = r.Reference });
        await run.SaveAsync(ct);
        run.Added("compliance dates", rows.Length);
    }
}
