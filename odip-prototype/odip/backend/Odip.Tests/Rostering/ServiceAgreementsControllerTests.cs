using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Agreement PR 2 (D9): the organisation's agreements ending within 60 days or ended, for the register's Agreements ending view. The approval fixture's day, Saturday 10 October 2026.</summary>
public class ServiceAgreementsControllerTests
{
    private static async Task<Guid> ParticipantAsync(Fixture f, string firstName, Guid tenantId, bool active = true)
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = firstName, LastName = "Ng", IsActive = active };
        f.Db.Participants.Add(participant);
        await f.Db.SaveChangesAsync();
        return participant.Id;
    }

    private static async Task ApprovedEndingAsync(Fixture f, Guid participantId, DateOnly end, Guid? tenantId = null) =>
        await MarkApprovedAsync(f.Db, await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: end.AddDays(-27), end: end, tenantId: tenantId, participantId: participantId));

    private static async Task<List<AgreementEndingDto>> EndingAsync(OdipDbContext db, Fixture f)
    {
        var response = await new ServiceAgreementsController(db, f.Clock).Ending(CancellationToken.None);
        return Assert.IsType<ApiResponse<List<AgreementEndingDto>>>(Assert.IsType<OkObjectResult>(response.Result).Value).Data!;
    }


    [Fact]
    public async Task It_lists_active_participants_agreements_ending_or_ended_soonest_first_in_the_alerts_words()
    {
        await using var f = await SetUpAsync();                                    // Amy Ng of TenantA
        await ApprovedEndingAsync(f, f.ParticipantId, Today.AddDays(20));
        var ben = await ParticipantAsync(f, "Ben", TenantA);
        await ApprovedEndingAsync(f, ben, Today.AddDays(-3));
        var far = await ParticipantAsync(f, "Far", TenantA);
        await ApprovedEndingAsync(f, far, Today.AddDays(90));                      // outside the 60 days
        var archived = await ParticipantAsync(f, "Archived", TenantA, active: false);
        await ApprovedEndingAsync(f, archived, Today.AddDays(5));                  // D6: archived participants are not listed

        var rows = await EndingAsync(f.Db, f);

        Assert.Equal(new[]
        {
            (ben, "Ben Ng", -3, "Agreement ended 2026-10-07: shifts stop after it"),
            (f.ParticipantId, "Amy Ng", 20, "Agreement ends in 20 days"),
        }, rows.Select(r => (r.ParticipantId, r.ParticipantName, r.DaysLeft, r.Status)));
        Assert.Equal((1, Today.AddDays(20), (int?)null), (rows[1].Version, rows[1].AgreementEndDate, rows[1].RenewalVersion));
    }

    [Fact]
    public async Task Another_organisations_agreements_are_never_listed()
    {
        await using var f = await SetUpAsync();
        await ApprovedEndingAsync(f, f.ParticipantId, Today.AddDays(20));
        var other = await ParticipantAsync(f, "Other", TenantB);
        await ApprovedEndingAsync(f, other, Today.AddDays(5), tenantId: TenantB);

        await using (var tenantA = TestDb.ForTenant(f.DbName, TenantA))
            Assert.Equal(new[] { f.ParticipantId }, (await EndingAsync(tenantA, f)).Select(r => r.ParticipantId));
        await using (var tenantB = TestDb.ForTenant(f.DbName, TenantB))
            Assert.Equal(new[] { other }, (await EndingAsync(tenantB, f)).Select(r => r.ParticipantId));
    }

    [Fact]
    public void Only_admins_coordinators_and_superadmins_may_read_it() =>
        Assert.Equal("Admin,Coordinator,SuperAdmin", typeof(ServiceAgreementsController).GetCustomAttribute<AuthorizeAttribute>()!.Roles);
}
