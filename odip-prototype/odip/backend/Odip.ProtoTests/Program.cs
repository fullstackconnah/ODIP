using System.Globalization;
using Odip.Domain.Billing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Dictionary;
using Odip.Domain.Enums;

var pass = 0;
var fail = 0;
var failures = new List<string>();

void Check(string name, bool condition)
{
    if (condition)
    {
        pass++;
    }
    else
    {
        fail++;
        failures.Add(name);
        Console.WriteLine($"FAIL: {name}");
    }
}

void CheckThrows<TEx>(string name, Action action) where TEx : Exception
{
    try
    {
        action();
        Check(name, false);
    }
    catch (TEx)
    {
        Check(name, true);
    }
    catch (Exception ex)
    {
        Check($"{name} (wrong exception type: {ex.GetType().Name})", false);
    }
}

// ───────────────────────── PRODA CSV ─────────────────────────

ProdaClaimRow MakeRow(
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

// Header order
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
    Check("PRODA header matches 16-column spec order", headerLine == string.Join(",", expectedHeader));
    Check("PRODA header has 16 columns", expectedHeader.Length == 16);
}

// 2-row batch dates render yyyy-MM-dd
{
    var row1 = MakeRow(from: new DateOnly(2026, 8, 1), to: new DateOnly(2026, 8, 2), claimReference: "REF-A");
    var row2 = MakeRow(from: new DateOnly(2026, 8, 3), to: new DateOnly(2026, 8, 4), claimReference: "REF-B");
    var csv = ProdaBulkFileWriter.Write(new[] { row1, row2 });
    var lines = csv.Split("\r\n");
    Check("2-row batch: row1 date format", lines[1].Contains("2026-08-01") && lines[1].Contains("2026-08-02"));
    Check("2-row batch: row2 date format", lines[2].Contains("2026-08-03") && lines[2].Contains("2026-08-04"));
}

// Hours formatting
{
    var row65 = MakeRow(quantity: null, hours: TimeSpan.FromHours(6.5), claimReference: "REF-H1");
    var csv65 = ProdaBulkFileWriter.Write(new[] { row65 });
    Check("6.5h renders 006:30", csv65.Contains("006:30"));

    var row30 = MakeRow(quantity: null, hours: TimeSpan.FromHours(30), claimReference: "REF-H2");
    var csv30 = ProdaBulkFileWriter.Write(new[] { row30 });
    Check("30h renders 030:00", csv30.Contains("030:00"));
}

// Quantity-based row leaves Hours empty and vice versa
{
    var qRow = MakeRow(quantity: 3m, hours: null, claimReference: "REF-Q");
    var qCsv = ProdaBulkFileWriter.Write(new[] { qRow });
    var qFields = qCsv.Split("\r\n")[1].Split(",");
    Check("Quantity-based row: Quantity populated", qFields[6] == "3");
    Check("Quantity-based row: Hours empty", qFields[7] == "");

    var hRow = MakeRow(quantity: null, hours: TimeSpan.FromHours(1), claimReference: "REF-Q2");
    var hCsv = ProdaBulkFileWriter.Write(new[] { hRow });
    var hFields = hCsv.Split("\r\n")[1].Split(",");
    Check("Hours-based row: Quantity empty", hFields[6] == "");
    Check("Hours-based row: Hours populated", hFields[7] == "001:00");
}

// GST enum P2 renders "P2"
{
    var row = MakeRow(gst: GSTCode.P2, claimReference: "REF-GST");
    var csv = ProdaBulkFileWriter.Write(new[] { row });
    Check("GSTCode.P2 renders 'P2'", csv.Split("\r\n")[1].Split(",")[9] == "P2");
}

// GSTCode.GST throws
CheckThrows<ArgumentException>("GSTCode.GST throws on write", () =>
{
    var row = MakeRow(gst: GSTCode.GST, claimReference: "REF-GST2");
    ProdaBulkFileWriter.Write(new[] { row });
});

// ClaimType mapping via FromBillableEvent
{
    var evStandard = new BillableEvent
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
    var rowStandard = ProdaBulkFileWriter.FromBillableEvent(evStandard, "REG1", "NDIS1", "12345678901");
    Check("ClaimType.Standard -> empty code", rowStandard.ClaimTypeCode == "");

    var evCancel = new BillableEvent
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
    var rowCancel = ProdaBulkFileWriter.FromBillableEvent(evCancel, "REG1", "NDIS1", "12345678901");
    Check("ClaimType.Cancellation -> CANC code", rowCancel.ClaimTypeCode == "CANC");
}

// CancellationReason present without CANC throws
CheckThrows<ArgumentException>("CancellationReason without CANC throws", () =>
{
    var row = MakeRow(claimTypeCode: "", cancellationReason: "NSDH", claimReference: "REF-BADCANC");
    ProdaBulkFileWriter.Write(new[] { row });
});

