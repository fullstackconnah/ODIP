using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Catalogue.CatalogueImportTestSupport;

namespace Odip.Tests.Catalogue;

/// <summary>
/// The catalogue endpoints (phase A item 3): the importer routes keep their Admin / SuperAdmin gate, answer a refusal with the importer's own
/// explanation, and the rows the preview sends are exactly what the confirm step posts back, through the same JSON options the API uses.
/// </summary>
public class SupportCatalogueControllerTests
{
    private static IFormFile FormFile(string fixture, string? fileName = null)
    {
        var bytes = File.ReadAllBytes(CatalogueFixtures.PathOf(fixture));
        var file = new Mock<IFormFile>();
        file.Setup(f => f.Length).Returns(bytes.Length);
        file.Setup(f => f.FileName).Returns(fileName ?? fixture);
        file.Setup(f => f.OpenReadStream()).Returns(() => new MemoryStream(bytes));
        return file.Object;
    }

    private static T Body<T>(ActionResult<ApiResponse<T>> result, Type expectedResultType) where T : notnull
    {
        Assert.IsType(expectedResultType, result.Result);
        return Assert.IsType<ApiResponse<T>>(((ObjectResult)result.Result!).Value).Data!;
    }

    [Fact]
    public void Both_import_routes_are_still_Admin_or_SuperAdmin_only_and_the_controller_requires_a_signed_in_user()
    {
        Assert.NotNull(typeof(SupportCatalogueController).GetCustomAttribute<AuthorizeAttribute>());
        foreach (var action in new[] { nameof(SupportCatalogueController.PreviewImport), nameof(SupportCatalogueController.ConfirmImport) })
        {
            var authorize = typeof(SupportCatalogueController).GetMethod(action)!.GetCustomAttribute<AuthorizeAttribute>();
            Assert.Equal("Admin,SuperAdmin", authorize?.Roles);
        }
    }

    [Fact]
    public async Task Previewing_the_real_2026_27_file_answers_with_the_format_the_version_and_every_row()
    {
        await using var db = CreateDb();
        var controller = new SupportCatalogueController(db);

        var result = await controller.PreviewImport(FormFile(CatalogueFixtures.File2026_27), NewImporter(db), CancellationToken.None);

        var preview = Body(result, typeof(OkObjectResult));
        Assert.Equal((CatalogueFileFormat.NationalRemote, "2026-27", 1017), (preview.DetectedFormat, preview.DetectedVersion, preview.Rows.Count));
    }

