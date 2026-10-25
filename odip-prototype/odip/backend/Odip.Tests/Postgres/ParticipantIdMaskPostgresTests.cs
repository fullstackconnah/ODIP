using Microsoft.AspNetCore.Mvc;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Tests.Controllers;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>
/// The participant list masks the NDIS number inside the SQL projection. InMemory evaluates that projection in .NET, so only
/// PostgreSQL shows that Npgsql translates the inline copy of <see cref="ParticipantIdMask.Mask"/> and that the two agree.
/// </summary>
public class ParticipantIdMaskPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ParticipantIdMaskPostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task GetAll_MaskTranslatesOnPostgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        // "430000017 " is the trailing-space case: Npgsql's btrim strips spaces only, which is accepted (stored numbers carry no tabs or newlines).
        var cases = new[] { "", "  ", "5", "12", "430000017", "430000017 " };
        foreach (var c in cases) ParticipantIdMaskTests.Seed(db, ndis: c, tenantId: tenantId);

        var result = await ParticipantIdMaskTests.ControllerFor(db, "SupportWorker").GetAll(null, null, null, null, null, null, 1, 50, CancellationToken.None);
        var items = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Items;

        Assert.Equal(cases.Select(ParticipantIdMask.Mask).OrderBy(x => x, StringComparer.Ordinal), items.Select(i => i.MaskedNdisNumber).OrderBy(x => x, StringComparer.Ordinal));
    }
}
