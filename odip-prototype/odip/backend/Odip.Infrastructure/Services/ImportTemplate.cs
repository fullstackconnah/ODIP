using ClosedXML.Excel;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The downloadable ODIP template: the columns in field order with one example row, every column text-formatted so Excel keeps leading zeros and
/// never reformats a date, and a Notes sheet saying what each column takes. Its headers are the field labels, so they always match.
/// </summary>
public static class ImportTemplate
{
    // The URL's word for the kind, so this name and the browser's download name agree.
    public static string FileName(ImportKind kind) => $"odip-{(kind == ImportKind.FundingPlans ? "funding-plans" : kind.ToString().ToLowerInvariant())}-template.xlsx";

    public static byte[] Build(ImportKind kind)
    {
        var fields = ImportFields.For(kind);
        var example = Example(kind);
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add(kind.ToString());
        for (var i = 0; i < fields.Count; i++)
        {
            sheet.Column(i + 1).Style.NumberFormat.Format = "@";
            sheet.Column(i + 1).Width = 24;
            sheet.Cell(1, i + 1).Value = fields[i].Label;
            sheet.Cell(1, i + 1).Style.Font.Bold = true;
            sheet.Cell(2, i + 1).Value = example.GetValueOrDefault(fields[i].Key, "");
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
        notes.Cell(fields.Count + 3, 1).Value = "Delete the example row before you import. Up to 2,000 rows and 5 MB per file.";
        notes.Column(1).Width = 30;
        notes.Column(3).Width = 60;

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
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
