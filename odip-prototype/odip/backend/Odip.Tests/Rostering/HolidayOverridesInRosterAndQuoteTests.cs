using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using Odip.Tests.Support;

namespace Odip.Tests.Rostering;

/// <summary>
/// The other two readers of the holiday tables (the 2026-10-08 review, L3-01 and L3-05): the roster's PUBLIC_HOLIDAY finding and the plan quote. The roster read the synced rows only, so a shift
/// on Boxing Day 2026 (a day only the override table holds) raised no holiday finding in NSW; the quote read both tables but filtered the state in the database, where the comparison is exact, so
/// a row written "nsw" was never found. Both read through <see cref="PublicHolidayLoader"/> now.
/// </summary>
public class HolidayOverridesInRosterAndQuoteTests
{
    private static readonly DateOnly BoxingDay = new(2026, 12, 26);   // a Saturday the synced feed has no row for
    private static readonly Guid Tenant = Guid.NewGuid();

    private static OdipDbContext CreateDb() => TestDb.Create();

    private static (RosteringController Controller, CheckShiftDto Dto) ArrangeRoster(OdipDbContext db, string providerState, DateOnly serviceDate)
    {
        var staff = new User
        {
            Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
        };
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true, IntakeCompletedAt = DateTime.UtcNow };
        db.Users.Add(staff);
        db.Participants.Add(participant);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), RegistrationNumber = "PR1", ABN = "1", OrganisationName = "Org", Address = "1 St", State = providerState });
        db.SaveChanges();
        var dto = new CheckShiftDto
        {
            ParticipantId = participant.Id, StaffId = staff.Id, ServiceDate = serviceDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        };
        return (new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db)), dto);
    }

    private static void AddOverride(OdipDbContext db, DateOnly date, string? state, TimeOnly? from = null, TimeOnly? to = null)
    {
        db.PublicHolidayOverrides.Add(new PublicHolidayOverride { Id = Guid.NewGuid(), Date = date, State = state, Name = "Boxing Day", StartTime = from, EndTime = to, Source = "NDIS-CODES 5.3" });
        db.SaveChanges();
    }

    private static async Task<List<RosterFindingDto>> Findings(RosteringController controller, CheckShiftDto dto)
    {
        var result = await controller.CheckShift(dto, CancellationToken.None);
        return Assert.IsType<ApiResponse<List<RosterFindingDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    // ── The roster ──────────────────────────────────────────────────────────

    [Fact]
    public async Task AShiftOnADayOnlyTheOverrideTableHoldsRaisesThePublicHolidayFinding()
    {
        using var db = CreateDb();
        var (controller, dto) = ArrangeRoster(db, "NSW", BoxingDay);
        AddOverride(db, BoxingDay, "NSW");

        var findings = await Findings(controller, dto);

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.PublicHoliday);
        Assert.Contains("Boxing Day", finding.Message);
        Assert.False(finding.RequiresReason);
    }

    [Theory]
    [InlineData("nsw", "NSW")]     // the organisation's state written in lower case
    [InlineData("NSW", "nsw")]     // the holiday row written in lower case
    public async Task TheStateIsMatchedInAnyCase(string providerState, string rowState)
    {
        using var db = CreateDb();
        var (controller, dto) = ArrangeRoster(db, providerState, BoxingDay);
        AddOverride(db, BoxingDay, rowState);

        var findings = await Findings(controller, dto);

        Assert.Contains(findings, f => f.Code == RosterConflictService.PublicHoliday);
    }

    [Fact]
    public async Task AnotherStatesOverrideAndAPartDayOverrideRaiseNoFinding()
    {
        using var db = CreateDb();
        var (controller, dto) = ArrangeRoster(db, "NSW", BoxingDay);
        AddOverride(db, BoxingDay, "SA");                                        // a South Australian day
        AddOverride(db, BoxingDay, "NSW", from: new TimeOnly(18, 0));            // and a part of a day, which a whole shift cannot be priced against

        var findings = await Findings(controller, dto);

        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.PublicHoliday);
    }

    // ── The plan quote ──────────────────────────────────────────────────────

    [Fact]
    public async Task TheQuoteFindsASyncedRowWhoseStateIsWrittenInLowerCase()
    {
        await using var db = CatalogueImportTestSupport.CreateDb();
        await CatalogueImportTestSupport.ImportAsync(db, CatalogueFixtures.File2026_27);
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = Mon5Oct, Name = "Labour Day", State = "nsw" });
        await db.SaveChangesAsync();
        var block = Block("x", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));

        var quote = await new PlanPricingService(db).QuoteAsync(Tenant, new[] { block }, Mon5Oct, Mon5Oct);

        Assert.Contains(quote.Lines, l => l.Band == DayBands.PublicHoliday);   // it priced 5 October 2026 as the public holiday it is, not as an ordinary Monday
    }

    [Fact]
    public async Task TheQuoteStillUsesAPartDayOverrideRow()
    {
        // Part-day rows are the quote's alone: NT from 19:00 on Christmas Eve. The 19:00 to 21:00 part of a Thursday evening block is the holiday band.
        await using var db = CatalogueImportTestSupport.CreateDb();
        await CatalogueImportTestSupport.ImportAsync(db, CatalogueFixtures.File2026_27);
        db.PublicHolidayOverrides.Add(new PublicHolidayOverride
        {
            Id = Guid.NewGuid(), Date = new DateOnly(2026, 12, 24), State = "NT", Name = "Christmas Eve (evening)", StartTime = new TimeOnly(19, 0), Source = "NDIS-CODES 5.3",
        });
        await db.SaveChangesAsync();
        var block = Block("x", PlanSupportType.CommunityAccess, DayOfWeek.Thursday, T(18), T(21), b => b with { Location = new PlanLocation { State = "NT" } });

        var quote = await new PlanPricingService(db).QuoteAsync(Tenant, new[] { block }, new DateOnly(2026, 12, 24), new DateOnly(2026, 12, 24));

        Assert.Contains(quote.Lines, l => l.Band == DayBands.PublicHoliday);
        Assert.Contains(quote.Lines, l => l.Band != DayBands.PublicHoliday);   // and the hour before 19:00 is still an ordinary weekday band
    }
}