    [Fact]
    public async Task A_file_that_is_not_an_xlsx_is_refused_before_it_is_read()
    {
        await using var db = CreateDb();
        var controller = new SupportCatalogueController(db);

        var result = await controller.PreviewImport(FormFile(CatalogueFixtures.File2026_27, "catalogue.csv"), NewImporter(db), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("File must be an .xlsx file.", Assert.IsType<ApiResponse<CatalogueImportPreviewDto>>(bad.Value).Errors!.Single());
    }

    [Fact]
    public async Task A_workbook_that_is_not_a_catalogue_is_refused_with_the_importers_explanation()
    {
        await using var db = CreateDb();
        var controller = new SupportCatalogueController(db);
        var notACatalogue = new Mock<IFormFile>();
        notACatalogue.Setup(f => f.Length).Returns(5);
        notACatalogue.Setup(f => f.FileName).Returns("notes.xlsx");
        notACatalogue.Setup(f => f.OpenReadStream()).Returns(() => new MemoryStream(new byte[] { 1, 2, 3, 4, 5 }));

        var result = await controller.PreviewImport(notACatalogue.Object, NewImporter(db), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains(".xlsx", Assert.IsType<ApiResponse<CatalogueImportPreviewDto>>(bad.Value).Errors!.Single());
    }

    [Fact]
    public async Task Confirming_the_previewed_rows_imports_them_and_says_what_it_did()
    {
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        var controller = new SupportCatalogueController(db);
        var preview = Body(await controller.PreviewImport(FormFile(CatalogueFixtures.File2026_27), NewImporter(db), CancellationToken.None), typeof(OkObjectResult));

        var result = await controller.ConfirmImport(new ConfirmCatalogueImportDto { CatalogueVersion = preview.DetectedVersion, Rows = preview.Rows }, NewImporter(db), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<ApiResponse<bool>>(ok.Value);
        Assert.True(response.Data);
        Assert.Equal("Imported 1017 items for catalogue version 2026-27: 1017 added, 0 updated, 0 unchanged, 0 existing items end-dated.", response.Message);
        Assert.Equal(1017, db.SupportCatalogueItems.Count());
    }

    [Fact]
    public async Task Confirming_no_rows_or_a_row_without_a_start_date_is_a_400_that_says_why()
    {
        await using var db = CreateDb();
        var controller = new SupportCatalogueController(db);
        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);

        var none = await controller.ConfirmImport(new ConfirmCatalogueImportDto { CatalogueVersion = "2026-27" }, NewImporter(db), CancellationToken.None);
        var noStart = await controller.ConfirmImport(new ConfirmCatalogueImportDto
        {
            CatalogueVersion = "2026-27",
            Rows = preview.Rows.Select(r => r.ItemNumber == "04_104_0125_6_1" ? r with { EffectiveFrom = default } : r).ToList(),
        }, NewImporter(db), CancellationToken.None);

        Assert.Equal("No rows to import.", Assert.IsType<ApiResponse<bool>>(Assert.IsType<BadRequestObjectResult>(none.Result).Value).Errors!.Single());
        Assert.Contains("04_104_0125_6_1", Assert.IsType<ApiResponse<bool>>(Assert.IsType<BadRequestObjectResult>(noStart.Result).Value).Errors!.Single());
        Assert.Empty(db.SupportCatalogueItems);
    }

    [Fact]
    public async Task The_catalogue_listing_returns_the_active_items_with_the_new_columns_and_leaves_end_dated_rows_out()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        db.ChangeTracker.Clear();   // a request has its own context: with the import's rows still tracked, a filtered Include would be fixed up with all of them
        var controller = new SupportCatalogueController(db);

        var groups = ((ApiResponse<List<SupportActivityGroupDto>>)((OkObjectResult)(await controller.GetAll(CancellationToken.None)).Result!).Value!).Data!;

        var communityAccess = groups.Single(g => g.GroupCode == "GRP_COMMUNITY_ACCESS");
        Assert.Equal(10, communityAccess.Items.Count);   // the 2025-26 rows were end-dated, so they are not listed
        var weekday = communityAccess.Items.Single(i => i.ItemNumber == "04_104_0125_6_1");
        Assert.Equal(("0125", 4, CatalogueItemType.Priced, 73.58m, 103.01m, 110.37m, false), (weekday.RegistrationGroup, weekday.SupportCategoryNumber, weekday.CatalogueType, weekday.PriceNational, weekday.PriceRemote, weekday.PriceVeryRemote, weekday.IsLegacy));
        Assert.Equal((new DateOnly(2026, 7, 1), (DateOnly?)null, "support-catalogue-2026-27.xlsx"), (weekday.EffectiveFrom, weekday.EffectiveTo, weekday.SourceDocument));
        Assert.Equal(73.58m, weekday.PriceLimit_VIC);
        Assert.DoesNotContain(groups.SelectMany(g => g.Items), i => !i.IsActive);
    }

    // ── The wire: what the preview sends is what the confirm step posts back ──────

    [Fact]
    public async Task The_previewed_rows_survive_the_JSON_round_trip_the_confirm_step_depends_on_and_import_the_same()
    {
        // The frontend posts preview.rows back unchanged. The API leaves defaults and nulls out of the JSON, so the round trip must give the same rows back.
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        await using var db = CreateDb();
        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);

        var sent = JsonSerializer.Serialize(new ApiResponse<CatalogueImportPreviewDto> { Success = true, Data = preview }, options);
        var received = JsonSerializer.Deserialize<ApiResponse<CatalogueImportPreviewDto>>(sent, options)!.Data!;
        var posted = JsonSerializer.Serialize(new ConfirmCatalogueImportDto { CatalogueVersion = received.DetectedVersion, Rows = received.Rows }, options);
        var confirm = JsonSerializer.Deserialize<ConfirmCatalogueImportDto>(posted, options)!;

        Assert.Equal(preview.Rows, confirm.Rows);
        var result = await NewImporter(db).CommitImportAsync(confirm);
        Assert.Equal(new CatalogueImportResultDto(1017, 0, 0, 0), result);
    }

    [Fact]
    public async Task A_confirm_request_with_an_absurd_number_of_rows_is_refused()
    {
        await using var db = CreateDb();
        var template = (await PreviewAsync(db, CatalogueFixtures.File2026_27)).Rows[0];
        var rows = Enumerable.Range(0, 10_001).Select(i => template with { ItemNumber = $"99_{i:D5}_9999_9_9" }).ToList();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = "2026-27", Rows = rows }));

        Assert.Contains("10,000", ex.Message);
        Assert.Empty(db.SupportCatalogueItems);
    }
}
