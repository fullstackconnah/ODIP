#pragma warning disable EF1001 // the query provider's own contract (IAsyncQueryProvider) and its internal base are the only way to see every query of an InMemory run
using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Query;
using Microsoft.EntityFrameworkCore.Query.Internal;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;

namespace Odip.Tests.Funding;

/// <summary>One funding period of a pool in a ledger test: its dates, its plan amount and, when the pool has set-asides, its set-aside.</summary>
internal sealed record PeriodSpec(DateOnly Start, DateOnly End, decimal Amount, decimal? SetAside = null);

/// <summary>One pool of a plan in a ledger test.</summary>
internal sealed record PoolSpec(FundingPoolKind Kind, int PaceCategory, PlanType Management, params PeriodSpec[] Periods);

/// <summary>
/// What every budget ledger test needs: an InMemory database scoped to one tenant (two kits made with the same <c>database</c> see the same rows through their own tenant filter), the fixed clock
/// of the funding tests (4 Oct 2026, 03:00 UTC: 13:00 in Sydney, so the provider's date and the UTC date agree unless a test moves it), the ledger service, and builders for the records the
/// ledger reads. Every row carries an explicit tenant id; the catalogue and the holidays are global, as in the app. Money is whole dollars so a figure can be read off a test.
/// </summary>
internal sealed class LedgerKit : IDisposable
{
    public static readonly Guid TenantA = FundingTestKit.TenantA;
    public static readonly Guid TenantB = FundingTestKit.TenantB;

    /// <summary>The fixed "now" of the funding tests: 4 Oct 2026, the provider's today (Sydney, 13:00).</summary>
    public static readonly DateOnly Today = new(2026, 10, 4);

    public OdipDbContext Db { get; }
    public FakeClock Clock { get; }
    public BudgetLedgerService Ledger { get; }
    public Guid TenantId { get; }
    /// <summary>The tenant the context is scoped to; null for a kit wrapped round a context the caller made (the PostgreSQL tests).</summary>
    public ICurrentTenant? Tenant { get; }

    private SupportActivityGroup? _community;
    private readonly Dictionary<(ClaimDayType, bool), SupportCatalogueItem> _items = new();

    private static int _numbers;

    private LedgerKit(OdipDbContext db, FakeClock clock, Guid tenantId, ICurrentTenant? tenant)
    {
        Db = db;
        Clock = clock;
        TenantId = tenantId;
        Tenant = tenant;
        Ledger = new BudgetLedgerService(db, clock);
    }

    /// <param name="countQueries">Counts the queries the context runs into <see cref="LedgerQueryCounter.Current"/>, for the test that shows how many a batch of participants costs.</param>
    public static LedgerKit Create(Guid? tenantId = null, string? database = null, DateTimeOffset? now = null, bool countQueries = false)
    {
        var id = tenantId ?? TenantA;
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(id);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var builder = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(database ?? Guid.NewGuid().ToString());
        if (countQueries) builder.ReplaceService<IAsyncQueryProvider, LedgerQueryCounter>();
        return new LedgerKit(new OdipDbContext(builder.Options, tenant.Object), new FakeClock(now ?? FundingTestKit.Now), id, tenant.Object);
    }

    /// <summary>The same builders over a context somebody else made (a scratch PostgreSQL database scoped to <paramref name="tenantId"/>), with the funding tests' fixed clock.</summary>
    public static LedgerKit Wrap(OdipDbContext db, Guid tenantId, DateTimeOffset? now = null) => new(db, new FakeClock(now ?? FundingTestKit.Now), tenantId, null);

    public void Dispose() => Db.Dispose();

    public static DateOnly D(int y, int m, int d) => new(y, m, d);

    // ── Provider, catalogue, holidays ───────────────────────────────────────

