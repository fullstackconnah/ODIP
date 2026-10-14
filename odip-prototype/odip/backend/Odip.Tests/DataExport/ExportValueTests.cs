using System.Globalization;
using Odip.Domain.Enums;
using Odip.Infrastructure.DataExport;
using Xunit;

namespace Odip.Tests.DataExport;

public class ExportValueTests
{
    private static readonly DateTime FourOhFour = new(2026, 10, 14, 4, 4, 0, DateTimeKind.Unspecified);

    [Fact]
    public void An_instant_is_utc_with_a_trailing_z_whatever_kind_it_was_read_back_with()
    {
        Assert.Equal("2026-10-14T04:04:00Z", ExportValue.Cell(FourOhFour, wallClock: false));
        Assert.Equal("2026-10-14T04:04:00Z", ExportValue.Cell(DateTime.SpecifyKind(FourOhFour, DateTimeKind.Utc), wallClock: false));
        Assert.Equal("2026-10-14T04:04:00Z", ExportValue.Cell(DateTime.SpecifyKind(FourOhFour, DateTimeKind.Utc).ToLocalTime(), wallClock: false));
        Assert.Equal("2026-10-14T04:04:00.25Z", ExportValue.Cell(FourOhFour.AddMilliseconds(250), wallClock: false));
        Assert.Equal("2026-10-14T04:04:00Z", ExportValue.Cell(new DateTimeOffset(2026, 10, 14, 15, 4, 0, TimeSpan.FromHours(11)), wallClock: false));
    }

    [Fact]
    public void A_wall_clock_value_keeps_its_digits_and_has_no_zone()
    {
        Assert.Equal("2026-10-03T08:00:00", ExportValue.Cell(new DateTime(2026, 10, 3, 8, 0, 0, DateTimeKind.Unspecified), wallClock: true));
        Assert.Equal("2026-10-03T08:00:00", ExportValue.Cell(new DateTime(2026, 10, 3, 8, 0, 0, DateTimeKind.Utc), wallClock: true));
    }

    [Fact]
    public void Dates_times_numbers_enums_and_lists_have_one_fixed_form_in_any_culture()
    {
        var before = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = new CultureInfo("de-DE"); // decimal comma, dot thousands: none of it may leak into the file
        try
        {
            Assert.Equal("", ExportValue.Cell(null, false));
            Assert.Equal("2026-10-05", ExportValue.Cell(new DateOnly(2026, 10, 5), false));
            Assert.Equal("19:30:00", ExportValue.Cell(new TimeOnly(19, 30), false));
            Assert.Equal("-12.50", ExportValue.Cell(-12.50m, false));
            Assert.Equal("1234567.5", ExportValue.Cell(1234567.5m, false));
            Assert.Equal("42", ExportValue.Cell(42, false));
            Assert.Equal("true", ExportValue.Cell(true, false));
            Assert.Equal("Updated", ExportValue.Cell(AuditAction.Updated, false));
            Assert.Equal("6f9619ff-8b86-d011-b42d-00cf4fc964ff", ExportValue.Cell(Guid.Parse("6F9619FF-8B86-D011-B42D-00CF4FC964FF"), false));
            Assert.Equal("\"[\"\"Asthma\"\",\"\"Café allergy\"\"]\"", ExportValue.Cell(new List<string> { "Asthma", "Café allergy" }, false));
            Assert.Equal("'=1+1", ExportValue.Cell("=1+1", false));
        }
        finally
        {
            CultureInfo.CurrentCulture = before;
        }
    }

    [Fact]
    public void A_type_with_no_format_is_refused_rather_than_written_as_its_type_name() =>
        Assert.Throws<NotSupportedException>(() => ExportValue.Cell(new object(), false));
}
