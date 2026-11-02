using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Rostering;
using QuestPDF.Fluent;
using UglyToad.PdfPig;
using Xunit;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The cost table of the agreement PDF is grouped by the PACE support category of each line, one full-width row ("01 Assistance with Daily Life") before each group, in category order. The
/// category is read from the support catalogue when the PDF is made (<see cref="ServiceAgreementDraftService.RenderPdfAsync"/>), preferring the row of the line's own catalogue version.
/// </summary>
public class DraftPdfCategoryTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private const string DailyLife = "01 Assistance with Daily Life", Transport = "02 Transport", Social = "04 Assistance with Social, Economic and Community Participation", NotInCatalogue = "Not in the support catalogue";

    private static ServiceAgreementDraftLine Line(string serviceType, string itemCode, int position, string version = "2026-27") =>
        new() { Id = Guid.NewGuid(), ServiceType = serviceType, ItemCode = itemCode, Position = position, Hours = 2, UnitPrice = 70m, CatalogueVersion = version, CatalogueEffectiveFrom = new DateOnly(2026, 7, 1) };

    private static ServiceAgreementDraft Revision(params ServiceAgreementDraftLine[] lines)
    {
        var draft = ApprovalTestSupport.BuildRevision(Tenant, Guid.NewGuid(), 1, new[] { Block("b1", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13)) }, Mon12Oct, Sun18Oct);
        draft.Lines.Clear();
        foreach (var line in lines) { line.DraftId = draft.Id; draft.Lines.Add(line); }
        return draft;
    }

    private static string TextWith(ServiceAgreementDraft draft, Dictionary<(string, string), int>? categories) =>
        TextOf(ServiceAgreementDraftPdfRenderer.Compose(draft, null, categories).GeneratePdf());

    private static SupportCatalogueItem Item(string number, string version, DateOnly from, int? pace, int? legacy = null) => new()
    {
        Id = Guid.NewGuid(), ActivityGroupId = Guid.NewGuid(), ItemNumber = number, Description = "Test " + number, CatalogueVersion = version, EffectiveFrom = from,
        PaceSupportCategoryNumber = pace, SupportCategoryNumber = legacy, IsActive = true,
    };

    /// <summary>The PDF of <paramref name="draft"/> as the service makes it, with <paramref name="catalogue"/> in the same database.</summary>
    private static async Task<string> ServiceTextAsync(ServiceAgreementDraft draft, params SupportCatalogueItem[] catalogue)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(Tenant);
        await using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        db.Participants.Add(new Participant { Id = draft.ParticipantId, TenantId = Tenant, FirstName = "Synthetic", LastName = "Participant", IsActive = true, IsDraft = true });
        db.ServiceAgreementDrafts.Add(draft);
        db.SupportCatalogueItems.AddRange(catalogue);
        await db.SaveChangesAsync();

        var (pdf, error) = await new ServiceAgreementDraftService(db).RenderPdfAsync(Tenant, draft.ParticipantId, draft.Id, CancellationToken.None);

        Assert.Null(error);
        return TextOf(pdf!.Content);
    }

    [Fact]
    public void Cost_table_groups_lines_by_pace_category_in_number_order()
    {
        // Saved with the 04 line first: the 01 group still comes first, and a group keeps its lines in Position order.
        var draft = Revision(Line("Out and about", "04_A", 0), Line("Morning routine", "01_A", 1), Line("Evening routine", "01_B", 2));
        var map = new Dictionary<(string, string), int> { [("04_A", "2026-27")] = 4, [("01_A", "2026-27")] = 1, [("01_B", "2026-27")] = 1 };

        var text = TextWith(draft, map);

        var order = new[] { DailyLife, "Morning routine", "Evening routine", Social, "Out and about" }.Select(s => text.IndexOf(Skeleton(s), StringComparison.Ordinal)).ToList();
        Assert.All(order, index => Assert.True(index >= 0));
        Assert.Equal(order.OrderBy(i => i), order);
        Assert.Equal(1, Count(text, DailyLife));        // one row for the category, not one for each of its lines
        Assert.Equal(1, Count(text, Social));
    }

    [Fact]
    public void Line_missing_from_catalogue_lands_in_not_in_catalogue_group()
    {
        var draft = Revision(Line("Hand typed", "ZZ_9", 0), Line("Morning routine", "01_A", 1));
        var map = new Dictionary<(string, string), int> { [("01_A", "2026-27")] = 1 };

        var text = TextWith(draft, map);

        var order = new[] { DailyLife, "Morning routine", NotInCatalogue, "Hand typed" }.Select(s => text.IndexOf(Skeleton(s), StringComparison.Ordinal)).ToList();
        Assert.All(order, index => Assert.True(index >= 0));
        Assert.Equal(order.OrderBy(i => i), order);        // the unmatched group is last even though its line was saved first
    }

    [Fact]
    public void A_table_with_no_lines_or_no_catalogue_has_no_category_rows()
    {
        Assert.DoesNotContain(Skeleton(NotInCatalogue), TextWith(Revision(), new Dictionary<(string, string), int>()));
        Assert.DoesNotContain(Skeleton(NotInCatalogue), TextWith(Revision(Line("Morning routine", "01_A", 0)), null));      // a caller with no catalogue gets the plain table
    }

    [Fact]
    public async Task Sta_line_uses_pace_category_not_item_code_prefix()
    {
        // An item whose code starts "04" but whose PACE category is 1, as on STA and SIL items.
        var text = await ServiceTextAsync(Revision(Line("Short term", "04_104_0125_6_1", 0)), Item("04_104_0125_6_1", "2026-27", new DateOnly(2026, 7, 1), pace: 1, legacy: 4));

        Assert.Contains(Skeleton(DailyLife), text);
        Assert.DoesNotContain(Skeleton(Social), text);
    }

    [Fact]
    public async Task A_row_with_only_the_legacy_number_is_read_by_it()
    {
        var text = await ServiceTextAsync(Revision(Line("Ride", "02_A", 0)), Item("02_A", "2026-27", new DateOnly(2026, 7, 1), pace: null, legacy: 2));

        Assert.Contains(Skeleton(Transport), text);
    }

    [Fact]
    public async Task Category_prefers_row_of_the_lines_catalogue_version()
    {
        // The newer row says 01; the line was priced from the older version, whose row says 02.
        var rows = new[] { Item("X_1", "2025-26", new DateOnly(2025, 7, 1), pace: 2), Item("X_1", "2026-27", new DateOnly(2026, 7, 1), pace: 1) };

        var own = await ServiceTextAsync(Revision(Line("Ride", "X_1", 0, version: "2025-26")), rows);
        var fallback = await ServiceTextAsync(Revision(Line("Ride", "X_1", 0, version: "2024-25")), rows);      // no row of its version: the newest

        Assert.Contains(Skeleton(Transport), own);
        Assert.DoesNotContain(Skeleton(DailyLife), own);
        Assert.Contains(Skeleton(DailyLife), fallback);
    }

    [Fact]
    public void The_table_keeps_its_four_header_cells_and_the_page_count_of_the_plain_table()
    {
        var draft = Revision(Line("Out and about", "04_A", 0), Line("Morning routine", "01_A", 1));
        var map = new Dictionary<(string, string), int> { [("04_A", "2026-27")] = 4, [("01_A", "2026-27")] = 1 };

        using var grouped = PdfDocument.Open(ServiceAgreementDraftPdfRenderer.Compose(draft, null, map).GeneratePdf());
        using var plain = PdfDocument.Open(ServiceAgreementDraftPdfRenderer.Compose(draft, null, null).GeneratePdf());

        Assert.Equal(plain.NumberOfPages, grouped.NumberOfPages);
        Assert.Equal(HeaderWords(plain), HeaderWords(grouped));
        Assert.Equal(1, HeaderWords(grouped));
    }

    // "Server price / provenance" is the one header that only the cost table has, so counting its first word counts the cost table's header rows.
    private static int HeaderWords(PdfDocument document) => document.GetPages().SelectMany(p => p.GetWords()).Count(w => w.Text == "provenance");

    private static int Count(string text, string phrase)
    {
        var needle = Skeleton(phrase);
        var count = 0;
        for (var at = text.IndexOf(needle, StringComparison.Ordinal); at >= 0; at = text.IndexOf(needle, at + needle.Length, StringComparison.Ordinal)) count++;
        return count;
    }
}
