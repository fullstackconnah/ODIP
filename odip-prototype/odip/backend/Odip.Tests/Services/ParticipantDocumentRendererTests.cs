using System.Text;
using Odip.Infrastructure.Services;
using QuestPDF.Infrastructure;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>Text the renderer cannot draw or lay out must not turn a download (or intake completion) into a 500.</summary>
public class ParticipantDocumentRendererTests
{
    public ParticipantDocumentRendererTests() => QuestPDF.Settings.License = LicenseType.Community;

    // An emoji, markup, a newline, a private-use character no bundled font carries, and a CJK character.
    private const string Awkward = "Zoe 😀 <b>x</b> line1\nline2 \uE000 \u4F60";

    [Fact]
    public void Render_DoesNotThrow_OnEmojiMarkupNewlinesMissingGlyphsAndA4000CharacterValue()
    {
        var model = new ParticipantDocumentModel(
            "Participant Profile", Awkward, "123456789", new DateTime(2026, 11, 13, 9, 30, 0),
            new[]
            {
                new ParticipantDocumentSection("Details",
                    new[]
                    {
                        new ParticipantDocumentField(Awkward, Awkward),
                        new ParticipantDocumentField("Long note", new string('x', 4000)),
                    },
                    new[] { new ParticipantDocumentTable("Table", new[] { "A", "B" }, new[] { new[] { Awkward, Awkward } }) }),
            });

        var bytes = ParticipantDocumentRenderer.Render(model);

        Assert.NotEmpty(bytes);
        Assert.Equal("%PDF", Encoding.ASCII.GetString(bytes, 0, 4));
    }
}
