using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

public class ImportValuesTests
{
    [Theory]
    [InlineData("03/04/1990")]
    [InlineData("3/4/1990")]
    [InlineData("1990-04-03")]
    [InlineData("1990-4-3")]
    public void Date_reads_day_first_and_iso(string text) =>
        Assert.Equal(((DateOnly?)new DateOnly(1990, 4, 3), (string?)null), ImportValues.Date(text, "Date of birth", columnIsMonthFirst: false));

    [Fact]
    public void Date_of_an_empty_cell_is_empty() => Assert.Equal(((DateOnly?)null, (string?)null), ImportValues.Date("", "Date of birth", false));

    [Fact]
    public void A_month_first_value_marks_its_column_and_the_column_refuses_every_slash_date()
    {
        Assert.True(ImportValues.LooksMonthFirst("04/23/1990"));
        Assert.False(ImportValues.LooksMonthFirst("03/04/1990"));
        Assert.False(ImportValues.LooksMonthFirst("1990-04-23"));
        const string refusal = "Date of birth: this column has month-first dates (mm/dd/yyyy), so this date can't be read safely. Use dd/mm/yyyy or yyyy-mm-dd.";
        Assert.Equal(refusal, ImportValues.Date("03/04/1990", "Date of birth", columnIsMonthFirst: true).Error);
        Assert.Equal(refusal, ImportValues.Date("04/23/1990", "Date of birth", columnIsMonthFirst: true).Error);
        Assert.Null(ImportValues.Date("1990-04-03", "Date of birth", columnIsMonthFirst: true).Error);
    }

    [Theory]
    [InlineData("3/4/90", "Date of birth needs a four-digit year (dd/mm/yyyy).")]
    [InlineData("31/02/1990", "Date of birth isn't a real date.")]
    [InlineData("1990-02-31", "Date of birth isn't a real date.")]
    [InlineData("March 3 1990", "Date of birth must be a date as dd/mm/yyyy or yyyy-mm-dd.")]
    [InlineData("03-04-1990", "Date of birth must be a date as dd/mm/yyyy or yyyy-mm-dd.")]
    public void Date_refuses_short_years_impossible_dates_and_other_shapes(string text, string error) =>
        Assert.Equal(error, ImportValues.Date(text, "Date of birth", false).Error);

    [Theory]
    [InlineData("Yes", true)] [InlineData("y", true)] [InlineData("TRUE", true)] [InlineData("1", true)]
    [InlineData("no", false)] [InlineData("N", false)] [InlineData("false", false)] [InlineData("0", false)]
    public void YesNo_accepts_the_listed_words_in_any_case(string text, bool expected) =>
        Assert.Equal(((bool?)expected, (string?)null), ImportValues.YesNo(text, "First aid"));

    [Fact]
    public void YesNo_leaves_an_empty_cell_empty_and_refuses_anything_else()
    {
        Assert.Equal(((bool?)null, (string?)null), ImportValues.YesNo("", "First aid"));
        Assert.Equal("First aid must be yes or no.", ImportValues.YesNo("maybe", "First aid").Error);
    }

    [Fact]
    public void AnnotationErrors_word_the_DTO_rules_with_the_field_label()
    {
        var dto = new CreateParticipantDto { FirstName = new string('a', 101), LastName = "Stone", NdisNumber = new string('1', 21) };
        var labels = new Dictionary<string, string> { ["FirstName"] = "First name", ["LastName"] = "Last name", ["NdisNumber"] = "NDIS number" };
        Assert.Equal(new[] { "First name is longer than 100 characters.", "NDIS number is longer than 20 characters." },
            ImportValues.AnnotationErrors(dto, labels).OrderBy(e => e));
    }

    [Theory]
    [InlineData("Self managed", PlanType.SelfManaged)]
    [InlineData("self-managed", PlanType.SelfManaged)]
    [InlineData("PLAN MANAGED", PlanType.PlanManaged)]
    [InlineData("Plan-managed", PlanType.PlanManaged)]
    [InlineData("NDIA managed", PlanType.AgencyManaged)]
    [InlineData("Agency", PlanType.AgencyManaged)]
    public void Plan_management_reads_the_words_other_platforms_use(string text, PlanType expected) =>
        Assert.Equal(((PlanType?)expected, (string?)null), ImportValues.PlanManagement(text, "Plan type"));

    [Fact]
    public void Plan_management_is_null_when_blank_and_named_when_unknown()
    {
        Assert.Equal(((PlanType?)null, (string?)null), ImportValues.PlanManagement("", "Plan type"));
        Assert.Equal("Managed by must be Self managed, Plan managed or NDIA managed.", ImportValues.PlanManagement("Family", "Managed by").Error);
    }
}
