using Microsoft.AspNetCore.Mvc;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Medications;

/// <summary>How a recorder outcome becomes an HTTP answer, shared by the MAR route and the shift package's portal route.</summary>
public class RecordAdministrationResultExtensionsTests
{
    private sealed class TestController : ControllerBase;

    [Fact]
    public void ASlotThatStaysBusy_Is409WithItsOwnCode_AndNoData()
    {
        var result = new RecordAdministrationResult(
            RecordAdministrationOutcome.SlotBusy, null, "Another request is recording this dose right now. Check the dose, then try again.",
            MedicationErrorCodes.AdministrationSlotBusy);

        var action = result.ToActionResult(new TestController());

        var conflict = Assert.IsType<ConflictObjectResult>(action);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(conflict.Value);
        Assert.False(body.Success);
        Assert.Equal("ADMINISTRATION_SLOT_BUSY", body.Code);
        Assert.Null(body.Data);   // unlike ADMINISTRATION_ALREADY_RECORDED there is no record to show: nothing was written
        Assert.Contains("recording this dose right now", Assert.Single(body.Errors!));
    }

    [Fact]
    public void AnAlreadyRecordedSlot_StillCarriesTheActiveRecord_AndADifferentCode()
    {
        var record = new AdministrationDto { Id = Guid.NewGuid() };
        var result = new RecordAdministrationResult(
            RecordAdministrationOutcome.AlreadyRecorded, record, "This dose has already been recorded.", MedicationErrorCodes.AdministrationAlreadyRecorded);

        var body = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<ConflictObjectResult>(result.ToActionResult(new TestController())).Value);

        Assert.Equal("ADMINISTRATION_ALREADY_RECORDED", body.Code);
        Assert.Equal(record.Id, body.Data!.Id);
    }
}
