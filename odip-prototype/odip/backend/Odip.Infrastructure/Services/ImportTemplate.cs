using ClosedXML.Excel;
using Odip.Application.DTOs;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The downloadable template: the columns in field order with one example row, every column text-formatted so Excel keeps leading zeros and
/// never reformats a date, and a Notes sheet saying what each column takes. Its headers are the field labels, so they always match.
/// </summary>
public static class ImportTemplate
{
    // The URL's word for the kind, so this name and the browser's download name agree.
    public static string FileName(ImportKind kind, ImportShiftShape? shape = null) => kind == ImportKind.UpcomingShifts
        ? $"bunya-support-upcoming-shifts-{(shape == ImportShiftShape.Dated ? "dated" : "weekly-pattern")}-template.xlsx"
        : $"bunya-support-{(kind == ImportKind.FundingPlans ? "funding-plans" : kind.ToString().ToLowerInvariant())}-template.xlsx";

    public static byte[] Build(ImportKind kind, ImportShiftShape? shape = null)
    {
        var fields = ImportFields.For(kind, shape);
        List<Dictionary<string, string>> examples = kind == ImportKind.UpcomingShifts ? ShiftExamples(shape) : [Example(kind)];
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add(kind == ImportKind.UpcomingShifts ? "Shifts" : kind.ToString());
        for (var i = 0; i < fields.Count; i++)
        {
            sheet.Column(i + 1).Style.NumberFormat.Format = "@";
            sheet.Column(i + 1).Width = 24;
            sheet.Cell(1, i + 1).Value = fields[i].Label;
            sheet.Cell(1, i + 1).Style.Font.Bold = true;
            for (var r = 0; r < examples.Count; r++) sheet.Cell(r + 2, i + 1).Value = examples[r].GetValueOrDefault(fields[i].Key, "");
        }

        var notes = workbook.Worksheets.Add("Notes");
        notes.Cell(1, 1).Value = "Column";
        notes.Cell(1, 2).Value = "Required";
        notes.Cell(1, 3).Value = "What to enter";
        notes.Row(1).Style.Font.Bold = true;
        for (var i = 0; i < fields.Count; i++)
        {
            notes.Cell(i + 2, 1).Value = fields[i].Label;
            notes.Cell(i + 2, 2).Value = fields[i].Required ? "Yes" : "No";
            notes.Cell(i + 2, 3).Value = fields[i].Hint;
        }
        notes.Cell(fields.Count + 3, 1).Value = "Delete the example rows before you import. Up to 2,000 rows and 5 MB per file.";
        if (kind == ImportKind.UpcomingShifts)
        {
            string[] lines =
            [
                "A participant is found by NDIS number, or by name and date of birth.",
                "Staff are found by email, else by full name; blank or not found imports the shift with nobody on it.",
                "An end before the start ends the next day.",
                "Shifts are added as drafts. Nobody is told until you publish the week.",
                shape == ImportShiftShape.Dated ? "Dates from today up to 12 weeks ahead." : "Weekday is Mon to Sun or Monday to Sunday.",
            ];
            for (var i = 0; i < lines.Length; i++) notes.Cell(fields.Count + 5 + i, 1).Value = lines[i];
        }
        notes.Column(1).Width = 30;
        notes.Column(3).Width = 60;

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private static List<Dictionary<string, string>> ShiftExamples(ImportShiftShape? shape)
    {
        Dictionary<string, string> Row(string when, string day, string start, string end, string email, string staff, string notes)
        {
            var row = new Dictionary<string, string>
            {
                ["ndis"] = "430 000 001", ["participantName"] = "Alex Example", ["dateOfBirth"] = "01/02/1990",
                ["start"] = start, ["end"] = end, ["staffEmail"] = email, ["staffName"] = staff, ["notes"] = notes,
            };
            row[shape == ImportShiftShape.Dated ? "date" : "weekday"] = shape == ImportShiftShape.Dated ? when : day;
            return row;
        }
        return
        [
            Row("03/11/2026", "Monday", "9:00 am", "3:00 pm", "sam.example@example.com", "Sam Example", "Community access"),
            Row("05/11/2026", "Thursday", "10:00 pm", "7:00 am", "", "", "Overnight; no staff yet"),
        ];
    }

    private static Dictionary<string, string> Example(ImportKind kind) => kind switch
    {
        ImportKind.Participants => new()
        {
            ["firstName"] = ImportParticipantRows.ExampleFirstName, ["lastName"] = ImportParticipantRows.ExampleLastName,
            ["preferredName"] = "", ["dateOfBirth"] = "03/04/1990", ["gender"] = "Female", ["ndisNumber"] = "430000000",
            ["planType"] = "Self managed", ["planStartDate"] = "01/07/2026", ["planEndDate"] = "30/06/2027",
            ["phone"] = "0400 000 000", ["email"] = "example@example.com", ["addressStreet"] = "1 Example Street", ["addressSuburb"] = "Sydney",
            ["addressState"] = "NSW", ["addressPostcode"] = "2000", ["contact1Name"] = "Sam Example", ["contact1Relationship"] = "Next of kin",
            ["contact1Phone"] = "0400 000 001",
        },
        ImportKind.Staff => new()
        {
            ["firstName"] = ImportParticipantRows.ExampleFirstName, ["lastName"] = ImportParticipantRows.ExampleLastName,
            ["email"] = "example@example.com", ["mobile"] = "0400 000 000", ["role"] = "Support worker", ["position"] = "Support worker",
            ["region"] = "Sydney", ["driversLicence"] = "Yes", ["driversLicenceExpiry"] = "30/06/2027", ["firstAid"] = "Yes",
            ["firstAidExpiry"] = "30/06/2027", ["medication"] = "No", ["manualHandling"] = "Yes", ["manualHandlingExpiry"] = "30/06/2027",
            ["overnight"] = "No", ["workerScreeningNumber"] = "1234567A", ["workerScreeningExpiry"] = "30/06/2030",
        },
        ImportKind.FundingPlans => new()
        {
            ["ndisNumber"] = "430000000", ["firstName"] = ImportParticipantRows.ExampleFirstName, ["lastName"] = ImportParticipantRows.ExampleLastName,
            ["dateOfBirth"] = "03/04/1990", ["planStart"] = "01/07/2026", ["planEnd"] = "30/06/2027", ["category"] = "Core",
            ["management"] = "Plan managed", ["amount"] = "45000.00",
        },
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };
}
