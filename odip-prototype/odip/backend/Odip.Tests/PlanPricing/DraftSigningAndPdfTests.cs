using System.Text;
using System.Text.Json;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
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

    private static ServiceAgreementDraft BlockBuilt(PlanTotals? totals = null, string? pricingJson = null, string? blockJson = null)
    {
        var block = MonWed();
        var quote = new PlanQuote { PeriodFrom = Mon12Oct, PeriodTo = Sun18Oct, Totals = totals ?? new PlanTotals { Amount = 588.64m, SupportHours = 8, LineCount = 2 }, TimeBasis = "tz-database" };
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

    [Fact]
    public void The_pdf_says_what_was_not_priced_what_needs_a_person_and_what_is_provisional()
    {
        var draft = BlockBuilt(totals: new PlanTotals { Amount = 588.64m, SupportHours = 8, LineCount = 2, UnpricedLines = 186, ReviewLines = 219, ProvisionalLines = 468 });

        var caveats = DraftPricingCaveats.For(draft);

        Assert.Equal(3, caveats.Count);
        Assert.Contains(caveats, c => c.Contains("186") && c.Contains("not priced"));
        Assert.Contains(caveats, c => c.Contains("219") && c.Contains("review"));
        Assert.Contains(caveats, c => c.Contains("468") && c.Contains("provisional"));
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
}
