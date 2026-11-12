using System.Text.RegularExpressions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Claims.InvoiceKit;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;

namespace Odip.Tests.Claims;

/// <summary>Start and finish times on invoice lines: stamped at issue from the window the claim was priced from, never for per-item, trip or manual lines, copied onto a credit note, and printed under the line's date.</summary>
[Collection(InvoicePdfs.Name)]
public class InvoiceLineTimesTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Day = new(2026, 10, 2);
    private static readonly TimeZoneInfo Sydney = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");
    private const string Hours = "04_104_0125_6_1";

    private static DateTime Utc(int h, int m, int dayOffset = 0) => TimeZoneInfo.ConvertTimeToUtc(Day.AddDays(dayOffset).ToDateTime(new TimeOnly(h, m)), Sydney);

    private static (InvoiceKit Kit, Participant Person) Org()
    {
        var kit = InvoiceKit.Create();
        kit.Settings();
        return (kit, kit.Person("Sam", "Lee", PlanType.SelfManaged));
    }

    private static Shift AddShift(InvoiceKit kit, Participant p, int startHour, int endHour, bool endsNextDay = false, SleepoverType night = SleepoverType.None)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id, ServiceDate = Day, StartTime = new TimeOnly(startHour, 0), EndTime = new TimeOnly(endHour, 0),
            EndsNextDay = endsNextDay, Ratio = SupportRatio.OneToOne, NightType = night, Status = ShiftStatus.Completed,
        };
        kit.Db.Shifts.Add(shift);
        kit.Db.SaveChanges();
        return shift;
    }

    private static void Complete(InvoiceKit kit, Shift shift, (int H, int M) start, (int H, int M) end, bool active = true, int endDayOffset = 0)
    {
        kit.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = shift.TenantId, ShiftId = shift.Id, ActualStart = Utc(start.H, start.M), ActualEnd = Utc(end.H, end.M, endDayOffset),
            VarianceMinutesStart = 0, VarianceMinutesEnd = 0, ExtraTime = ExtraTimeDecision.Approved, TimeZoneId = "Australia/Sydney", SubmittedByUserId = Guid.NewGuid(), StartedAt = Utc(start.H, start.M), IsActive = active,
        });
        kit.Db.SaveChanges();
    }

    private static void Each(InvoiceKit kit, string code)
    {
        kit.Db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = Guid.NewGuid(), ItemNumber = code, Description = code, Unit = "E", DayType = ClaimDayType.Weekday,
            CatalogueVersion = "2026-27", EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
        });
        kit.Db.SaveChanges();
    }

    /// <summary>A submitted claim of the given kind with one $100 line each: the shift (null: none), the item code and the shift part.</summary>
    private static TripClaim Claim(InvoiceKit kit, Participant p, ClaimKind kind, params (Guid? ShiftId, string Code, int Part)[] lines)
    {
        var claim = new TripClaim
        {
            TenantId = p.TenantId, Id = Guid.NewGuid(), Kind = kind, ParticipantId = p.Id, PeriodFrom = new DateOnly(2026, 10, 1), PeriodTo = new DateOnly(2026, 10, 14),
            Status = TripClaimStatus.Submitted, ClaimReference = $"TC-{Random.Shared.Next(10_000_000, 99_999_999)}", TotalAmount = 100m * lines.Length,
        };
        kit.Db.TripClaims.Add(claim);
        foreach (var (shiftId, code, part) in lines)
            kit.Db.ClaimLineItems.Add(new ClaimLineItem
            {
                TenantId = p.TenantId, Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shiftId, ShiftPart = part, SupportItemCode = code, DayType = ClaimDayType.Weekday,
                SupportsDeliveredFrom = Day, SupportsDeliveredTo = Day, Hours = 1m, UnitPrice = 100m, TotalAmount = 100m, GSTCode = GSTCode.P2,
            });
        kit.Db.SaveChanges();
        return claim;
    }

    private static async Task<Invoice> Issue(InvoiceKit kit, TripClaim claim) =>
        Assert.Single(await kit.Service.IssueForSubmitAsync(claim.Id, Now.UtcDateTime, null, Ct));

    private static (TimeOnly?, TimeOnly?) Times(InvoiceLine l) => (l.ServiceStartTime, l.ServiceEndTime);

    [Fact]
    public async Task AnHoursLineOfAShiftWithAFinishedCompletion_GetsTheWorkedTimes()
    {
        var (kit, p) = Org();
        var shift = AddShift(kit, p, 9, 17);
        Complete(kit, shift, (8, 40), (17, 20));

        var invoice = await Issue(kit, Claim(kit, p, ClaimKind.Shift, (shift.Id, Hours, 0)));

        var line = Assert.Single(invoice.Lines);
        Assert.Equal(new TimeOnly(8, 40), line.ServiceStartTime);
        Assert.Equal(new TimeOnly(17, 20), line.ServiceEndTime);
    }

    [Theory]
    [InlineData(false)]   // no completion at all
    [InlineData(true)]    // a completion that was deactivated (its times must not be used)
    public async Task AnHoursLineOfAShiftWithNoUsableCompletion_GetsTheRosteredTimes(bool deactivatedCompletion)
    {
        var (kit, p) = Org();
        var shift = AddShift(kit, p, 9, 15);
        if (deactivatedCompletion) Complete(kit, shift, (8, 0), (16, 30), active: false);

        var invoice = await Issue(kit, Claim(kit, p, ClaimKind.Shift, (shift.Id, Hours, 0)));

        Assert.Equal((new TimeOnly(9, 0), new TimeOnly(15, 0)), Times(Assert.Single(invoice.Lines)));
    }

    [Fact]
    public async Task ASleepoverShift_HoursLineGetsTheRosteredTimes_AndItsEachLineGetsNone()
    {
        var (kit, p) = Org();
        Each(kit, "01_SLEEP");
        var shift = AddShift(kit, p, 22, 7, endsNextDay: true, night: SleepoverType.Sleepover);
        Complete(kit, shift, (21, 30), (8, 15), endDayOffset: 1);   // a sleepover is always claimed rostered

        var invoice = await Issue(kit, Claim(kit, p, ClaimKind.Shift, (shift.Id, Hours, 0), (shift.Id, "01_SLEEP", 0)));

        Assert.Equal((new TimeOnly(22, 0), new TimeOnly(7, 0)), Times(invoice.Lines.Single(l => l.SupportItemCode == Hours)));
        Assert.Equal((null, null), Times(invoice.Lines.Single(l => l.SupportItemCode == "01_SLEEP")));
    }

    [Fact]
    public async Task AnOvernightShift_KeepsItsRealStartAndFinish()
    {
        var (kit, p) = Org();
        var shift = AddShift(kit, p, 22, 7, endsNextDay: true);
        Complete(kit, shift, (22, 10), (7, 5), endDayOffset: 1);

        var line = Assert.Single((await Issue(kit, Claim(kit, p, ClaimKind.Shift, (shift.Id, Hours, 0)))).Lines);

        Assert.Equal((new TimeOnly(22, 10), new TimeOnly(7, 5)), Times(line));
        Assert.True(line.ServiceEndTime < line.ServiceStartTime);
    }

    [Fact]
    public async Task AKilometreLineOfAShift_GetsNoTimes_WhileItsHoursLineDoes()
    {
        var (kit, p) = Org();
        Each(kit, "02_KM");
        var shift = AddShift(kit, p, 9, 15);

        var invoice = await Issue(kit, Claim(kit, p, ClaimKind.Shift, (shift.Id, Hours, 0), (shift.Id, "02_KM", 0)));

        Assert.Equal((null, null), Times(invoice.Lines.Single(l => l.SupportItemCode == "02_KM")));
        Assert.Equal((new TimeOnly(9, 0), new TimeOnly(15, 0)), Times(invoice.Lines.Single(l => l.SupportItemCode == Hours)));
    }

    [Fact]
    public async Task TripLines_GetNoTimes()
    {
        var kit = InvoiceKit.Create();
        kit.Settings();
        var trip = kit.Trip();
        var claim = kit.TripClaim(trip, TripClaimStatus.Submitted, kit.Book(trip, kit.Person("Jane", "Doe", PlanType.SelfManaged)));

        var invoice = await Issue(kit, claim);

        Assert.All(invoice.Lines, l => Assert.Equal((null, null), Times(l)));
    }

    [Fact]
    public async Task ManualLines_GetNoTimes()
    {
        var (kit, p) = Org();

        var invoice = await Issue(kit, Claim(kit, p, ClaimKind.Manual, (null, Hours, 0)));

        Assert.Equal((null, null), Times(Assert.Single(invoice.Lines)));
    }

    [Fact]
    public async Task AShiftNotFound_LeavesTheLineBlank_AndTheInvoiceStillIssues()
    {
        var (kit, p) = Org();
        var own = AddShift(kit, p, 9, 15);

        var invoice = await Issue(kit, Claim(kit, p, ClaimKind.Shift, (Guid.NewGuid(), Hours, 0), (own.Id, "04_104_0125_6_1", 1)));

        Assert.Equal(2, invoice.Lines.Count);
        Assert.Equal(1, invoice.Lines.Count(l => l.ServiceStartTime == null && l.ServiceEndTime == null));
        Assert.Equal(1, invoice.Lines.Count(l => l.ServiceStartTime == new TimeOnly(9, 0) && l.ServiceEndTime == new TimeOnly(15, 0)));   // the control: found shifts still get times
    }

    [Fact]
    public async Task AnInvoiceNeverTakesTimesFromAnotherOrganisationsShift()
    {
        var name = Guid.NewGuid().ToString();
        var seed = InvoiceKit.Create(noTenant: true, superAdmin: true, database: name);
        seed.Settings(TenantA);
        seed.Settings(TenantB);
        var other = seed.Person("Ann", "Ay", PlanType.SelfManaged, TenantA);
        var theirs = AddShift(seed, other, 9, 15);
        var mine = seed.Person("Ben", "Bee", PlanType.SelfManaged, TenantB);
        var own = AddShift(seed, mine, 10, 14);
        var claim = Claim(seed, mine, ClaimKind.Shift, (theirs.Id, Hours, 0), (own.Id, Hours, 1));

        // A SuperAdmin with no organisation in scope passes the global query filter, so only the explicit guard keeps the other organisation out.
        var invoice = await Issue(InvoiceKit.Create(noTenant: true, superAdmin: true, database: name), claim);

        Assert.Equal(TenantB, invoice.TenantId);
        Assert.Equal(1, invoice.Lines.Count(l => l.ServiceStartTime == null && l.ServiceEndTime == null));
        Assert.Equal(1, invoice.Lines.Count(l => Times(l) == (new TimeOnly(10, 0), new TimeOnly(14, 0))));
    }

    [Fact]
    public async Task AShiftSplitIntoTwoPricedLines_GivesBothTheSameTimes_AndKeepsTheTotals()
    {
        var (kit, p) = Org();
        var shift = AddShift(kit, p, 14, 22);

        var invoice = await Issue(kit, Claim(kit, p, ClaimKind.Shift, (shift.Id, Hours, 0), (shift.Id, Hours, 1)));

        Assert.Equal(2, invoice.Lines.Count);
        Assert.All(invoice.Lines, l => Assert.Equal((new TimeOnly(14, 0), new TimeOnly(22, 0)), Times(l)));
        Assert.Equal((200m, 200m), (invoice.Subtotal, invoice.Total));
    }

    [Fact]
    public async Task NoLineEverHasExactlyOneOfTheTwoTimes()
    {
        var (kit, p) = Org();
        Each(kit, "02_KM");
        var worked = AddShift(kit, p, 9, 17);
        Complete(kit, worked, (8, 40), (17, 20));
        var rostered = AddShift(kit, p, 9, 15);
        var night = AddShift(kit, p, 22, 7, endsNextDay: true);
        Complete(kit, night, (22, 10), (7, 5), endDayOffset: 1);

        var invoice = await Issue(kit, Claim(kit, p, ClaimKind.Shift,
            (worked.Id, Hours, 0), (rostered.Id, Hours, 0), (night.Id, Hours, 0), (worked.Id, "02_KM", 0), (Guid.NewGuid(), Hours, 0), (null, Hours, 0)));

        Assert.All(invoice.Lines, l => Assert.Equal(l.ServiceStartTime == null, l.ServiceEndTime == null));
        Assert.Equal(3, invoice.Lines.Count(l => l.ServiceStartTime != null));
        Assert.Equal(3, invoice.Lines.Count(l => l.ServiceStartTime == null));
    }

    [Fact]
    public async Task ACreditNote_CopiesTheTimesOfTheLinesItCredits()
    {
        var (kit, p) = Org();
        Each(kit, "02_KM");
        var shift = AddShift(kit, p, 9, 15);
        var original = await Issue(kit, Claim(kit, p, ClaimKind.Shift, (shift.Id, Hours, 0), (shift.Id, "02_KM", 0)));
        await kit.Db.SaveChangesAsync();

        var credit = await kit.Service.CreditAsync(original, Now.UtcDateTime, null, Ct);

        Assert.Equal((new TimeOnly(9, 0), new TimeOnly(15, 0)), Times(credit.Lines.Single(l => l.SupportItemCode == Hours)));
        Assert.Equal((null, null), Times(credit.Lines.Single(l => l.SupportItemCode == "02_KM")));
    }

    [Fact]
    public async Task TheDraftPreviewPdf_ShowsTheShiftTimes()
    {
        var (kit, p) = Org();
        var shift = AddShift(kit, p, 9, 15);
        var claim = Claim(kit, p, ClaimKind.Shift, (shift.Id, Hours, 0));

        var (pdf, _) = await kit.Service.PreviewAsync(claim.Id, p.Id);

        Assert.Contains("9:00 am – 3:00 pm", RawTextOf(pdf));
    }

    [Fact]
    public async Task TheLegacyPdf_ShowsNoTimes()
    {
        var (kit, p) = Org();
        var shift = AddShift(kit, p, 9, 15);
        var claim = Claim(kit, p, ClaimKind.Shift, (shift.Id, Hours, 0));

        var (pdf, _) = await kit.Service.GenerateInvoiceAsync(claim.Id, p.Id);

        Assert.DoesNotMatch(new Regex(@"\d{1,2}:\d{2}\s*(am|pm)"), RawTextOf(pdf));
    }
}