    public ProviderSettings SeedProvider(string state = "NSW", Guid? tenantId = null)
    {
        var settings = new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? TenantId, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test Provider", Address = "1 Test St", State = state,
        };
        Db.ProviderSettings.Add(settings);
        Db.SaveChanges();
        return settings;
    }

    public SupportActivityGroup CommunityAccess => _community ??= SeedGroup(Odip.Domain.Billing.Catalogue.CatalogueGroups.CommunityAccessGroupCode, "Community Access", 4);

    /// <summary>The activity group with this code: the one the database already holds (the catalogue is global), else a new one.</summary>
    public SupportActivityGroup SeedGroup(string code, string name, int category)
    {
        var existing = Db.SupportActivityGroups.FirstOrDefault(g => g.GroupCode == code);
        if (existing is not null) return existing;
        var group = new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = code, DisplayName = name, SupportCategory = category };
        Db.SupportActivityGroups.Add(group);
        Db.SaveChanges();
        return group;
    }

    /// <summary>
    /// The community access rows: standard and intensive for weekday, weekday evening, Saturday, Sunday and public holiday, all PACE category 4 and valid from 1 Jul 2026. Prices per hour in the
    /// states the tests use: VIC (the default) is 50, 55 evening, 70 Saturday, 90 Sunday, 110 holiday and intensive is 1.4 times that; NSW is 1.2 times the VIC figure.
    /// </summary>
    public void SeedCommunityAccessCatalogue(DateOnly? effectiveFrom = null, DateOnly? effectiveTo = null, string version = "2026-27")
    {
        var prices = new Dictionary<ClaimDayType, decimal>
        {
            [ClaimDayType.Weekday] = 50m, [ClaimDayType.WeekdayEvening] = 55m, [ClaimDayType.Saturday] = 70m, [ClaimDayType.Sunday] = 90m, [ClaimDayType.PublicHoliday] = 110m,
        };
        foreach (var (dayType, vic) in prices)
        {
            foreach (var intensive in new[] { false, true })
            {
                var price = intensive ? vic * 1.4m : vic;
                var item = new SupportCatalogueItem
                {
                    Id = Guid.NewGuid(), ActivityGroupId = CommunityAccess.Id, ItemNumber = $"04_{dayType}_{(intensive ? "INT" : "STD")}", Description = $"Community access {dayType}", DayType = dayType,
                    IsIntensive = intensive, PriceLimit_VIC = price, PriceLimit_NSW = price * 1.2m, PriceLimit_ACT = price, PriceLimit_NT = price, PriceLimit_QLD = price, PriceLimit_SA = price,
                    PriceLimit_TAS = price, PriceLimit_WA = price, PriceLimit_Remote = price, PriceLimit_VeryRemote = price, CatalogueVersion = version,
                    EffectiveFrom = effectiveFrom ?? new DateOnly(2026, 7, 1), EffectiveTo = effectiveTo, IsActive = effectiveTo is null, PaceSupportCategoryNumber = 4, SupportCategoryNumber = 4,
                };
                Db.SupportCatalogueItems.Add(item);
                _items[(dayType, intensive)] = item;
            }
        }
        Db.SaveChanges();
    }

    /// <summary>The community access rows, seeded when the database does not hold them yet and read back when another kit over the same database already seeded them (the catalogue is global).</summary>
    public void EnsureCommunityAccessCatalogue()
    {
        if (!Db.SupportCatalogueItems.Any(i => i.ItemNumber == "04_Weekday_STD" && i.CatalogueVersion == "2026-27")) { SeedCommunityAccessCatalogue(); return; }
        foreach (var item in Db.SupportCatalogueItems.Where(i => i.ActivityGroupId == CommunityAccess.Id && i.CatalogueVersion == "2026-27")) _items[(item.DayType, item.IsIntensive)] = item;
    }

    public SupportCatalogueItem Item(ClaimDayType dayType, bool intensive = false) => _items[(dayType, intensive)];

    /// <summary>A catalogue row outside community access (a capacity building item of category 15, say), for claim lines that belong to a stated pool.</summary>
    public SupportCatalogueItem SeedItem(string code, int paceCategory, string groupCode = "GRP_OTHER", decimal price = 100m, int? legacyCategory = null)
    {
        var group = Db.SupportActivityGroups.Local.FirstOrDefault(g => g.GroupCode == groupCode) ?? SeedGroup(groupCode, groupCode, paceCategory);
        var item = new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = group.Id, ItemNumber = code, Description = code, DayType = ClaimDayType.Weekday, PriceLimit_VIC = price, PriceLimit_NSW = price, CatalogueVersion = "2026-27",
            EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true, PaceSupportCategoryNumber = paceCategory, SupportCategoryNumber = legacyCategory,
        };
        Db.SupportCatalogueItems.Add(item);
        Db.SaveChanges();
        return item;
    }

    public void SeedHoliday(DateOnly date, string? state = null)
    {
        Db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = date, Name = "Test holiday", State = state });
        Db.SaveChanges();
    }

    // ── People and plans ────────────────────────────────────────────────────

    /// <param name="ndisNumber">"auto" (the default) gives each participant a number of their own; null gives none.</param>
    public Participant SeedParticipant(PlanType planType = PlanType.PlanManaged, string? ndisNumber = "auto", bool intensive = false, string? addressState = null, Guid? tenantId = null, string first = "Sophie", string last = "Brown")
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? TenantId, FirstName = first, LastName = last, IsActive = true, PlanType = planType, NdisNumber = ndisNumber == "auto" ? string.Create(System.Globalization.CultureInfo.InvariantCulture, $"4301{Interlocked.Increment(ref _numbers):00000}") : ndisNumber,
            IsIntensiveSupport = intensive, AddressState = addressState,
        };
        Db.Participants.Add(participant);
        Db.SaveChanges();
        return participant;
    }

    public static PeriodSpec Q(int quarter, decimal amount, decimal? setAside = null, int year = 2026) => quarter switch
    {
        1 => new PeriodSpec(D(year, 7, 1), D(year, 9, 30), amount, setAside),
        2 => new PeriodSpec(D(year, 10, 1), D(year, 12, 31), amount, setAside),
        3 => new PeriodSpec(D(year + 1, 1, 1), D(year + 1, 3, 31), amount, setAside),
        _ => new PeriodSpec(D(year + 1, 4, 1), D(year + 1, 6, 30), amount, setAside),
    };

    /// <summary>A Core (flexible) pool under <paramref name="management"/> holding the quarters given.</summary>
    public static PoolSpec Core(PlanType management, params PeriodSpec[] periods) => new(FundingPoolKind.CoreFlexible, 0, management, periods);
    public static PoolSpec Stated(int category, PlanType management, params PeriodSpec[] periods) => new(FundingPoolKind.Stated, category, management, periods);

    /// <summary>1 Jul 2026 to 30 Jun 2027 with the pools given, each holding every quarter at the amount given.</summary>
    public FundingPlan SeedPlan(Participant participant, params PoolSpec[] pools) => SeedPlan(participant, D(2026, 7, 1), D(2027, 6, 30), pools);

    public FundingPlan SeedPlan(Participant participant, DateOnly start, DateOnly end, params PoolSpec[] pools)
    {
        var plan = new FundingPlan
        {
            Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, PlanStart = start, PlanEnd = end, Evidence = BudgetEvidenceSource.PlanCopy, Revision = 1,
            CreatedAt = FundingTestKit.Now.UtcDateTime, UpdatedAt = FundingTestKit.Now.UtcDateTime, CreatedBy = "test", UpdatedBy = "test",
        };
        var position = 0;
        foreach (var spec in pools)
        {
            var pool = new FundingPool
            {
                Id = Guid.NewGuid(), TenantId = participant.TenantId, FundingPlanId = plan.Id, Position = position++, Kind = spec.Kind, PaceCategory = spec.PaceCategory, ManagementType = spec.Management,
                Name = spec.Kind == FundingPoolKind.CoreFlexible ? PaceCategories.CoreFlexibleName : PaceCategories.NameOf(spec.PaceCategory)!,
            };
            var order = 0;
            foreach (var period in spec.Periods)
            {
                pool.Periods.Add(new FundingPeriod
                {
                    Id = Guid.NewGuid(), TenantId = participant.TenantId, FundingPoolId = pool.Id, Position = order++, PeriodStart = period.Start, PeriodEnd = period.End, PlanAmount = period.Amount, SetAside = period.SetAside,
                });
            }
            plan.Pools.Add(pool);
        }
        Db.FundingPlans.Add(plan);
        Db.SaveChanges();
        return plan;
    }

    // ── Shifts, trips and claims ────────────────────────────────────────────

    public Shift SeedShift(Participant participant, DateOnly date, ShiftStatus status = ShiftStatus.Published, int startHour = 9, int endHour = 17, bool endsNextDay = false)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, ServiceDate = date, StartTime = new TimeOnly(startHour, 0), EndTime = new TimeOnly(endHour, 0),
            EndsNextDay = endsNextDay, Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
        };
        Db.Shifts.Add(shift);
        Db.SaveChanges();
        return shift;
    }

    public TripInstance SeedTrip(DateOnly start, int days, TripStatus status = TripStatus.Confirmed, string name = "Coastal weekend", decimal activeHours = 8m, Guid? groupId = null)
    {
        var trip = new TripInstance
        {
            Id = Guid.NewGuid(), TenantId = TenantId, TripName = name, StartDate = start, DurationDays = days, Status = status, ActiveHoursPerDay = activeHours,
            DepartureTime = new TimeOnly(8, 0), ReturnTime = new TimeOnly(18, 0), DefaultActivityGroupId = groupId,
        };
        for (var i = 0; i < days; i++)
            trip.TripDays.Add(new TripDay { Id = Guid.NewGuid(), TripInstanceId = trip.Id, DayNumber = i + 1, Date = start.AddDays(i) });
        Db.TripInstances.Add(trip);
        Db.SaveChanges();
        return trip;
    }

    public ParticipantBooking SeedBooking(TripInstance trip, Participant participant, BookingStatus status = BookingStatus.Confirmed, PlanType? planTypeOverride = null)
    {
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = status, PlanTypeOverride = planTypeOverride };
        Db.ParticipantBookings.Add(booking);
        Db.SaveChanges();
        return booking;
    }

    /// <summary>A shift-kind claim for the participant with one line, for $<paramref name="amount"/>, for the shift given: its code the weekday community access item's unless one is given, its dates the shift's.</summary>
    public TripClaim SeedShiftClaim(Participant participant, TripClaimStatus status, decimal amount, Shift shift, string? itemCode = null, string? reference = null)
    {
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id, Status = status, ClaimReference = reference ?? $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = amount };
        Db.TripClaims.Add(claim);
        Db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, SupportItemCode = itemCode ?? Item(ClaimDayType.Weekday).ItemNumber, DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = shift.ServiceDate, SupportsDeliveredTo = shift.ServiceDate, Hours = 8m, UnitPrice = amount / 8m, TotalAmount = amount, Status = ClaimLineItemStatus.Draft,
        });
        Db.SaveChanges();
        return claim;
    }

    /// <summary>A line on an existing claim, for a shift, with its own status and paid amount.</summary>
    public ClaimLineItem AddShiftLine(TripClaim claim, Shift shift, decimal amount, ClaimLineItemStatus status = ClaimLineItemStatus.Draft, decimal? paid = null, string? itemCode = null, DateOnly? date = null)
    {
        var line = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, SupportItemCode = itemCode ?? Item(ClaimDayType.Weekday).ItemNumber, DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = date ?? shift.ServiceDate, SupportsDeliveredTo = date ?? shift.ServiceDate, Hours = 8m, UnitPrice = amount / 8m, TotalAmount = amount, Status = status, PaidAmount = paid,
        };
        Db.ClaimLineItems.Add(line);
        Db.SaveChanges();
        return line;
    }

    /// <summary>A trip claim with one line for a booking.</summary>
    public (TripClaim Claim, ClaimLineItem Line) SeedTripClaim(TripInstance trip, ParticipantBooking booking, TripClaimStatus status, decimal amount, DateOnly from, string? itemCode = null)
    {
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, Status = status, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = amount };
        var line = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id, SupportItemCode = itemCode ?? Item(ClaimDayType.Weekday).ItemNumber, DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = from, SupportsDeliveredTo = from, Hours = 8m, UnitPrice = amount / 8m, TotalAmount = amount, Status = ClaimLineItemStatus.Draft,
        };
        Db.TripClaims.Add(claim);
        Db.ClaimLineItems.Add(line);
        Db.SaveChanges();
        return (claim, line);
    }
}

