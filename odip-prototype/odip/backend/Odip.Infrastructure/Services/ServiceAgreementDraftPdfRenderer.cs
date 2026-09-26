using System.Globalization;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>Renders an informational draft only. It intentionally contains no legal terms, signature, or billing status.</summary>
public static class ServiceAgreementDraftPdfRenderer
{
    public static byte[] Render(ServiceAgreementDraft draft)
    {
        QuestPDF.Settings.License = LicenseType.Community;
        return Document.Create(document => document.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(40);
            page.DefaultTextStyle(style => style.FontSize(10));
            page.Header().Column(column =>
            {
                column.Item().AlignCenter().Text("DRAFT — NO LEGAL TERMS").Bold().FontSize(18).FontColor(Colors.Red.Darken2);
                column.Item().PaddingTop(4).Text("Non-binding service-agreement planning summary only. Not signed. Not a billing authority.").AlignCenter().FontColor(Colors.Grey.Darken1);
                column.Item().PaddingTop(8).LineHorizontal(1);
            });
            page.Content().PaddingTop(16).Column(column =>
            {
                column.Item().Text($"Draft version {draft.Version}").Bold().FontSize(14);
                Field(column, "Participant", draft.ParticipantNameSnapshot);
                Field(column, "NDIS number", draft.NdisNumberSnapshot ?? "Not recorded");
                Field(column, "Date of birth", draft.DateOfBirthSnapshot?.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) ?? "Not recorded");
                Field(column, "Representative", draft.Representative ?? "Not recorded");
                Field(column, "Plan dates", $"{draft.PlanStartDate:dd MMM yyyy} — {draft.PlanEndDate:dd MMM yyyy}");
                Field(column, "Draft agreement dates", $"{draft.AgreementStartDate:dd MMM yyyy} — {draft.AgreementEndDate:dd MMM yyyy}");
                Field(column, "Service types", draft.ServiceTypesJson);
                column.Item().PaddingTop(16).Text("Catalogue-priced draft lines").Bold().FontSize(12);
                column.Item().PaddingTop(6).Table(table =>
                {
                    table.ColumnsDefinition(columns => { columns.RelativeColumn(2); columns.RelativeColumn(); columns.RelativeColumn(); columns.RelativeColumn(); });
                    table.Header(header => { header.Cell().Background(Colors.Grey.Lighten2).Padding(4).Text("Support type").Bold(); header.Cell().Background(Colors.Grey.Lighten2).Padding(4).Text("Hours").Bold(); header.Cell().Background(Colors.Grey.Lighten2).Padding(4).Text("Catalogue code").Bold(); header.Cell().Background(Colors.Grey.Lighten2).Padding(4).Text("Server price / provenance").Bold(); });
                    foreach (var line in draft.Lines)
                    {
                        table.Cell().Padding(4).Text(line.ServiceType); table.Cell().Padding(4).Text(line.Hours.ToString("0.##", CultureInfo.InvariantCulture)); table.Cell().Padding(4).Text(line.ItemCode);
                        table.Cell().Padding(4).Text($"{line.UnitPrice.ToString("0.00", CultureInfo.InvariantCulture)} ({line.CatalogueVersion}, {line.CatalogueEffectiveFrom:dd MMM yyyy})");
                    }
                });
                column.Item().PaddingTop(18).AlignCenter().Text("DRAFT / NO LEGAL TERMS / NOT SIGNED / NO BILLING AUTHORITY").Bold().FontColor(Colors.Red.Darken2);
            });
            page.Footer().AlignCenter().Text(text => { text.Span("DRAFT — NO LEGAL TERMS — Page "); text.CurrentPageNumber(); });
        })).GeneratePdf();
    }

    private static void Field(ColumnDescriptor column, string label, string value) => column.Item().PaddingTop(4).Row(row => { row.ConstantItem(150).Text(label).SemiBold(); row.RelativeItem().Text(value); });
}
