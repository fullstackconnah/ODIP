using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Controllers;

public class EventTemplatesControllerTests
{
    // The edit panel shows no Active control and deactivation is the DELETE verb, so a stale edit must not undo it.
    [Fact]
    public async Task Update_AfterTheTemplateWasDeactivated_KeepsItInactive()
    {
        using var db = Db();
        var template = EventTemplate(db, A);
        var controller = new EventTemplatesController(db);

        Assert.IsType<NoContentResult>(await controller.Deactivate(template.Id, CancellationToken.None));
        var edit = new UpdateEventTemplateDto { EventCode = template.EventCode, EventName = "Renamed", IsActive = true };
        Assert.IsType<OkObjectResult>((await controller.Update(template.Id, edit, CancellationToken.None)).Result);

        var stored = await db.EventTemplates.AsNoTracking().SingleAsync(t => t.Id == template.Id);
        Assert.Equal("Renamed", stored.EventName);
        Assert.False(stored.IsActive);
    }
}
