using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>The NDIA bulk-claim file writer: pure, so the format is pinned without a database.</summary>
public class BprWriterTests
{
    private static BprRowOut Row(decimal? hours = 2.5m, decimal? quantity = null, string claimType = "", string reason = "", string support = "04_104_0125_6_1", string reference = "0123456789abcdef0123A1", decimal price = 193.99m) =>
        new("PR1", "430000001", new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 8), support, reference, quantity, hours, price, "P2", claimType, reason, "");

    private static string[][] Fields(byte[] file) =>
        Encoding.UTF8.GetString(file).Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Select(l => l.Split(',')).ToArray();

    [Theory]
    [InlineData("2.5", "2:30")]
    [InlineData("10", "10:00")]
    [InlineData("0.25", "0:15")]
    [InlineData("8.5", "8:30")]
    public void Hours_are_written_H_MM_without_padding(string hours, string expected) =>
        Assert.Equal(expected, Fields(BprCsvService.Write([Row(decimal.Parse(hours, CultureInfo.InvariantCulture))]))[1][7]);

    [Fact]
    public void One_minute_is_written_0_01() => Assert.Equal("0:01", BprCsvService.FormatHours(1m / 60m));

    [Fact]
    public void Hour_unit_fills_Hours_and_leaves_Quantity_blank()
    {
        var f = Fields(BprCsvService.Write([Row(hours: 2.5m)]))[1];
        Assert.Equal("", f[6]);
        Assert.Equal("2:30", f[7]);
    }

    [Fact]
    public void Each_unit_fills_Quantity_and_leaves_Hours_blank()
    {
        var f = Fields(BprCsvService.Write([Row(hours: null, quantity: 3m)]))[1];
        Assert.Equal("3", f[6]);
        Assert.Equal("", f[7]);
    }

    [Fact]
    public void Row_reference_is_20_hex_A_attempt()
    {
        var id = Guid.Parse("3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8");
        var first = BprCsvService.RowReference(id, 1);
        Assert.Matches(new Regex("^[0-9a-f]{20}A1$"), first);
        Assert.EndsWith("A2", BprCsvService.RowReference(id, 2));
        Assert.True(first.Length <= 50);
    }

    [Fact]
    public void Cancellation_writes_CANC_and_the_reason_code()
    {
        var f = Fields(BprCsvService.Write([Row(claimType: "CANC", reason: "NSDH")]))[1];
        Assert.Equal("CANC", f[13]);
        Assert.Equal("NSDH", f[14]);
    }

    [Fact]
    public void Cancellation_with_a_CA_item_uses_it_and_leaves_ClaimType_blank()
    {
        var item = new SupportCatalogueItem { ItemNumber = "04_104_0125_6_1", Unit = "H" };
        var ca = new SupportCatalogueItem { ItemNumber = "04_104_0125_6_1_CA", Unit = "H" };
        var line = new ClaimLineItem { Id = Guid.NewGuid(), SupportItemCode = "04_104_0125_6_1", ClaimType = ClaimType.Cancellation, CancellationReason = " nsdh ", Hours = 2m, UnitPrice = 50m, GSTCode = GSTCode.P2 };
        var row = new BprRow(line, new TripClaim(), new Participant { NdisNumber = "430000001" }, PlanType.AgencyManaged, item, ca, "VIC", new ProviderSettings { RegistrationNumber = "PR1" });

        var f = Fields(BprCsvService.Write([BprCsvService.ToOut(row, 1)]))[1];

        Assert.Equal("04_104_0125_6_1_CA", f[4]);
        Assert.Equal("", f[13]);
        Assert.Equal("NSDH", f[14]);
    }

    [Fact]
    public void Lines_end_with_CRLF()
    {
        var text = Encoding.UTF8.GetString(BprCsvService.Write([Row(), Row()]));
        Assert.EndsWith("\r\n", text);
        Assert.Equal(3, Regex.Matches(text, "\r\n").Count);
        Assert.DoesNotMatch(new Regex("(?<!\r)\n"), text);
    }

    [Fact]
    public void UnitPrice_is_invariant_under_de_DE()
    {
        var before = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");
            Assert.Equal("193.99", Fields(BprCsvService.Write([Row()]))[1][8]);
            Assert.Equal("0.5", Fields(BprCsvService.Write([Row(hours: null, quantity: 0.5m)]))[1][6]);
        }
        finally { CultureInfo.CurrentCulture = before; }
    }

    [Fact]
    public void Header_is_the_first_row_and_has_16_columns()
    {
        var text = Encoding.UTF8.GetString(BprCsvService.Write([]));
        Assert.Equal(BprCsvService.Header + "\r\n", text);
        Assert.Equal(16, BprCsvService.Header.Split(',').Length);
    }

    [Fact]
    public void Writer_never_reads_funding()
    {
        var line = new ClaimLineItem { Id = Guid.NewGuid(), SupportItemCode = "04_104_0125_6_1", Hours = 1m, UnitPrice = 10m };
        var other = new Participant { NdisNumber = "430000001", FundingSource = ParticipantFundingSource.Other };
        var row = new BprRow(line, new TripClaim(), other, PlanType.AgencyManaged, null, null, "VIC", new ProviderSettings { RegistrationNumber = "PR1" });
        Assert.Equal(2, Fields(BprCsvService.Write([BprCsvService.ToOut(row, 1)])).Length);
    }
}
