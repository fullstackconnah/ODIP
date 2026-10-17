using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>Name projections on the real provider: a blank last name must not leave "Jo " (the trim has to translate to SQL).</summary>
public class FullNamePostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public FullNamePostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task ParticipantList_FullName_HasNoTrailingSpace_WhenLastNameBlank()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, _) = await _pg.NewTenantContextAsync();
        using var _ = db;
        db.Participants.AddRange(
            new Participant { Id = Guid.NewGuid(), FirstName = "Jo", LastName = "" },
            new Participant { Id = Guid.NewGuid(), FirstName = "Al", LastName = "", PreferredName = "Ally" },
            new Participant { Id = Guid.NewGuid(), FirstName = "Bo", LastName = "Lee" });
        await db.SaveChangesAsync();
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

        var result = await controller.GetAll(null, null, null, null, null, false, 1, 50, CancellationToken.None);

        var items = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Items;
        Assert.Equal(new[] { "Ally", "Bo Lee", "Jo" }, items.Select(i => i.FullName).OrderBy(n => n).ToArray());
    }

    [SkippableFact]
    public async Task PeopleList_FullName_HasNoTrailingSpace_WhenLastNameBlank()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, _) = await _pg.NewTenantContextAsync();
        using var _ = db;
        db.People.AddRange(
            new Person { Id = Guid.NewGuid(), FirstName = "Jo", LastName = "" },
            new Person { Id = Guid.NewGuid(), FirstName = "", LastName = "Lee" });
        await db.SaveChangesAsync();

        var result = await new PersonsController(db).GetAll(null, CancellationToken.None);

        var people = Assert.IsType<ApiResponse<List<PersonDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(new[] { "Jo", "Lee" }, people.Select(p => p.FullName).OrderBy(n => n).ToArray());
    }
}
