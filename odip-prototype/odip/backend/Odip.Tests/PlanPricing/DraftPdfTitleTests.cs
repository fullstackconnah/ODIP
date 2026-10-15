using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Rostering;
using UglyToad.PdfPig;
using Xunit;
using static Odip.Tests.PlanPricing.DraftPdfNamingTests;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The top of the agreement PDF: a title, who the agreement is from (the organisation's name, ABN and NDIS registration number from its provider settings, each only when set, never a placeholder)
/// and the day it was prepared (the revision's creation date in the provider's time zone). Rendered through <see cref="ServiceAgreementDraftService.RenderPdfAsync"/> against an in-memory
/// database, because reading the right organisation's settings is half of what is being tested.
/// </summary>
public class DraftPdfTitleTests
{
    private static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();

    /// <summary>Tuesday 6 October 2026, 01:30 in Sydney (AEDT, +11:00); Monday 5 October, 22:30 in Perth (+8:00); Monday 5 October 14:30 in UTC.</summary>
    private static readonly DateTime CreatedAt = new(2026, 10, 5, 14, 30, 0, DateTimeKind.Utc);

    private static PlanBlock MonWed() =>
        Block("b1", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday } });

    private static PlanBlock[] FourSupports() => new[]
    {
        MonWed(),
        Block("sat", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 }),
        Block("night", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(6), b => b with { Setting = PlanSetting.AtHome }),
        Block("unpriced", PlanSupportType.CommunityAccess, DayOfWeek.Tuesday, T(1), T(5)),
    };

    /// <summary>
    /// The PDF of one revision of tenant A, as <see cref="ServiceAgreementDraftService.RenderPdfAsync"/> makes it, with tenant A's provider settings <paramref name="own"/> (none when null) and
    /// tenant B's <paramref name="other"/> in the same database. The context is a SuperAdmin's when asked: its query filters let every organisation's rows through, which is the case the explicit tenant is for.
    /// </summary>
    private static async Task<byte[]> PdfAsync(ProviderSettings? own, ProviderSettings? other = null, bool superAdmin = false, PlanBlock[]? blocks = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(superAdmin ? null : TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        await using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var participant = db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Synthetic", LastName = "Participant", IsActive = true, IsDraft = true }).Entity;
        var draft = ApprovalTestSupport.BuildRevision(TenantA, participant.Id, 1, blocks ?? new[] { MonWed() }, Mon12Oct, Sun18Oct);
        draft.CreatedAt = CreatedAt;
        db.ServiceAgreementDrafts.Add(draft);
        if (own is not null) { own.Id = Guid.NewGuid(); own.TenantId = TenantA; db.ProviderSettings.Add(own); }
        if (other is not null) { other.Id = Guid.NewGuid(); other.TenantId = TenantB; db.ProviderSettings.Add(other); }
        await db.SaveChangesAsync();

        var (pdf, error) = await new ServiceAgreementDraftService(db).RenderPdfAsync(TenantA, participant.Id, draft.Id, CancellationToken.None);

        Assert.Null(error);
        return pdf!.Content;
    }

    private static ProviderSettings Provider(string name = "", string abn = "", string registration = "", string state = "NSW") =>
        new() { OrganisationName = name, ABN = abn, RegistrationNumber = registration, State = state };

    // ── The block ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_first_page_opens_with_the_title_then_the_provider_then_the_day_it_was_prepared_and_then_the_participant()
    {
        var pdf = await PdfAsync(Provider("Oassist", "12345678901", "4-ABC-123"));

        var text = TextOf(pdf);

        Assert.Contains(Skeleton("Service agreement") + Skeleton("Oassist · ABN 12 345 678 901 · NDIS registration 4-ABC-123") + Skeleton("Prepared 06 Oct 2026") + Skeleton("Participant"), text);
        Assert.Contains("ABN 12 345 678 901", WordsOf(pdf));              // grouped the way an ABN is written
    }

    [Theory]
    [InlineData("Oassist", "", "", "Oassist")]
    [InlineData("", "12345678901", "", "ABN 12 345 678 901")]
    [InlineData("", "", "4-ABC-123", "NDIS registration 4-ABC-123")]
    [InlineData("Oassist", "12345678901", "", "Oassist · ABN 12 345 678 901")]
    [InlineData("Oassist", "", "4-ABC-123", "Oassist · NDIS registration 4-ABC-123")]
    [InlineData("", "12 345 678 901", "4-ABC-123", "ABN 12 345 678 901 · NDIS registration 4-ABC-123")]
    [InlineData("  Oassist  ", "  ", "4-ABC-123  ", "Oassist · NDIS registration 4-ABC-123")]
    public async Task Only_the_fields_that_are_set_are_printed_with_nothing_in_place_of_the_rest(string name, string abn, string registration, string expected)
    {
        var text = TextOf(await PdfAsync(Provider(name, abn, registration)));

        Assert.Contains(Skeleton("Service agreement") + Skeleton(expected) + Skeleton("Prepared 06 Oct 2026"), text);
    }

    [Fact]
    public async Task An_abn_that_is_not_eleven_digits_is_printed_as_it_was_typed()
    {
        var words = WordsOf(await PdfAsync(Provider("Oassist", "12-345", "")));

        Assert.Contains("Oassist · ABN 12-345", words);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task With_no_provider_details_there_is_no_provider_line_and_no_placeholder(bool settingsRow)
    {
        var pdf = await PdfAsync(settingsRow ? Provider("", "  ", "") : null);

        var text = TextOf(pdf);

        Assert.Contains(Skeleton("Service agreement") + Skeleton("Prepared 06 Oct 2026") + Skeleton("Participant"), text);
        Assert.DoesNotContain(Skeleton("NDIS registration"), text);
        Assert.DoesNotMatch(@"ABN \d", WordsOf(pdf));              // the template's own text says "ABN" (section 1), but no number follows it
    }

    [Fact]
    public async Task Another_organisations_settings_are_never_printed_even_when_the_context_can_see_them()
    {
        var pdf = await PdfAsync(own: null, other: Provider("Other Organisation", "98765432109", "9-XYZ-999"), superAdmin: true);

        var text = TextOf(pdf);

        Assert.DoesNotContain(Skeleton("Other Organisation"), text);
        Assert.DoesNotContain(Skeleton("9-XYZ-999"), text);
        Assert.Contains(Skeleton("Service agreement") + Skeleton("Prepared 06 Oct 2026") + Skeleton("Participant"), text);
    }

    // ── The day it was prepared ───────────────────────────────────────────────────

    [Theory]
    [InlineData("NSW", "06 Oct 2026")]      // 01:30 on the 6th in Sydney
    [InlineData("WA", "05 Oct 2026")]       // 22:30 on the 5th in Perth
    public async Task The_day_prepared_is_the_day_in_the_providers_zone_and_not_the_day_in_UTC(string state, string expected)
    {
        var text = TextOf(await PdfAsync(Provider("Oassist", state: state)));

        Assert.Contains(Skeleton("Prepared " + expected), text);
    }

    [Fact]
    public async Task With_no_settings_at_all_the_day_is_the_day_in_Sydney_as_everywhere_else_in_the_app()
    {
        var text = TextOf(await PdfAsync(own: null));

        Assert.Contains(Skeleton("Prepared 06 Oct 2026"), text);
    }

    // ── Where it sits and how it looks ────────────────────────────────────────────

    [Fact]
    public async Task The_title_is_on_the_first_page_only_and_a_step_larger_than_the_section_headings()
    {
        var pdf = await PdfAsync(Provider("Oassist"), blocks: FourSupports());

        using var document = PdfDocument.Open(pdf);
        Assert.True(document.NumberOfPages >= 2);
        var titles = document.GetPages().Select(page => page.GetWords().Count(word => word.Text == "Service" && word.Letters[0].PointSize > 14)).ToList();
        Assert.Equal(1, titles[0]);
        Assert.All(titles.Skip(1), count => Assert.Equal(0, count));
        var first = document.GetPage(1).GetWords().ToList();
        var title = first.OrderByDescending(word => word.BoundingBox.Top).First();
        var heading = first.Single(word => word.Text == "Schedule");
        Assert.Equal("Service", title.Text);                                                      // the very first thing on the page
        Assert.True(title.Letters[0].PointSize > heading.Letters[0].PointSize, $"title {title.Letters[0].PointSize} pt, section heading {heading.Letters[0].PointSize} pt");
    }
}
