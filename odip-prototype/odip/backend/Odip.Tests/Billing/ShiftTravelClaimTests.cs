using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// Provider travel on a shift claim (travel plan A2): the source of the legs (actual or forecast), the pricing through the shared rule, and the lines the claim saves.
/// Fixtures: a community access item on RG 0125 that allows provider travel, and its 04_799 kilometre item in GRP_PROVIDER_TRAVEL.
/// </summary>
public class ShiftTravelClaimTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateOnly Monday = new(2026, 11, 2);
    private const decimal Price = 60.40m;
    private const string BasisNumber = "04_104_0125_6_1";
    private const string KmNumber = "04_799_0125_6_1";

    private sealed class Fx
    {
        public OdipDbContext Db = TestDb.Create();
        public Participant Participant = null!;
        public Guid TenantId;

        public static Fx Create(Guid? tenantId = null, bool orgClaims = true, CatalogueClaimFlag? travelFlag = CatalogueClaimFlag.Yes)
        {
            var fx = new Fx { TenantId = tenantId ?? ShiftTravelClaimTests.TenantId };
            var db = fx.Db;
            db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = fx.TenantId, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test", Address = "1 Test St", State = "VIC" });
            db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = fx.TenantId, ClaimProviderTravel = orgClaims });
            fx.Participant = new Participant { Id = Guid.NewGuid(), TenantId = fx.TenantId, FirstName = "Jane", LastName = "Doe", NdisNumber = "43100001234", PlanType = PlanType.AgencyManaged };
            db.Participants.Add(fx.Participant);
            var community = db.SupportActivityGroups.Local.FirstOrDefault(g => g.GroupCode == "GRP_COMMUNITY_ACCESS")
                ?? db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "GRP_COMMUNITY_ACCESS", DisplayName = "Community Access", SupportCategory = 4 }).Entity;
            var travel = db.SupportActivityGroups.Local.FirstOrDefault(g => g.GroupCode == "GRP_PROVIDER_TRAVEL")
                ?? db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "GRP_PROVIDER_TRAVEL", DisplayName = "Provider Travel", SupportCategory = 1 }).Entity;
            if (!db.SupportCatalogueItems.Local.Any(i => i.ItemNumber == BasisNumber))
            {
                db.SupportCatalogueItems.Add(Item(community.Id, BasisNumber, "H", Price, travelFlag));
                db.SupportCatalogueItems.Add(Item(travel.Id, KmNumber, "E", 1.00m, null));
            }
            return fx;
        }

        private static SupportCatalogueItem Item(Guid groupId, string number, string unit, decimal price, CatalogueClaimFlag? travel) => new()
        {
            Id = Guid.NewGuid(), ActivityGroupId = groupId, ItemNumber = number, Description = number, Unit = unit, DayType = ClaimDayType.Weekday, IsIntensive = false,
            RegistrationGroup = "0125", ProviderTravel = travel,
            PriceLimit_VIC = price, PriceLimit_NSW = price, PriceLimit_ACT = price, PriceLimit_NT = price, PriceLimit_QLD = price, PriceLimit_SA = price, PriceLimit_TAS = price, PriceLimit_WA = price,
            PriceLimit_Remote = price, PriceLimit_VeryRemote = price, CatalogueVersion = "2025-26", EffectiveFrom = new DateOnly(2025, 7, 1), IsActive = true,
        };

        public Shift Shift(DateOnly? date = null, Guid? patternId = null, ShiftStatus status = ShiftStatus.Completed)
        {
            var shift = new Shift
            {
                Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = Participant.Id, ServiceDate = date ?? Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(11, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status, ShiftPatternId = patternId,
            };
            Db.Shifts.Add(shift);
            return shift;
        }

        public ShiftCompletion Completion(Shift shift, int? preMin = null, decimal? preKm = null, int? postMin = null, decimal? postKm = null, bool submitted = true, bool active = true)
        {
            var completion = new ShiftCompletion
            {
                Id = Guid.NewGuid(), TenantId = TenantId, ShiftId = shift.Id, ActualStart = DateTime.UtcNow, ActualEnd = DateTime.UtcNow, TimeZoneId = "Australia/Melbourne", SubmittedByUserId = Guid.NewGuid(),
                StartedAt = DateTime.UtcNow, SubmittedAt = submitted ? DateTime.UtcNow : null, IsActive = active,
                PreShiftTravelMinutes = preMin, PreShiftTravelKilometres = preKm, PostShiftTravelMinutes = postMin, PostShiftTravelKilometres = postKm,
            };
            Db.ShiftCompletions.Add(completion);
            return completion;
        }

        /// <summary>A pattern made from an agreement block carrying this planned travel; the draft and block belong to this organisation unless <paramref name="draftTenantId"/> says otherwise.</summary>
        public ShiftPattern Pattern(PlanProviderTravel? travel, PlanLocation? location = null, Guid? draftTenantId = null)
        {
            var draft = new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = draftTenantId ?? TenantId, ParticipantId = Participant.Id, Version = 1, State = "VIC" };
            Db.ServiceAgreementDrafts.Add(draft);
            Db.ServiceAgreementDraftBlocks.Add(new ServiceAgreementDraftBlock
            {
                Id = Guid.NewGuid(), DraftId = draft.Id, BlockKey = "blk", BlockJson = DraftJson.Write(new PlanBlock { Travel = travel, Location = location ?? new PlanLocation { State = "VIC", Zone = PriceZone.National, Mm = 1 } }),
            });
            var pattern = new ShiftPattern { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = Participant.Id, SourceDraftId = draft.Id, SourceBlockKey = "blk", DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(11, 0), EffectiveFrom = Monday };
            Db.ShiftPatterns.Add(pattern);
            return pattern;
        }

        public async Task<ShiftClaimGenerated> Generate()
        {
            await Db.SaveChangesAsync();
            return await new ShiftClaimGenerationService(Db).GenerateAsync(Participant.Id, Monday, Monday.AddDays(7));
        }

        public async Task<List<ClaimLineItem>> Lines(ShiftClaimGenerated g) =>
            await Db.ClaimLineItems.Where(l => l.TripClaimId == g.Claim.Id).OrderBy(l => l.ShiftPart).ToListAsync();
    }

    private static bool IsTravel(ClaimLineItem l) => l.ClaimType == ClaimType.ProviderTravel || l.SupportItemCode.Contains("_799_");

    [Fact]
    public async Task T7_AHandMadeShift_ClaimsBothLegs_AsOneTimeLine_AndOneKmLine_OnTheShiftsOwnItem()
    {
        var fx = Fx.Create();
        var shift = fx.Shift();
        fx.Completion(shift, preMin: 20, preKm: 5m, postMin: 15, postKm: 4m);
        var lines = await fx.Lines(await fx.Generate());

        Assert.Equal(new[] { 0, 1, 2 }, lines.Select(l => l.ShiftPart));   // the band part, then travel n and n+1
        var time = Assert.Single(lines, l => l.ClaimType == ClaimType.ProviderTravel && l.SupportItemCode == BasisNumber);
        Assert.Equal(0.58m, time.Hours);                                    // 35 minutes
        Assert.Equal(0.58m * Price, time.TotalAmount);
        Assert.Equal(shift.Id, time.ShiftId);
        var km = Assert.Single(lines, l => l.SupportItemCode == KmNumber);
        Assert.Equal(ClaimType.Standard, km.ClaimType);   // blank in the file; only the time line is TRAN
        Assert.Equal(8.91m, km.Hours);                                      // floor(9 km x 0.99) at $1.00 an item
        Assert.Equal(8.91m, km.TotalAmount);
        Assert.Equal(Monday, km.SupportsDeliveredFrom);
    }

    [Fact]
    public async Task T3_OrgOff_TheClaimIsTheSameAsWithNoTravel()
    {
        var withTravel = Fx.Create(orgClaims: false);
        withTravel.Completion(withTravel.Shift(), preMin: 40, preKm: 10m, postMin: 40, postKm: 10m);
        var none = Fx.Create(orgClaims: false);
        none.Completion(none.Shift());
        var a = await withTravel.Lines(await withTravel.Generate());
        var b = await none.Lines(await none.Generate());
        Assert.Equal(b.Select(l => (l.SupportItemCode, l.Hours, l.TotalAmount, l.ClaimType)), a.Select(l => (l.SupportItemCode, l.Hours, l.TotalAmount, l.ClaimType)));
    }

    [Fact]
    public async Task T4_BlockOff_ClaimsNoTravel_AndFlagsTheAgreementSentence()
    {
        var fx = Fx.Create();
        var pattern = fx.Pattern(new PlanProviderTravel { Claim = false, MinutesEachWay = 20, ReturnToBase = true });
        fx.Completion(fx.Shift(patternId: pattern.Id), preMin: 20, preKm: 5m, postMin: 20);
        var generated = await fx.Generate();
        Assert.DoesNotContain(await fx.Lines(generated), IsTravel);
        Assert.Contains(generated.Flagged, f => f.Caveat.Contains("Travel not claimed: the agreement doesn't include provider travel."));
    }

    [Fact]
    public async Task D7_AgreementShiftWithTheReturnBoxOff_ClaimsOnlyTheBeforeLeg_AndFlagsTheTripBack()
    {
        var fx = Fx.Create();
        var pattern = fx.Pattern(new PlanProviderTravel { Claim = true, MinutesEachWay = 20, ReturnToBase = false });
        fx.Completion(fx.Shift(patternId: pattern.Id), preMin: 15, postMin: 15);
        var generated = await fx.Generate();
        var time = Assert.Single(await fx.Lines(generated), l => l.ClaimType == ClaimType.ProviderTravel);
        Assert.Equal(0.25m, time.Hours);
        Assert.Contains(generated.Flagged, f => f.Caveat.Contains("Travel after the shift not claimed: the agreement doesn't include the trip back."));
    }

    [Fact]
    public async Task T9_TheCapIsPerLeg_AndFlagged()
    {
        var fx = Fx.Create();
        var pattern = fx.Pattern(new PlanProviderTravel { Claim = true, MinutesEachWay = 50, ReturnToBase = true });
        fx.Completion(fx.Shift(patternId: pattern.Id), preMin: 50, postMin: 10);
        var generated = await fx.Generate();
        var time = Assert.Single(await fx.Lines(generated), l => l.ClaimType == ClaimType.ProviderTravel);
        Assert.Equal(0.67m, time.Hours);   // 30 + 10 = 40 minutes
        Assert.Contains(generated.Flagged, f => f.Caveat.Contains("Travel before the shift capped at 30 minutes: 50 minutes were recorded."));
    }

    [Fact]
    public async Task T13_ASharedTrip_ClaimsTheFlooredShare()
    {
        var fx = Fx.Create();
        var pattern = fx.Pattern(new PlanProviderTravel { Claim = true, MinutesEachWay = 25, ReturnToBase = false, ParticipantsSharing = 2 });
        fx.Completion(fx.Shift(patternId: pattern.Id), preMin: 25);
        var time = Assert.Single(await fx.Lines(await fx.Generate()), l => l.ClaimType == ClaimType.ProviderTravel);
        Assert.Equal(0.20m, time.Hours);   // 25 / 2 = 12 minutes
    }

    [Fact]
    public async Task T10_ABasisItemThatDoesNotAllowProviderTravel_ClaimsNoTravel_AndTheShiftIsStillClaimed()
    {
        var fx = Fx.Create(travelFlag: CatalogueClaimFlag.No);
        fx.Completion(fx.Shift(), preMin: 20, preKm: 5m);
        var generated = await fx.Generate();
        Assert.Single(await fx.Lines(generated));
        Assert.Contains(generated.Flagged, f => f.Caveat == $"Travel not claimed: {BasisNumber} does not allow provider travel.");
    }

    [Fact]
    public async Task C21_OnlyTheActiveSubmittedCompletionCounts_AReturnedOneWithTravelIsIgnored()
    {
        var fx = Fx.Create();
        var shift = fx.Shift();
        fx.Completion(shift, preMin: 30, preKm: 8m, active: false);   // the returned completion, still carrying travel
        fx.Completion(shift);                                         // the active one, with none
        Assert.DoesNotContain(await fx.Lines(await fx.Generate()), IsTravel);
    }

    [Fact]
    public async Task C22_ASubmittedCompletionWithNoLegs_ClaimsNothing_NotThePlannedForecast()
    {
        var fx = Fx.Create();
        var pattern = fx.Pattern(new PlanProviderTravel { Claim = true, MinutesEachWay = 20, KmEachWay = 5m, ReturnToBase = true });
        fx.Completion(fx.Shift(patternId: pattern.Id));
        Assert.DoesNotContain(await fx.Lines(await fx.Generate()), IsTravel);
    }

    [Fact]
    public async Task N4_TravelOnACompletionThatIsNotSubmitted_IsNeverClaimed()
    {
        var fx = Fx.Create();
        fx.Completion(fx.Shift(), preMin: 20, preKm: 5m, submitted: false);
        Assert.DoesNotContain(await fx.Lines(await fx.Generate()), IsTravel);
    }

    [Fact]
    public async Task T19_RunningTwice_MakesTheTravelLinesOnce_AndTheShiftIsNoLongerACandidate()
    {
        var fx = Fx.Create();
        fx.Completion(fx.Shift(), preMin: 20);
        var first = await fx.Generate();
        Assert.Contains(await fx.Lines(first), l => l.ClaimType == ClaimType.ProviderTravel);
        await Assert.ThrowsAsync<InvalidOperationException>(() => new ShiftClaimGenerationService(fx.Db).GenerateAsync(fx.Participant.Id, Monday, Monday.AddDays(7)));
        Assert.Equal(1, await fx.Db.ClaimLineItems.CountAsync(l => l.ClaimType == ClaimType.ProviderTravel));
    }

    [Fact]
    public async Task T18_TheRunsHours_ExcludeTheTravelLines()
    {
        var fx = Fx.Create();
        fx.Completion(fx.Shift(), preMin: 30, preKm: 5m);
        var generated = await fx.Generate();
        Assert.Equal(2m, generated.Hours);
    }

    [Fact]
    public async Task T23_TheSourceReadsOnlyTheCallersOrganisation()
    {
        var a = Fx.Create();
        var shiftA = a.Shift();
        a.Completion(shiftA, preMin: 30, preKm: 8m);
        var foreignPattern = a.Pattern(new PlanProviderTravel { Claim = true, MinutesEachWay = 30, ReturnToBase = true });
        await a.Db.SaveChangesAsync();
        var otherTenant = Guid.NewGuid();
        var policy = await ShiftTravelSource.PolicyAsync(a.Db, otherTenant, default);
        Assert.True(policy.OrgClaims);   // no settings row for the other organisation: on by default, and org A's row is not read

        // org B asks for org A's shift (the filter is off in this context): it gets no travel, never org A's completion.
        var inputs = await ShiftTravelSource.ForShiftsAsync(a.Db, otherTenant, policy, new[] { new ShiftRef(shiftA.Id, null) }, default);
        Assert.Null(Assert.Single(inputs));

        // org B's pattern naming org A's draft (a crafted row) gets no forecast.
        var crafted = new ShiftPattern { Id = Guid.NewGuid(), TenantId = otherTenant, ParticipantId = Guid.NewGuid(), SourceDraftId = foreignPattern.SourceDraftId, SourceBlockKey = "blk", DayOfWeek = DayOfWeek.Monday, EffectiveFrom = Monday };
        a.Db.ShiftPatterns.Add(crafted);
        await a.Db.SaveChangesAsync();
        Assert.Null(Assert.Single(await ShiftTravelSource.ForShiftsAsync(a.Db, otherTenant, policy, new[] { new ShiftRef(null, crafted.Id) }, default)));
    }

    [Fact]
    public async Task T23_OrgBSettingsAreNotOrgAs()
    {
        var a = Fx.Create(orgClaims: true);
        var otherTenant = Guid.NewGuid();
        a.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = otherTenant, ClaimProviderTravel = false });
        await a.Db.SaveChangesAsync();
        Assert.True((await ShiftTravelSource.PolicyAsync(a.Db, a.TenantId, default)).OrgClaims);
        Assert.False((await ShiftTravelSource.PolicyAsync(a.Db, otherTenant, default)).OrgClaims);
    }

    [Fact]
    public async Task TheForecast_FollowsTheReturnBox_AndC22_AnActualWithNoLegsIsNotForecast()
    {
        var fx = Fx.Create();
        var back = fx.Pattern(new PlanProviderTravel { Claim = true, MinutesEachWay = 20, KmEachWay = 3m, ReturnToBase = true });
        var oneWay = fx.Pattern(new PlanProviderTravel { Claim = true, MinutesEachWay = 20, KmEachWay = 3m, ReturnToBase = false });
        var off = fx.Pattern(new PlanProviderTravel { Claim = false, MinutesEachWay = 20 });
        var done = fx.Shift(patternId: back.Id, status: ShiftStatus.Published);
        fx.Completion(done);   // submitted, active, no legs
        await fx.Db.SaveChangesAsync();
        var policy = await ShiftTravelSource.PolicyAsync(fx.Db, fx.TenantId, default);
        var inputs = await ShiftTravelSource.ForShiftsAsync(fx.Db, fx.TenantId, policy,
            new[] { new ShiftRef(null, back.Id), new ShiftRef(null, oneWay.Id), new ShiftRef(null, off.Id), new ShiftRef(null, null), new ShiftRef(done.Id, back.Id) }, default);

        Assert.Equal((20, 3m, 20, 3m), (inputs[0]!.Pre.Minutes, inputs[0]!.Pre.Km, inputs[0]!.Post.Minutes, inputs[0]!.Post.Km));
        Assert.Equal((20, 3m, 0, 0m), (inputs[1]!.Pre.Minutes, inputs[1]!.Pre.Km, inputs[1]!.Post.Minutes, inputs[1]!.Post.Km));
        Assert.Null(inputs[2]);   // the block's claim is off: no forecast
        Assert.Null(inputs[3]);   // a hand-made future shift forecasts none
        Assert.Equal((0, 0m, 0, 0m), (inputs[4]!.Pre.Minutes, inputs[4]!.Pre.Km, inputs[4]!.Post.Minutes, inputs[4]!.Post.Km));   // submitted and empty: zero legs, no fallback
    }
}
