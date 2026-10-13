using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class ImportsControllerTests
{
    private static (ImportsController Controller, OdipDbContext Db) Controller()
    {
        var tenantId = Guid.NewGuid();
        var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var controller = new ImportsController(Service(db, tenantId))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = Admin() } },
        };
        return (controller, db);
    }

    private static IFormFile Upload(string fileName, string text)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", fileName);
    }

    [Fact]
    public void Only_Admin_and_SuperAdmin_reach_the_import_and_no_action_widens_it()
    {
        Assert.Equal("Admin,SuperAdmin", typeof(ImportsController).GetCustomAttribute<AuthorizeAttribute>()!.Roles);
        Assert.DoesNotContain(typeof(ImportsController).GetMethods(), m => m.GetCustomAttribute<AuthorizeAttribute>() is not null || m.GetCustomAttribute<AllowAnonymousAttribute>() is not null);
    }

    [Fact]
    public void Uploads_are_held_in_memory_up_to_the_request_limit()
    {
        foreach (var name in new[] { nameof(ImportsController.Preview), nameof(ImportsController.Commit) })
        {
            var limits = typeof(ImportsController).GetMethod(name)!.GetCustomAttribute<RequestFormLimitsAttribute>()!;
            Assert.True(limits.MemoryBufferThreshold >= limits.MultipartBodyLengthLimit, $"{name} would buffer a large upload to a temp file");
            Assert.True(limits.MultipartBodyLengthLimit > ImportFileReader.MaxBytes, $"{name} cuts off a file under 5 MB");
        }
    }

    [Fact]
    public async Task A_refused_file_answers_400_with_its_message_and_an_unknown_kind_404()
    {
        var (controller, db) = Controller();
        using var _ = db;
        var refused = Assert.IsType<ObjectResult>((await controller.Preview("participants", Upload("people.xls", "a,b\n1,2\n"), null, CancellationToken.None)).Result);
        Assert.Equal(400, refused.StatusCode);
        Assert.Equal("Upload a .csv or .xlsx file. An older .xls workbook can be saved as .xlsx from Excel.", Assert.IsType<ApiResponse<ImportPreviewDto>>(refused.Value).Errors.Single());
        Assert.IsType<NotFoundObjectResult>((await controller.Preview("vehicles", Upload("people.csv", "a\n1\n"), null, CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Commit_then_undo_round_trip_and_a_changed_import_answers_409_with_its_blockers()
    {
        var (controller, db) = Controller();
        using var _ = db;
        const string csv = "First name,Last name\nAva,Stone\nBen,Lee\n";
        var committed = Assert.IsType<OkObjectResult>((await controller.Commit("participants", Upload("people.csv", csv), null, "Active", "key-1", CancellationToken.None)).Result);
        var result = Assert.IsType<ApiResponse<ImportResultDto>>(committed.Value).Data!;
        Assert.Equal(2, result.CreatedCount);

        var ava = db.Participants.Single(p => p.LastName == "Stone");
        db.Shifts.Add(new Shift { Id = Guid.NewGuid(), ParticipantId = ava.Id, ServiceDate = new DateOnly(2026, 11, 2), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), Status = ShiftStatus.Draft });
        await db.SaveChangesAsync();
        var blocked = Assert.IsType<ConflictObjectResult>((await controller.Undo(result.BatchId, CancellationToken.None)).Result);
        Assert.Equal("has shifts", Assert.IsType<ApiResponse<List<ImportUndoBlockerDto>>>(blocked.Value).Data!.Single().Reason);

        db.Shifts.RemoveRange(db.Shifts);
        await db.SaveChangesAsync();
        Assert.IsType<OkObjectResult>((await controller.Undo(result.BatchId, CancellationToken.None)).Result);
        var history = Assert.IsType<ApiResponse<List<ImportBatchDto>>>(Assert.IsType<OkObjectResult>((await controller.History(CancellationToken.None)).Result).Value).Data!;
        Assert.NotNull(history.Single().UndoneAt);
    }

    [Fact]
    public async Task The_template_downloads_as_an_xlsx_named_for_its_kind()
    {
        var (controller, db) = Controller();
        using var _ = db;
        var file = Assert.IsType<FileContentResult>(controller.Template("participants"));
        Assert.Equal(("odip-participants-template.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), (file.FileDownloadName, file.ContentType));
    }
}
