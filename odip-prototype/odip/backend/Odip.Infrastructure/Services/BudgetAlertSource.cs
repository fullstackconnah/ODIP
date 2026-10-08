using Odip.Application.DTOs;
using Odip.Domain.Interfaces;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The budget alerts of a set of participants (budget phase 2b), for <see cref="ParticipantAlertsService"/>: the rules are <see cref="BudgetAlertRules"/>'s; what is here is getting the figures for
/// the whole set at once. The aggregate alerts route runs on every dashboard view for every active participant, so this makes ONE call to the ledger for the lot and one read of the NDIA's signal,
/// each a fixed number of queries whatever the number of participants (<c>BudgetAlertsQueryCountTests</c> counts them with three and with thirty).
///
/// Money is on these alerts' messages, so they follow the organisation: the tenant is the caller's own (<see cref="ICurrentTenant"/>), never read off a participant. A SuperAdmin who has not chosen
/// an organisation to view as has none, and so gets no budget alert (a budget belongs to one organisation).
/// </summary>
public sealed class BudgetAlertSource
{
    private readonly BudgetLedgerService _ledger;
    private readonly NdiaRejectionReader _ndia;
    private readonly ICurrentTenant _tenant;

    public BudgetAlertSource(BudgetLedgerService ledger, NdiaRejectionReader ndia, ICurrentTenant tenant)
    {
        _ledger = ledger;
        _ndia = ndia;
        _tenant = tenant;
    }

    /// <summary>The budget alerts of each participant that has any, by participant id. Ids that are not participants of the caller's organisation are simply absent.</summary>
    public async Task<IReadOnlyDictionary<Guid, IReadOnlyList<ParticipantAlertDto>>> ForAsync(IReadOnlyCollection<Guid> participantIds, CancellationToken ct)
    {
        var result = new Dictionary<Guid, IReadOnlyList<ParticipantAlertDto>>();
        if (participantIds.Count == 0 || _tenant.TenantId is not { } tenantId) return result;

        var ledgers = await _ledger.ComputeAsync(tenantId, participantIds, ct);
        if (ledgers.Count == 0) return result;

        // The NDIA's word only matters for a plan that is running, and every ledger carries the same provider's today.
        var running = ledgers.Values.Where(l => l.Ledger is { PlanIsCurrent: true }).ToDictionary(l => l.ParticipantId, l => l.Ledger!.Plan);
        var today = ledgers.Values.First().Today;
        var ndia = await _ndia.ReadAsync(tenantId, running, today, ct);

        var none = new Dictionary<Guid, PoolNdiaRejection>();
        foreach (var (participantId, ledger) in ledgers)
        {
            var alerts = BudgetAlertRules.For(ledger, ndia.TryGetValue(participantId, out var pools) ? pools : none);
            if (alerts.Count > 0) result[participantId] = alerts;
        }

        return result;
    }
}
