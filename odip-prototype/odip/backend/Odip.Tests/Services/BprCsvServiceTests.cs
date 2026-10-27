using System.Text;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Services;

/// <summary>
/// Nullability audit (shift-completion design spec, delivery PR 3): BprCsvService's agency-
/// managed filter dereferenced `l.ParticipantBooking.PlanTypeOverride` directly, which NREs for
/// Kind == Shift claim lines now that ParticipantBookingId/ParticipantBooking are nullable. A
/// shift-kind line must be excluded from the BPR CSV (export for shift claims is out of scope
/// for this PR — see the design spec's Open questions), not NRE the whole request.
/// </summary>
public class BprCsvServiceTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static OdipDbContext CreateDb() => TestDb.Create();

    [Fact]
    public async Task GenerateBprCsvAsync_ShiftKindClaim_ExcludesShiftLines_DoesNotThrow()
    {
        using var db = CreateDb();

        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Amy", LastName = "Ng",
            NdisNumber = "43100003333", PlanType = PlanType.AgencyManaged,
        };
        db.Participants.Add(participant);

        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id,
            ServiceDate = new DateOnly(2026, 9, 7), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        };
        db.Shifts.Add(shift);

        var claim = new TripClaim
        {
            Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id,
            PeriodFrom = shift.ServiceDate, PeriodTo = shift.ServiceDate, ClaimReference = "TC-43100003333-20260907",
        };
        db.TripClaims.Add(claim);

        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, ParticipantBookingId = null,
            SupportItemCode = "04_SHIFT", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = shift.ServiceDate, SupportsDeliveredTo = shift.ServiceDate,
            Hours = 8m, UnitPrice = 40m, TotalAmount = 320m,
        });

        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "PR1", ABN = "1",
            OrganisationName = "Org", Address = "1 St", State = "VIC",
        });
        await db.SaveChangesAsync();

        var service = new BprCsvService(db);

        var (bytes, fileName) = await service.GenerateBprCsvAsync(claim.Id, CancellationToken.None);

        var csv = Encoding.UTF8.GetString(bytes);
        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        Assert.Single(lines); // header row only — the shift-kind line was excluded, not NRE'd
        Assert.StartsWith("RegistrationNumber,NDISNumber,", lines[0]);
        Assert.Contains(claim.ClaimReference, fileName);
    }

    [Fact]
    public async Task GenerateBprCsvAsync_AgencyManagedLines_EveryRowHas16FieldsUnderTheRightHeader()
    {
        using var db = CreateDb();
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Amy", LastName = "Ng",
            NdisNumber = "431,\"00", PlanType = PlanType.AgencyManaged,
        };
        var booking = new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = Guid.NewGuid(), ParticipantId = participant.Id,
            BookingStatus = BookingStatus.Confirmed,
        };
        var claim = new TripClaim { Id = Guid.NewGuid(), ParticipantId = participant.Id, ClaimReference = "TC-1", PeriodFrom = new DateOnly(2026, 9, 7), PeriodTo = new DateOnly(2026, 9, 7) };
        db.Participants.Add(participant);
        db.ParticipantBookings.Add(booking);
        db.TripClaims.Add(claim);
        foreach (var (type, reason) in new[] { (ClaimType.Standard, (string?)null), (ClaimType.Cancellation, "late, notice") })
            db.ClaimLineItems.Add(new ClaimLineItem
            {
                Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id,
                SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday,
                SupportsDeliveredFrom = new DateOnly(2026, 9, 7), SupportsDeliveredTo = new DateOnly(2026, 9, 7),
                Hours = 8.5m, UnitPrice = 40m, TotalAmount = 340m, ClaimType = type, CancellationReason = reason,
            });
        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "PR1", ABN = "1",
            OrganisationName = "Org", Address = "1 St", State = "VIC",
        });
        await db.SaveChangesAsync();

        var (bytes, _) = await new BprCsvService(db).GenerateBprCsvAsync(claim.Id, CancellationToken.None);

        var lines = Encoding.UTF8.GetString(bytes).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var header = lines[0].Split(',');
        Assert.Equal(16, header.Length);
        Assert.Equal(3, lines.Length);
        var rows = lines.Skip(1).Select(l => Split(l)).ToList();
        Assert.All(rows, r => Assert.Equal(16, r.Count));
        var byName = rows.Select(r => header.Zip(r).ToDictionary(x => x.First, x => x.Second)).ToList();
        var standard = byName.Single(r => r["ClaimType"] == "");
        var canc = byName.Single(r => r["ClaimType"] == "CANC");
        Assert.Equal("PR1", standard["RegistrationNumber"]);
        Assert.Equal("431,\"00", standard["NDISNumber"]); // comma and quote survive the escaping
        Assert.Equal("04_104_0125_6_1", standard["SupportNumber"]);
        Assert.Equal("008:30", standard["Hours"]);
        Assert.Equal("40.00", standard["UnitPrice"]);
        Assert.Equal("", standard["CancellationReason"]);
        Assert.Equal("late, notice", canc["CancellationReason"]);
        // The three legacy fields and the ABN are blank on every row.
        Assert.All(byName, r =>
        {
            Assert.Equal("", r["AuthorisedBy"]);
            Assert.Equal("", r["ParticipantApproved"]);
            Assert.Equal("", r["InKindFundingProgram"]);
            Assert.Equal("", r["ABNofSupportProvider"]);
        });
        // Pin positions independent of the header line (NDIA spec order).
        Assert.Equal("RegistrationNumber,NDISNumber,SupportsDeliveredFrom,SupportsDeliveredTo,SupportNumber,ClaimReference,Quantity,Hours,UnitPrice,GSTCode,AuthorisedBy,ParticipantApproved,InKindFundingProgram,ClaimType,CancellationReason,ABNofSupportProvider", lines[0]);
        var cancRow = rows.Single(r => r[13] == "CANC");
        Assert.Equal("late, notice", cancRow[14]);
        Assert.Equal("", cancRow[15]);
    }

    [Fact]
    public async Task GenerateBprCsvAsync_AParticipantSwitchedToOtherAfterTheService_StillExportsTheirLine()
    {
        using var db = CreateDb();
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Amy", LastName = "Ng",
            NdisNumber = "431000123", PlanType = PlanType.AgencyManaged, FundingSource = ParticipantFundingSource.Other,
        };
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = Guid.NewGuid(), ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed };
        var claim = new TripClaim { Id = Guid.NewGuid(), ParticipantId = participant.Id, ClaimReference = "TC-1", PeriodFrom = new DateOnly(2026, 9, 7), PeriodTo = new DateOnly(2026, 9, 7) };
        db.Participants.Add(participant);
        db.ParticipantBookings.Add(booking);
        db.TripClaims.Add(claim);
        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id,
            SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 9, 7), SupportsDeliveredTo = new DateOnly(2026, 9, 7),
            Hours = 8m, UnitPrice = 40m, TotalAmount = 320m, ClaimType = ClaimType.Standard,
        });
        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "PR1", ABN = "1",
            OrganisationName = "Org", Address = "1 St", State = "VIC",
        });
        await db.SaveChangesAsync();

        var (bytes, _) = await new BprCsvService(db).GenerateBprCsvAsync(claim.Id, CancellationToken.None);

        var lines = Encoding.UTF8.GetString(bytes).Split((char)10, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        Assert.Equal(2, lines.Length); // the header and the line: a BPR mirrors its claim
    }

    // RFC 4180 split: commas inside quotes stay, doubled quotes unescape.
    private static List<string> Split(string line)
    {
        var fields = new List<string>(); var cur = new StringBuilder(); var q = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (q && c == '"' && i + 1 < line.Length && line[i + 1] == '"') { cur.Append('"'); i++; }
            else if (c == '"') q = !q;
            else if (c == ',' && !q) { fields.Add(cur.ToString()); cur.Clear(); }
            else cur.Append(c);
        }
        fields.Add(cur.ToString());
        return fields;
    }
}
