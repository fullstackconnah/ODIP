using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Odip.Infrastructure.Services;

/// <summary>
/// DOC-01 — pure QuestPDF renderer for a composed <see cref="ParticipantDocumentModel"/> (Intake
/// Form or Participant Profile). No EF Core, no Participant/entity references — takes only the
/// plain model, mirroring <c>InvoiceService</c>'s Document.Create/A4/40pt-margin/10pt-default-font
/// idioms (the only other QuestPDF consumer in this codebase) and its table styling
/// (<c>Background("#e2e8f0")</c> header shading, <c>BorderBottom(1).BorderColor("#e2e8f0")</c> body
/// cells) so the two PDF surfaces look consistent. No logos/branding — none exist in this
/// codebase (see InvoiceService — even it renders no logo, just organisation text).
/// </summary>
public static class ParticipantDocumentRenderer
{
    public static byte[] Render(ParticipantDocumentModel model)
    {
        return Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(40);
                page.DefaultTextStyle(x => x.FontSize(10));

                page.Header().Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(model.ParticipantFullName).Bold().FontSize(16);
                            if (!string.IsNullOrWhiteSpace(model.NdisNumber))
                                c.Item().Text($"NDIS: {model.NdisNumber}").FontSize(9);
                        });
                        row.ConstantItem(160).AlignRight().Column(c =>
                        {
                            c.Item().Text(model.Title).Bold().FontSize(14);
                            c.Item().Text($"Generated: {model.GeneratedAtUtc:dd MMM yyyy HH:mm}").FontSize(9);
                        });
                    });
                    // PF-10.6 — the Client Overview's "TRIP | DATE | GROUP" header line. Only
                    // ComposeClientOverview sets TripName (never null there — see its doc comment),
                    // so this is a no-op for the Intake Form / Participant Profile.
                    if (model.TripName != null)
                    {
                        col.Item().PaddingTop(4).Row(row =>
                        {
                            row.RelativeItem().Text($"TRIP: {model.TripName}").SemiBold().FontSize(9);
                            row.RelativeItem().Text($"DATE: {model.TripDate}").SemiBold().FontSize(9);
                            row.RelativeItem().Text($"GROUP: {model.TripGroup}").SemiBold().FontSize(9);
                        });
                    }

                    col.Item().PaddingTop(8).LineHorizontal(1);
                });

                page.Content().PaddingTop(16).Column(col =>
                {
                    foreach (var section in model.Sections)
                    {
                        col.Item().PaddingTop(12).Text(section.Heading).Bold().FontSize(13);

                        foreach (var field in section.Fields)
                        {
                            col.Item().PaddingTop(2).Row(row =>
                            {
                                row.ConstantItem(200).Text(field.Label).SemiBold();
                                row.RelativeItem().Text(field.Value);
                            });
                        }

                        foreach (var table in section.Tables)
                        {
                            col.Item().PaddingTop(8).Text(table.Heading).Bold().FontSize(11);
                            col.Item().PaddingTop(2).Table(t =>
                            {
                                t.ColumnsDefinition(cols =>
                                {
                                    foreach (var _ in table.Columns) cols.RelativeColumn(1);
                                });

                                t.Header(header =>
                                {
                                    foreach (var columnHeading in table.Columns)
                                        header.Cell().Background("#e2e8f0").Padding(4).Text(columnHeading).Bold();
                                });

                                foreach (var row in table.Rows)
                                    foreach (var cell in row)
                                        t.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).Text(cell);
                            });
                        }
                    }
                });

                page.Footer().AlignCenter().Text(x =>
                {
                    x.CurrentPageNumber();
                    x.Span(" / ");
                    x.TotalPages();
                });
            });
        }).GeneratePdf();
    }
}
