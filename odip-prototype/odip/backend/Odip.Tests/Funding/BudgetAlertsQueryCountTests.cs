using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The aggregate alerts route loads the alerts of every active participant on each dashboard view, so the budget rules may not ask a question per participant: the ledger is called ONCE for the
/// whole set and the NDIA's signal is read for the whole set in a fixed number of queries. The test counts the queries a context runs (every Execute and ExecuteAsync is one, the idiom of
/// <c>LedgerQueryCounter</c>) with three participants and with thirty, each with a plan, a claim, a rostered shift, a trip booking and a rejected claim, and the two counts must be the same.
/// </summary>
public class BudgetAlertsQueryCountTests(Xunit.Abstractions.ITestOutputHelper output)
{
    private static async Task<(int WithBudget, int Without)> QueriesForAsync(int participants)
    {
        using var kit = LedgerKit.Create(countQueries: true);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        var trip = kit.SeedTrip(D(2026, 10, 20), 2);
        for (var i = 0; i < participants; i++)
        {
            var participant = kit.SeedParticipant(first: "Person", last: $"No{i:00}");
            kit.SeedPlan(participant, D(2026, 10, 1), D(2027, 6, 30), Core(PlanType.PlanManaged, Q(2, 1000m), Q(3, 1000m), Q(4, 1000m)));
            var done = kit.SeedShift(participant, D(2026, 10, 2), ShiftStatus.Completed);
            kit.SeedShiftClaim(participant, TripClaimStatus.Paid, 900m, done);
            kit.SeedShift(participant, D(2026, 10, 5));
            kit.SeedBooking(trip, participant);
            var refused = kit.SeedShift(participant, D(2026, 10, 1), ShiftStatus.Completed);
            var claim = kit.SeedShiftClaim(participant, TripClaimStatus.Rejected, 200m, refused);
            claim.RejectionCode = "V27";
            claim.RejectedDate = FundingTestKit.Now.UtcDateTime;
            kit.Db.SaveChanges();
        }

        var source = new BudgetAlertSource(kit.Ledger, new NdiaRejectionReader(kit.Db, kit.Clock), kit.Tenant!);
        var counter = LedgerQueryCounter.Start();
        var withBudget = await new ParticipantAlertsService(kit.Db, kit.Clock, source).GetAlertsAsync(participantId: null, activeOnly: true);
        var queries = counter[0];

        // Every participant really was worked out (the count is of work done, not of an early exit): over, approaching or forecast over, plus the NDIA's word.
        Assert.Equal(participants, withBudget.Count);
        Assert.All(withBudget, p => Assert.Contains(p.Alerts, a => a.Type == "budget-ndia-exhausted"));
        Assert.All(withBudget, p => Assert.Contains(p.Alerts, a => a.Type == "budget-approaching" || a.Type == "budget-forecast-over"));

        counter = LedgerQueryCounter.Start();
        await new ParticipantAlertsService(kit.Db, kit.Clock).GetAlertsAsync(participantId: null, activeOnly: true);
        return (queries, counter[0]);
    }

    [Fact]
    public async Task TheBudgetRules_AskTheSameQuestions_ForThreeParticipantsAsForThirty()
    {
        var small = await QueriesForAsync(3);
        var large = await QueriesForAsync(30);

        output.WriteLine($"queries with the budget rules: {small.WithBudget} for 3 participants, {large.WithBudget} for 30; without them: {small.Without} and {large.Without}");
        Assert.Equal(small.WithBudget, large.WithBudget);
        Assert.Equal(small.Without, large.Without);
        // And what the budget adds is a handful of queries, not a number that could hide a loop behind a small fixture.
        Assert.InRange(large.WithBudget - large.Without, 1, 25);
    }
}
