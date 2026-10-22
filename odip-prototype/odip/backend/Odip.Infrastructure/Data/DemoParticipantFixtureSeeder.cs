using Microsoft.EntityFrameworkCore;

namespace Odip.Infrastructure.Data;

public enum DemoFixtureStatus { Seeded, NoDemoTenant, Rejected }

public sealed record DemoFixtureResult(DemoFixtureStatus Status, string? Detail, IReadOnlyDictionary<string, int> Added)
{
    public int Total => Added.Values.Sum();
}

// RED-STEP STUB: writes nothing. The tests are written against this public surface first.
public sealed class DemoParticipantFixtureSeeder
{
    public const string ActorLabel = "Synthetic demo fixture seeder";
    public static readonly string[] HostKeys = { "liam", "sophie", "noah", "olivia" };

    public DemoParticipantFixtureSeeder(TimeProvider? clock = null) { }

    public static Guid IdOf(string kind, params object[] key) => Guid.Empty;

    public Task<DemoFixtureResult> RunAsync(DbContextOptions<OdipDbContext> options, bool dryRun, CancellationToken ct) =>
        Task.FromResult(new DemoFixtureResult(DemoFixtureStatus.Seeded, null, new Dictionary<string, int>()));
}
