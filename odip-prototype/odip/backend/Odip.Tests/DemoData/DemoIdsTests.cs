using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// Demo row ids are name-based, so a top-up run can tell "already inserted" from "missing" without any marker table.
/// The expected ids below were computed independently of the C# (Python: SHA-256 of "odip-demo/v1/{kind}/{key}", first 16 bytes,
/// version nibble 8, RFC 4122 variant, little-endian Guid layout), so a change to the algorithm cannot pass by agreeing with itself.
/// </summary>
public class DemoIdsTests
{
    [Fact]
    public void For_MatchesIndependentlyComputedValues()
    {
        Assert.Equal(Guid.Parse("dfae913c-8dac-83e6-9044-3a3b3202631a"), DemoIds.For("shift-pattern", "james-liam-tue"));
        Assert.Equal(Guid.Parse("524f89cc-cce8-810d-a8d7-a1a866dc1043"), DemoIds.For("shift", "story", "S03a", new DateOnly(2026, 10, 5)));
        Assert.Equal(Guid.Parse("ae6dc16d-4a25-8a78-a23c-b2f3078773f7"), DemoIds.For("provider-settings"));
    }

    [Fact]
    public void For_SetsTheVersionAndVariantBits_ForEveryKey()
    {
        for (var i = 0; i < 500; i++)
        {
            var text = DemoIds.For("probe", i).ToString("D");
            Assert.Equal('8', text[14]);              // first hex digit of the third group: version 8 (custom, name-based)
            Assert.Contains(text[19], "89ab");        // first hex digit of the fourth group: RFC 4122 variant
        }
    }

    [Fact]
    public void For_DiffersByKindAndByEveryKeyPart_AndIsStableAcrossCalls()
    {
        var a = DemoIds.For("shift", "a", "b");
        Assert.Equal(a, DemoIds.For("shift", "a", "b"));
        Assert.NotEqual(a, DemoIds.For("shift-pattern", "a", "b"));
        Assert.NotEqual(a, DemoIds.For("shift", "a", "c"));
        Assert.NotEqual(a, DemoIds.For("shift", "a"));
        Assert.NotEqual(DemoIds.For("shift", "a", "b"), DemoIds.For("shift", "b", "a"));
    }

    [Fact]
    public void For_FormatsDatesAndGuidsTheSameWhatever_TheCurrentCulture()
    {
        var date = new DateOnly(2026, 10, 5);
        var guid = Guid.Parse("11111111-2222-3333-4444-555555555555");
        var original = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            // The deploy image's test run uses invariant globalization, where only the invariant culture exists: there the check runs
            // under the current culture, which is all that can differ.
            try { System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("ar-SA"); }
            catch (System.Globalization.CultureNotFoundException) { }

            Assert.Equal(DemoIds.For("x", "2026-10-05"), DemoIds.For("x", date));
            Assert.Equal(DemoIds.For("x", "11111111222233334444555555555555"), DemoIds.For("x", guid));
        }
        finally
        {
            System.Globalization.CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public void Pick_IsDeterministic_InRange_AndVariesWithTheSalt()
    {
        var id = DemoIds.For("shift", "x");
        Assert.Equal(DemoIds.Pick(id, "variance", -5, 25), DemoIds.Pick(id, "variance", -5, 25));

        var seen = new HashSet<int>();
        for (var i = 0; i < 400; i++)
        {
            var value = DemoIds.Pick(DemoIds.For("shift", i), "variance", -5, 25);
            Assert.InRange(value, -5, 25);
            seen.Add(value);
        }
        Assert.True(seen.Count >= 25, $"expected the picks to spread over the range, saw {seen.Count} distinct values");
        Assert.Equal(7, DemoIds.Pick(id, "anything", 7, 7));
    }
}
