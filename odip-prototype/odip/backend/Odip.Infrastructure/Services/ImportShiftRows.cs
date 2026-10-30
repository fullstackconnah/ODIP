using System.Globalization;
using System.Text.RegularExpressions;
using Odip.Application.DTOs;

namespace Odip.Infrastructure.Services;

/// <summary>
/// One upcoming-shifts row as read from the file. <see cref="Dates"/> are the days it makes a shift on: the one date of a dated row, or every
/// matching weekday in the pattern's span. Staff and participant cells are kept as written; matching them to people is the service's.
/// </summary>
public sealed record ImportShiftLine(string? NdisKey, string FullName, DateOnly? DateOfBirth, string StaffEmail, string StaffName,
    TimeOnly Start, TimeOnly End, bool EndsNextDay, string? Notes, DayOfWeek? Weekday, List<DateOnly> Dates);

/// <summary>
/// The upcoming-shifts import, file side: a row is read into its shifts' dates and times, with every error naming the field, never the value.
/// Only the file and the clock are used here; the service matches people and runs the roster checks.
/// </summary>
public static class ImportShiftRows
{
    public const int MaxWeeks = 12;
    /// <summary>The last day a dated row may fall on, after today: 12 weeks ahead.</summary>
    public const int DatedHorizonDays = 83;
    /// <summary>How far ahead a pattern may start from.</summary>
    public const int PatternStartDays = 28;

    private static readonly Regex Clock = new(@"^([0-9]{1,2})(?:[:.]([0-9]{2}))?\s*([ap])\.?(?:m\.?)?$|^([0-9]{1,2})[:.]([0-9]{2})$", RegexOptions.IgnoreCase);
    private static readonly string[] DateKeys = ["dateOfBirth", "date"];
    private static readonly Dictionary<string, DayOfWeek> Days = new()
    {
        ["mon"] = DayOfWeek.Monday, ["monday"] = DayOfWeek.Monday, ["tue"] = DayOfWeek.Tuesday, ["tues"] = DayOfWeek.Tuesday, ["tuesday"] = DayOfWeek.Tuesday,
        ["wed"] = DayOfWeek.Wednesday, ["wednesday"] = DayOfWeek.Wednesday, ["thu"] = DayOfWeek.Thursday, ["thur"] = DayOfWeek.Thursday,
        ["thurs"] = DayOfWeek.Thursday, ["thursday"] = DayOfWeek.Thursday, ["fri"] = DayOfWeek.Friday, ["friday"] = DayOfWeek.Friday,
        ["sat"] = DayOfWeek.Saturday, ["saturday"] = DayOfWeek.Saturday, ["sun"] = DayOfWeek.Sunday, ["sunday"] = DayOfWeek.Sunday,
    };

