using System.Text.RegularExpressions;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>
/// DOC-01 review polish — <see cref="ParticipantDocumentService.BuildFileName"/> feeds directly
/// into the download endpoints' Content-Disposition filename (see
/// <c>ParticipantsController.DownloadIntakeFormPdf</c>/<c>DownloadParticipantProfilePdf</c>), so an
/// unsanitized participant name is a real HTTP response-splitting/header-injection surface (CR/LF
/// in a header value) as well as a plain malformed-download-name risk (quotes, commas). This suite
/// exercises the sanitizer directly — extracted to a <c>public static</c> method (see that method's
/// doc comment: no InternalsVisibleTo exists anywhere in this backend tree, and "public" is this
/// codebase's existing cross-project test-access convention in Odip.Infrastructure/Services, e.g.
/// <see cref="ParticipantDocumentComposer"/>'s public static Compose* methods) — rather than
/// asserting on a full end-to-end participant graph.
/// </summary>
public class ParticipantDocumentServiceFileNameTests
{
    /// <summary>Letters, digits, space, hyphen only — genuinely header-safe: excludes quotes, commas, CR, LF, and non-ASCII.</summary>
    private static readonly Regex HeaderSafeFileName = new("^[A-Za-z0-9 -]+\\.pdf$");

    [Fact]
    public void BuildFileName_StripsQuotesCommasCrLfAndUnicode_ProducesHeaderSafeFileName()
    {
        // CRLF is a real Content-Disposition header-injection/response-splitting vector if it
        // survives into the filename; quotes/commas can break a naive "filename=..." header
        // parameter; café/emoji stand in for arbitrary unicode.
        var unsafeName = "O'Brien, \"Test\"\r\ncafé 😀";

        var fileName = ParticipantDocumentService.BuildFileName(unsafeName, "Intake-Form");

        Assert.Matches(HeaderSafeFileName, fileName);
        Assert.DoesNotContain("'", fileName);
        Assert.DoesNotContain("\"", fileName);
        Assert.DoesNotContain(",", fileName);
        Assert.DoesNotContain("\r", fileName);
        Assert.DoesNotContain("\n", fileName);
    }

    [Fact]
    public void BuildFileName_EntirelyNonAsciiName_FallsBackToNonEmptyParticipantSegment()
    {
        // Every character in this name is outside [A-Za-z0-9 -], so the sanitized identifier
        // segment would otherwise be stripped to nothing, producing a malformed filename like
        // "-Intake-Form-20260901.pdf" (leading hyphen, empty name segment).
        var entirelyUnicodeName = "日本語名前";

        var fileName = ParticipantDocumentService.BuildFileName(entirelyUnicodeName, "Intake-Form");

        Assert.Matches(HeaderSafeFileName, fileName);
        Assert.False(fileName.StartsWith('-'), $"Expected a non-empty fallback name segment, got a leading hyphen in '{fileName}'.");
        Assert.StartsWith("Participant-Intake-Form-", fileName);
    }

    [Fact]
    public void BuildFileName_PreservesSafeCharacters_IncludingHyphensAndSpaces()
    {
        var fileName = ParticipantDocumentService.BuildFileName("Sophie-Anne Brown", "Participant-Profile");

        Assert.Matches(HeaderSafeFileName, fileName);
        Assert.StartsWith("Sophie-Anne Brown-Participant-Profile-", fileName);
    }
}
