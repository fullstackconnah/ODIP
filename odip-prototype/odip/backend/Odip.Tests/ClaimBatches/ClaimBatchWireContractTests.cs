using System.Text.Json;
using Odip.Api.Serialization;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>The hub and file JSON the frontend reads: fixed lowercase strings for kind and funding, enum names for batch status.</summary>
public class ClaimBatchWireContractTests
{
    private static readonly JsonSerializerOptions Json = Options();

    private static JsonSerializerOptions Options()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(o);
        return o;
    }

    [Fact]
    public async Task Hub_and_file_json_use_the_planned_strings()
    {
        using var f = new BatchFixture();
        var (_, trip, _) = f.AddClaim();
        var (_, shift, _) = f.AddClaim(shiftLines: true);
        f.AddClaim(plan: PlanType.PlanManaged);
        f.AddClaim(plan: PlanType.SelfManaged);

        var hub = JsonDocument.Parse(JsonSerializer.Serialize(await f.Service.HubAsync(f.TenantId, default), Json)).RootElement;
        var ready = hub.GetProperty("ready").EnumerateArray().ToDictionary(r => r.GetProperty("lineId").GetGuid());
        var managed = hub.GetProperty("managed").EnumerateArray().Select(m => m.GetProperty("fundingType").GetString()).Order().ToList();

        Assert.Equal("trip", ready[trip[0].Id].GetProperty("claimKind").GetString());
        Assert.Equal("shift", ready[shift[0].Id].GetProperty("claimKind").GetString());
        Assert.All(ready.Values, r => Assert.Equal("agency", r.GetProperty("fundingType").GetString()));
        Assert.Equal(["plan", "self"], managed);

        var built = await f.BuildAsync(trip[0].Id);
        Assert.True(built.Ok, string.Join("; ", built.Errors ?? []));
        Assert.Equal("Built", JsonDocument.Parse(JsonSerializer.Serialize(built.Value, Json)).RootElement.GetProperty("status").GetString());
    }
}
