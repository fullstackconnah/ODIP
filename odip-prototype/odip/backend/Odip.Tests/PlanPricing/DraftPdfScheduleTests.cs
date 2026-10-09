using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Odip.Tests.Rostering;
using QuestPDF.Fluent;
using QuestPDF.Infrastructure;
using Xunit;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The agreement PDF prints the weekly schedule: one row for each support the revision was saved with, read from its stored blocks and its stored pricing (so the PDF, like the screen,
/// says what was priced when it was saved). The text is extracted with PdfPig as <see cref="DraftSigningAndPdfTests"/> does, and compared as <see cref="Skeleton"/>s (the font draws "fi", "ft" and "ti"
/// as ligatures that come back as other characters).
/// </summary>
public class DraftPdfScheduleTests
{
    private static PlanBlock MonWed(string id = "b1") =>
        Block(id, PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday } });

    private static PlanBlock SaturdayOuting() =>
        Block("sat", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });

    private static PlanBlock FridayNight() =>
        Block("night", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(6), b => b with { Setting = PlanSetting.AtHome });

    /// <summary>Community access has no weekday night item, so a shift wholly inside the night (00:00 to 06:00) has nothing to price it by.</summary>
    private static PlanBlock UnpricedNight() =>
        Block("unpriced", PlanSupportType.CommunityAccess, DayOfWeek.Tuesday, T(1), T(5));

    /// <summary>A revision as saving it would have stored it (blocks, the engine's answer, its lines), for the week of Monday 12 to Sunday 18 October 2026.</summary>
    private static ServiceAgreementDraft Revision(params PlanBlock[] blocks) =>
        ApprovalTestSupport.BuildRevision(Guid.NewGuid(), Guid.NewGuid(), 3, blocks, Mon12Oct, Sun18Oct);

    private static string Dollars(PlanQuote quote, string blockId) =>
        "$" + quote.Totals.ByBlock.Single(b => b.BlockId == blockId).Amount.ToString("N2", System.Globalization.CultureInfo.InvariantCulture);

    private static string Row(params string[] cells) => string.Concat(cells.Select(Skeleton));

    // ── The table ─────────────────────────────────────────────────────────────────

    // The text comes back in lines, top to bottom and left to right, so a heading that wraps onto a second line ("Hours a" / "week") is split across the header row. A body row that does not wrap is
    // contiguous: its cells are in the order of its columns.
    [Fact]
    public void The_pdf_has_a_schedule_of_supports_with_a_row_for_each_support_in_the_order_saved_and_a_sentence_that_it_repeats_every_week()
    {
        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(Revision(MonWed(), SaturdayOuting())));

        Assert.Contains(Skeleton("Schedule of supports"), text);
        Assert.Contains(Row("Repeats every week from 12 Oct 2026 to 18 Oct 2026.", "Days", "Time", "Support", "Ratio", "State", "Hours"), text);
        foreach (var heading in new[] { "week", "Cost", "agreement" }) Assert.Contains(Skeleton(heading), text);
        var expected =
            Row("Mon, Wed", "09:00 to 13:00", "Community access", "1:1", "NSW", "8", "$588.64") +
            Row("Sat", "09:00 to 15:00", "Group activity", "1:3", "NSW", "6", "$207.06");
        Assert.Contains(expected, text);
    }

    [Fact]
    public void A_run_of_days_reads_Mon_to_Fri_and_the_hours_a_week_are_the_hours_of_a_shift_times_its_days()
    {
        var weekdays = MonWed("weekdays") with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday } };
        var draft = Revision(weekdays);

        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(draft));

        var cost = Dollars(Quote(new[] { weekdays }, Mon12Oct, Sun18Oct), "weekdays");
        Assert.Contains(Row("Mon to Fri", "09:00 to 13:00", "Community access", "1:1", "NSW", "20", cost), text);
    }

    [Fact]
    public void A_support_that_ends_the_next_day_says_so_in_words()
    {
        var overnight = FridayNight();
        var draft = Revision(MonWed(), overnight);

        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(draft));

        var cost = Dollars(Quote(new[] { MonWed(), overnight }, Mon12Oct, Sun18Oct), "night");
        Assert.Contains(Row("Fri", "22:00 to 06:00 (ends the next day)", "Personal care", "1:1", "NSW", "8", cost), text);
        Assert.DoesNotContain(Skeleton("09:00 to 13:00 (ends the next day)"), text);       // only the overnight row says it
    }

    [Fact]
    public void A_support_with_no_price_yet_says_Not_priced_and_never_zero_dollars()
    {
        var draft = Revision(MonWed(), UnpricedNight());
        var answer = DraftJson.ReadQuote(draft.PricingJson)!;
        Assert.Equal(0m, answer.Totals.ByBlock.Single(b => b.BlockId == "unpriced").Amount);       // the setup: the engine priced nothing from it
        Assert.Contains(answer.Issues, issue => issue is { BlockId: "unpriced", Reason: PlanFailureReason.NoItem });

        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(draft));

        var before = Row("Tue", "01:00 to 05:00", "Community access", "1:1", "NSW", "4");
        Assert.Contains(before + Skeleton("Not priced"), text);
        Assert.DoesNotContain(before + Skeleton("$0"), text);
    }

    [Fact]
    public void The_schedule_comes_first_and_the_catalogue_lines_follow_it_as_the_cost_detail()
    {
        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(Revision(MonWed(), SaturdayOuting())));

        var schedule = text.IndexOf(Skeleton("Schedule of supports"), StringComparison.Ordinal);
        var lines = text.IndexOf(Skeleton("Cost detail (NDIS catalogue prices)"), StringComparison.Ordinal);
        var total = text.IndexOf(Skeleton("Total of the priced lines"), StringComparison.Ordinal);
        Assert.True(schedule >= 0 && schedule < lines && lines < total, $"schedule at {schedule}, lines table at {lines}, total at {total}");
        Assert.Contains(Skeleton("04_104_0125_6_1"), text);       // the lines table still prints each line's catalogue code
    }

    [Fact]
    public void A_revision_typed_by_hand_has_no_weekly_schedule_and_says_so_without_a_repeats_sentence()
    {
        var draft = Revision(MonWed());
        draft.Blocks.Clear();
        draft.PricingJson = null;

        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(draft));

        Assert.Contains(Skeleton("Schedule of supports"), text);
        Assert.Contains(Skeleton("No weekly schedule was recorded for this agreement."), text);
        Assert.DoesNotContain(Skeleton("Repeats every week"), text);
    }

    [Fact]
    public void A_support_whose_stored_text_cannot_be_read_is_not_listed_and_the_pdf_says_that_some_are_missing()
    {
        var draft = Revision(MonWed(), SaturdayOuting());
        draft.Blocks.Single(b => b.BlockKey == "sat").BlockJson = """{"id":"sat","supportType":"ARenamedMember","days":["Saturday"]}""";

        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(draft));

        Assert.Contains(Row("Mon, Wed", "09:00 to 13:00", "Community access", "1:1", "NSW", "8", "$588.64"), text);
        Assert.DoesNotContain(Row("Sat", "09:00 to 15:00"), text);
        Assert.Contains(Skeleton("could not be read, so they are not listed here"), text);
    }

    [Fact]
    public void A_row_takes_its_cost_from_the_saved_lines_when_the_stored_answer_has_no_total_for_the_support()
    {
        var draft = Revision(MonWed());
        draft.PricingJson = null;                      // no stored answer to read the block's total from; the lines it was saved with still say

        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(draft));

        Assert.Contains(Row("Mon, Wed", "09:00 to 13:00", "Community access", "1:1", "NSW", "8", "$588.64"), text);
    }

    // ── The words of a row ────────────────────────────────────────────────────────

    private const DayOfWeek Mon = DayOfWeek.Monday, Tue = DayOfWeek.Tuesday, Wed = DayOfWeek.Wednesday, Thu = DayOfWeek.Thursday, Fri = DayOfWeek.Friday, Sat = DayOfWeek.Saturday, Sun = DayOfWeek.Sunday;

    [Theory]
    [InlineData("Mon to Fri", new[] { Mon, Tue, Wed, Thu, Fri })]
    [InlineData("Mon, Wed, Fri", new[] { Mon, Wed, Fri })]
    [InlineData("Sat, Sun", new[] { Sat, Sun })]
    [InlineData("Mon, Tue", new[] { Mon, Tue })]
    [InlineData("Tue, Thu to Sat", new[] { Tue, Thu, Fri, Sat })]
    [InlineData("Mon, Sun", new[] { Sun, Mon })]                                  // the week starts on Monday: Sunday is its last day, not the one before Monday
    [InlineData("Mon, Tue", new[] { Tue, Mon, Mon })]                             // in any order, each day once
    [InlineData("Every day", new[] { Mon, Tue, Wed, Thu, Fri, Sat, Sun })]
    [InlineData("Fri", new[] { Fri })]
    [InlineData("No days", new DayOfWeek[0])]
    public void Days_read_in_the_screens_words_Monday_first_with_a_run_of_three_or_more_as_a_range(string expected, DayOfWeek[] days) =>
        Assert.Equal(expected, AgreementSchedule.DaysText(days));

    [Theory]
    [InlineData(9, 0, 13, 0, "09:00 to 13:00")]
    [InlineData(22, 0, 6, 0, "22:00 to 06:00 (ends the next day)")]
    [InlineData(16, 0, 16, 0, "16:00 to 16:00 (ends the next day)")]               // the same time twice is a 24 hour shift
    [InlineData(0, 0, 6, 0, "00:00 to 06:00")]
    public void A_time_says_in_words_when_the_shift_ends_the_next_day(int startHour, int startMinute, int endHour, int endMinute, string expected) =>
        Assert.Equal(expected, AgreementSchedule.TimeText(Block("x", PlanSupportType.PersonalCare, Mon, T(startHour, startMinute), T(endHour, endMinute))));

    [Theory]
    [InlineData(9, 0, 13, 0, 2, "8")]
    [InlineData(9, 0, 13, 30, 3, "13.5")]
    [InlineData(7, 0, 9, 20, 1, "2.33")]                                           // 140 minutes: never more than two decimals
    [InlineData(22, 0, 6, 0, 7, "56")]
    [InlineData(16, 0, 16, 0, 2, "48")]
    public void The_hours_a_week_are_the_length_of_a_shift_on_the_clock_times_its_days(int startHour, int startMinute, int endHour, int endMinute, int days, string expected)
    {
        var block = Block("x", PlanSupportType.PersonalCare, Mon, T(startHour, startMinute), T(endHour, endMinute), b => b with { Days = new[] { Mon, Tue, Wed, Thu, Fri, Sat, Sun }.Take(days).ToArray() });

        Assert.Equal(expected, AgreementSchedule.HoursText(block));
    }

    [Fact]
    public void The_ratio_is_workers_to_participants_present()
    {
        Assert.Equal("2:1", AgreementSchedule.RatioText(MonWed() with { Workers = 2 }));
        Assert.Equal("1:3", AgreementSchedule.RatioText(SaturdayOuting()));
    }

    // ── The PDF of a saved revision ───────────────────────────────────────────────

    [Fact]
    public async Task The_pdf_of_a_revision_that_was_saved_prints_its_schedule_so_the_blocks_are_loaded_with_it()
    {
        var tenantId = Guid.NewGuid();
        var name = Guid.NewGuid().ToString();
        OdipDbContext Open(Guid? forTenant, bool superAdmin)
        {
            var tenant = new Mock<ICurrentTenant>();
            tenant.Setup(t => t.TenantId).Returns(forTenant);
            tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
            return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
        }
        await using var db = Open(tenantId, superAdmin: false);
        await db.Database.EnsureCreatedAsync();
        await using (var importDb = Open(null, superAdmin: true))
            await CatalogueImportTestSupport.ImportAsync(importDb, CatalogueFixtures.File2026_27);       // the catalogue is global: imported as a SuperAdmin would
        var participant = db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Synthetic", LastName = "Participant", NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true, IsDraft = true }).Entity;
        await db.SaveChangesAsync();
        var request = new CreateServiceAgreementDraftDto
        {
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = Mon12Oct, AgreementEndDate = Sun18Oct, State = "NSW",
            Blocks = new[] { MonWed(), SaturdayOuting() }.Select(b => new DraftBlockDto { Block = b, Requirements = new DraftBlockRequirementsDto() }).ToList(),
        };
        var service = new ServiceAgreementDraftService(db);
        var saved = Assert.IsType<ServiceAgreementDraft>((await service.SaveAsync(tenantId, participant.Id, request, "actor", CancellationToken.None)).Draft);
        db.ChangeTracker.Clear();                      // the PDF is rendered from what the database holds, not from the objects the save left tracked

        var (pdf, error) = await service.RenderPdfAsync(tenantId, participant.Id, saved.Id, CancellationToken.None);

        Assert.Null(error);
        var text = TextOf(pdf!.Content);
        Assert.Contains(Row("Mon, Wed", "09:00 to 13:00", "Community access", "1:1", "NSW", "8", "$588.64"), text);
        Assert.Contains(Row("Sat", "09:00 to 15:00", "Group activity", "1:3", "NSW", "6", "$207.06"), text);
    }

    // ── A sample to look at ───────────────────────────────────────────────────────

    /// <summary>
    /// Renders a sample plan (a weekday routine, a Saturday outing, an overnight support and one with no price) and, when ODIP_SAMPLE_PDF names a file, writes the PDF there and each of its pages
    /// beside it as a PNG, so a person can look at the table. Without the variable it renders and checks only that it is a PDF.
    /// </summary>
    [Fact]
    public void A_sample_agreement_with_a_weekday_routine_an_overnight_support_and_one_without_a_price_renders()
    {
        var draft = Revision(MonWed("community") with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday } }, SaturdayOuting(), FridayNight(), UnpricedNight());
        draft.ParticipantNameSnapshot = "Alex Sample";
        draft.Representative = "Sam Sample (parent)";
        draft.ServiceTypesJson = """["Community access","Group activity","Personal care"]""";

        var pdf = ServiceAgreementDraftPdfRenderer.Render(draft);

        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(pdf, 0, 5));
        if (Environment.GetEnvironmentVariable("ODIP_SAMPLE_PDF") is not { Length: > 0 } path) return;
        File.WriteAllBytes(path, pdf);
        var pages = ServiceAgreementDraftPdfRenderer.Compose(draft).GenerateImages(new ImageGenerationSettings { ImageFormat = ImageFormat.Png, RasterDpi = 110 }).ToList();
        for (var page = 0; page < pages.Count; page++) File.WriteAllBytes(Path.ChangeExtension(path, null) + $"-page-{page + 1}.png", pages[page]);
    }
}
