using System.Reflection;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Catalogue;

/// <summary>
/// A catalogue confirm waits for an import that is already running, and that wait has to end before Npgsql cancels the command that is waiting. The wait
/// itself needs PostgreSQL and is exercised by <see cref="CataloguePostgresTests"/>; this pins the number, which no provider-free test can reach any other way.
/// </summary>
public class CatalogueImportLockTests
{
    /// <summary>Npgsql's default CommandTimeout. Nothing in the API sets another: Program.cs registers UseNpgsql with the connection string alone.</summary>
    private static readonly TimeSpan NpgsqlDefaultCommandTimeout = TimeSpan.FromSeconds(30);

    [Fact]
    public void The_wait_for_another_import_ends_before_the_command_that_is_waiting_times_out()
    {
        var lockType = typeof(CatalogueImportService).Assembly.GetType("Odip.Infrastructure.Services.CatalogueImportLock");
        Assert.NotNull(lockType);
        var field = lockType!.GetField("Wait", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(field);

        var wait = (TimeSpan)field!.GetValue(null)!;

        // The lock is taken by one SQL command. With a wait longer than the command timeout, Npgsql cancels the command first and the second admin gets a
        // raw 500 instead of the 400 "Another catalogue import is still running".
        Assert.True(wait > TimeSpan.Zero, "the wait must be positive");
        Assert.True(wait < NpgsqlDefaultCommandTimeout, $"the lock wait ({wait.TotalSeconds:0} s) must be shorter than Npgsql's {NpgsqlDefaultCommandTimeout.TotalSeconds:0} s command timeout");
    }
}
