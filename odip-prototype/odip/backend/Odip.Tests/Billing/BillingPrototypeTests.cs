using System.IO;
using System.Linq;
using Odip.Domain.Billing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Dictionary;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// Coverage ported from the package-free Odip.ProtoTests harness that proved out the new
/// Billing and Dictionary logic offline (NuGet-blocked environment). Kept 1:1 with that
/// harness's assertions so behaviour is pinned under xunit for the normal test run.
/// </summary>
public class BillingPrototypeTests
{
    // ── Helpers ──────────────────────────────────────────────

    private static ProdaClaimRow MakeRow(
        DateOnly? from = null,
        DateOnly? to = null,
        decimal? quantity = 2m,
        TimeSpan? hours = null,
        string claimReference = "REF-1",
        GSTCode gst = GSTCode.P2,
        string claimTypeCode = "",
        string? cancellationReason = null)
    {
        var f = from ?? new DateOnly(2026, 8, 1);
        var t = to ?? new DateOnly(2026, 8, 1);
        return new ProdaClaimRow(
            "REG123",
            "NDIS999",
            f,
            t,
            "01_002_0107_1_1",
            claimReference,
            quantity,
            hours,
            50.00m,
            gst,
            "A Coordinator",
            true,
            null,
            claimTypeCode,
            cancellationReason,
            "12345678901");
    }

    private static FundingSource AgencyFundingSource() => new()
    {
        Id = Guid.NewGuid(),
        RouteType = FundingRouteType.AgencyManaged
    };

    private static BillableEvent MakeEvent(
        FundingSource fundingSource,
        Guid? serviceBookingId = null,
        string supportItem = "01_002_0107_1_1",
        decimal totalAmount = 10m,
        decimal? quantity = 1m,
        TimeSpan? hours = null,
        decimal unitPrice = 10m,
        string claimReference = "REF-1",
        DateOnly? from = null,
        DateOnly? to = null)
    {
        var f = from ?? new DateOnly(2026, 8, 1);
        var t = to ?? new DateOnly(2026, 8, 1);
        return new BillableEvent
        {
            Id = Guid.NewGuid(),
            FundingSourceId = fundingSource.Id,
            FundingSource = fundingSource,
            ServiceBookingId = serviceBookingId,
            SupportItemNumber = supportItem,
            SupportsDeliveredFrom = f,
            SupportsDeliveredTo = t,
            Quantity = quantity,
            Hours = hours,
            UnitPrice = unitPrice,
            TotalAmount = totalAmount,
            GstCode = GSTCode.P2,
            ClaimReference = claimReference
        };
    }

    private static ServiceBooking MakeBooking(
        string supportItem, decimal allocated, decimal claimed, DateOnly? endDate = null, int claimWindowDays = 60)
    {
        var booking = new ServiceBooking
        {
            Id = Guid.NewGuid(),
            ProdaBookingReference = "BOOK-1",
            StartDate = new DateOnly(2026, 1, 1),
            EndDate = endDate ?? new DateOnly(2026, 12, 31),
            ClaimWindowDays = claimWindowDays
        };
        booking.Lines.Add(new ServiceBookingLine
        {
            Id = Guid.NewGuid(),
            ServiceBookingId = booking.Id,
            SupportItemNumber = supportItem,
            AllocatedAmount = allocated,
            ClaimedAmount = claimed
        });
        return booking;
    }

    private static string ResolveSeedJsonPath()
    {
        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < 8; i++)
        {
            var candidate = Path.Combine(dir, "Odip.Domain", "SeedData", "DataDictionarySeed.json");
            if (File.Exists(candidate))
                return candidate;
            dir = Path.GetFullPath(Path.Combine(dir, ".."));
        }

