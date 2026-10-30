using Odip.Domain.Billing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>The hard and soft checks, pure: one clean row, then one change per rule.</summary>
public class ClaimBatchChecksTests
{
    private static readonly DateOnly Today = new(2026, 10, 30);

    private static BprRow Clean(Action<ClaimLineItem>? line = null, Action<TripClaim>? claim = null, Action<Participant>? person = null, Action<SupportCatalogueItem>? item = null)
    {
        var l = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = Guid.NewGuid(), SupportItemCode = "04_104_0125_6_1", Hours = 2m, UnitPrice = 60m, TotalAmount = 120m,
            SupportsDeliveredFrom = Today.AddDays(-5), SupportsDeliveredTo = Today.AddDays(-5), GSTCode = GSTCode.P2, ClaimType = ClaimType.Standard,
        };
        var c = new TripClaim { Id = l.TripClaimId, ClaimReference = "TC-1", Status = TripClaimStatus.Draft };
        var p = new Participant { Id = Guid.NewGuid(), NdisNumber = "430000001" };
        var i = new SupportCatalogueItem { ItemNumber = l.SupportItemCode, Unit = "H", PriceNational = 70m, PriceLimit_VIC = 70m };
        line?.Invoke(l); claim?.Invoke(c); person?.Invoke(p); item?.Invoke(i);
        return new BprRow(l, c, p, PlanType.AgencyManaged, i, null, "VIC", new ProviderSettings { RegistrationNumber = "4050012345" });
    }

    private static string[] Rules(BprRow row, BatchContext? ctx = null) =>
        ClaimBatchChecks.For(row, ctx ?? new BatchContext { Today = Today }).Select(p => p.Rule).ToArray();

    [Fact]
    public void A_clean_line_has_no_problems() => Assert.Empty(Rules(Clean()));

    [Theory]
    [InlineData("")]
    [InlineData("AB12")]
    public void RegistrationNumber_must_be_digits(string reg)
    {
        var row = Clean() with { Settings = new ProviderSettings { RegistrationNumber = reg } };
        Assert.Contains("RegistrationNumber", Rules(row));
    }

    [Theory]
    [InlineData("43000000")]
    [InlineData("530000001")]
    [InlineData("4300000012")]
    [InlineData("")]
    public void NdisNumber_must_be_9_digits_starting_43(string number) =>
        Assert.Contains("NdisNumber", Rules(Clean(person: p => p.NdisNumber = number)));

    [Fact]
    public void DateOrder_and_FutureDate()
    {
        Assert.Contains("DateOrder", Rules(Clean(line: l => l.SupportsDeliveredTo = l.SupportsDeliveredFrom.AddDays(-1))));
        Assert.Contains("FutureDate", Rules(Clean(line: l => { l.SupportsDeliveredFrom = Today; l.SupportsDeliveredTo = Today.AddDays(1); })));
        Assert.DoesNotContain("FutureDate", Rules(Clean(line: l => { l.SupportsDeliveredFrom = Today; l.SupportsDeliveredTo = Today; })));
    }

    [Fact]
    public void CatalogueItem_is_required() => Assert.Contains("CatalogueItem", Rules(Clean() with { Item = null }));

    [Fact]
    public void PriceLimit_applies_only_over_a_positive_limit_and_when_the_item_has_a_national_price()
    {
        Assert.Contains("PriceLimit", Rules(Clean(line: l => l.UnitPrice = 70.01m)));
        Assert.DoesNotContain("PriceLimit", Rules(Clean(line: l => l.UnitPrice = 70m)));
        Assert.DoesNotContain("PriceLimit", Rules(Clean(line: l => l.UnitPrice = 500m, item: i => i.PriceNational = null)));
        Assert.DoesNotContain("PriceLimit", Rules(Clean(line: l => l.UnitPrice = 500m, item: i => i.PriceLimit_VIC = 0m)));
    }

    [Theory]
    [InlineData(GSTCode.GST)]
    [InlineData(GSTCode.NoGST)]
    [InlineData(GSTCode.Exempt)]
    public void GstCode_other_than_P1_P2_P5_is_refused(GSTCode code) => Assert.Contains("GstCode", Rules(Clean(line: l => l.GSTCode = code)));

    [Theory]
    [InlineData("NSDH", false)]
    [InlineData(" nsdo ", false)]
    [InlineData("late", true)]
    [InlineData(null, true)]
    public void Cancellation_needs_one_of_the_four_reasons(string? reason, bool refused) =>
        Assert.Equal(refused, Rules(Clean(line: l => { l.ClaimType = ClaimType.Cancellation; l.CancellationReason = reason; })).Contains("CancellationReason"));

    [Theory]
    [InlineData(ClaimType.Variation)]
    [InlineData(ClaimType.Adjustment)]
    public void ChangeType_is_refused(ClaimType type) => Assert.Contains("ChangeType", Rules(Clean(line: l => l.ClaimType = type)));

    [Theory]
    [InlineData(PlanType.PlanManaged)]
    [InlineData(PlanType.SelfManaged)]
    public void NotAgency_is_refused(PlanType plan) => Assert.Contains("NotAgency", Rules(Clean() with { PlanType = plan }));

    [Fact]
    public void Context_facts_become_problems()
    {
        var row = Clean();
        var l = row.Line;
        var ctx = new BatchContext
        {
            Today = Today,
            OtherFunded = new Dictionary<Guid, string> { [l.TripClaimId] = "Other funded." },
            PendingFiles = new Dictionary<Guid, string> { [l.Id] = "BPR261030001.csv" },
            Accepted = [new AcceptedLine("430000001", l.SupportItemCode, l.SupportsDeliveredFrom, l.SupportsDeliveredTo, "BPR261001001.csv")],
            HeldBy = new Dictionary<Guid, string> { [l.TripClaimId] = "TC-9" },
        };
        var rules = Rules(row, ctx);
        Assert.Contains("OtherFunded", rules);
        Assert.Contains("AlreadyPending", rules);
        Assert.Contains("AlreadyAccepted", rules);
        Assert.Contains("HeldByAnotherClaim", rules);
        Assert.Contains("BPR261030001.csv", ClaimBatchChecks.For(row, ctx).First(p => p.Rule == "AlreadyPending").Message);
    }

    [Theory]
    [InlineData(ClaimLineItemStatus.Submitted)]
    [InlineData(ClaimLineItemStatus.Approved)]
    [InlineData(ClaimLineItemStatus.Paid)]
    [InlineData(ClaimLineItemStatus.PartiallyPaid)]
    public void AlreadySent_for_a_sent_line(ClaimLineItemStatus status) => Assert.Contains("AlreadySent", Rules(Clean(line: l => l.Status = status)));

    [Theory]
    [InlineData(TripClaimStatus.Submitted)]
    [InlineData(TripClaimStatus.Approved)]
    [InlineData(TripClaimStatus.Paid)]
    [InlineData(TripClaimStatus.PartiallyPaid)]
    [InlineData(TripClaimStatus.Cancelled)]
    public void ClaimNotOpen_for_each_closed_claim_status(TripClaimStatus status) => Assert.Contains("ClaimNotOpen", Rules(Clean(claim: c => c.Status = status)));

    [Theory]
    [InlineData(TripClaimStatus.Draft)]
    [InlineData(TripClaimStatus.Ready)]
    public void ClaimNotOpen_not_for_an_open_claim(TripClaimStatus status) => Assert.DoesNotContain("ClaimNotOpen", Rules(Clean(claim: c => c.Status = status)));

    [Theory]
    [InlineData(TripClaimStatus.Submitted)]
    [InlineData(TripClaimStatus.Rejected)]
    public void A_rejected_line_may_be_resubmitted_from_a_sent_claim(TripClaimStatus status) =>
        Assert.DoesNotContain("ClaimNotOpen", Rules(Clean(claim: c => c.Status = status, line: l => l.Status = ClaimLineItemStatus.Rejected)));

    [Fact]
    public void NeedsDecision_until_confirmed_and_never_for_a_fixable_code()
    {
        var row = Clean(line: l => l.Status = ClaimLineItemStatus.Rejected);
        var id = row.Line.Id;
        BatchContext Ctx(string code, params Guid[] confirmed) =>
            new() { Today = Today, LastRejectCode = new Dictionary<Guid, string> { [id] = code }, ConfirmedLineIds = confirmed.ToHashSet() };
        Assert.Contains("NeedsDecision", Rules(row, Ctx("V04")));
        Assert.DoesNotContain("NeedsDecision", Rules(row, Ctx("V04", id)));
        Assert.DoesNotContain("NeedsDecision", Rules(row, Ctx("C16")));
        Assert.Contains("NeedsDecision", Rules(row, Ctx("ZZ9")));
    }

    [Theory]
    [InlineData(59, "none")]
    [InlineData(60, "amber")]
    [InlineData(79, "amber")]
    [InlineData(80, "red")]
    [InlineData(90, "red")]
    [InlineData(91, "over90")]
    public void Age_band_boundaries(int days, string band)
    {
        Assert.Equal(band, ClaimBatchChecks.AgeBand(days));
        var rules = Rules(Clean(line: l => { l.SupportsDeliveredFrom = Today.AddDays(-days); l.SupportsDeliveredTo = Today.AddDays(-days); }));
        Assert.Equal(band != "none", rules.Contains("Age"));
    }

    [Fact]
    public void Age_is_a_warning_never_a_block() =>
        Assert.All(ClaimBatchChecks.For(Clean(line: l => { l.SupportsDeliveredFrom = Today.AddDays(-100); l.SupportsDeliveredTo = l.SupportsDeliveredFrom; }), new BatchContext { Today = Today }),
            p => Assert.Equal("warn", p.Severity));

    [Fact]
    public void OutsidePlan_warns_only_when_the_participant_has_plans_and_none_covers()
    {
        var row = Clean();
        var pid = row.Participant!.Id;
        BatchContext With(params (DateOnly, DateOnly)[] plans) => new() { Today = Today, Plans = new Dictionary<Guid, IReadOnlyList<(DateOnly, DateOnly)>> { [pid] = plans } };
        Assert.Contains("OutsidePlan", Rules(row, With((Today.AddDays(-400), Today.AddDays(-100)))));
        Assert.DoesNotContain("OutsidePlan", Rules(row, With((Today.AddDays(-100), Today.AddDays(100)))));
        Assert.DoesNotContain("OutsidePlan", Rules(row, With()));
    }

    [Fact]
    public void DuplicateInFile_warns_on_the_same_participant_item_and_dates()
    {
        var a = Clean();
        var b = Clean() with { Participant = a.Participant };
        b.Line.SupportsDeliveredFrom = a.Line.SupportsDeliveredFrom;
        b.Line.SupportsDeliveredTo = a.Line.SupportsDeliveredTo;
        var ctx = new BatchContext { Today = Today, BuildRows = [a, b] };
        Assert.Contains("DuplicateInFile", Rules(a, ctx));
        Assert.DoesNotContain("DuplicateInFile", Rules(a, new BatchContext { Today = Today, BuildRows = [a] }));
    }

    [Fact]
    public void HoursNotWholeMinutes_applies_only_to_the_hour_unit()
    {
        Assert.Contains("HoursNotWholeMinutes", Rules(Clean(line: l => l.Hours = 1.333m)));
        Assert.DoesNotContain("HoursNotWholeMinutes", Rules(Clean(line: l => l.Hours = 1.25m)));
        Assert.DoesNotContain("HoursNotWholeMinutes", Rules(Clean(line: l => l.Hours = 1.333m, item: i => i.Unit = "E")));
    }

    [Theory]
    [InlineData("C16", false)]
    [InlineData("C22", false)]
    [InlineData("C28", false)]
    [InlineData("V36", false)]
    [InlineData("V26", false)]
    [InlineData("C27", false)]
    [InlineData("C38", false)]
    [InlineData("V31", false)]
    [InlineData("C30", false)]
    [InlineData("P05", false)]
    [InlineData("V04", true)]
    [InlineData("P04", true)]
    [InlineData("V11", true)]
    [InlineData("V13", true)]
    [InlineData("V43", true)]
    [InlineData("V16", true)]
    [InlineData("V17", true)]
    [InlineData("V18", true)]
    [InlineData("V27", true)]
    [InlineData("V28", true)]
    [InlineData("P03", true)]
    [InlineData("C15", true)]
    [InlineData("C39", true)]
    [InlineData("v04", true)]
    [InlineData("XX1", true)]
    public void Reject_code_kinds(string code, bool needsDecision) => Assert.Equal(needsDecision, NdiaRejectCodes.For(code).NeedsDecision);
}
