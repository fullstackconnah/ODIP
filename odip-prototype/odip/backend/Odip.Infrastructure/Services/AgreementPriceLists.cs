using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>A catalogue version and the day it starts (the earliest <c>EffectiveFrom</c> of its rows).</summary>
public sealed record PriceListRef(string Version, DateOnly Start);

/// <summary>What the Agreements list knows of one participant's revisions: the newest approved one (current), the unapproved one after it (waiting), the term's start and each one's price list.</summary>
public sealed record AgreementRevisionSet(AgreementRevisionRefDto? Current, AgreementRevisionRefDto? Waiting, DateOnly? TermStart, string? CurrentList, string? WaitingList);

/// <summary>The derived price list of an agreement (nothing is stored) and the one sum every screen uses for a line.</summary>
public static class AgreementPriceLists
{
    /// <summary>Every catalogue version with its start, newest first. The catalogue is global (no TenantId).</summary>
    public static async Task<List<PriceListRef>> ListAsync(OdipDbContext db, CancellationToken ct)
    {
        var rows = await db.SupportCatalogueItems.AsNoTracking()
            .GroupBy(i => i.CatalogueVersion).Select(g => new { Version = g.Key, Start = g.Min(i => i.EffectiveFrom) }).ToListAsync(ct);
        // Ordered in memory: Npgsql drops an OrderBy placed before a GroupBy or Distinct.
        return rows.Where(r => r.Version != "").OrderByDescending(r => r.Start).ThenByDescending(r => r.Version, StringComparer.Ordinal)
            .Select(r => new PriceListRef(r.Version, r.Start)).ToList();
    }

    /// <summary>A revision's price list: the version of its line with the latest <c>CatalogueEffectiveFrom</c> (a tie goes to the ordinal-greater version). Null when no line carries a version.</summary>
    public static string? VersionOf(IEnumerable<(string Version, DateOnly From)> lines) =>
        lines.Where(l => l.Version != "").OrderByDescending(l => l.From).ThenByDescending(l => l.Version, StringComparer.Ordinal).Select(l => l.Version).FirstOrDefault();

    /// <summary>The newest list that starts after the current list's start and on or before the agreement's end; null when none, or when current is null or not in the lists.</summary>
    public static PriceListRef? Newer(IReadOnlyList<PriceListRef> lists, string? current, DateOnly agreementEnd)
    {
        var from = lists.FirstOrDefault(l => l.Version == current);
        if (from is null) return null;
        return lists.Where(l => l.Start > from.Start && l.Start <= agreementEnd).OrderByDescending(l => l.Start).FirstOrDefault();
    }

    /// <summary>What a line adds up to: the engine's total for a line it generated, hours times unit price floored to the cent for one typed by hand.</summary>
    public static decimal LineTotal(decimal? total, decimal hours, decimal unitPrice) => total ?? Math.Floor(hours * unitPrice * 100m) / 100m;

    public static decimal LineTotal(ServiceAgreementDraftLine x) => LineTotal(x.Total, x.Hours, x.UnitPrice);

    /// <summary>What a quote's priced lines add up to: each line's own total, already floored to the cent. A line that could not be priced is not money the agreement claims.</summary>
    public static decimal PricedTotal(PlanQuote quote) => quote.Lines.Where(l => l.IsPriced).Sum(l => l.Total);
}

/// <summary>The one reading of "current" and "waiting" for the Agreements list and the bulk actions, so they never disagree about which revision is which.</summary>
public static class AgreementRevisions
{
    public static async Task<Dictionary<Guid, AgreementRevisionSet>> LatestAsync(OdipDbContext db, Guid tenantId, IReadOnlyCollection<Guid> participantIds, CancellationToken ct)
    {
        var result = new Dictionary<Guid, AgreementRevisionSet>();
        if (participantIds.Count == 0) return result;
        var ids = participantIds.ToList();
        var revisions = await db.ServiceAgreementDrafts.AsNoTracking()
            .Where(d => d.TenantId == tenantId && ids.Contains(d.ParticipantId))
            .Select(d => new { d.ParticipantId, d.Id, d.Version, d.AgreementStartDate, d.AgreementEndDate, Approved = db.ServiceAgreementDraftApprovals.Any(a => a.DraftId == d.Id) })
            .ToListAsync(ct);

        // Current = the approved revision with the highest version; waiting = the newest revision when it is unapproved.
        var picked = revisions.GroupBy(r => r.ParticipantId).ToDictionary(g => g.Key, g =>
        {
            var newest = g.MaxBy(r => r.Version)!;
            return (Current: g.Where(r => r.Approved).MaxBy(r => r.Version)?.Id, Waiting: newest.Approved ? (Guid?)null : newest.Id);
        });

        var wanted = picked.Values.SelectMany(v => new[] { v.Current, v.Waiting }).OfType<Guid>().ToList();
        var lines = await db.ServiceAgreementDraftLines.AsNoTracking().Where(l => wanted.Contains(l.DraftId))
            .Select(l => new { l.DraftId, l.Total, l.Hours, l.UnitPrice, l.CatalogueVersion, l.CatalogueEffectiveFrom }).ToListAsync(ct);
        var byDraft = lines.GroupBy(l => l.DraftId).ToDictionary(g => g.Key, g => (
            Total: g.Sum(l => AgreementPriceLists.LineTotal(l.Total, l.Hours, l.UnitPrice)),
            List: AgreementPriceLists.VersionOf(g.Select(l => (l.CatalogueVersion, l.CatalogueEffectiveFrom)))));

        foreach (var one in revisions.GroupBy(r => r.ParticipantId))
        {
            var (currentId, waitingId) = picked[one.Key];
            AgreementRevisionRefDto? Make(Guid? id)
            {
                if (id is not Guid draftId) return null;
                var r = one.First(x => x.Id == draftId);
                return new AgreementRevisionRefDto
                {
                    DraftId = r.Id, Version = r.Version, AgreementStartDate = r.AgreementStartDate, AgreementEndDate = r.AgreementEndDate,
                    Total = byDraft.TryGetValue(r.Id, out var t) ? t.Total : 0m,
                };
            }
            string? ListOf(Guid? id) => id is Guid draftId && byDraft.TryGetValue(draftId, out var t) ? t.List : null;
            var current = Make(currentId);
            // The term starts at the earliest approved revision ending on the current end (a mid-term change covers only its last weeks): one step, not the renewal's walk-back.
            DateOnly? termStart = current is null ? null : one.Where(r => r.Approved && r.AgreementEndDate == current.AgreementEndDate).Min(r => r.AgreementStartDate);
            result[one.Key] = new AgreementRevisionSet(current, Make(waitingId), termStart, ListOf(currentId), ListOf(waitingId));
        }
        return result;
    }
}
