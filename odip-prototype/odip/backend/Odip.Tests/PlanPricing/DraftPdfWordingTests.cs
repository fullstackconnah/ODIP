using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using Odip.Tests.Rostering;
using Xunit;
using static Odip.Tests.PlanPricing.DraftPdfNamingTests;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The words the agreement PDF is written in once the stamp is gone: no draft line under the page title, labels that do not call the agreement a draft, and a count in the singular when it is one.
/// The template's numbered review sections are the owner's placeholders and are not touched (DraftSigningAndPdfTests holds their headings).
/// </summary>
public class DraftPdfWordingTests
{
    private static PlanBlock Weekdays() =>
        Block("weekdays", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday } });

    private static PlanBlock SaturdayOuting() =>
        Block("sat", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });

    private static ServiceAgreementDraft Revision(params PlanBlock[] blocks) =>
        ApprovalTestSupport.BuildRevision(Guid.NewGuid(), Guid.NewGuid(), 3, blocks, Mon12Oct, Sun18Oct);

    /// <summary>A plan long enough for two pages: the schedule, its cost detail and the template's eight sections do not fit on one.</summary>
    private static ServiceAgreementDraft TwoPages() => Revision(
        Weekdays(), SaturdayOuting(),
        Block("night", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(6), b => b with { Setting = PlanSetting.AtHome }),
        Block("unpriced", PlanSupportType.CommunityAccess, DayOfWeek.Tuesday, T(1), T(5)));

    // ── No draft line under the page title ────────────────────────────────────────

    [Fact]
    public void No_page_carries_the_grey_draft_line_under_the_title_and_each_still_has_its_page_number()
    {
        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(TwoPages()));

        foreach (var line in new[] { "ODIP Service Agreement", "provisional blank draft", "Legal review required", "not signed, active, roster-ready, an invoice, claim authority, or billing authority" })
            Assert.DoesNotContain(Skeleton(line), text);
        Assert.Contains(Skeleton("Page 1"), text);
        Assert.Contains(Skeleton("Page 2"), text);
    }

    // With no header the page breaks fall in new places: a numbered heading must not be left on its own at the foot of a page with its text on the next.
    [Fact]
    public void A_numbered_section_heading_is_never_the_last_line_of_a_page()
    {
        using var document = UglyToad.PdfPig.PdfDocument.Open(ServiceAgreementDraftPdfRenderer.Render(TwoPages()));

        Assert.True(document.NumberOfPages >= 2, "the fixture should run onto a second page");
        foreach (var page in document.GetPages())
        {
            // The lines of the page from the bottom up (the lowest is the page number), each as its words from left to right.
            var lines = page.GetWords().GroupBy(word => Math.Round(word.BoundingBox.Bottom / 3)).OrderBy(group => group.Key)
                .Select(group => string.Join(" ", group.OrderBy(word => word.BoundingBox.Left).Select(word => word.Text))).ToList();
            Assert.Matches(@"^Page \d+$", lines[0]);
            Assert.DoesNotMatch(@"^\d\. ", lines[1]);
        }
    }

    // ── Labels ────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_agreement_dates_and_the_cost_table_are_not_called_drafts()
    {
        var pdf = ServiceAgreementDraftPdfRenderer.Render(Revision(Weekdays(), SaturdayOuting()));

        var words = WordsOf(pdf);
        var text = TextOf(pdf);

        Assert.Contains("Agreement dates 12 Oct 2026 — 18 Oct 2026", words);
        Assert.Contains("Cost detail (NDIS catalogue prices)", words);
        Assert.DoesNotContain(Skeleton("Draft agreement dates"), text);
        Assert.DoesNotContain(Skeleton("Catalogue-priced draft lines"), text);
    }

    // ── Singular and plural ───────────────────────────────────────────────────────

    // A cell that wraps puts its last line after the other cells' first lines, so what follows the count is read from the cell that comes next: with one line in the table, the total sentence under it.
    private static readonly string ThenTheTotal = Skeleton("Total of the priced lines");

    [Fact]
    public void One_shift_is_said_in_the_singular_and_five_in_the_plural()
    {
        var one = TextOf(ServiceAgreementDraftPdfRenderer.Render(Revision(SaturdayOuting())));
        var five = TextOf(ServiceAgreementDraftPdfRenderer.Render(Revision(Weekdays())));

        Assert.Contains(Skeleton("for 1 shift") + ThenTheTotal, one);
        Assert.Contains(Skeleton("for 5 shifts") + ThenTheTotal, five);
    }

    [Theory]
    [InlineData(1, "1 night")]
    [InlineData(2, "2 nights")]
    public void A_line_of_nights_counts_them_in_the_singular_for_one(int nights, string expected)
    {
        var draft = Revision(Weekdays());
        var line = draft.Lines.Single();
        line.Unit = "D";
        line.Hours = nights;

        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(draft));

        Assert.Contains(Skeleton("Community access — Weekday Daytime") + Skeleton(expected) + Skeleton("04_104_0125_6_1"), text);
    }
}
