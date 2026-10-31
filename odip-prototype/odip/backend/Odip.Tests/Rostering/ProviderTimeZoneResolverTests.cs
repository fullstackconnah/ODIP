using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>Settings PR 2a: every provider-zone read goes through the saved zone, with the State default behind it. Fixtures store a zone that differs from the State's default, so old State-only code fails them.</summary>
public class ProviderTimeZoneResolverTests
{
    private sealed class FixedClock(DateTime utc) : TimeProvider { public override DateTimeOffset GetUtcNow() => new(utc); }

    private static readonly Guid Tenant = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly DateTime DayBoundary = new(2026, 10, 31, 14, 30, 0, DateTimeKind.Utc);   // Nov 1 01:30 in Sydney, Oct 31 22:30 in Perth
    private static readonly DateTime DstDay = new(2026, 10, 4, 13, 30, 0, DateTimeKind.Utc);          // Oct 5 00:30 in Sydney (DST began Oct 4), Oct 4 23:30 in Brisbane

    [Theory]
    [InlineData("Australia/Perth", "NSW", "Australia/Perth")]
    [InlineData(null, "VIC", "Australia/Melbourne")]
    [InlineData(null, "TAS", "Australia/Hobart")]
    [InlineData("Europe/London", "WA", "Australia/Perth")]     // off the list: the State default applies
    [InlineData("australia/perth", "NSW", "Australia/Sydney")] // ids are exact-case
    [InlineData(null, null, "Australia/Sydney")]
    public void For_ReturnsTheStoredZone_ElseTheStatesDefault(string? stored, string? state, string expected) =>
        Assert.Equal(expected, ProviderTimeZoneResolver.For(stored, state).Id);

    [Fact]
    public void ForInvoiceState_IgnoresAnyZoneSetting_AndReadsTheStateOnly() =>
        Assert.Equal("Australia/Sydney", ProviderTimeZoneResolver.ForInvoiceState("NSW").Id);

    [Fact]
    public void TodayIn_FollowsTheSavedZone_AcrossTheDayBoundary_AndTheDstStart()
    {
        Assert.Equal(new DateOnly(2026, 10, 31), ProviderLocalTime.TodayIn(DayBoundary, ProviderTimeZoneResolver.For("Australia/Perth", "NSW").Zone));
        Assert.Equal(new DateOnly(2026, 11, 1), ProviderLocalTime.TodayIn(DayBoundary, ProviderTimeZoneResolver.For(null, "NSW").Zone));
        Assert.Equal(new DateOnly(2026, 10, 5), ProviderLocalTime.TodayIn(DstDay, ProviderTimeZoneResolver.For("Australia/Sydney", "QLD").Zone));
        Assert.Equal(new DateOnly(2026, 10, 4), ProviderLocalTime.TodayIn(DstDay, ProviderTimeZoneResolver.For(null, "QLD").Zone));
    }

    [Fact]
    public void Zones_AreExactlyTheSevenPickerZones_AndMelbourneAndHobartShareSydneysClock()
    {
        Assert.Equal(
            new[] { "Australia/Adelaide", "Australia/Brisbane", "Australia/Darwin", "Australia/Hobart", "Australia/Melbourne", "Australia/Perth", "Australia/Sydney" },
            StateTimeZoneMap.Zones.Order(StringComparer.Ordinal).ToArray());
        Assert.Equal("Australia/Sydney", StateTimeZoneMap.Clock("Australia/Melbourne"));
        Assert.Equal("Australia/Sydney", StateTimeZoneMap.Clock("Australia/Hobart"));
        Assert.Equal("Australia/Perth", StateTimeZoneMap.Clock("Australia/Perth"));
    }

    private static async Task<Odip.Infrastructure.Data.OdipDbContext> DbWithPerthRowAsync()
    {
        var db = TestDb.Create(Guid.NewGuid().ToString());
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = Tenant, State = "NSW", TimeZoneId = "Australia/Perth" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), State = "NSW", TimeZoneId = "Australia/Darwin" });
        await db.SaveChangesAsync();
        return db;
    }

    [Fact]
    public async Task ResolveAsync_ByTenant_ReadsThatOrganisationsSavedZone()
    {
        await using var db = await DbWithPerthRowAsync();

        Assert.Equal("Australia/Perth", (await ProviderTimeZoneResolver.ResolveAsync(db, Tenant, CancellationToken.None)).Id);
    }

    [Fact]
    public async Task ResolveAsync_Scoped_ReadsTheSavedZone_OfTheOrganisationInView()
    {
        await using var db = TestDb.Create(Guid.NewGuid().ToString(), viewingAs: Tenant);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = Tenant, State = "NSW", TimeZoneId = "Australia/Perth" });
        await db.SaveChangesAsync();

        Assert.Equal("Australia/Perth", (await ProviderTimeZoneResolver.ResolveAsync(db, CancellationToken.None)).Id);
    }

    [Fact]
    public async Task TodayAsync_ByTenant_UsesTheSavedZone()
    {
        await using var db = await DbWithPerthRowAsync();
        var clock = new FixedClock(DayBoundary);

        Assert.Equal(new DateOnly(2026, 10, 31), await ProviderTimeZoneResolver.TodayAsync(db, Tenant, clock, CancellationToken.None));
    }

    [Fact]
    public void AgreementProvider_UsesTheSavedZone()
    {
        var settings = new ProviderSettings { State = "NSW", TimeZoneId = "Australia/Perth" };

        Assert.Equal("Australia/Perth", AgreementProvider.From(settings).Zone.Id);
    }

    [Fact]
    public async Task NoSettingsRow_IsTheSydneyFallback()
    {
        await using var db = TestDb.Create(Guid.NewGuid().ToString());

        Assert.Equal("Australia/Sydney", (await ProviderTimeZoneResolver.ResolveAsync(db, Tenant, CancellationToken.None)).Id);
        Assert.Empty(db.ProviderSettings);
    }
}
