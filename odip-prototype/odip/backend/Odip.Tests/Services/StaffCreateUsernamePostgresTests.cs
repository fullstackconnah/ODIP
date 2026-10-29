using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Odip.Tests.EarlyAccess;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>The username load on real PostgreSQL: it must translate, filter by name in SQL, and still see other organisations' users.</summary>
public class StaffCreateUsernamePostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public StaffCreateUsernamePostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task Username_load_is_filtered_in_sql_and_still_sees_every_organisation()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var tag = Guid.NewGuid().ToString("N")[..8];
        var first = "Jo" + tag;
        var baseName = $"{first}.ng".ToLowerInvariant();

        await using (var seed = _pg.CreateContext())
        {
            var other = new Tenant { Id = Guid.NewGuid(), Name = "Other " + tag, EmailDomain = tag + ".example.org", IsActive = true, CreatedAt = DateTime.UtcNow };
            seed.Tenants.Add(other);
            foreach (var name in new[] { baseName.ToUpperInvariant(), baseName + "-2", "unrelated." + tag })
                seed.Users.Add(new User { Id = Guid.NewGuid(), TenantId = other.Id, FirstName = "X", LastName = "Y", Username = name, Email = name + "@gmail.com", Role = UserRole.SupportWorker });
            await seed.SaveChangesAsync();
        }

        var log = new CommandLog();
        await using var db = _pg.CreateContext(log);
        var result = await new StaffCreateService(db, null).StageAsync(
            new CreateStaffDto { FirstName = first, LastName = "Ng", Email = $"jo.{tag}@gmail.com", Role = UserRole.SupportWorker }, null, null, CancellationToken.None);

        Assert.Null(result.Error);
        Assert.Equal(baseName + "-3", result.User!.Username);
        var usernameSql = log.Commands.Single(c => c.Contains("\"Username\"") && c.Contains("lower", StringComparison.OrdinalIgnoreCase) && !c.Contains("\"Email\""));
        Assert.Contains("WHERE", usernameSql, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class CommandLog : DbCommandInterceptor
    {
        public List<string> Commands { get; } = [];

        public override ValueTask<InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
            System.Data.Common.DbCommand command, CommandEventData eventData, InterceptionResult<System.Data.Common.DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Commands.Add(command.CommandText);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}
