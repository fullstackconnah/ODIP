using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Tests.Funding;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The daily top-up says what the shifts it made do to budgets (budget phase 3) in ONE log line for each organisation, and nowhere else: no screen, no task, and never a failure of the run. Saturday 10 Oct 2026,
/// 13:00 in Sydney; an agreement pattern for Mondays 9 to 1 in NSW makes shifts of $240, eight of them to the horizon.
/// </summary>
public class RosterTopUpBudgetSummaryTests
{
    private static readonly Guid Tenant = LedgerKit.TenantA;

    private sealed class ListLogger<T> : ILogger<T>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = new();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) => Entries.Add((logLevel, formatter(state, exception)));
    }

    private static OdipDbContext AdminDb(string name)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
    }

    private static async Task<(OdipDbContext Db, RosterTopUpBackgroundService Service, ListLogger<RosterTopUpBackgroundService> Log)> Build(decimal october)
    {
        var name = Guid.NewGuid().ToString();
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(name));
        services.AddSingleton<IRosterPlacementGate>(new RosterPlacementGate());
        services.AddSingleton<RosterShiftGenerator>();
        var provider = services.BuildServiceProvider();
        var log = new ListLogger<RosterTopUpBackgroundService>();
        var service = new RosterTopUpBackgroundService(provider.GetRequiredService<IServiceScopeFactory>(), new ConfigurationBuilder().Build(), log, FakeClock.AtUtc(2026, 10, 10, 2, 0));

        var db = AdminDb(name);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = Tenant, State = "NSW" });
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = Tenant, FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        var draft = new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = participant.Id, Version = 1, State = "NSW", ParticipantNameSnapshot = "Amy Ng",
            AgreementStartDate = new DateOnly(2026, 10, 1), AgreementEndDate = new DateOnly(2027, 3, 31), PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
        };
        db.ServiceAgreementDrafts.Add(draft);
        db.ShiftPatterns.Add(new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            EffectiveFrom = new DateOnly(2026, 10, 1), EffectiveTo = new DateOnly(2027, 3, 31), IsActive = true, SourceDraftId = draft.Id, SourceBlockKey = "b", WorkerSlot = 1,
        });
        await db.SaveChangesAsync();
        var kit = LedgerKit.Wrap(db, Tenant);
        kit.SeedCommunityAccessCatalogue();
        kit.SeedPlan(participant, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, october)));
        return (db, service, log);
    }

    [Fact]
    public async Task ShiftsThatTakeAPoolPastItsFunding_AreSummarisedInOneLineForTheOrganisation_AndStillMade()
    {
        var (db, service, log) = await Build(october: 1000m);
        await using var _ = db;

        var run = await service.RunOnceAsync(CancellationToken.None);

        Assert.Equal((8, 0), (run.ShiftsCreated, run.Failures));
        var line = Assert.Single(log.Entries, e => e.Message.StartsWith("Roster top-up budget for organisation", StringComparison.Ordinal));
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains(Tenant.ToString(), line.Message);
        Assert.Contains("in 1 period(s), for 1 of 1 participants", line.Message);
    }

    [Fact]
    public async Task ShiftsWithinTheFunding_LeaveNoBudgetLine()
    {
        var (db, service, log) = await Build(october: 50000m);
        await using var _ = db;

        var run = await service.RunOnceAsync(CancellationToken.None);

        Assert.Equal(8, run.ShiftsCreated);
        Assert.DoesNotContain(log.Entries, e => e.Message.Contains("budget", StringComparison.OrdinalIgnoreCase));
    }
}
