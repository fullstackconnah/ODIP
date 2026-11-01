using System.Text.Json;
using Odip.Api.Serialization;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>Shift billing PR2: a PUT that leaves supportGroupCode out keeps the stored type, and one that sends null clears it. The two are told apart by the init setter, which System.Text.Json runs only for a key that is present.</summary>
public class SupportTypeJsonTests
{
    private static readonly JsonSerializerOptions Options = Make();

    private static JsonSerializerOptions Make()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        return options;
    }

    [Fact]
    public void UpdateShiftDto_AbsentKey_IsNotSet_AndNullAndValueAre()
    {
        var absent = JsonSerializer.Deserialize<UpdateShiftDto>("{}", Options)!;
        Assert.False(absent.HasSupportGroupCode);

        var cleared = JsonSerializer.Deserialize<UpdateShiftDto>("{\"supportGroupCode\":null}", Options)!;
        Assert.True(cleared.HasSupportGroupCode);
        Assert.Null(cleared.SupportGroupCode);

        var set = JsonSerializer.Deserialize<UpdateShiftDto>("{\"supportGroupCode\":\"GRP_X\"}", Options)!;
        Assert.True(set.HasSupportGroupCode);
        Assert.Equal("GRP_X", set.SupportGroupCode);
    }

    [Fact]
    public void UpdateShiftPatternDto_AbsentKey_IsNotSet_AndNullAndValueAre()
    {
        var absent = JsonSerializer.Deserialize<UpdateShiftPatternDto>("{}", Options)!;
        Assert.False(absent.HasSupportGroupCode);

        var cleared = JsonSerializer.Deserialize<UpdateShiftPatternDto>("{\"supportGroupCode\":null}", Options)!;
        Assert.True(cleared.HasSupportGroupCode);
        Assert.Null(cleared.SupportGroupCode);

        var set = JsonSerializer.Deserialize<UpdateShiftPatternDto>("{\"supportGroupCode\":\"GRP_X\"}", Options)!;
        Assert.True(set.HasSupportGroupCode);
        Assert.Equal("GRP_X", set.SupportGroupCode);
    }
}