// >5000 rows throws
CheckThrows<ArgumentException>(">5000 rows throws", () =>
{
    var rows = new List<ProdaClaimRow>();
    for (var i = 0; i < ProdaBulkFileWriter.MaxRecordsPerFile + 1; i++)
        rows.Add(MakeRow(claimReference: $"REF-{i}"));
    ProdaBulkFileWriter.Write(rows);
});

// field containing a comma is quoted
{
    var row = MakeRow(claimReference: "REF,WITH,COMMA");
    var csv = ProdaBulkFileWriter.Write(new[] { row });
    Check("Comma field is quoted", csv.Contains("\"REF,WITH,COMMA\""));
}

// FileName
{
    Check(
        "FileName(2026-08-02) == NDISUPLOAD020826.csv",
        ProdaBulkFileWriter.FileName(new DateOnly(2026, 8, 2)) == "NDISUPLOAD020826.csv");
}

// CRLF line endings
{
    var csv = ProdaBulkFileWriter.Write(new[] { MakeRow(claimReference: "REF-CRLF") });
    Check("CSV uses CRLF line endings", csv.Contains("\r\n") && !csv.Replace("\r\n", "").Contains("\n"));
}

// ───────────────────────── BillingValidator ─────────────────────────

FundingSource AgencyFundingSource() => new()
{
    Id = Guid.NewGuid(),
    RouteType = FundingRouteType.AgencyManaged
};

