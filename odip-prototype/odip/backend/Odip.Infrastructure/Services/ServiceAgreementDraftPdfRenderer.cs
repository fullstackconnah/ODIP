using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Renders an agreement revision as the one PDF for the participant: a title that names the provider and the day it was prepared, who it is for, the plan's dates, the weekly schedule of supports, the
/// catalogue lines behind its cost and the template's review sections. It carries no stamp and none of the draft's furniture (a banner, a header line, the revision number, the template's name and hashes); each page has only its number at the foot.
/// Signing is not decided here: the template's state (<c>ProvisionalAgreementTemplate</c>) keeps signing closed, and the PDF does not read it.
/// </summary>
public static class ServiceAgreementDraftPdfRenderer
{
    public static byte[] Render(ServiceAgreementDraft draft, AgreementProvider? provider = null) => Compose(draft, provider).GeneratePdf();

    /// <summary>The document before it is written out, so a test can draw its pages as images and look at them. With no <paramref name="provider"/> the title has no provider line.</summary>
    public static Document Compose(ServiceAgreementDraft draft, AgreementProvider? provider = null)
    {
        QuestPDF.Settings.License = LicenseType.Community;
        provider ??= AgreementProvider.From(null);
        return Document.Create(document => document.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(40);
            page.DefaultTextStyle(style => style.FontSize(10));
            page.Content().PaddingTop(16).Column(column =>
            {
                Title(column, draft, provider);
                Field(column, "Participant", draft.ParticipantNameSnapshot);
                Field(column, "NDIS number", draft.NdisNumberSnapshot ?? "Not recorded");
                Field(column, "Date of birth", draft.DateOfBirthSnapshot is { } birth ? Date(birth) : "Not recorded");
                Field(column, "Representative", draft.Representative ?? "Not recorded");
                Field(column, "Plan dates", $"{Date(draft.PlanStartDate)} — {Date(draft.PlanEndDate)}");
                Field(column, "Agreement dates", $"{Date(draft.AgreementStartDate)} — {Date(draft.AgreementEndDate)}");
                Field(column, "Service types", ServiceTypesText(draft.ServiceTypesJson));
                Schedule(column, draft);
                column.Item().PaddingTop(16).EnsureSpace(90).Text("Cost detail (NDIS catalogue prices)").Bold().FontSize(12);
                column.Item().PaddingTop(6).Table(table =>
                {
                    table.ColumnsDefinition(columns => { columns.RelativeColumn(2); columns.RelativeColumn(); columns.RelativeColumn(); columns.RelativeColumn(); });
                    table.Header(header => { header.Cell().Background(Colors.Grey.Lighten2).Padding(4).Text("Support type").Bold(); header.Cell().Background(Colors.Grey.Lighten2).Padding(4).Text("Hours").Bold(); header.Cell().Background(Colors.Grey.Lighten2).Padding(4).Text("Catalogue code").Bold(); header.Cell().Background(Colors.Grey.Lighten2).Padding(4).Text("Server price / provenance").Bold(); });
                    foreach (var line in draft.Lines.OrderBy(x => x.Position))
                    {
                        // A line the pricing engine generated from a block says its band, its unit and what it totals over the agreement; a hand-typed line prints exactly as it always did.
                        table.Cell().Padding(4).Text(line.Band is null ? line.ServiceType : $"{line.ServiceType} — {line.Band}");
                        table.Cell().Padding(4).Text(line.Hours.ToString("0.##", CultureInfo.InvariantCulture) + (line.Unit switch { "E" => " each", "D" => line.Hours == 1m ? " night" : " nights", _ => string.Empty }));
                        table.Cell().Padding(4).Text(line.ItemCode);
                        table.Cell().Padding(4).Text($"{line.UnitPrice.ToString("0.00", CultureInfo.InvariantCulture)} ({line.CatalogueVersion}, {Date(line.CatalogueEffectiveFrom)})"
                            + (line.Total is { } total ? $" — {total.ToString("0.00", CultureInfo.InvariantCulture)} for {line.Occurrences} {(line.Occurrences == 1 ? "shift" : "shifts")}" : string.Empty));
                    }
                });
                if (draft.Lines.Any(x => x.Total is not null))
                    column.Item().PaddingTop(6).Text($"Total of the priced lines over the agreement period: {draft.Lines.Sum(x => x.Total ?? 0m).ToString("0.00", CultureInfo.InvariantCulture)}. Prices are the catalogue maximums on each service date and are not a quote.").FontColor(Colors.Grey.Darken1);
                // A total that leaves work out says so beside the total: what was not priced, what a person has to look at and what rests on a rate nobody has confirmed.
                var caveats = DraftPricingCaveats.For(draft);
                if (caveats.Count > 0)
                {
                    column.Item().PaddingTop(8).Text("Read before relying on these totals").Bold().FontColor(Colors.Orange.Darken3);
                    foreach (var caveat in caveats) column.Item().PaddingTop(2).Text("• " + caveat).FontColor(Colors.Orange.Darken3);
                }
                column.Item().PaddingTop(18).EnsureSpace(90).Text("Agreement review sections (all fields require approved, participant-specific completion)").Bold().FontSize(12);
                Section(column, "1. Parties and representatives", "Participant, authorised representative authority, provider legal entity, ABN, registration status and notices contacts are placeholders pending review.");
                Section(column, "2. Supports, delivery and schedule", "Select eligible support code, arrangement/ratio, service delivery state or territory, location, dates, times, recurrence, exceptions and accessibility requirements per line. Standard 1:1 community access is only a suggestion, never a default charge.");
                Section(column, "3. Proposed fees, travel and other costs", "Catalogue values are development snapshots, not agreed ODIP prices. Complete approved rate, pricing source/version, GST, travel, non-face-to-face work, transport, expenses, limits, approval, receipts and refund details before any use.");
                Section(column, "4. Funding and payment", "Funding route, plan manager, invoice, claim and payment process remain placeholders. This draft cannot trigger invoice or claim transitions.");
                Section(column, "5. Communication, privacy and records", "Complete accessible-format, interpreter/support-person, information sharing, access/correction, retention and withdrawal details under approved policy.");
                Section(column, "6. Responsibilities, cancellation and service changes", "Complete approved responsibilities, cancellation, late-change, provider cancellation, emergency, replacement, variation, review, termination and transition terms. No notice period or fee is agreed here.");
                Section(column, "7. Concerns and complaints", "Insert approved provider contact, response and escalation pathway; confirm any external reference at use time.");
                Section(column, "8. Signatures — non-operative layout only", "A signature block is a future layout placeholder. This revision rejects signing and evidence approval; it does not establish identity, authority, informed consent or acceptance.");
            });
            page.Footer().AlignCenter().Text(text => { text.Span("Page "); text.CurrentPageNumber(); });
        }));
    }

    /// <summary>
    /// The file the PDF is downloaded as: "Service agreement - {participant} - {agreement start}.pdf". The name is the one printed on the PDF (the snapshot taken when the revision was saved), cut down to
    /// letters, digits, spaces and hyphens, the same allowlist the participant's other documents use (<c>ParticipantDocumentService.BuildFileName</c>): nothing in it can end a header, name a folder or break the
    /// page's own reading of Content-Disposition. A name with nothing left in it is "Participant".
    /// </summary>
    public static string FileName(ServiceAgreementDraft draft)
    {
        var name = Regex.Replace(Regex.Replace(draft.ParticipantNameSnapshot ?? string.Empty, "[^A-Za-z0-9 -]", string.Empty), @"\s+", " ").Trim(' ', '-');
        return $"Service agreement - {(name.Length == 0 ? "Participant" : name)} - {draft.AgreementStartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}.pdf";
    }

    /// <summary>The revision's service types as a sentence, "Community access, Personal care": they are stored as a JSON list. Text that is not a list is printed as it is, and none is "Not recorded".</summary>
    public static string ServiceTypesText(string? serviceTypesJson)
    {
        if (string.IsNullOrWhiteSpace(serviceTypesJson)) return "Not recorded";
        try
        {
            var types = (JsonSerializer.Deserialize<List<string?>>(serviceTypesJson) ?? []).Where(type => !string.IsNullOrWhiteSpace(type)).Select(type => type!.Trim()).ToList();
            return types.Count == 0 ? "Not recorded" : string.Join(", ", types);
        }
        catch (JsonException) { return serviceTypesJson; }
    }

    /// <summary>
    /// The top of the first page: the title, who the agreement is from (only what the organisation has set; no line at all when it has set nothing) and the day it was prepared, which is the day the
    /// revision was saved in the provider's zone, so the same revision always says the same day.
    /// </summary>
    private static void Title(ColumnDescriptor column, ServiceAgreementDraft draft, AgreementProvider provider)
    {
        column.Item().Text("Service agreement").Bold().FontSize(16);
        if (provider.Line is { } line) column.Item().PaddingTop(2).Text(line).FontColor(Colors.Grey.Darken1);
        column.Item().PaddingTop(2).Text($"Prepared {Date(ProviderLocalTime.TodayIn(draft.CreatedAt, provider.Zone))}").FontColor(Colors.Grey.Darken1);
        column.Item().Height(8);
    }

    /// <summary>A date as the PDF writes it, "12 Oct 2026", whatever culture the machine has (a culture that spells July out in full would make the same PDF differ from host to host).</summary>
    private static string Date(DateOnly date) => date.ToString("dd MMM yyyy", CultureInfo.InvariantCulture);

    /// <summary>
    /// The weekly schedule of supports: what is delivered, on which days and at what times, at what ratio, and what each support comes to over the agreement. Read from the revision's stored blocks and
    /// pricing (<see cref="AgreementSchedule"/>). The catalogue lines that follow it are the cost detail behind the figures.
    /// </summary>
    private static void Schedule(ColumnDescriptor column, ServiceAgreementDraft draft)
    {
        var schedule = AgreementSchedule.Of(draft);
        column.Item().PaddingTop(16).EnsureSpace(90).Text("Schedule of supports").Bold().FontSize(12);
        if (schedule.Rows.Count == 0 && schedule.Unreadable == 0)
        {
            column.Item().PaddingTop(4).Text("No weekly schedule was recorded for this agreement.");
            return;
        }

        column.Item().PaddingTop(4).Text(AgreementSchedule.Repeats(draft));
        if (schedule.Rows.Count > 0)
            column.Item().PaddingTop(6).Table(table =>
            {
                // The time column is wide enough for "22:00 to 06:00 (ends the next day)" on one line, and the figures are narrow: the days and the support share what is left.
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(2f); columns.ConstantColumn(158); columns.RelativeColumn(3f); columns.ConstantColumn(34);
                    columns.ConstantColumn(34); columns.ConstantColumn(44); columns.ConstantColumn(66);
                });
                table.Header(header =>
                {
                    foreach (var heading in new[] { "Days", "Time", "Support", "Ratio", "State", "Hours a week", "Cost for the agreement" })
                        header.Cell().Background(Colors.Grey.Lighten2).Padding(4).Text(heading).Bold().FontSize(9);
                });
                foreach (var row in schedule.Rows)
                    foreach (var value in new[] { row.Days, row.Time, row.Support, row.Ratio, row.State, row.HoursAWeek, row.Cost })
                        table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten1).Padding(4).Text(value).FontSize(9);
            });
        if (schedule.Unreadable > 0)
            column.Item().PaddingTop(4).Text("Some supports in this agreement could not be read, so they are not listed here. Check the agreement before relying on this schedule.").FontColor(Colors.Orange.Darken3);
    }

    // A section stays in one piece, so a numbered heading is never left at the foot of a page with its text on the next.
    private static void Section(ColumnDescriptor column, string heading, string body) =>
        column.Item().PaddingTop(8).ShowEntire().Column(section =>
        {
            section.Item().Text(heading).SemiBold();
            section.Item().Text(body);
        });

    private static void Field(ColumnDescriptor column, string label, string value) => column.Item().PaddingTop(4).Row(row => { row.ConstantItem(150).Text(label).SemiBold(); row.RelativeItem().Text(value); });
}
