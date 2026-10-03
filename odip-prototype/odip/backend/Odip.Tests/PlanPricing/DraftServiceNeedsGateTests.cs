using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The onboarding checklist's "service needs" step (<c>POST participants/{id}/onboarding/service-needs-confirmation</c>) asks for a current dated draft with valid catalogue-priced lines.
/// A hand-typed line was priced on the agreement's start date, so its catalogue row had to be valid on that date. A line the plan builder generates is priced on the date of each shift, so a plan
/// that crosses a catalogue price change has a line whose row starts AFTER the agreement does, and that is a correct draft, not an invalid one.
/// </summary>
public class DraftServiceNeedsGateTests
{
    private static readonly Guid Tenant = Guid.NewGuid();

    private static OdipDbContext Open(string name, Guid? tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
    }

    private static ParticipantInquiriesController Controller(OdipDbContext db)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(Tenant);
        var http = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "coordinator-1")], "Test")) };
        return new ParticipantInquiriesController(db, tenant.Object) { ControllerContext = new ControllerContext { HttpContext = http } };
    }

    private static async Task<Participant> AddParticipantAsync(OdipDbContext db)
    {
        var participant = db.Participants.Add(new Participant
        {
            Id = Guid.NewGuid(), TenantId = Tenant, FirstName = "Synthetic", LastName = "Participant", NdisNumber = "43100001234",
            DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true, IsDraft = true, IntakeCompletedAt = new DateTime(2026, 9, 20, 3, 0, 0, DateTimeKind.Utc),
        }).Entity;
        await db.SaveChangesAsync();
        return participant;
    }

    [Fact]
    public async Task A_plan_of_blocks_that_crosses_a_catalogue_price_change_passes_the_gate_although_a_line_starts_after_the_agreement()
    {
        var store = Guid.NewGuid().ToString();
        // Two catalogue versions: July's rows, and community access rows that start again on 1 December at a dollar more.
        await using var catalogue = await DecemberDatabaseAsync(code => code.Contains("_0125_", StringComparison.Ordinal), 1m, store);
        await using var db = Open(store, Tenant);
        var participant = await AddParticipantAsync(db);
        var block = Block("b1", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday } });
        var request = new CreateServiceAgreementDraftDto
        {
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
            AgreementStartDate = new DateOnly(2026, 11, 23), AgreementEndDate = new DateOnly(2026, 12, 13), State = "NSW",
            Blocks = new List<DraftBlockDto> { new() { Block = block } },
        };

        var saved = await new ServiceAgreementDraftService(db).SaveAsync(Tenant, participant.Id, request, "actor", CancellationToken.None);

        var draft = Assert.IsType<ServiceAgreementDraft>(saved.Draft);
        // The setup is the failing shape: part of the plan is priced from a row that starts on 1 December, after the agreement starts.
        Assert.Contains(draft.Lines, l => l.CatalogueEffectiveFrom == new DateOnly(2026, 12, 1));
        Assert.Contains(draft.Lines, l => l.CatalogueEffectiveFrom == new DateOnly(2026, 7, 1));
        Assert.All(draft.Lines, l => Assert.False(string.IsNullOrEmpty(l.BlockKey)));

        var result = await Controller(db).ConfirmServiceNeeds(participant.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.True(Assert.IsType<ApiResponse<ParticipantOnboardingDto>>(ok.Value).Data!.ServiceTypeConfirmed);
    }

    [Fact]
    public async Task A_hand_typed_line_still_needs_a_catalogue_row_valid_on_the_agreements_start_date()
    {
        var store = Guid.NewGuid().ToString();
        await using var catalogue = await DecemberDatabaseAsync(code => code.Contains("_0125_", StringComparison.Ordinal), 1m, store);
        await using var db = Open(store, Tenant);
        var participant = await AddParticipantAsync(db);
        db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = participant.Id, Version = 1,
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
            AgreementStartDate = new DateOnly(2026, 11, 23), AgreementEndDate = new DateOnly(2026, 12, 13),
            Lines =
            {
                // A line with no block, from a row that starts after the agreement does: it was not priced on the start date.
                new ServiceAgreementDraftLine { Id = Guid.NewGuid(), ServiceType = "Community access", Hours = 10, ItemCode = "04_104_0125_6_1", CatalogueVersion = "2026-27", CatalogueEffectiveFrom = new DateOnly(2026, 12, 1), UnitPrice = 74.58m },
            },
        });
        await db.SaveChangesAsync();

        var result = await Controller(db).ConfirmServiceNeeds(participant.Id, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }
}