/// <summary>
/// Counts the queries a context runs (every Execute and ExecuteAsync is one query), like the demo idle-tick test's counter, but per test: the count lives in an <see cref="AsyncLocal{T}"/> that a test
/// starts and reads, so tests of other classes running at the same time (xUnit runs classes in parallel) can neither add to it nor reset it.
/// </summary>
public sealed class LedgerQueryCounter : IAsyncQueryProvider
{
    private static readonly AsyncLocal<int[]?> Counter = new();

    /// <summary>Starts counting for the current test; the returned array's first element is the number of queries run since.</summary>
    public static int[] Start() => Counter.Value = new int[1];

    private readonly EntityQueryProvider _inner;

    public LedgerQueryCounter(IQueryCompiler compiler) => _inner = new EntityQueryProvider(compiler);

    private static void Count() { if (Counter.Value is { } count) Interlocked.Increment(ref count[0]); }

    public IQueryable CreateQuery(Expression expression) => _inner.CreateQuery(expression);

    public IQueryable<TElement> CreateQuery<TElement>(Expression expression) => new EntityQueryable<TElement>(this, expression);

    public object? Execute(Expression expression) { Count(); return _inner.Execute(expression); }

    public TResult Execute<TResult>(Expression expression) { Count(); return _inner.Execute<TResult>(expression); }

    public TResult ExecuteAsync<TResult>(Expression expression, CancellationToken cancellationToken = default) { Count(); return _inner.ExecuteAsync<TResult>(expression, cancellationToken); }
}
