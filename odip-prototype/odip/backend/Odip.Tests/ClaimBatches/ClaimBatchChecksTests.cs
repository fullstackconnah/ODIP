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
    private static readonly Guid Pid = Guid.NewGuid();
    /// <summary>The clean row's participant is recorded as my provider on a plan that covers every date used here, so only the test's own change shows.</summary>
    private static readonly IReadOnlyDictionary<Guid, IReadOnlyList<PlanSpan>> Covered = Plans(new PlanSpan(Today.AddYears(-5), Today.AddYears(5), MyProviderRecord.Recorded));

    private static IReadOnlyDictionary<Guid, IReadOnlyList<PlanSpan>> Plans(params PlanSpan[] plans) => new Dictionary<Guid, IReadOnlyList<PlanSpan>> { [Pid] = plans };

    private static BprRow Clean(Action<ClaimLineItem>? line = null, Action<TripClaim>? claim = null, Action<Participant>? person = null, Action<SupportCatalogueItem>? item = null)
    {
        var l = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = Guid.NewGuid(), SupportItemCode = "04_104_0125_6_1", Hours = 2m, UnitPrice = 60m, TotalAmount = 120m,
            SupportsDeliveredFrom = Today.AddDays(-5), SupportsDeliveredTo = Today.AddDays(-5), GSTCode = GSTCode.P2, ClaimType = ClaimType.Standard,
        };
        var c = new TripClaim { Id = l.TripClaimId, ClaimReference = "TC-1", Status = TripClaimStatus.Draft };
        var p = new Participant { Id = Pid, NdisNumber = "430000001" };
        var i = new SupportCatalogueItem { ItemNumber = l.SupportItemCode, Unit = "H", PriceNational = 70m, PriceLimit_VIC = 70m };
        line?.Invoke(l); claim?.Invoke(c); person?.Invoke(p); item?.Invoke(i);
        return new BprRow(l, c, p, PlanType.AgencyManaged, i, null, "VIC", new ProviderSettings { RegistrationNumber = "4050012345" });
    }

    private static string[] Rules(BprRow row, BatchContext? ctx = null) =>
        ClaimBatchChecks.For(row, ctx ?? new BatchContext { Today = Today, Plans = Covered }).Select(p => p.Rule).ToArray();

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
    [InlineData(CatalogueClaimFlag.No, false, true)]
    [InlineData(null, false, true)]
    [InlineData(CatalogueClaimFlag.Yes, false, false)]
    [InlineData(CatalogueClaimFlag.No, true, false)]   // a "_CA" twin in the price guide allows it whatever the flag says
    public void D_A_cancellation_line_is_blocked_unless_the_item_allows_it(CatalogueClaimFlag? flag, bool hasTwin, bool blocked)
    {
        var row = Clean(line: l => { l.ClaimType = ClaimType.Cancellation; l.CancellationReason = "NSDH"; }, item: i => i.ShortNoticeCancellation = flag);
        if (hasTwin) row = row with { CancelledItem = new SupportCatalogueItem { ItemNumber = row.Line.SupportItemCode + "_CA" } };

        var problems = ClaimBatchChecks.For(row, new BatchContext { Today = Today, Plans = Covered });

        Assert.Equal(blocked, problems.Any(p => p.Rule == "CancellationNotAllowed" && p.Severity == ClaimBatchChecks.Block));
        if (blocked) Assert.Contains("04_104_0125_6_1 can't be claimed as a short-notice cancellation.", problems.Single(p => p.Rule == "CancellationNotAllowed").Message);
    }

    [Fact]
    public void A_standard_line_is_never_blocked_by_the_cancellation_rule() =>
        Assert.DoesNotContain("CancellationNotAllowed", Rules(Clean(item: i => i.ShortNoticeCancellation = CatalogueClaimFlag.No)));

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
            Today = Today, Plans = Covered,
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
        Assert.All(ClaimBatchChecks.For(Clean(line: l => { l.SupportsDeliveredFrom = Today.AddDays(-100); l.SupportsDeliveredTo = l.SupportsDeliveredFrom; }), new BatchContext { Today = Today, Plans = Covered }),
            p => Assert.Equal("warn", p.Severity));

    [Fact]
    public void OutsidePlan_warns_only_when_the_participant_has_plans_and_none_covers()
    {
        var row = Clean();
        BatchContext With(params (DateOnly Start, DateOnly End)[] plans) => new() { Today = Today, Plans = Plans(plans.Select(p => new PlanSpan(p.Start, p.End, MyProviderRecord.Recorded)).ToArray()) };
        Assert.Contains("OutsidePlan", Rules(row, With((Today.AddDays(-400), Today.AddDays(-100)))));
        Assert.DoesNotContain("OutsidePlan", Rules(row, With((Today.AddDays(-100), Today.AddDays(100)))));
        Assert.DoesNotContain("OutsidePlan", Rules(row, With()));
    }

    // ---- my provider ----

    private static BatchContext OnPlan(MyProviderRecord record, DateOnly? on = null) =>
        new() { Today = Today, Plans = Plans(new PlanSpan(Today.AddDays(-100), Today.AddDays(100), record, on)) };

    private static string MyProviderMessage(BprRow row, BatchContext ctx) => ClaimBatchChecks.For(row, ctx).Single(p => p.Rule == "MyProvider").Message;

    [Fact]
    public void MyProvider_warns_when_the_covering_plan_is_Unknown()
    {
        var problem = ClaimBatchChecks.For(Clean(), OnPlan(MyProviderRecord.Unknown)).Single(p => p.Rule == "MyProvider");
        Assert.Equal((ClaimBatchChecks.Warn, "Not recorded as this participant's my provider for this plan. The NDIA may reject this line or pay it late."), (problem.Severity, problem.Message));
    }

    [Fact]
    public void MyProvider_warns_that_a_Requested_plan_is_not_confirmed_yet() =>
        Assert.Equal("Your my provider request for this plan isn't confirmed yet. The NDIA may reject this line or pay it late.", MyProviderMessage(Clean(), OnPlan(MyProviderRecord.Requested, Today.AddDays(-3))));

    [Fact]
    public void MyProvider_warns_when_the_line_is_before_the_Recorded_date()
    {
        var row = Clean(); // delivered 5 days before Today
        Assert.Equal("This line is before the date you were recorded as my provider (28 Oct 2026).", MyProviderMessage(row, OnPlan(MyProviderRecord.Recorded, Today.AddDays(-2))));
    }

    [Fact]
    public void MyProvider_is_quiet_when_Recorded_on_or_before_the_line_or_with_no_date()
    {
        Assert.DoesNotContain("MyProvider", Rules(Clean(), OnPlan(MyProviderRecord.Recorded, Today.AddDays(-5))));
        Assert.DoesNotContain("MyProvider", Rules(Clean(), OnPlan(MyProviderRecord.Recorded, Today.AddDays(-50))));
        Assert.DoesNotContain("MyProvider", Rules(Clean(), OnPlan(MyProviderRecord.Recorded)));
    }

    [Fact]
    public void MyProvider_warns_with_no_plans_but_stays_silent_when_no_plan_covers_the_line()
    {
        const string text = "Not recorded as this participant's my provider for this plan. The NDIA may reject this line or pay it late.";
        Assert.Equal(text, MyProviderMessage(Clean(), new BatchContext { Today = Today }));
        Assert.DoesNotContain("MyProvider", Rules(Clean(), new BatchContext { Today = Today, Plans = Plans(new PlanSpan(Today.AddDays(-400), Today.AddDays(-100), MyProviderRecord.Recorded)) }));
    }

    [Theory]
    [InlineData(PlanType.PlanManaged)]
    [InlineData(PlanType.SelfManaged)]
    public void MyProvider_reaches_only_NDIA_managed_lines(PlanType plan)
    {
        var rules = Rules(Clean() with { PlanType = plan }, new BatchContext { Today = Today });
        Assert.Contains("NotAgency", rules);
        Assert.DoesNotContain("MyProvider", rules);
    }

    [Fact]
    public void MyProvider_comes_before_Age()
    {
        var row = Clean(line: l => { l.SupportsDeliveredFrom = Today.AddDays(-70); l.SupportsDeliveredTo = l.SupportsDeliveredFrom; });
        var rules = Rules(row, new BatchContext { Today = Today, Plans = Plans(new PlanSpan(Today.AddDays(-200), Today.AddDays(100))) });
        Assert.Equal(["MyProvider", "Age"], rules);
    }

    [Fact]
    public void MyProvider_is_a_warning_never_a_block() =>
        Assert.All(ClaimBatchChecks.For(Clean(), OnPlan(MyProviderRecord.Unknown)), p => Assert.Equal("warn", p.Severity));

    [Fact]
    public void DuplicateInFile_warns_on_the_same_participant_item_and_dates()
    {
        var a = Clean();
        var b = Clean() with { Participant = a.Participant };
        b.Line.SupportsDeliveredFrom = a.Line.SupportsDeliveredFrom;
        b.Line.SupportsDeliveredTo = a.Line.SupportsDeliveredTo;
        var ctx = new BatchContext { Today = Today, Plans = Covered, BuildRows = [a, b] };
        Assert.Contains("DuplicateInFile", Rules(a, ctx));
        Assert.DoesNotContain("DuplicateInFile", Rules(a, new BatchContext { Today = Today, Plans = Covered, BuildRows = [a] }));
    }

    [Fact]
    public void DoubleClaimAcrossFiles_warns_with_the_other_reference_right_after_DuplicateInFile()
    {
        var a = Clean();
        var b = Clean() with { Participant = a.Participant };
        b.Line.SupportsDeliveredFrom = a.Line.SupportsDeliveredFrom;
        b.Line.SupportsDeliveredTo = a.Line.SupportsDeliveredTo;
        var ctx = new BatchContext { Today = Today, BuildRows = [a, b], DoubleClaimed = new Dictionary<Guid, string> { [a.Line.Id] = "TC-9" } };
        var problems = ClaimBatchChecks.For(a, ctx);
        var rules = problems.Select(p => p.Rule).ToList();
        Assert.Equal(rules.IndexOf("DuplicateInFile") + 1, rules.IndexOf("DoubleClaimAcrossFiles"));
        var warn = problems.Single(p => p.Rule == "DoubleClaimAcrossFiles");
        Assert.Equal(ClaimBatchChecks.Warn, warn.Severity);
        Assert.Contains("TC-9", warn.Message);
        Assert.DoesNotContain("DoubleClaimAcrossFiles", Rules(b, ctx));
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

    // ── Provider travel (travel plan A2, T21 and T22) ──

    [Fact]
    public void T21_ATravelLine_BesideItsBandLine_IsNotADuplicate_AndIsNotAlreadyAccepted()
    {
        var band = Clean();
        var travel = Clean(line: l => l.ClaimType = ClaimType.ProviderTravel) with { Participant = band.Participant };
        var ctx = new BatchContext { Today = Today, Plans = Covered, BuildRows = [band, travel], Accepted = [new AcceptedLine("430000001", band.Line.SupportItemCode, band.Line.SupportsDeliveredFrom, band.Line.SupportsDeliveredTo, "BPR1.csv", ClaimType.Standard)] };
        Assert.DoesNotContain("DuplicateInFile", Rules(travel, ctx));
        Assert.DoesNotContain("AlreadyAccepted", Rules(travel, ctx));
        Assert.Contains("AlreadyAccepted", Rules(band, ctx));   // (b) the same type, item and dates still blocks
    }

    [Fact]
    public void T21_TwoTravelLines_OfTheSameItemAndDates_StillWarn()
    {
        var a = Clean(line: l => l.ClaimType = ClaimType.ProviderTravel);
        var b = Clean(line: l => l.ClaimType = ClaimType.ProviderTravel) with { Participant = a.Participant };
        b.Line.SupportsDeliveredFrom = a.Line.SupportsDeliveredFrom; b.Line.SupportsDeliveredTo = a.Line.SupportsDeliveredTo;
        Assert.Contains("DuplicateInFile", Rules(a, new BatchContext { Today = Today, Plans = Covered, BuildRows = [a, b] }));
    }

    [Theory]
    [InlineData(ClaimType.ProviderTravel, "04_104_0125_6_1", "TRAN")]
    [InlineData(ClaimType.Standard, "04_799_0125_6_1", "")]
    [InlineData(ClaimType.Standard, "04_104_0125_6_1", "")]
    public void T22_TheClaimTypeColumn_IsTRANForProviderTravel_AndBlankForTheKmItemAndAnOldRow(ClaimType type, string item, string expected)
    {
        var row = Clean(line: l => { l.ClaimType = type; l.SupportItemCode = item; });
        Assert.Equal(expected, BprCsvService.ToOut(row, 1).ClaimType);
    }

    [Fact]
    public void T22_ACancellation_StillWritesCANC()
    {
        var row = Clean(line: l => { l.ClaimType = ClaimType.Cancellation; l.CancellationReason = "nsdh"; });
        Assert.Equal("CANC", BprCsvService.ToOut(row, 1).ClaimType);
    }

    [Fact]
    public void F2_AnAcceptedStandardLine_StillBlocksACancellationLineOfTheSameItemAndDates()
    {
        var accepted = Clean();
        var cancel = Clean(line: l => l.ClaimType = ClaimType.Cancellation) with { Participant = accepted.Participant };
        var ctx = new BatchContext { Today = Today, Plans = Covered, BuildRows = [accepted, cancel], Accepted = [new AcceptedLine("430000001", accepted.Line.SupportItemCode, accepted.Line.SupportsDeliveredFrom, accepted.Line.SupportsDeliveredTo, "BPR1.csv", ClaimType.Standard)] };
        Assert.Contains("AlreadyAccepted", Rules(cancel, ctx));
        Assert.Contains("DuplicateInFile", Rules(cancel, ctx));
    }

    [Fact]
    public void N3_ATravelKmRow_WritesTheDollarsInQuantity_AndLeavesHoursEmpty()
    {
        var row = Clean(line: l => { l.SupportItemCode = "04_799_0125_6_1"; l.Hours = 8.91m; l.UnitPrice = 1m; l.TotalAmount = 8.91m; }, item: i => { i.ItemNumber = "04_799_0125_6_1"; i.Unit = "E"; });
        var o = BprCsvService.ToOut(row, 1);
        Assert.Equal((8.91m, (decimal?)null, ""), (o.Quantity, o.Hours, o.ClaimType));
    }
}
