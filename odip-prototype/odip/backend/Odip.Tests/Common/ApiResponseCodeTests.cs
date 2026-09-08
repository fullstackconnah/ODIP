using Odip.Application.Common;
using Xunit;

namespace Odip.Tests.Common;

/// <summary>
/// ApiResponse.Fail(string, string) — a machine-readable Code alongside the existing plain-
/// sentence Errors message, added additively for the shift-completion state machine's 409
/// codes (SHIFT_NOT_STARTABLE etc., Tasks 4/5/7/8/9) so PR 2's frontend can branch on Code
/// instead of parsing message text. Every pre-existing Fail(string) call site is unaffected —
/// Code stays null on those responses.
/// </summary>
public class ApiResponseCodeTests
{
    [Fact]
    public void Fail_WithMessageAndCode_SetsBothErrorsAndCode()
    {
        var response = ApiResponse<string>.Fail("This shift can't be started right now.", "SHIFT_NOT_STARTABLE");

        Assert.False(response.Success);
        Assert.Equal("SHIFT_NOT_STARTABLE", response.Code);
        Assert.Equal("This shift can't be started right now.", Assert.Single(response.Errors!));
    }

    [Fact]
    public void Fail_WithMessageOnly_LeavesCodeNull()
    {
        var response = ApiResponse<string>.Fail("Shift not found.");

        Assert.Null(response.Code);
        Assert.Equal("Shift not found.", Assert.Single(response.Errors!));
    }
}