BillableEvent MakeEvent(
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

ServiceBooking MakeBooking(string supportItem, decimal allocated, decimal claimed, DateOnly? endDate = null, int claimWindowDays = 60)
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

var validator = new BillingValidator();

// Over-balance claim -> BOOKING_BALANCE Error
{
    var fs = AgencyFundingSource();
    var booking = MakeBooking("01_002_0107_1_1", allocated: 100m, claimed: 95m);
    var ev = MakeEvent(fs, booking.Id, totalAmount: 10m, claimReference: "REF-OVER");
    var results = validator.Validate(new[] { ev }, new[] { booking }, new HashSet<string>(), new DateOnly(2026, 8, 2));
    Check(
        "Over-balance claim -> BOOKING_BALANCE Error",
        results.Any(r => r.EventId == ev.Id && r.Code == "BOOKING_BALANCE" && r.Severity == BillingSeverity.Error));
}

// Duplicate ClaimReference in-set -> DUPLICATE_REF
{
    var fs = AgencyFundingSource();
    var ev1 = MakeEvent(fs, claimReference: "REF-DUP", from: new DateOnly(2026, 8, 1), to: new DateOnly(2026, 8, 1));
    var ev2 = MakeEvent(fs, claimReference: "REF-DUP", from: new DateOnly(2026, 8, 1), to: new DateOnly(2026, 8, 1));
    var results = validator.Validate(new[] { ev1, ev2 }, Array.Empty<ServiceBooking>(), new HashSet<string>(), new DateOnly(2026, 8, 2));
    Check(
        "Duplicate ClaimReference in-set -> DUPLICATE_REF",
        results.Count(r => r.Code == "DUPLICATE_REF") >= 2);
}

// Reference in priorClaimedReferences -> Error
{
    var fs = AgencyFundingSource();
    var ev = MakeEvent(fs, claimReference: "REF-PRIOR");
    var results = validator.Validate(new[] { ev }, Array.Empty<ServiceBooking>(), new HashSet<string> { "REF-PRIOR" }, new DateOnly(2026, 8, 2));
    Check(
        "Prior-claimed reference -> DUPLICATE_REF Error",
        results.Any(r => r.EventId == ev.Id && r.Code == "DUPLICATE_REF" && r.Severity == BillingSeverity.Error));
}

// Event past ClaimDeadline -> PAST_DEADLINE
{
    var fs = AgencyFundingSource();
    var booking = MakeBooking("01_002_0107_1_1", 1000m, 0m, endDate: new DateOnly(2026, 1, 31), claimWindowDays: 60);
    // ClaimDeadline = 2026-01-31 + 60 days = 2026-04-01
    var ev = MakeEvent(fs, booking.Id, claimReference: "REF-PAST", totalAmount: 10m);
    var results = validator.Validate(new[] { ev }, new[] { booking }, new HashSet<string>(), new DateOnly(2026, 8, 2));
    Check(
        "Event past ClaimDeadline -> PAST_DEADLINE",
        results.Any(r => r.EventId == ev.Id && r.Code == "PAST_DEADLINE" && r.Severity == BillingSeverity.Error));
}

// Within 14 days -> DEADLINE_NEAR Warning
{
    var fs = AgencyFundingSource();
    var today = new DateOnly(2026, 8, 2);
    var deadline = today.AddDays(10);
    var booking = MakeBooking("01_002_0107_1_1", 1000m, 0m, endDate: deadline, claimWindowDays: 0);
    var ev = MakeEvent(fs, booking.Id, claimReference: "REF-NEAR", totalAmount: 10m);
    var results = validator.Validate(new[] { ev }, new[] { booking }, new HashSet<string>(), today);
    Check(
        "Within 14 days -> DEADLINE_NEAR Warning",
        results.Any(r => r.EventId == ev.Id && r.Code == "DEADLINE_NEAR" && r.Severity == BillingSeverity.Warning));
}

// Quantity and Hours both set -> Error
{
    var fs = AgencyFundingSource();
    var ev = MakeEvent(fs, quantity: 1m, hours: TimeSpan.FromHours(1), claimReference: "REF-BOTHSET");
    var results = validator.Validate(new[] { ev }, Array.Empty<ServiceBooking>(), new HashSet<string>(), new DateOnly(2026, 8, 2));
    Check(
        "Quantity and Hours both set -> Error",
        results.Any(r => r.EventId == ev.Id && r.Code == "QTY_XOR_HOURS" && r.Severity == BillingSeverity.Error));
}

// Both null -> Error
{
    var fs = AgencyFundingSource();
    var ev = MakeEvent(fs, quantity: null, hours: null, claimReference: "REF-BOTHNULL");
    var results = validator.Validate(new[] { ev }, Array.Empty<ServiceBooking>(), new HashSet<string>(), new DateOnly(2026, 8, 2));
    Check(
        "Quantity and Hours both null -> Error",
        results.Any(r => r.EventId == ev.Id && r.Code == "QTY_XOR_HOURS" && r.Severity == BillingSeverity.Error));
}

// from > to -> Error
{
    var fs = AgencyFundingSource();
    var ev = MakeEvent(fs, from: new DateOnly(2026, 8, 5), to: new DateOnly(2026, 8, 1), claimReference: "REF-BADDATE");
    var results = validator.Validate(new[] { ev }, Array.Empty<ServiceBooking>(), new HashSet<string>(), new DateOnly(2026, 8, 2));
    Check(
        "from > to dates -> DATE_ORDER Error",
        results.Any(r => r.EventId == ev.Id && r.Code == "DATE_ORDER" && r.Severity == BillingSeverity.Error));
}

// TotalAmount mismatch -> AMOUNT_MISMATCH Warning
{
    var fs = AgencyFundingSource();
    var ev = MakeEvent(fs, quantity: 2m, unitPrice: 10m, totalAmount: 999m, claimReference: "REF-MISMATCH");
    var results = validator.Validate(new[] { ev }, Array.Empty<ServiceBooking>(), new HashSet<string>(), new DateOnly(2026, 8, 2));
    Check(
        "TotalAmount mismatch -> AMOUNT_MISMATCH Warning",
        results.Any(r => r.EventId == ev.Id && r.Code == "AMOUNT_MISMATCH" && r.Severity == BillingSeverity.Warning));
}

// Apply(): valid agency event -> Validated, ClaimedAmount incremented; second identical -> BOOKING_BALANCE
{
    var fs = AgencyFundingSource();
    var booking = MakeBooking("01_002_0107_1_1", allocated: 100m, claimed: 0m);
    var ev1 = MakeEvent(fs, booking.Id, quantity: 1m, unitPrice: 10m, totalAmount: 10m, claimReference: "REF-APPLY-1");
    var results1 = validator.Apply(new[] { ev1 }, new[] { booking }, new HashSet<string>(), new DateOnly(2026, 8, 2));
    Check("Apply(): valid event -> Status Validated", ev1.Status == BillableEventStatus.Validated);
    Check("Apply(): ClaimedAmount incremented", booking.Lines.First().ClaimedAmount == 10m);
    Check("Apply(): no error results for valid event", !results1.Any(r => r.EventId == ev1.Id && r.Severity == BillingSeverity.Error));

    // Second identical event: booking now has 10 claimed, 90 remaining; claim 95 -> exceeds
    var ev2 = MakeEvent(fs, booking.Id, quantity: 1m, unitPrice: 95m, totalAmount: 95m, claimReference: "REF-APPLY-2");
    var results2 = validator.Apply(new[] { ev2 }, new[] { booking }, new HashSet<string>(), new DateOnly(2026, 8, 2));
    Check(
        "Apply(): second event over remaining balance -> BOOKING_BALANCE, Rejected",
        results2.Any(r => r.EventId == ev2.Id && r.Code == "BOOKING_BALANCE" && r.Severity == BillingSeverity.Error)
        && ev2.Status == BillableEventStatus.Rejected);
}

// ───────────────────────── Router ─────────────────────────

{
    var cases = new (FundingRouteType route, BillingRoute expected)[]
    {
        (FundingRouteType.AgencyManaged, BillingRoute.ProdaClaim),
        (FundingRouteType.PlanManaged, BillingRoute.XeroInvoiceToPlanManager),
        (FundingRouteType.SelfManaged, BillingRoute.XeroInvoiceToParticipant),
        (FundingRouteType.Private, BillingRoute.XeroInvoiceToPayer),
        (FundingRouteType.BusinessToBusiness, BillingRoute.XeroInvoiceToPayer),
    };

    foreach (var (routeType, expected) in cases)
    {
        var fs = new FundingSource { Id = Guid.NewGuid(), RouteType = routeType };
        var ev = new BillableEvent { Id = Guid.NewGuid(), FundingSourceId = fs.Id };
        var actual = BillingRouter.Route(ev, fs);
        Check($"Router: {routeType} -> {expected}", actual == expected);
    }
}

// ───────────────────────── Dictionary ─────────────────────────

string ResolveSeedJsonPath()
{
    var candidate = Path.Combine(AppContext.BaseDirectory, "SeedData", "DataDictionarySeed.json");
    if (File.Exists(candidate))
        return candidate;

    // Fallback: resolve relative to source tree (useful when run without CopyToOutputDirectory taking effect).
    var dir = AppContext.BaseDirectory;
    for (var i = 0; i < 6; i++)
    {
        var fallback = Path.Combine(dir, "Odip.Domain", "SeedData", "DataDictionarySeed.json");
        if (File.Exists(fallback))
            return fallback;
        dir = Path.GetFullPath(Path.Combine(dir, ".."));
    }

    throw new FileNotFoundException("Could not locate DataDictionarySeed.json via any known path.");
}

var seedJsonPath = ResolveSeedJsonPath();
var seedJson = File.ReadAllText(seedJsonPath);
var tenantId = Guid.NewGuid();
var defs = DataDictionarySeeder.LoadFromJson(seedJson, tenantId);

// seeder loads 280 fields / 24 domains
{
    var (fieldCount, domainCount) = DataDictionarySeeder.Stats(defs);
    Check("Seeder loads 280 fields", fieldCount == 280);
    Check("Seeder loads 24 domains", domainCount == 24);
}

// known field PID-007
{
    var pid007 = defs.FirstOrDefault(d => d.FieldId == "PID-007");
    Check("PID-007 exists", pid007 is not null);
    if (pid007 is not null)
    {
        Check("PID-007 name == Date of Birth", pid007.Name == "Date of Birth");
        Check("PID-007 domain == Participant Identity", pid007.Domain == "Participant Identity");
        Check("PID-007 DataType == Date", pid007.DataType == FieldDataType.Date);
    }
}

// sensitive flag true for a MED-* field, false for a PID-* field
{
    var medField = defs.FirstOrDefault(d => d.FieldId.StartsWith("MED-", StringComparison.Ordinal));
    var pidField = defs.FirstOrDefault(d => d.FieldId.StartsWith("PID-", StringComparison.Ordinal));
    Check("A MED-* field is IsSensitive == true", medField is not null && medField.IsSensitive);
    Check("A PID-* field is IsSensitive == false", pidField is not null && !pidField.IsSensitive);
}

// Single-select field yields non-empty PicklistOptions if any exists with allowedValues
{
    var singleSelectWithValues = defs.FirstOrDefault(
        d => d.DataType == FieldDataType.SingleSelect && !string.IsNullOrWhiteSpace(d.PicklistOptionsRaw));
    if (singleSelectWithValues is null)
    {
        Console.WriteLine("SKIP: no Single-select field with allowedValues found in seed data.");
    }
    else
    {
        Check(
            $"Single-select field {singleSelectWithValues.FieldId} yields non-empty PicklistOptions",
            singleSelectWithValues.PicklistOptions.Count > 0);
    }
}

// FormTemplate.FromAppearsIn("Risk Assessment", defs) yields >20 fields
{
    var form = FormTemplate.FromAppearsIn("Risk Assessment", defs);
    var total = form.Sections.Sum(s => s.FieldIds.Count);
    Check("FormTemplate.FromAppearsIn('Risk Assessment') yields >20 fields", total > 20);
}

// malformed JSON throws InvalidDataException
CheckThrows<InvalidDataException>("Malformed JSON throws InvalidDataException", () =>
{
    DataDictionarySeeder.LoadFromJson("{ not valid json", Guid.NewGuid());
});

// ───────────────────────── Summary ─────────────────────────

Console.WriteLine();
Console.WriteLine($"PASS: {pass}  FAIL: {fail}  TOTAL: {pass + fail}");
if (fail > 0)
{
    Console.WriteLine("Failures:");
    foreach (var f in failures)
        Console.WriteLine($"  - {f}");
}

return fail > 0 ? 1 : 0;