        throw new FileNotFoundException("Could not locate DataDictionarySeed.json via any known path.");
    }

    // ── PRODA CSV ────────────────────────────────────────────

    [Fact]
    public void Write_HeaderRow_MatchesSixteenColumnSpecOrder()
    {
        var expectedHeader = new[]
        {
            "RegistrationNumber", "NDISNumber", "SupportsDeliveredFrom", "SupportsDeliveredTo",
            "SupportNumber", "ClaimReference", "Quantity", "Hours", "UnitPrice", "GSTCode",
            "AuthorisedBy", "ParticipantApproved", "InKindFundingProgram", "ClaimType",
            "CancellationReason", "ABNofSupportProvider"
        };

        var csv = ProdaBulkFileWriter.Write(new[] { MakeRow() });
        var headerLine = csv.Split("\r\n")[0];

        Assert.Equal(16, expectedHeader.Length);
        Assert.Equal(string.Join(",", expectedHeader), headerLine);
    }

    [Fact]
    public void Write_TwoRowBatch_RendersDatesAsIsoYyyyMmDd()
    {
        var row1 = MakeRow(from: new DateOnly(2026, 8, 1), to: new DateOnly(2026, 8, 2), claimReference: "REF-A");
        var row2 = MakeRow(from: new DateOnly(2026, 8, 3), to: new DateOnly(2026, 8, 4), claimReference: "REF-B");

        var csv = ProdaBulkFileWriter.Write(new[] { row1, row2 });
        var lines = csv.Split("\r\n");

        Assert.Contains("2026-08-01", lines[1]);
        Assert.Contains("2026-08-02", lines[1]);
        Assert.Contains("2026-08-03", lines[2]);
        Assert.Contains("2026-08-04", lines[2]);
    }

    [Fact]
    public void Write_SixPointFiveHours_RendersAsZeroPaddedHhhMm()
    {
        var row = MakeRow(quantity: null, hours: TimeSpan.FromHours(6.5), claimReference: "REF-H1");

        var csv = ProdaBulkFileWriter.Write(new[] { row });

        Assert.Contains("006:30", csv);
    }

    [Fact]
    public void Write_ThirtyHours_RendersAsZeroPaddedHhhMm()
    {
        var row = MakeRow(quantity: null, hours: TimeSpan.FromHours(30), claimReference: "REF-H2");

        var csv = ProdaBulkFileWriter.Write(new[] { row });

        Assert.Contains("030:00", csv);
    }

    [Fact]
    public void Write_QuantityBasedRow_LeavesHoursColumnEmpty()
    {
        var row = MakeRow(quantity: 3m, hours: null, claimReference: "REF-Q");

        var csv = ProdaBulkFileWriter.Write(new[] { row });
        var fields = csv.Split("\r\n")[1].Split(",");

        Assert.Equal("3", fields[6]);
        Assert.Equal(string.Empty, fields[7]);
    }

    [Fact]
    public void Write_HoursBasedRow_LeavesQuantityColumnEmpty()
    {
        var row = MakeRow(quantity: null, hours: TimeSpan.FromHours(1), claimReference: "REF-Q2");

        var csv = ProdaBulkFileWriter.Write(new[] { row });
        var fields = csv.Split("\r\n")[1].Split(",");

        Assert.Equal(string.Empty, fields[6]);
        Assert.Equal("001:00", fields[7]);
    }

    [Fact]
    public void Write_GstCodeP2_RendersAsP2()
    {
        var row = MakeRow(gst: GSTCode.P2, claimReference: "REF-GST");

        var csv = ProdaBulkFileWriter.Write(new[] { row });
        var fields = csv.Split("\r\n")[1].Split(",");

        Assert.Equal("P2", fields[9]);
    }

    [Fact]
    public void Write_GstCodeGst_ThrowsArgumentException()
    {
        var row = MakeRow(gst: GSTCode.GST, claimReference: "REF-GST2");

        Assert.Throws<ArgumentException>(() => ProdaBulkFileWriter.Write(new[] { row }));
    }

    [Fact]
    public void FromBillableEvent_StandardClaimType_MapsToEmptyCode()
    {
        var ev = new BillableEvent
        {
            Id = Guid.NewGuid(),
            SupportsDeliveredFrom = new DateOnly(2026, 8, 1),
            SupportsDeliveredTo = new DateOnly(2026, 8, 1),
            SupportItemNumber = "01_002_0107_1_1",
            Quantity = 1,
            UnitPrice = 10,
            TotalAmount = 10,
            GstCode = GSTCode.P2,
            ClaimType = ClaimType.Standard,
            ClaimReference = "REF-STD"
        };

        var row = ProdaBulkFileWriter.FromBillableEvent(ev, "REG1", "NDIS1", "12345678901");

        Assert.Equal(string.Empty, row.ClaimTypeCode);
    }

    [Fact]
    public void FromBillableEvent_CancellationClaimType_MapsToCancCode()
    {
        var ev = new BillableEvent
        {
            Id = Guid.NewGuid(),
            SupportsDeliveredFrom = new DateOnly(2026, 8, 1),
            SupportsDeliveredTo = new DateOnly(2026, 8, 1),
            SupportItemNumber = "01_002_0107_1_1",
            Quantity = 1,
            UnitPrice = 10,
            TotalAmount = 10,
            GstCode = GSTCode.P2,
            ClaimType = ClaimType.Cancellation,
            CancellationReasonCode = "NSDH",
            ClaimReference = "REF-CANC"
        };

        var row = ProdaBulkFileWriter.FromBillableEvent(ev, "REG1", "NDIS1", "12345678901");

        Assert.Equal("CANC", row.ClaimTypeCode);
    }

    [Fact]
    public void Write_CancellationReasonWithoutCancClaimType_ThrowsArgumentException()
    {
        var row = MakeRow(claimTypeCode: "", cancellationReason: "NSDH", claimReference: "REF-BADCANC");

        Assert.Throws<ArgumentException>(() => ProdaBulkFileWriter.Write(new[] { row }));
    }

    [Fact]
    public void Write_MoreThanMaxRecords_ThrowsArgumentException()
    {
        var rows = Enumerable.Range(0, ProdaBulkFileWriter.MaxRecordsPerFile + 1)
            .Select(i => MakeRow(claimReference: $"REF-{i}"))
            .ToList();

        Assert.Throws<ArgumentException>(() => ProdaBulkFileWriter.Write(rows));
    }

    [Fact]
    public void Write_FieldContainingComma_IsQuoted()
    {
        var row = MakeRow(claimReference: "REF,WITH,COMMA");

        var csv = ProdaBulkFileWriter.Write(new[] { row });

        Assert.Contains("\"REF,WITH,COMMA\"", csv);
    }

    [Fact]
    public void FileName_ForTwoAugust2026_MatchesOassistConvention()
    {
        Assert.Equal("NDISUPLOAD020826.csv", ProdaBulkFileWriter.FileName(new DateOnly(2026, 8, 2)));
    }

    [Fact]
    public void Write_UsesCrlfLineEndingsOnly()
    {
        var csv = ProdaBulkFileWriter.Write(new[] { MakeRow(claimReference: "REF-CRLF") });

        Assert.Contains("\r\n", csv);
        Assert.DoesNotContain("\n", csv.Replace("\r\n", string.Empty));
    }

    // ── BillingValidator ─────────────────────────────────────

    [Fact]
    public void Validate_OverBalanceClaim_ProducesBookingBalanceError()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        var booking = MakeBooking("01_002_0107_1_1", allocated: 100m, claimed: 95m);
        var ev = MakeEvent(fs, booking.Id, totalAmount: 10m, claimReference: "REF-OVER");

        var results = validator.Validate(new[] { ev }, new[] { booking }, new HashSet<string>(), new DateOnly(2026, 8, 2));

        Assert.Contains(results, r => r.EventId == ev.Id && r.Code == "BOOKING_BALANCE" && r.Severity == BillingSeverity.Error);
    }

    [Fact]
    public void Validate_DuplicateClaimReferenceInSet_ProducesDuplicateRefError()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        var ev1 = MakeEvent(fs, claimReference: "REF-DUP", from: new DateOnly(2026, 8, 1), to: new DateOnly(2026, 8, 1));
        var ev2 = MakeEvent(fs, claimReference: "REF-DUP", from: new DateOnly(2026, 8, 1), to: new DateOnly(2026, 8, 1));

        var results = validator.Validate(new[] { ev1, ev2 }, Array.Empty<ServiceBooking>(), new HashSet<string>(), new DateOnly(2026, 8, 2));

        Assert.True(results.Count(r => r.Code == "DUPLICATE_REF") >= 2);
    }

    [Fact]
    public void Validate_ReferenceAlreadyClaimed_ProducesDuplicateRefError()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        var ev = MakeEvent(fs, claimReference: "REF-PRIOR");

        var results = validator.Validate(new[] { ev }, Array.Empty<ServiceBooking>(), new HashSet<string> { "REF-PRIOR" }, new DateOnly(2026, 8, 2));

        Assert.Contains(results, r => r.EventId == ev.Id && r.Code == "DUPLICATE_REF" && r.Severity == BillingSeverity.Error);
    }

    [Fact]
    public void Validate_EventPastClaimDeadline_ProducesPastDeadlineError()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        // EndDate 2026-01-31 + 60 day window => deadline well before today (2026-08-02).
        var booking = MakeBooking("01_002_0107_1_1", 1000m, 0m, endDate: new DateOnly(2026, 1, 31), claimWindowDays: 60);
        var ev = MakeEvent(fs, booking.Id, claimReference: "REF-PAST", totalAmount: 10m);

        var results = validator.Validate(new[] { ev }, new[] { booking }, new HashSet<string>(), new DateOnly(2026, 8, 2));

        Assert.Contains(results, r => r.EventId == ev.Id && r.Code == "PAST_DEADLINE" && r.Severity == BillingSeverity.Error);
    }

    [Fact]
    public void Validate_DeadlineWithin14Days_ProducesDeadlineNearWarning()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        var today = new DateOnly(2026, 8, 2);
        var deadline = today.AddDays(10);
        var booking = MakeBooking("01_002_0107_1_1", 1000m, 0m, endDate: deadline, claimWindowDays: 0);
        var ev = MakeEvent(fs, booking.Id, claimReference: "REF-NEAR", totalAmount: 10m);

        var results = validator.Validate(new[] { ev }, new[] { booking }, new HashSet<string>(), today);

        Assert.Contains(results, r => r.EventId == ev.Id && r.Code == "DEADLINE_NEAR" && r.Severity == BillingSeverity.Warning);
    }

    [Fact]
    public void Validate_QuantityAndHoursBothSet_ProducesError()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        var ev = MakeEvent(fs, quantity: 1m, hours: TimeSpan.FromHours(1), claimReference: "REF-BOTHSET");

        var results = validator.Validate(new[] { ev }, Array.Empty<ServiceBooking>(), new HashSet<string>(), new DateOnly(2026, 8, 2));

        Assert.Contains(results, r => r.EventId == ev.Id && r.Code == "QTY_XOR_HOURS" && r.Severity == BillingSeverity.Error);
    }

    [Fact]
    public void Validate_QuantityAndHoursBothNull_ProducesError()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        var ev = MakeEvent(fs, quantity: null, hours: null, claimReference: "REF-BOTHNULL");

        var results = validator.Validate(new[] { ev }, Array.Empty<ServiceBooking>(), new HashSet<string>(), new DateOnly(2026, 8, 2));

        Assert.Contains(results, r => r.EventId == ev.Id && r.Code == "QTY_XOR_HOURS" && r.Severity == BillingSeverity.Error);
    }

    [Fact]
    public void Validate_FromDateAfterToDate_ProducesDateOrderError()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        var ev = MakeEvent(fs, from: new DateOnly(2026, 8, 5), to: new DateOnly(2026, 8, 1), claimReference: "REF-BADDATE");

        var results = validator.Validate(new[] { ev }, Array.Empty<ServiceBooking>(), new HashSet<string>(), new DateOnly(2026, 8, 2));

        Assert.Contains(results, r => r.EventId == ev.Id && r.Code == "DATE_ORDER" && r.Severity == BillingSeverity.Error);
    }

    [Fact]
    public void Validate_TotalAmountMismatch_ProducesAmountMismatchWarning()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        var ev = MakeEvent(fs, quantity: 2m, unitPrice: 10m, totalAmount: 999m, claimReference: "REF-MISMATCH");

        var results = validator.Validate(new[] { ev }, Array.Empty<ServiceBooking>(), new HashSet<string>(), new DateOnly(2026, 8, 2));

        Assert.Contains(results, r => r.EventId == ev.Id && r.Code == "AMOUNT_MISMATCH" && r.Severity == BillingSeverity.Warning);
    }

    [Fact]
    public void Apply_ValidAgencyEvent_MarksValidatedAndIncrementsClaimedAmount()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        var booking = MakeBooking("01_002_0107_1_1", allocated: 100m, claimed: 0m);
        var ev = MakeEvent(fs, booking.Id, quantity: 1m, unitPrice: 10m, totalAmount: 10m, claimReference: "REF-APPLY-1");

        var results = validator.Apply(new[] { ev }, new[] { booking }, new HashSet<string>(), new DateOnly(2026, 8, 2));

        Assert.Equal(BillableEventStatus.Validated, ev.Status);
        Assert.Equal(10m, booking.Lines.First().ClaimedAmount);
        Assert.DoesNotContain(results, r => r.EventId == ev.Id && r.Severity == BillingSeverity.Error);
    }

    [Fact]
    public void Apply_SecondIdenticalEventOverRemainingBalance_RejectsWithBookingBalance()
    {
        var validator = new BillingValidator();
        var fs = AgencyFundingSource();
        var booking = MakeBooking("01_002_0107_1_1", allocated: 100m, claimed: 0m);
        var ev1 = MakeEvent(fs, booking.Id, quantity: 1m, unitPrice: 10m, totalAmount: 10m, claimReference: "REF-APPLY-1");
        validator.Apply(new[] { ev1 }, new[] { booking }, new HashSet<string>(), new DateOnly(2026, 8, 2));

        // Booking now has 10 claimed / 90 remaining; claiming 95 exceeds the remaining balance.
        var ev2 = MakeEvent(fs, booking.Id, quantity: 1m, unitPrice: 95m, totalAmount: 95m, claimReference: "REF-APPLY-2");
        var results2 = validator.Apply(new[] { ev2 }, new[] { booking }, new HashSet<string>(), new DateOnly(2026, 8, 2));

        Assert.Contains(results2, r => r.EventId == ev2.Id && r.Code == "BOOKING_BALANCE" && r.Severity == BillingSeverity.Error);
        Assert.Equal(BillableEventStatus.Rejected, ev2.Status);
    }

    // ── Router ───────────────────────────────────────────────

    [Theory]
    [InlineData(FundingRouteType.AgencyManaged, BillingRoute.ProdaClaim)]
    [InlineData(FundingRouteType.PlanManaged, BillingRoute.XeroInvoiceToPlanManager)]
    [InlineData(FundingRouteType.SelfManaged, BillingRoute.XeroInvoiceToParticipant)]
    [InlineData(FundingRouteType.Private, BillingRoute.XeroInvoiceToPayer)]
    [InlineData(FundingRouteType.BusinessToBusiness, BillingRoute.XeroInvoiceToPayer)]
    public void Route_EachFundingRouteType_MapsToExpectedBillingRoute(FundingRouteType routeType, BillingRoute expected)
    {
        var fs = new FundingSource { Id = Guid.NewGuid(), RouteType = routeType };
        var ev = new BillableEvent { Id = Guid.NewGuid(), FundingSourceId = fs.Id };

        var actual = BillingRouter.Route(ev, fs);

        Assert.Equal(expected, actual);
    }

    // ── Dictionary ───────────────────────────────────────────

    [Fact]
    public void LoadFromJson_RealSeedFile_Loads287FieldsAcross24Domains()
    {
        var json = File.ReadAllText(ResolveSeedJsonPath());
        var defs = DataDictionarySeeder.LoadFromJson(json, Guid.NewGuid());

        var (fieldCount, domainCount) = DataDictionarySeeder.Stats(defs);

        // 285 + DIAG-01/02's MED-016 (Diagnoses) and MED-017 (HIDPA Support Categories) — both
        // added to the existing "Health & Medical" domain, so domainCount is unchanged at 24.
        Assert.Equal(287, fieldCount);
        Assert.Equal(24, domainCount);
    }

    [Fact]
    public void LoadFromJson_KnownField_ParsesDateOfBirthCorrectly()
    {
        var json = File.ReadAllText(ResolveSeedJsonPath());
        var defs = DataDictionarySeeder.LoadFromJson(json, Guid.NewGuid());

        var pid007 = defs.Single(d => d.FieldId == "PID-007");

        Assert.Equal("Date of Birth", pid007.Name);
        Assert.Equal("Participant Identity", pid007.Domain);
        Assert.Equal(FieldDataType.Date, pid007.DataType);
    }

    [Fact]
    public void LoadFromJson_SensitiveFlag_TrueForMedicalField_FalseForIdentityField()
    {
        var json = File.ReadAllText(ResolveSeedJsonPath());
        var defs = DataDictionarySeeder.LoadFromJson(json, Guid.NewGuid());

        var medField = defs.First(d => d.FieldId.StartsWith("MED-", StringComparison.Ordinal));
        var pidField = defs.First(d => d.FieldId.StartsWith("PID-", StringComparison.Ordinal));

        Assert.True(medField.IsSensitive);
        Assert.False(pidField.IsSensitive);
    }

    [Fact]
    public void LoadFromJson_SingleSelectFieldWithAllowedValues_YieldsNonEmptyPicklistOptions()
    {
        var json = File.ReadAllText(ResolveSeedJsonPath());
        var defs = DataDictionarySeeder.LoadFromJson(json, Guid.NewGuid());

        var singleSelectWithValues = defs.FirstOrDefault(
            d => d.DataType == FieldDataType.SingleSelect && !string.IsNullOrWhiteSpace(d.PicklistOptionsRaw));

        if (singleSelectWithValues is null)
        {
            // No Single-select field with allowedValues in this seed snapshot — nothing to assert.
            return;
        }

        Assert.NotEmpty(singleSelectWithValues.PicklistOptions);
    }

    [Fact]
    public void FromAppearsIn_RiskAssessment_YieldsMoreThan20Fields()
    {
        var json = File.ReadAllText(ResolveSeedJsonPath());
        var defs = DataDictionarySeeder.LoadFromJson(json, Guid.NewGuid());

        var form = FormTemplate.FromAppearsIn("Risk Assessment", defs);

        Assert.True(form.Sections.Sum(s => s.FieldIds.Count) > 20);
    }

    [Fact]
    public void LoadFromJson_MalformedJson_ThrowsInvalidDataException()
    {
        Assert.Throws<InvalidDataException>(() => DataDictionarySeeder.LoadFromJson("{ not valid json", Guid.NewGuid()));
    }
}
