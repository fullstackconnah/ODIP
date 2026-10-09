using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Odip.Api.Controllers;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Rostering;
using UglyToad.PdfPig;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// What the agreement PDF is called and how it names the participant's service types: the file is "Service agreement - {participant} - {agreement start}.pdf" (it was
/// "service-agreement-draft-v{revision id}.pdf"), and the service types read "Community access, Personal care" and not the JSON they are stored as.
/// </summary>
public class DraftPdfNamingTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static PlanBlock MonWed() =>
        Block("b1", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday } });

    /// <summary>The words of the PDF as they are drawn, with nothing taken out of them (the other PDF tests compare skeletons, which cannot tell a JSON list from a readable one).</summary>
    internal static string WordsOf(byte[] pdf)
    {
        using var document = PdfDocument.Open(pdf);
        return string.Join(" ", document.GetPages().SelectMany(page => page.GetWords()).Select(word => word.Text));
    }

    private static async Task<(OdipDbContext Db, ServiceAgreementDraft Draft)> StoredRevisionAsync(string participantName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var participant = db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Synthetic", LastName = "Participant", IsActive = true, IsDraft = true }).Entity;
        var draft = ApprovalTestSupport.BuildRevision(TenantId, participant.Id, 1, new[] { MonWed() }, Mon12Oct, Sun18Oct);
        draft.ParticipantNameSnapshot = participantName;
        db.ServiceAgreementDrafts.Add(draft);
        await db.SaveChangesAsync();
        return (db, draft);
    }

    private static async Task<FileContentResult> DownloadAsync(OdipDbContext db, ServiceAgreementDraft draft)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantId);
        var controller = new ServiceAgreementDraftsController(db, tenant.Object, new ServiceAgreementDraftService(db));
        return Assert.IsType<FileContentResult>(await controller.Pdf(draft.ParticipantId, draft.Id, CancellationToken.None));
    }

    // ── The service types ─────────────────────────────────────────────────────────

    [Fact]
    public void The_service_types_print_as_a_readable_list_and_not_as_the_json_they_are_stored_in()
    {
        var draft = ApprovalTestSupport.BuildRevision(TenantId, Guid.NewGuid(), 1, new[] { MonWed() }, Mon12Oct, Sun18Oct);
        draft.ServiceTypesJson = """["Community access","Personal care"]""";

        var words = WordsOf(ServiceAgreementDraftPdfRenderer.Render(draft));

        Assert.Contains("Service types Community access, Personal care", words);
        Assert.DoesNotContain("[\"", words);
        Assert.DoesNotContain("\"]", words);
    }

    // ── The file name ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_download_is_named_service_agreement_participant_and_the_day_the_agreement_starts()
    {
        var (db, draft) = await StoredRevisionAsync("Synthetic Participant");
        await using var _ = db;

        var download = await DownloadAsync(db, draft);

        Assert.Equal("application/pdf", download.ContentType);
        Assert.Equal("Service agreement - Synthetic Participant - 2026-10-12.pdf", download.FileDownloadName);
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(download.FileContents, 0, 5));
    }

    /// <summary>The Content-Disposition header MVC writes when it executes the result, which is what the browser receives.</summary>
    private static async Task<string> HeaderOfAsync(FileContentResult result)
    {
        var context = new DefaultHttpContext { RequestServices = new ServiceCollection().AddLogging().AddMvcCore().Services.BuildServiceProvider() };
        context.Response.Body = new MemoryStream();
        await result.ExecuteResultAsync(new ActionContext(context, new RouteData(), new ActionDescriptor()));
        return context.Response.Headers.ContentDisposition.ToString();
    }

    /// <summary>The name the page takes out of Content-Disposition (frontend api/hooks/service-agreement-drafts.ts, <c>fileNameFromDisposition</c>): the RFC 5987 <c>filename*</c> when there is one, else the plain <c>filename</c>.</summary>
    private static string? NameTheHookReads(string header)
    {
        var star = Regex.Match(header, @"filename\*\s*=\s*[^';]*'[^';]*'([^;]+)", RegexOptions.IgnoreCase);
        if (star.Success) return Uri.UnescapeDataString(star.Groups[1].Value.Trim().Trim('"'));
        var plain = Regex.Match(header, @"filename\s*=\s*""?([^"";]+)""?", RegexOptions.IgnoreCase);
        return plain.Success ? plain.Groups[1].Value : null;
    }

    // The download name is sent the way ASP.NET sends any file name (what FileResultExecutorBase does with FileDownloadName): an ASCII filename for simple clients and the RFC 5987 filename* with the
    // real name, percent-encoded UTF-8. The page prefers the second, so the name arrives with its letters.
    [Theory]
    [InlineData("Synthetic Participant")]
    [InlineData("José Núñez")]
    [InlineData("Nguyễn Thị Hoa")]
    [InlineData("Zoë O'Brien")]
    [InlineData("Mary-Jane O'Brien, \"MJ\"\r\n/\\:*?<>| café 100% ; 😀")]
    public async Task The_name_survives_the_header_and_the_pages_own_way_of_reading_it_back_with_its_letters(string participantName)
    {
        var (db, draft) = await StoredRevisionAsync(participantName);
        await using var _ = db;
        var download = await DownloadAsync(db, draft);
        var fileName = download.FileDownloadName;

        var header = await HeaderOfAsync(download);

        Assert.Equal(fileName, NameTheHookReads(header));
        Assert.DoesNotContain('\n', header);
        Assert.DoesNotContain('\r', header);
        var plain = Regex.Match(header, @"filename\s*=\s*""?([^"";]+)""?", RegexOptions.IgnoreCase);
        Assert.True(plain.Success, header);
        Assert.All(plain.Groups[1].Value, character => Assert.True(character < 128, $"the plain filename is ASCII for a client that cannot read filename*: {header}"));
        if (fileName.Any(character => character > 127)) Assert.Matches(@"filename\*\s*=\s*UTF-8''", header);
    }

    [Theory]
    [InlineData("José Núñez", "José Núñez")]
    [InlineData("Nguyễn Thị Hoa", "Nguyễn Thị Hoa")]
    public async Task The_download_of_a_participant_with_accents_keeps_every_letter_of_the_name(string participantName, string expectedName)
    {
        var (db, draft) = await StoredRevisionAsync(participantName);
        await using var _ = db;

        var download = await DownloadAsync(db, draft);

        Assert.Equal($"Service agreement - {expectedName} - 2026-10-12.pdf", download.FileDownloadName);
    }

    // ── The words ─────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Synthetic Participant", "Service agreement - Synthetic Participant - 2026-10-12.pdf")]
    [InlineData("Mary-Jane O'Brien", "Service agreement - Mary-Jane OBrien - 2026-10-12.pdf")]
    [InlineData("  Ann   Lee  ", "Service agreement - Ann Lee - 2026-10-12.pdf")]
    [InlineData("A/B\\C:D*E?F\"G<H>I|J", "Service agreement - ABCDEFGHIJ - 2026-10-12.pdf")]          // nothing a file system refuses
    [InlineData("100% real; \r\ninjected", "Service agreement - 100 real injected - 2026-10-12.pdf")]    // nothing that ends or splits a header, or that the page's decoding would choke on
    [InlineData("José Núñez", "Service agreement - José Núñez - 2026-10-12.pdf")]                    // the letters of the name stay, accents and all
    [InlineData("Nguyễn Thị Hoa", "Service agreement - Nguyễn Thị Hoa - 2026-10-12.pdf")]
    [InlineData("Zoë O'Brien", "Service agreement - Zoë OBrien - 2026-10-12.pdf")]                    // the apostrophe goes, the ë stays
    [InlineData("José Lee", "Service agreement - José Lee - 2026-10-12.pdf")]            // an accent typed as a combining mark stays with its letter
    [InlineData("日本語名前", "Service agreement - 日本語名前 - 2026-10-12.pdf")]                      // letters of any script
    [InlineData("😀 - 😀", "Service agreement - Participant - 2026-10-12.pdf")]                        // nothing left of the name: a word, not an empty segment
    [InlineData("- -", "Service agreement - Participant - 2026-10-12.pdf")]
    [InlineData("", "Service agreement - Participant - 2026-10-12.pdf")]
    public void The_file_name_keeps_letters_digits_spaces_and_hyphens_of_the_name_and_nothing_else(string participantName, string expected) =>
        Assert.Equal(expected, ServiceAgreementDraftPdfRenderer.FileName(new ServiceAgreementDraft { ParticipantNameSnapshot = participantName, AgreementStartDate = Mon12Oct }));

    [Fact]
    public void The_date_in_the_file_name_is_the_agreements_start_in_year_month_day_whatever_the_culture()
    {
        var before = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture = System.Globalization.CultureInfo.InvariantCulture;
            Assert.Equal("Service agreement - Ann Lee - 2027-01-05.pdf", ServiceAgreementDraftPdfRenderer.FileName(new ServiceAgreementDraft { ParticipantNameSnapshot = "Ann Lee", AgreementStartDate = new DateOnly(2027, 1, 5) }));
        }
        finally { System.Globalization.CultureInfo.CurrentCulture = before; }
    }

    [Theory]
    [InlineData("""["Community access","Personal care"]""", "Community access, Personal care")]
    [InlineData("""["  Community access  "]""", "Community access")]
    [InlineData("[]", "Not recorded")]
    [InlineData("""["", "  "]""", "Not recorded")]
    [InlineData("[null]", "Not recorded")]
    [InlineData("", "Not recorded")]
    [InlineData(null, "Not recorded")]
    [InlineData("not json", "not json")]                  // text that is not a list is printed as it is, never a failure
    [InlineData("""{"a":1}""", """{"a":1}""")]
    public void Service_types_read_as_a_sentence_and_text_that_is_not_a_list_is_printed_as_it_is(string? stored, string expected) =>
        Assert.Equal(expected, ServiceAgreementDraftPdfRenderer.ServiceTypesText(stored));
}
