using ClosedXML.Excel;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

public class ImportShiftRowsTests
{
    private static readonly DateOnly Today = new(2026, 10, 26);
    private static readonly DateOnly Next = new(2026, 11, 2);
    private static readonly string[] PatternMapping = ["ndis", "weekday", "start", "end"];
    private static readonly string[] DatedMapping = ["ndis", "date", "start", "end"];

    private static List<ImportRowPlan> Build(ImportShiftShape shape, string[] mapping, DateOnly from, int weeks, params string[][] rows) =>
        ImportShiftRows.Build(new ImportTable(mapping, rows.Select((cells, i) => new ImportRow(i + 2, cells)).ToList()), mapping, shape, Today, from, weeks);

    [Fact]
    public void Pattern_Monday_12Weeks_From2Nov_Makes12Dates_Last18Jan()
    {
        var plan = Build(ImportShiftShape.Pattern, PatternMapping, Next, 12, ["430000001", "Monday", "9:00 am", "3:00 pm"]).Single();
        Assert.Equal(ImportRowStatus.Ready, plan.Status);
        Assert.Equal(12, plan.Shift!.Dates.Count);
        Assert.Equal(Next, plan.Shift.Dates[0]);
        Assert.Equal(new DateOnly(2027, 1, 18), plan.Shift.Dates[^1]);
    }

    [Fact]
    public void Pattern_FromWednesday_IncludesOnlyDatesInSpan()
    {
        var wednesday = new DateOnly(2026, 10, 28);
        var plan = Build(ImportShiftShape.Pattern, PatternMapping, wednesday, 1, ["430000001", "Mon", "9am", "3pm"]).Single();
        // 28 Oct to 3 Nov holds one Monday, 2 Nov.
        Assert.Equal([Next], plan.Shift!.Dates);
    }

    [Fact]
    public void Dated_YesterdayAndDay84_AreInvalid_Today_And_Day83_Ready()
    {
        var plans = Build(ImportShiftShape.Dated, DatedMapping, Next, 1,
            ["430000001", Today.AddDays(-1).ToString("yyyy-MM-dd"), "09:00", "15:00"],
            ["430000001", Today.ToString("yyyy-MM-dd"), "09:00", "15:00"],
            ["430000001", Today.AddDays(83).ToString("yyyy-MM-dd"), "09:00", "15:00"],
            ["430000001", Today.AddDays(84).ToString("yyyy-MM-dd"), "09:00", "15:00"]);
        Assert.Equal([ImportRowStatus.Invalid, ImportRowStatus.Ready, ImportRowStatus.Ready, ImportRowStatus.Invalid], plans.Select(p => p.Status));
    }

    [Theory]
    [InlineData("9:00 am", 9, 0)]
    [InlineData("9am", 9, 0)]
    [InlineData("09:00", 9, 0)]
    [InlineData("21:00", 21, 0)]
    [InlineData("12:30 AM", 0, 30)]
    [InlineData("12:30 pm", 12, 30)]
    [InlineData("0.375", 9, 0)]
    public void Times_ParseAmPmAnd24hAndExcelFraction(string text, int hour, int minute) =>
        Assert.Equal(new TimeOnly(hour, minute), ImportShiftRows.Time(text, "Start time").Value);

    [Fact]
    public void Times_Garbage_NamesTheField() =>
        Assert.Equal("Start time must be a time like 9:00 am or 21:00.", ImportShiftRows.Time("soon", "Start time").Error);

    [Fact]
    public void EndBeforeStart_EndsNextDay_WithNote()
    {
        var plan = Build(ImportShiftShape.Pattern, PatternMapping, Next, 1, ["430000001", "Thu", "10:00 pm", "7:00 am"]).Single();
        Assert.True(plan.Shift!.EndsNextDay);
        Assert.Contains("Ends the next day.", plan.Notes);
    }

    [Fact]
    public void SameStartAndEnd_HasNoLength()
    {
        var plan = Build(ImportShiftShape.Pattern, PatternMapping, Next, 1, ["430000001", "Thu", "9:00", "9:00"]).Single();
        Assert.Equal(ImportRowStatus.Invalid, plan.Status);
        Assert.Contains("The shift has no length.", plan.Reasons);
    }

    [Fact]
    public void Weekday_Number_IsInvalid()
    {
        var plan = Build(ImportShiftShape.Pattern, PatternMapping, Next, 1, ["430000001", "1", "9:00", "15:00"]).Single();
        Assert.Contains("Weekday must be Mon to Sun.", plan.Reasons);
    }

    [Fact]
    public void MappingError_NeitherNdisNorNameDob_SaysWhich()
    {
        string?[] mapping = ["participantName", "weekday", "start", "end"];
        Assert.Equal("Match a column to NDIS number, or to Participant name and Date of birth.",
            ImportFields.MappingError(ImportKind.UpcomingShifts, mapping, 4, requireAll: true, ImportShiftShape.Pattern));
        string?[] withDob = ["participantName", "dateOfBirth", "weekday", "start", "end"];
        Assert.Null(ImportFields.MappingError(ImportKind.UpcomingShifts, withDob, 5, requireAll: true, ImportShiftShape.Pattern));
    }

    [Fact]
    public void AutoMatch_MessyHeaders_MatchD5Fixture()
    {
        string[] headers = ["Client Name", "DOB", "Day of Week", "From", "To", "Support Worker", "Worker Email", "Comments", "NDIS #"];
        Assert.Equal(["participantName", "dateOfBirth", "weekday", "start", "end", "staffName", "staffEmail", "notes", "ndis"],
            ImportFields.AutoMatch(ImportKind.UpcomingShifts, headers, ImportShiftShape.Pattern));
    }

    [Theory]
    [InlineData(ImportShiftShape.Pattern, "Weekday")]
    [InlineData(ImportShiftShape.Dated, "Date")]
    public void Template_BothShapes_HaveNotesSheetAndHeaders(ImportShiftShape shape, string when)
    {
        using var workbook = new XLWorkbook(new MemoryStream(ImportTemplate.Build(ImportKind.UpcomingShifts, shape)));
        Assert.Equal(when, workbook.Worksheet("Shifts").Cell(1, 4).GetString());
        Assert.NotNull(workbook.Worksheet("Notes"));
        Assert.DoesNotContain(workbook.Worksheets.SelectMany(w => w.CellsUsed()), c => c.GetString().Contains("ODIP"));
    }
}
