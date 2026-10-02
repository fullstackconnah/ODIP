using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Tests.EarlyAccess;
using Odip.Tests.Medications;

namespace Odip.Tests.DemoData;

/// <summary>
/// One scratch database plus a settable clock, wired the way production wires it: the maintainer gets the same
/// <see cref="DbContextOptions{TContext}"/> a request would (audit interceptor included) and builds its own tenant-scoped context from them.
/// The store is EF InMemory, so unique and partial indexes, advisory locks and SQL translation are NOT exercised here: the Postgres-backed
/// tests (DemoDataPostgresTests) repeat the ones that matter.
/// </summary>
internal sealed class DemoTestEnv
{
    public static readonly Guid DemoTenantId = Guid.Parse("b0000000-0000-0000-0000-000000000001");

    public DbContextOptions<OdipDbContext> Options { get; }
    public FakeClock Clock { get; }
    public CapturingLogger<DemoDataMaintainer> Log { get; } = new();

    /// <param name="nowUtc">The tick clock. 2026-10-02T00:30Z is Fri 10:30 AEST, the plan's worked example.</param>
    public DemoTestEnv(DateTimeOffset nowUtc, bool audit = true)
    {
        Clock = new FakeClock(nowUtc);
        var builder = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase("demo-" + Guid.NewGuid().ToString("N"));
        if (audit) builder.AddInterceptors((IInterceptor)new AuditInterceptor(new HttpContextAccessor()));
        Options = builder.Options;
    }

    public static DemoTestEnv At(int y, int mo, int d, int h, int mi, bool audit = true) =>
        new(new DateTimeOffset(y, mo, d, h, mi, 0, TimeSpan.Zero), audit);

    /// <summary>A context that sees every tenant: for seeding fixtures and reading results.</summary>
    public OdipDbContext AdminDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(Options, tenant.Object);
    }

    public async Task AddTenantAsync(string name = "Demo", string domain = "demo.odip.com.au", bool active = true, Guid? id = null)
    {
        await using var db = AdminDb();
        db.Tenants.Add(new Tenant { Id = id ?? (name == "Demo" && domain == "demo.odip.com.au" ? DemoTenantId : Guid.NewGuid()), Name = name, EmailDomain = domain, IsActive = active });
        await db.SaveChangesAsync();
    }

    public async Task SetProviderStateAsync(string state)
    {
        await using var db = AdminDb();
        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = DemoTenantId, State = state, OrganisationName = "Existing Provider", ABN = "00 000 000 000",
        });
        await db.SaveChangesAsync();
    }

    public DemoDataMaintainer Maintainer(IEnumerable<IDemoPack>? packs = null, DemoDataOptions? options = null, IDemoTickLock? tickLock = null) =>
        new(options ?? new DemoDataOptions { Scenarios = DemoScenarioMode.On }, Clock, Log, packs, tickLock ?? new InProcessTickLock());

    public Task<DemoTickResult> RunAsync(IEnumerable<IDemoPack>? packs = null, CancellationToken ct = default) =>
        Maintainer(packs).RunAsync(Options, ct);

    /// <summary>A pack made of a delegate, for tests that need a pack to do one specific thing.</summary>
    public sealed class DelegatePack(string name, Func<DemoRun, CancellationToken, Task> body) : IDemoPack
    {
        public string Name => name;
        public Task RunAsync(DemoRun run, CancellationToken ct) => body(run, ct);
    }

    public static DelegatePack Pack(string name, Func<DemoRun, CancellationToken, Task> body) => new(name, body);
}
