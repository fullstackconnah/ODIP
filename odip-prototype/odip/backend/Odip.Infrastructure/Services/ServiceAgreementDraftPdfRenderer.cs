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
                column.Item().AlignCenter().Text("UNAPPROVED / NOT FOR SIGNING OR LIVE USE").Bold().FontSize(18).FontColor(Colors.Red.Darken2);
                column.Item().PaddingTop(4).Text("ODIP Service Agreement — provisional blank draft. Legal review required; not signed, active, roster-ready, an invoice, claim authority, or billing authority.").AlignCenter().FontColor(Colors.Grey.Darken1);
                column.Item().PaddingTop(8).LineHorizontal(1);
            });
            page.Content().PaddingTop(16).Column(column =>
            {
                column.Item().Text($"Draft version {draft.Version} — template {ProvisionalAgreementTemplate.Version} ({ProvisionalAgreementTemplate.State})").Bold().FontSize(14);
                Field(column, "Imported template DOCX", $"{ProvisionalAgreementTemplate.DocxFileName} · SHA-256 {ProvisionalAgreementTemplate.DocxSha256}");
                Field(column, "Matching review PDF", $"{ProvisionalAgreementTemplate.PdfFileName} · SHA-256 {ProvisionalAgreementTemplate.PdfSha256}");
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
                    foreach (var line in draft.Lines.OrderBy(x => x.Position))
                    {
                        // A line the pricing engine generated from a block says its band, its unit and what it totals over the agreement; a hand-typed line prints exactly as it always did.
                        table.Cell().Padding(4).Text(line.Band is null ? line.ServiceType : $"{line.ServiceType} — {line.Band}");
                        table.Cell().Padding(4).Text(line.Hours.ToString("0.##", CultureInfo.InvariantCulture) + (line.Unit switch { "E" => " each", "D" => " nights", _ => string.Empty }));
                        table.Cell().Padding(4).Text(line.ItemCode);
                        table.Cell().Padding(4).Text($"{line.UnitPrice.ToString("0.00", CultureInfo.InvariantCulture)} ({line.CatalogueVersion}, {line.CatalogueEffectiveFrom:dd MMM yyyy})"
                            + (line.Total is { } total ? $" — {total.ToString("0.00", CultureInfo.InvariantCulture)} for {line.Occurrences} shifts" : string.Empty));
                    }
                });
                if (draft.Lines.Any(x => x.Total is not null))
                    column.Item().PaddingTop(6).Text($"Total of the priced lines over the agreement period: {draft.Lines.Sum(x => x.Total ?? 0m).ToString("0.00", CultureInfo.InvariantCulture)}. Prices are the catalogue maximums on each service date and are not a quote.").FontColor(Colors.Grey.Darken1);
                column.Item().PaddingTop(18).Text("Agreement review sections (all fields require approved, participant-specific completion)").Bold().FontSize(12);
                Section(column, "1. Parties and representatives", "Participant, authorised representative authority, provider legal entity, ABN, registration status and notices contacts are placeholders pending review.");
                Section(column, "2. Supports, delivery and schedule", "Select eligible support code, arrangement/ratio, service delivery state or territory, location, dates, times, recurrence, exceptions and accessibility requirements per line. Standard 1:1 community access is only a suggestion, never a default charge.");
                Section(column, "3. Proposed fees, travel and other costs", "Catalogue values are development snapshots, not agreed ODIP prices. Complete approved rate, pricing source/version, GST, travel, non-face-to-face work, transport, expenses, limits, approval, receipts and refund details before any use.");
                Section(column, "4. Funding and payment", "Funding route, plan manager, invoice, claim and payment process remain placeholders. This draft cannot trigger invoice or claim transitions.");
                Section(column, "5. Communication, privacy and records", "Complete accessible-format, interpreter/support-person, information sharing, access/correction, retention and withdrawal details under approved policy.");
                Section(column, "6. Responsibilities, cancellation and service changes", "Complete approved responsibilities, cancellation, late-change, provider cancellation, emergency, replacement, variation, review, termination and transition terms. No notice period or fee is agreed here.");
                Section(column, "7. Concerns and complaints", "Insert approved provider contact, response and escalation pathway; confirm any external reference at use time.");
                Section(column, "8. Signatures — non-operative layout only", "A signature block is a future layout placeholder. This revision rejects signing and evidence approval; it does not establish identity, authority, informed consent or acceptance.");
                column.Item().PaddingTop(18).AlignCenter().Text("UNAPPROVED / NOT FOR SIGNING OR LIVE USE / NOT ACTIVE / NO ROSTER, INVOICE OR CLAIM AUTHORITY").Bold().FontColor(Colors.Red.Darken2);
            });
            page.Footer().AlignCenter().Text(text => { text.Span("UNAPPROVED — NOT FOR SIGNING OR LIVE USE — Page "); text.CurrentPageNumber(); });
        })).GeneratePdf();
    }

    private static void Section(ColumnDescriptor column, string heading, string body) =>
        column.Item().PaddingTop(8).Column(section =>
        {
            section.Item().Text(heading).SemiBold();
            section.Item().Text(body);
        });

    private static void Field(ColumnDescriptor column, string label, string value) => column.Item().PaddingTop(4).Row(row => { row.ConstantItem(150).Text(label).SemiBold(); row.RelativeItem().Text(value); });
}
