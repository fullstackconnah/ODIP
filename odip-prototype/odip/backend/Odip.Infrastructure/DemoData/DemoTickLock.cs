using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.DemoData;

/// <summary>
/// Makes sure only one maintainer works on a database at a time (plan 4.6): an overlapping deploy or a second API container on the same
/// database must not interleave two ticks. <see cref="TryAcquireAsync"/> never waits: a tick that cannot get the lock is skipped, and the
/// next hourly tick picks up whatever it left.
/// </summary>
public interface IDemoTickLock
{
    /// <summary>The held lock (dispose to release), or null when somebody else holds it.</summary>
    Task<IAsyncDisposable?> TryAcquireAsync(OdipDbContext db, CancellationToken ct);
}

/// <summary>
/// The production lock: a Postgres session-level advisory lock (<c>pg_try_advisory_lock</c>) on a connection of its own, held for the whole
/// tick and released explicitly (and, should the process die, by the server when the session ends). It is shared by every process using
/// the database, which an in-process lock is not. For a provider that is not Npgsql (EF InMemory in tests) there is no other process to
/// exclude, so it takes nothing and always succeeds; tests that need exclusion pass an <see cref="InProcessTickLock"/>.
/// </summary>
public sealed class PostgresAdvisoryTickLock : IDemoTickLock
{
    /// <summary>The advisory-lock key: a bigint derived from a fixed phrase, so it is the same in every process and unlikely to clash.</summary>
    public static readonly long Key = BitConverter.ToInt64(SHA256.HashData(Encoding.UTF8.GetBytes("odip-demo-data-tick")), 0);

    public async Task<IAsyncDisposable?> TryAcquireAsync(OdipDbContext db, CancellationToken ct)
    {
        if (!db.Database.IsNpgsql()) return NoLock.Instance;

        var connectionString = db.Database.GetConnectionString()
            ?? throw new InvalidOperationException("The demo tick lock needs the database connection string.");
        var connection = new NpgsqlConnection(connectionString);
        try
        {
            await connection.OpenAsync(ct);
            await using var command = new NpgsqlCommand("SELECT pg_try_advisory_lock(@key)", connection);
            command.Parameters.AddWithValue("key", Key);
            var acquired = (bool)(await command.ExecuteScalarAsync(ct) ?? false);
            if (!acquired)
            {
                await connection.DisposeAsync();
                return null;
            }
            return new Held(connection);
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private sealed class Held(NpgsqlConnection connection) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            try
            {
                await using var command = new NpgsqlCommand("SELECT pg_advisory_unlock(@key)", connection);
                command.Parameters.AddWithValue("key", Key);
                await command.ExecuteScalarAsync();
            }
            catch
            {
                // The connection may already be gone; closing it ends the session, which releases the lock anyway.
            }
            finally
            {
                await connection.DisposeAsync();
            }
        }
    }

    private sealed class NoLock : IAsyncDisposable
    {
        public static readonly NoLock Instance = new();
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}

/// <summary>A lock inside one process, for tests (and any host with a single instance and no Postgres session to lean on).</summary>
public sealed class InProcessTickLock : IDemoTickLock
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    public Task<IAsyncDisposable?> TryAcquireAsync(OdipDbContext db, CancellationToken ct) =>
        Task.FromResult<IAsyncDisposable?>(_gate.Wait(0, ct) ? new Held(_gate) : null);

    private sealed class Held(SemaphoreSlim gate) : IAsyncDisposable
    {
        private int _released;

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0) gate.Release();
            return ValueTask.CompletedTask;
        }
    }
}