    /// <summary>"9:00 am", "9am", "09:00", "21:00" or an Excel day fraction ("0.375"); the error names the field.</summary>
    public static (TimeOnly? Value, string? Error) Time(string text, string label)
    {
        var error = $"{label} must be a time like 9:00 am or 21:00.";
        if (text.Length == 0) return (null, $"{label} is required.");
        if (text.Contains('.') && decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var fraction) && fraction is >= 0 and < 1)
            return (TimeOnly.FromTimeSpan(TimeSpan.FromMinutes(Math.Round((double)fraction * 1440) % 1440)), null);
        var m = Clock.Match(text.Trim());
        if (!m.Success) return (null, error);
        var meridiem = m.Groups[3].Value.ToLowerInvariant();
        var hour = int.Parse(meridiem.Length > 0 ? m.Groups[1].Value : m.Groups[4].Value, CultureInfo.InvariantCulture);
        var minuteText = meridiem.Length > 0 ? m.Groups[2].Value : m.Groups[5].Value;
        var minute = minuteText.Length > 0 ? int.Parse(minuteText, CultureInfo.InvariantCulture) : 0;
        if (minute > 59) return (null, error);
        if (meridiem.Length > 0)
        {
            if (hour is < 1 or > 12) return (null, error);
            hour = hour % 12 + (meridiem == "p" ? 12 : 0);
        }
        else if (hour > 23) return (null, error);
        return (new TimeOnly(hour, minute), null);
    }

    public static List<ImportRowPlan> Build(ImportTable table, IReadOnlyList<string?> mapping, ImportShiftShape shape, DateOnly today, DateOnly from, int weeks)
    {
        var column = ImportValues.Columns(mapping);
        var monthFirst = ImportValues.MonthFirst(table, column, DateKeys);

        var plans = new List<ImportRowPlan>(table.Rows.Count);
        foreach (var row in table.Rows)
        {
            string Get(string key) => column.TryGetValue(key, out var i) ? table.Cell(row, i).Trim() : "";
            plans.Add(BuildRow(row.RowNumber, Get, monthFirst, shape, today, from, weeks));
        }
        return plans;
    }

    private static ImportRowPlan BuildRow(int rowNumber, Func<string, string> get, Dictionary<string, bool> monthFirst, ImportShiftShape shape,
        DateOnly today, DateOnly from, int weeks)
    {
        var reasons = new List<string>();
        var ndisText = get("ndis");
        var ndis = ImportParticipantRows.NdisKey(ndisText);
        string? ndisKey = null;
        if (ndis.Length > 0)
        {
            if (ImportParticipantRows.IsNdisNumber(ndis)) ndisKey = ndis;
            else reasons.Add("NDIS number must be 9 digits.");
        }
        var name = get("participantName");
        var (dob, dobError) = ImportValues.Date(get("dateOfBirth"), "Date of birth", monthFirst["dateOfBirth"]);
        if (dobError != null) reasons.Add(dobError);
        if (ndis.Length == 0 && dobError is null && (name.Length == 0 || dob is null))
            reasons.Add("Give the NDIS number, or the participant's name and date of birth.");

        var (start, startError) = Time(get("start"), "Start time");
        var (end, endError) = Time(get("end"), "End time");
        if (startError != null) reasons.Add(startError);
        if (endError != null) reasons.Add(endError);

        var dates = new List<DateOnly>();
        DayOfWeek? weekday = null;
        if (shape == ImportShiftShape.Dated)
        {
            var (date, dateError) = ImportValues.Date(get("date"), "Date", monthFirst["date"]);
            if (dateError != null) reasons.Add(dateError);
            else if (date is null) reasons.Add("Date is required.");
            else if (date < today || date > today.AddDays(DatedHorizonDays)) reasons.Add($"Date must be from today up to {Say(today.AddDays(DatedHorizonDays))}.");
            else dates.Add(date.Value);
        }
        else
        {
            if (Days.TryGetValue(ImportFields.Normalise(get("weekday")), out var day))
            {
                weekday = day;
                for (var d = from; d < from.AddDays(weeks * 7); d = d.AddDays(1))
                    if (d.DayOfWeek == day) dates.Add(d);
            }
            else reasons.Add("Weekday must be Mon to Sun.");
        }

        var plan = new ImportRowPlan { RowNumber = rowNumber, Name = name.Length > 0 ? name : ndisText };
        foreach (var reason in reasons) plan.Refuse(reason);
        if (reasons.Count > 0) return plan;
        if (start == end) { plan.Refuse("The shift has no length."); return plan; }
        var endsNextDay = end < start;
        if (endsNextDay) plan.Notes.Add("Ends the next day.");
        var notes = get("notes");
        plan.Shift = new ImportShiftLine(ndisKey, name, dob, get("staffEmail"), get("staffName"), start!.Value, end!.Value, endsNextDay,
            notes.Length > 0 ? notes : null, weekday, dates);
        return plan;
    }

    private static string Say(DateOnly day) => day.ToString("ddd d MMM", CultureInfo.InvariantCulture);
}
