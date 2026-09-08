using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
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

/// <summary>
/// After the Task 5 sweep, PortalController/RosteringController must reference every SHIFT_*
/// code exclusively through ShiftErrorCodes — codified after the critique found one code
/// (STATUS_TRANSITION_VIA_COMPLETION) breaking the SHIFT_* prefix and another (the return-
/// reason 400) shipping with no code at all. A literal-matching test (asserting each literal
/// has a corresponding constant) would assert nothing once zero literals remain, so this
/// instead asserts the sweep is complete (no raw SHIFT_* literals left in either controller)
/// and that ShiftErrorCodes itself stays well-formed (every value matches the SHIFT_* prefix
/// and no two constants collide on the same value).
/// </summary>
public class ShiftErrorCodesTests
{
    private static readonly string BackendRoot = FindBackendRoot();

    private static string FindBackendRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
        {
            var parent = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
            if (parent == dir) break;
            dir = parent;
        }
        if (dir is null || !File.Exists(Path.Combine(dir, "Odip.sln")))
            throw new InvalidOperationException($"Could not locate Odip.sln above {AppContext.BaseDirectory}");
        return dir;
    }

    [Theory]
    [InlineData("Odip.Api/Controllers/PortalController.cs")]
    [InlineData("Odip.Api/Controllers/RosteringController.cs")]
    public void NoRawShiftCodeLiteralsRemain(string relativePath)
    {
        var source = File.ReadAllText(Path.Combine(BackendRoot, relativePath));

        var literalCodes = Regex.Matches(source, "\"(SHIFT_[A-Z_]+)\"")
            .Select(m => m.Groups[1].Value)
            .Distinct()
            .ToList();

        Assert.True(literalCodes.Count == 0,
            $"{relativePath} still has raw SHIFT_* string literal(s) instead of ShiftErrorCodes constants: {string.Join(", ", literalCodes)}");
    }

    [Fact]
    public void EveryShiftErrorCodesConstant_MatchesPrefixAndIsUnique()
    {
        var values = typeof(ShiftErrorCodes).GetFields()
            .Where(f => f.IsLiteral)
            .Select(f => (string)f.GetRawConstantValue()!)
            .ToList();

        Assert.NotEmpty(values);
        foreach (var value in values)
            Assert.Matches("^SHIFT_[A-Z_]+$", value);

        var duplicates = values.GroupBy(v => v).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        Assert.True(duplicates.Count == 0, $"Duplicate ShiftErrorCodes value(s): {string.Join(", ", duplicates)}");
    }
}
