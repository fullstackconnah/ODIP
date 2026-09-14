using Odip.Application.Common;
using Xunit;

namespace Odip.Tests.Common;

/// <summary>
/// PagingParams.Clamp — the shared helper extracted from the copy-pasted
/// `page = Math.Max(page, 1); pageSize = Math.Clamp(pageSize, 1, N);` pair that used to live
/// inline in each list controller. Pagination-rollout wave 1 (shared scaffolding only).
/// </summary>
public class PagingParamsTests
{
    [Fact]
    public void Clamp_PageBelowFloor_FloorsToOne()
    {
        var (page, pageSize) = PagingParams.Clamp(0, 50);

        Assert.Equal(1, page);
        Assert.Equal(50, pageSize);
    }

    [Fact]
    public void Clamp_PageNegative_FloorsToOne()
    {
        var (page, _) = PagingParams.Clamp(-5, 50);

        Assert.Equal(1, page);
    }

    [Fact]
    public void Clamp_PageSizeAboveDefaultCeiling_ClampsTo200()
    {
        var (_, pageSize) = PagingParams.Clamp(1, 500);

        Assert.Equal(PagingParams.MaxPageSize, pageSize);
        Assert.Equal(200, pageSize);
    }

    [Fact]
    public void Clamp_PageSizeBelowOne_FloorsToOne()
    {
        var (_, pageSize) = PagingParams.Clamp(1, 0);

        Assert.Equal(1, pageSize);
    }

    [Fact]
    public void Clamp_ValuesInRange_PassThroughUnchanged()
    {
        var (page, pageSize) = PagingParams.Clamp(3, 75);

        Assert.Equal(3, page);
        Assert.Equal(75, pageSize);
    }

    [Fact]
    public void Clamp_CustomMaxPageSize_IsHonoured()
    {
        var (_, pageSize) = PagingParams.Clamp(1, 500, maxPageSize: 100);

        Assert.Equal(100, pageSize);
    }

    [Fact]
    public void Clamp_CustomMaxPageSize_DoesNotAffectDefaultConstant()
    {
        PagingParams.Clamp(1, 500, maxPageSize: 100);

        Assert.Equal(200, PagingParams.MaxPageSize);
    }

    [Fact]
    public void Clamp_ValueWithinCustomMaxPageSize_PassesThroughUnchanged()
    {
        var (_, pageSize) = PagingParams.Clamp(1, 80, maxPageSize: 100);

        Assert.Equal(80, pageSize);
    }
}
