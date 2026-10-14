using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Alerts;

/// <summary>
/// Agreement PR 2, rule 12 of <see cref="ParticipantAlertsService"/> (D8): the service agreement ending soon (Warning) or ended (Critical), opening the agreement page.
/// The approval fixture: one active participant, a Sydney provider, and a clock at 02:00 UTC on Saturday 10 October 2026 (13:00 in Sydney).
/// </summary>
public class AgreementEndingAlertsTests
{
    private static async Task ApprovedEndingAsync(Fixture f, DateOnly end) =>
        await MarkApprovedAsync(f.Db, await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: end.AddDays(-27), end: end));

    /// <summary>The agreement alerts of the fixture's participant, asked as the participant page asks (one participant, archived ones included).</summary>
    private static async Task<List<ParticipantAlertDto>> AgreementAlertsAsync(Fixture f) =>
        (await new ParticipantAlertsService(f.Db, f.Clock).GetAlertsAsync(f.ParticipantId)).Single().Alerts
            .Where(a => a.Type.StartsWith("agreement-", StringComparison.Ordinal)).ToList();

    [Fact]
    public async Task An_agreement_ending_within_sixty_days_is_a_warning_that_opens_the_agreement_page()
    {
        await using var f = await SetUpAsync();
        await ApprovedEndingAsync(f, Today.AddDays(20));

        var alert = Assert.Single(await AgreementAlertsAsync(f));

        Assert.Equal(("agreement-ending-soon", AlertSeverity.Warning, "Agreement ends in 20 days", $"/participants/{f.ParticipantId}/agreement-draft"), (alert.Type, alert.Severity, alert.Message, alert.LinkTo));
    }

    [Fact]
    public async Task Today_is_the_providers_so_an_agreement_ending_on_the_utc_date_has_ended_in_sydney()
    {
        await using var f = await SetUpAsync();
        await ApprovedEndingAsync(f, new DateOnly(2026, 10, 10));
        f.Clock.Set(new DateTimeOffset(2026, 10, 10, 14, 30, 0, TimeSpan.Zero));   // 01:30 on Sunday 11 October in Sydney (AEDT): the UTC date would still say "ends today"

        var alert = Assert.Single(await AgreementAlertsAsync(f));

        Assert.Equal(("agreement-ended", AlertSeverity.Critical, "Agreement ended 2026-10-10: shifts stop after it"), (alert.Type, alert.Severity, alert.Message));
    }


    [Fact]
    public async Task An_archived_participant_is_not_flagged_and_one_with_no_approved_agreement_has_no_agreement_alert()
    {
        await using var archived = await SetUpAsync(active: false);
        await ApprovedEndingAsync(archived, Today.AddDays(20));
        Assert.Empty(await AgreementAlertsAsync(archived));          // the participant page asks with activeOnly false, so the rule itself must skip it (D6)

        await using var unapproved = await SetUpAsync();
        await AddRevisionAsync(unapproved, 1, new[] { WeekdayBlock() }, start: Today, end: Today.AddDays(20));
        Assert.Empty(await AgreementAlertsAsync(unapproved));
    }

    /// <summary>The lead's added check: the aggregate route (the participants table badge and the dashboard card) carries the ended alert too.</summary>
    [Fact]
    public async Task The_ended_alert_is_in_the_aggregate_the_register_and_dashboard_read()
    {
        await using var f = await SetUpAsync();
        await ApprovedEndingAsync(f, Today.AddDays(-3));

        var response = await new ParticipantAlertsController(new ParticipantAlertsService(f.Db, f.Clock), f.Db).GetAggregate(CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantAlertsDto>>>(Assert.IsType<OkObjectResult>(response.Result).Value);
        var mine = Assert.Single(body.Data!, p => p.ParticipantId == f.ParticipantId);
        var ended = Assert.Single(mine.Alerts, a => a.Type == "agreement-ended");
        Assert.Equal(("Agreement ended 2026-10-07: shifts stop after it", $"/participants/{f.ParticipantId}/agreement-draft", 1), (ended.Message, ended.LinkTo, mine.CriticalCount));
    }
}
