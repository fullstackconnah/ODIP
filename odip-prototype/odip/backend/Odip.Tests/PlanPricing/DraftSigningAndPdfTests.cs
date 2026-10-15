using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using UglyToad.PdfPig;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// Review F7. A revision the plan builder made has lines that cannot be read from hours and a unit price alone (a sleepover is 52 hours at 281.97, a dollar line is 45.5 hours at 1.00, a
/// 40 minute shift cannot be totalled from hours times price), and it carries caveats a reader must not miss (a part that was not priced, lines that need a person). What a signature
/// attests to (the document and its hash) and what the PDF prints have to say both. Signing evidence is still closed by design, so no stored snapshot changes meaning: these are what the
/// next one would hold.
/// </summary>
public class DraftSigningAndPdfTests
{
    private static PlanBlock MonWed(string id = "b1") =>
        Block(id, PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday } });

    private static ServiceAgreementDraft BlockBuilt(PlanTotals? totals = null, string? pricingJson = null, string? blockJson = null, IReadOnlyList<PlanIssue>? issues = null, IReadOnlyList<HolidayOccurrence>? holidays = null)
    {
        var block = MonWed();
        var quote = new PlanQuote
        {
            PeriodFrom = Mon12Oct, PeriodTo = Sun18Oct, Totals = totals ?? new PlanTotals { Amount = 588.64m, SupportHours = 8, LineCount = 2 }, TimeBasis = "tz-database",
            Issues = issues ?? Array.Empty<PlanIssue>(), HolidayOccurrences = holidays ?? Array.Empty<HolidayOccurrence>(),
        };
        var draftId = Guid.NewGuid();
        return new ServiceAgreementDraft
        {
            Id = draftId, TenantId = Guid.NewGuid(), ParticipantId = Guid.NewGuid(), Version = 3, State = "NSW", ServiceTypesJson = "[\"Community access\"]", ParticipantNameSnapshot = "Synthetic Participant", CreatedBy = "t",
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = Mon12Oct, AgreementEndDate = Sun18Oct,
            PricingJson = pricingJson ?? DraftJson.Write(quote),
            Blocks = { new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draftId, Position = 0, BlockKey = "b1", BlockJson = blockJson ?? DraftJson.Write(block), RequirementsJson = DraftJson.Write(new DraftBlockRequirementsDto { WorkerGender = "Female" }) } },
            Lines =
            {
                new ServiceAgreementDraftLine
                {
                    Id = Guid.NewGuid(), DraftId = draftId, ServiceType = "Community access", ItemCode = "04_104_0125_6_1", Hours = 8m, UnitPrice = 73.58m, Unit = "H", Band = "Weekday Daytime", Total = 588.64m, Occurrences = 2, Flags = 1,
                    BlockKey = "b1", CatalogueVersion = "2026-27", CatalogueEffectiveFrom = new DateOnly(2026, 7, 1),
                },
            },
        };
    }

    private static JsonElement Document(ServiceAgreementDraft draft) => JsonDocument.Parse(ElectronicSigningEvidenceService.BuildDocument(draft)).RootElement.Clone();

    // ── The document a signature attests to ───────────────────────────────────────

    [Fact]
    public void The_signing_document_names_the_unit_band_total_shifts_flags_and_block_of_every_line()
    {
        var line = Document(BlockBuilt()).GetProperty("Lines")[0];

        Assert.Equal("Weekday Daytime", line.GetProperty("Band").GetString());
        Assert.Equal("H", line.GetProperty("Unit").GetString());
        Assert.Equal(588.64m, line.GetProperty("Total").GetDecimal());
        Assert.Equal(2, line.GetProperty("Occurrences").GetInt32());
        Assert.Equal(1, line.GetProperty("Flags").GetInt32());
        Assert.Equal("b1", line.GetProperty("BlockKey").GetString());
        // and what it always held
        Assert.Equal(("04_104_0125_6_1", 8m, 73.58m), (line.GetProperty("ItemCode").GetString(), line.GetProperty("Hours").GetDecimal(), line.GetProperty("UnitPrice").GetDecimal()));
    }

    [Fact]
    public void The_signing_document_holds_a_hash_of_the_blocks_and_of_the_answer_so_a_signature_attests_to_what_was_priced()
    {
        var root = Document(BlockBuilt());

        Assert.Matches("^[0-9a-f]{64}$", root.GetProperty("BlocksHash").GetString());
        Assert.Matches("^[0-9a-f]{64}$", root.GetProperty("PricingHash").GetString());
    }

    [Fact]
    public void The_hashes_come_from_a_canonical_serialisation_not_from_the_text_the_database_keeps()
    {
        var plain = Document(BlockBuilt());
        // PostgreSQL's jsonb rewrites its text: key order and spacing. The same block and the same answer, written differently, hash the same.
        var block = JsonDocument.Parse(DraftJson.Write(MonWed())).RootElement;
        var reordered = "{ " + string.Join(", ", block.EnumerateObject().Reverse().Select(p => $"\"{p.Name}\": {p.Value.GetRawText()}")) + " }";
        var answer = JsonDocument.Parse(DraftJson.Write(new PlanQuote { PeriodFrom = Mon12Oct, PeriodTo = Sun18Oct, Totals = new PlanTotals { Amount = 588.64m, SupportHours = 8, LineCount = 2 }, TimeBasis = "tz-database" })).RootElement;
        var spaced = "{ " + string.Join(" , ", answer.EnumerateObject().Reverse().Select(p => $"\"{p.Name}\" : {p.Value.GetRawText()}")) + " }";

        var rewritten = Document(BlockBuilt(pricingJson: spaced, blockJson: reordered));

        Assert.Equal(plain.GetProperty("BlocksHash").GetString(), rewritten.GetProperty("BlocksHash").GetString());
        Assert.Equal(plain.GetProperty("PricingHash").GetString(), rewritten.GetProperty("PricingHash").GetString());
    }

    [Fact]
    public void A_different_block_or_a_different_answer_is_a_different_hash()
    {
        var plain = Document(BlockBuilt());

        var otherBlock = Document(BlockBuilt(blockJson: DraftJson.Write(MonWed() with { End = T(14) })));
        var otherAnswer = Document(BlockBuilt(totals: new PlanTotals { Amount = 700m, SupportHours = 8, LineCount = 2 }));

        Assert.NotEqual(plain.GetProperty("BlocksHash").GetString(), otherBlock.GetProperty("BlocksHash").GetString());
        Assert.Equal(plain.GetProperty("PricingHash").GetString(), otherBlock.GetProperty("PricingHash").GetString());
        Assert.NotEqual(plain.GetProperty("PricingHash").GetString(), otherAnswer.GetProperty("PricingHash").GetString());
    }

    [Fact]
    public void A_revision_typed_by_hand_has_no_blocks_and_no_answer_to_hash_and_its_lines_read_as_before()
    {
        var draft = BlockBuilt();
        draft.Blocks.Clear();
        draft.PricingJson = null;
        var line = draft.Lines.Single();
        line.BlockKey = null; line.Band = null; line.Total = null; line.Occurrences = 0; line.Flags = 0;

        var root = Document(draft);

        Assert.Equal(JsonValueKind.Null, root.GetProperty("BlocksHash").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("PricingHash").ValueKind);
        var written = root.GetProperty("Lines")[0];
        Assert.Equal(JsonValueKind.Null, written.GetProperty("Total").ValueKind);
        Assert.Equal(8m, written.GetProperty("Hours").GetDecimal());
    }

    [Fact]
    public void The_document_is_the_same_for_the_same_revision_every_time()
    {
        var draft = BlockBuilt();

        Assert.Equal(ElectronicSigningEvidenceService.BuildDocument(draft), ElectronicSigningEvidenceService.BuildDocument(draft));
    }

    // ── What the PDF must not leave out ───────────────────────────────────────────

    private static PlanIssue Issue(PlanFailureReason reason, int shifts, string blockId = "b1") => new(blockId, reason, reason + " message", shifts, Mon12Oct);

    private static HolidayOccurrence Holiday(HolidayDecision decision, bool skipped = false, int day = 0) =>
        new("b1", Mon12Oct.AddDays(day), "Holiday", "NSW", decision, skipped, null, null, null);

    // Design review 1: the PDF is what a family reads, and it said "186 shift lines" for a count that is shifts times items (a shift short of two things was counted twice).
    [Fact]
    public void The_pdf_says_what_was_not_priced_what_needs_a_person_and_what_is_provisional_in_shifts_not_in_the_engines_lines()
    {
        var draft = BlockBuilt(
            totals: new PlanTotals { Amount = 588.64m, SupportHours = 8, LineCount = 2, UnpricedLines = 372, ReviewLines = 219, ProvisionalLines = 468 },
            issues: new[] { Issue(PlanFailureReason.NoItem, 186), Issue(PlanFailureReason.CatalogueNotFound, 186) },       // one shift, two things not priced: 186 shifts, not 372
            holidays: Enumerable.Range(0, 15).Select(day => Holiday(HolidayDecision.Review, day: day)).ToList());

        var caveats = DraftPricingCaveats.For(draft);

        Assert.Equal(new[]
        {
            "At least 186 shifts have a part that is not priced, so that part is not in any total.",      // one block, two issues: its largest is the figure, and the other may touch shifts it does not (review N10)
            "15 public holiday shifts are priced at the holiday rate and still need a decision by a person before this agreement is approved.",
            "Some lines use provisional rates that are not yet confirmed.",
        }, caveats);
        Assert.DoesNotContain(caveats, c => c.Contains("372") || c.Contains("219") || c.Contains("468"));
    }

    [Fact]
    public void Blocks_add_up_and_a_block_counts_its_largest_issue_and_a_decided_holiday_or_a_flag_that_is_only_for_review_is_not_work_left_out()
    {
        var draft = BlockBuilt(
            issues: new[]
            {
                Issue(PlanFailureReason.NoItem, 10), Issue(PlanFailureReason.TransportNotAvailable, 4), Issue(PlanFailureReason.NoItem, 3, "b2"),
                Issue(PlanFailureReason.SleepoverClockChange, 7), Issue(PlanFailureReason.BlocksOverlap, 9), Issue(PlanFailureReason.RegistrationGroupNotHeld, 1),
            },
            holidays: new[] { Holiday(HolidayDecision.Charge), Holiday(HolidayDecision.Skip, skipped: true, day: 1), Holiday(HolidayDecision.Review, day: 2) });

        var caveats = DraftPricingCaveats.For(draft);

        Assert.Equal(13, DraftPricingCaveats.ShiftsNotPriced(DraftJson.ReadQuote(draft.PricingJson!)!));     // 10 (the larger of block 1's two) + 3
        Assert.Equal(new[]
        {
            "At least 13 shifts have a part that is not priced, so that part is not in any total.",      // block 1 has two issues, so its 10 is the largest and not the count
            "1 public holiday shift is priced at the holiday rate and still needs a decision by a person before this agreement is approved.",
        }, caveats);
    }

    // Code review N10: "186 shifts have a part that is not priced" was printed as the count for a block that counts its largest issue, which is a lower bound.
    [Fact]
    public void The_count_is_exact_when_every_block_has_one_issue_and_at_least_when_a_block_has_several()
    {
        var exact = BlockBuilt(issues: new[] { Issue(PlanFailureReason.NoItem, 10), Issue(PlanFailureReason.NoItem, 3, "b2") });
        var lowerBound = BlockBuilt(issues: new[] { Issue(PlanFailureReason.NoItem, 10), Issue(PlanFailureReason.CatalogueNotFound, 10) });
        var refusalAndOne = BlockBuilt(issues: new[] { Issue(PlanFailureReason.RegistrationGroupNotHeld, 1), Issue(PlanFailureReason.NoItem, 2) });

        Assert.False(DraftPricingCaveats.NotPricedIsLowerBound(DraftJson.ReadQuote(exact.PricingJson!)!));
        Assert.Equal("13 shifts have a part that is not priced, so that part is not in any total.", Assert.Single(DraftPricingCaveats.For(exact)));
        Assert.True(DraftPricingCaveats.NotPricedIsLowerBound(DraftJson.ReadQuote(lowerBound.PricingJson!)!));
        Assert.Equal("At least 10 shifts have a part that is not priced, so that part is not in any total.", Assert.Single(DraftPricingCaveats.For(lowerBound)));
        Assert.False(DraftPricingCaveats.NotPricedIsLowerBound(DraftJson.ReadQuote(refusalAndOne.PricingJson!)!));        // a refusal is not a part left out
    }

    [Fact]
    public void One_shift_is_said_in_the_singular()
    {
        var caveats = DraftPricingCaveats.For(BlockBuilt(issues: new[] { Issue(PlanFailureReason.NoItem, 1) }));

        Assert.Equal("1 shift has a part that is not priced, so that part is not in any total.", Assert.Single(caveats));
    }

    [Fact]
    public void A_revision_priced_in_full_says_nothing_and_so_does_one_typed_by_hand()
    {
        var plain = BlockBuilt();
        var byHand = BlockBuilt();
        byHand.PricingJson = null;

        Assert.Empty(DraftPricingCaveats.For(plain));
        Assert.Empty(DraftPricingCaveats.For(byHand));
    }

    [Fact]
    public void An_answer_that_cannot_be_read_is_not_a_crash_and_is_not_silence_either()
    {
        var caveats = DraftPricingCaveats.For(BlockBuilt(pricingJson: "{ this is not json"));

        Assert.Contains("could not be read", Assert.Single(caveats));
    }

    [Fact]
    public void The_pdf_of_a_part_priced_revision_renders()
    {
        var pdf = ServiceAgreementDraftPdfRenderer.Render(BlockBuilt(totals: new PlanTotals { Amount = 588.64m, SupportHours = 8, LineCount = 2, UnpricedLines = 5, ReviewLines = 3, ProvisionalLines = 2 }));

        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(pdf, 0, 5));
    }

    /// <summary>
    /// The words on every page of a PDF, in reading order, reduced to what survives text extraction. The font draws "fi", "ft" and "ti" as ligature glyphs, which come back as a ligature character
    /// or a NUL ("shi\0s"), so what is compared is the text with every character that is not a letter or a digit, and the letters that can be part of a ligature (f, t, i), taken out of both sides.
    /// </summary>
    internal static string Skeleton(string text) => Regex.Replace(text, @"[^a-z0-9]|[fti]", string.Empty, RegexOptions.IgnoreCase);

    internal static string TextOf(byte[] pdf)
    {
        using var document = PdfDocument.Open(pdf);
        return Skeleton(string.Join(" ", document.GetPages().SelectMany(page => page.GetWords()).Select(word => word.Text)));
    }

    // Code review N14: the PDF is what a family reads, and nothing pinned that it prints the caveats: the test above reads the first five bytes. Dropping the section would have passed.
    [Fact]
    public void The_pdf_prints_what_the_total_leaves_out_under_it_and_says_nothing_of_it_when_nothing_is_left_out()
    {
        var caveated = BlockBuilt(
            totals: new PlanTotals { Amount = 588.64m, SupportHours = 8, LineCount = 2, UnpricedLines = 372, ReviewLines = 219, ProvisionalLines = 468 },
            issues: new[] { Issue(PlanFailureReason.NoItem, 186), Issue(PlanFailureReason.CatalogueNotFound, 186) },
            holidays: Enumerable.Range(0, 15).Select(day => Holiday(HolidayDecision.Review, day: day)).ToList());

        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(caveated));

        Assert.Contains(Skeleton("Read before relying on these totals"), text);
        var caveats = DraftPricingCaveats.For(caveated);
        Assert.Equal(3, caveats.Count);
        foreach (var caveat in caveats) Assert.Contains(Skeleton(caveat), text);
        Assert.Contains(Skeleton("At least 186 shifts have a part that is not priced, so that part is not in any total."), text);
        Assert.True(text.IndexOf(Skeleton("Total of the priced lines"), StringComparison.Ordinal) < text.IndexOf(Skeleton("Read before relying on these totals"), StringComparison.Ordinal), "the caveats come after the total they are about");

        var clean = TextOf(ServiceAgreementDraftPdfRenderer.Render(BlockBuilt()));
        Assert.DoesNotContain(Skeleton("Read before relying on these totals"), clean);
        Assert.Contains(Skeleton("Total of the priced lines"), clean);
    }

    // ── The PDF carries no stamp and none of the draft's furniture (the owner dropped it; signing stays closed) ──

    [Fact]
    public void The_pdf_has_no_unapproved_not_for_signing_banner_at_the_top_the_end_or_the_foot_of_any_page()
    {
        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(BlockBuilt()));

        foreach (var stamp in new[] { "UNAPPROVED", "NOT FOR SIGNING OR LIVE USE", "NOT ACTIVE", "NO ROSTER, INVOICE OR CLAIM AUTHORITY" })
            Assert.DoesNotContain(Skeleton(stamp), text);
        Assert.Contains(Skeleton("Page 1"), text);                // the foot of each page still numbers it
    }

    [Fact]
    public void The_pdf_has_no_draft_version_line_and_prints_neither_the_templates_name_nor_its_hashes()
    {
        var draft = BlockBuilt();

        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(draft));

        foreach (var furniture in new[]
        {
            $"Draft version {draft.Version}", "Imported template", "Matching review PDF", ProvisionalAgreementTemplate.Version, ProvisionalAgreementTemplate.State,
            ProvisionalAgreementTemplate.DocxFileName, ProvisionalAgreementTemplate.PdfFileName, ProvisionalAgreementTemplate.DocxSha256, ProvisionalAgreementTemplate.PdfSha256,
        })
            Assert.DoesNotContain(Skeleton(furniture), text);
    }

    [Fact]
    public void Every_section_of_the_template_is_still_on_the_pdf()
    {
        var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(BlockBuilt()));

        foreach (var heading in new[]
        {
            "1. Parties and representatives", "2. Supports, delivery and schedule", "3. Proposed fees, travel and other costs", "4. Funding and payment",
            "5. Communication, privacy and records", "6. Responsibilities, cancellation and service changes", "7. Concerns and complaints", "8. Signatures — non-operative layout only",
        })
            Assert.Contains(Skeleton(heading), text);
    }

    [Fact]
    public void The_dates_on_the_pdf_print_the_same_on_a_machine_with_another_culture()
    {
        CultureInfo australian;
        try { australian = new CultureInfo("en-AU"); }
        catch (CultureNotFoundException) { return; }              // a host with no culture data has only the invariant one, which is what the dates are written in
        var before = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = australian;               // spells July and June out in full

            var text = TextOf(ServiceAgreementDraftPdfRenderer.Render(BlockBuilt()));

            Assert.Contains(Skeleton("01 Jul 2026 — 30 Jun 2027"), text);
            Assert.Contains(Skeleton("(2026-27, 01 Jul 2026)"), text);
        }
        finally { CultureInfo.CurrentCulture = before; }
    }
}
