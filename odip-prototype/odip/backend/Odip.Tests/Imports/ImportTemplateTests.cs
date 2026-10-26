using ClosedXML.Excel;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

public class ImportTemplateTests
{
    [Fact]
    public void The_template_round_trips_its_columns_match_and_its_example_row_is_skipped()
    {
        var table = ImportFileReader.Read(ImportTemplate.Build(ImportKind.Participants), ImportTemplate.FileName(ImportKind.Participants));
        var mapping = ImportFields.AutoMatch(ImportKind.Participants, table.Headers);

        Assert.Equal(ImportFields.For(ImportKind.Participants).Select(f => f.Key), mapping);
        var example = ImportParticipantRows.Build(table, mapping, new DateOnly(2026, 10, 13)).Single();
        Assert.Equal(ImportRowStatus.Skipped, example.Status);
    }

    [Fact]
    public void The_example_values_are_all_valid_once_the_names_are_real()
    {
        var table = ImportFileReader.Read(ImportTemplate.Build(ImportKind.Participants), "t.xlsx");
        var cells = table.Rows.Single().Cells.ToArray();
        cells[0] = "Ava";
        cells[1] = "Stone";
        var renamed = new ImportTable(table.Headers, [new ImportRow(2, cells)]);

        var plan = ImportParticipantRows.Build(renamed, ImportFields.AutoMatch(ImportKind.Participants, table.Headers), new DateOnly(2026, 10, 13)).Single();

        Assert.Equal(ImportRowStatus.Ready, plan.Status);
        Assert.Empty(plan.Warnings);
    }

    [Fact]
    public void The_notes_sheet_says_what_each_column_takes()
    {
        using var workbook = new XLWorkbook(new MemoryStream(ImportTemplate.Build(ImportKind.Participants)));
        var notes = workbook.Worksheet("Notes");
        Assert.Equal(("First name", "Yes", "Required."), (notes.Cell(2, 1).GetString(), notes.Cell(2, 2).GetString(), notes.Cell(2, 3).GetString()));
        Assert.Equal("bunya-support-participants-template.xlsx", ImportTemplate.FileName(ImportKind.Participants));
    }

    [Fact]
    public void The_staff_template_round_trips()
    {
        var table = ImportFileReader.Read(ImportTemplate.Build(ImportKind.Staff), ImportTemplate.FileName(ImportKind.Staff));
        Assert.Equal(ImportFields.For(ImportKind.Staff).Select(f => f.Key), ImportFields.AutoMatch(ImportKind.Staff, table.Headers));
        Assert.Equal("bunya-support-staff-template.xlsx", ImportTemplate.FileName(ImportKind.Staff));
    }
    [Fact]
    public void The_funding_template_round_trips_its_example_row_is_skipped_and_its_name_is_the_url_word()
    {
        var table = ImportFileReader.Read(ImportTemplate.Build(ImportKind.FundingPlans), ImportTemplate.FileName(ImportKind.FundingPlans));
        var mapping = ImportFields.AutoMatch(ImportKind.FundingPlans, table.Headers);

        Assert.Equal(ImportFields.For(ImportKind.FundingPlans).Select(f => f.Key), mapping);
        Assert.Equal(ImportRowStatus.Skipped, ImportFundingRows.Build(table, mapping).Single().Status);
        Assert.Equal("bunya-support-funding-plans-template.xlsx", ImportTemplate.FileName(ImportKind.FundingPlans));
    }

    [Fact]
    public void The_funding_example_values_are_all_valid_once_the_names_are_real()
    {
        var table = ImportFileReader.Read(ImportTemplate.Build(ImportKind.FundingPlans), "t.xlsx");
        var cells = table.Rows.Single().Cells.ToArray();
        cells[1] = "Ava";
        cells[2] = "Stone";
        var plan = ImportFundingRows.Build(new ImportTable(table.Headers, [new ImportRow(2, cells)]), ImportFields.AutoMatch(ImportKind.FundingPlans, table.Headers)).Single();
        Assert.Equal(ImportRowStatus.Ready, plan.Status);
    }
}
