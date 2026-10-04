using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Moq;
using Odip.Api.Services;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// The shared set-up of the approval tests (the service and the controller): one in-memory database with an active participant, a provider in Sydney, a clock fixed on Saturday 10 October
/// 2026, and revisions stored as saving them would have stored them (their blocks, the engine's answer without its lines, and its lines).
/// </summary>
internal static class ApprovalTestSupport
{
    public static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();
    public static readonly DateOnly Today = new(2026, 10, 10);
    public static readonly DateOnly Start = new(2026, 10, 12);               // the Monday after today
    public static readonly DateOnly HorizonEnd = new(2026, 12, 5);           // today + 56 days
    public static readonly DayOfWeek[] Weekdays = { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday };

    public static readonly ApprovalCaller Admin = new(Guid.NewGuid(), "Alex Admin", new[] { "Admin" });
    public static readonly ApprovalCaller Coordinator = new(Guid.NewGuid(), "Casey Coordinator", new[] { "Coordinator" });
    public static readonly ApprovalCaller SuperAdmin = new(Guid.NewGuid(), "Sam Super", new[] { "SuperAdmin" });

    public sealed class Fixture : IAsyncDisposable
    {
        public required string DbName { get; init; }
        public required OdipDbContext Db { get; init; }
        public required Guid ParticipantId { get; init; }
        public FakeClock Clock { get; } = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        /// <summary>The settings the service and the controller read (<c>RosterTopUp:*</c>); none is the defaults: the top-up on, 56 days.</summary>
        public IConfiguration? Configuration { get; set; }
        public ServiceAgreementApprovalService Service => new(Db, new RosterPlacementGate(), new RosterShiftGenerator(), clock: Clock, configuration: Configuration);

        /// <summary>The daily top-up switched off (<c>RosterTopUp:Enabled</c> false), for the service and the controller alike.</summary>
        public void SwitchTopUpOff() => Configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["RosterTopUp:Enabled"] = "false" }).Build();
        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    public static OdipDbContext NewDb(string name, bool audited = false, params IInterceptor[] interceptors)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name);
        if (audited)
        {
            var identity = new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Admin.UserId!.Value.ToString()), new Claim("fullName", Admin.Name) }, "Test");
            var accessor = new Mock<IHttpContextAccessor>();
            accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });
            options.AddInterceptors(new AuditInterceptor(accessor.Object));
        }

        if (interceptors.Length > 0) options.AddInterceptors(interceptors);
        return new OdipDbContext(options.Options, tenant.Object);
    }

    public static async Task<Fixture> SetUpAsync(bool active = true, bool audited = false, string state = "NSW", string firstName = "Amy")
    {
        var name = Guid.NewGuid().ToString();
        var db = NewDb(name, audited);
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = firstName, LastName = "Ng", IsActive = active, IsDraft = !active };
        db.Participants.Add(participant);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantA, State = state });
        await db.SaveChangesAsync();
        return new Fixture { DbName = name, Db = db, ParticipantId = participant.Id };
    }

    public static PlanBlock WeekdayBlock(string id = "weekdays", Func<PlanBlock, PlanBlock>? change = null)
    {
        var block = Block(id, PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = Weekdays });
        return change is null ? block : change(block);
    }

    /// <summary>A revision as saving it would have stored it: the blocks, the engine's answer without its lines, and the lines it generated. <paramref name="shape"/> changes the answer (an issue, a Review line) the way a gap would.</summary>
    public static async Task<ServiceAgreementDraft> AddRevisionAsync(Fixture f, int version, IReadOnlyList<PlanBlock> blocks, DateOnly? start = null, DateOnly? end = null,
        Func<PlanQuote, PlanQuote>? shape = null, string state = "NSW", bool handTyped = false, DraftBlockRequirementsDto? requirements = null, IEnumerable<HolidayEntry>? holidays = null,
        Guid? tenantId = null, Guid? participantId = null)
    {
        var draft = BuildRevision(tenantId ?? TenantA, participantId ?? f.ParticipantId, version, blocks, start, end, shape, state, handTyped, requirements, holidays);
        f.Db.ServiceAgreementDrafts.Add(draft);
        await f.Db.SaveChangesAsync();
        return draft;
    }

    /// <summary>The revision as saving it would have stored it (blocks, answer and lines), not yet in any context: the Postgres tests add it to theirs.</summary>
    public static ServiceAgreementDraft BuildRevision(Guid tenantId, Guid participantId, int version, IReadOnlyList<PlanBlock> blocks, DateOnly? start = null, DateOnly? end = null,
        Func<PlanQuote, PlanQuote>? shape = null, string state = "NSW", bool handTyped = false, DraftBlockRequirementsDto? requirements = null, IEnumerable<HolidayEntry>? holidays = null)
    {
        var from = start ?? Start;
        var to = end ?? new DateOnly(2026, 12, 20);
        var quote = Quote(blocks, from, to, holidays: holidays);
        if (shape is not null) quote = shape(quote);
        var draft = new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, Version = version, State = state, ParticipantNameSnapshot = "Amy Ng",
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = from, AgreementEndDate = to,
            ServiceTypesJson = "[]", PricingJson = handTyped ? null : DraftJson.Write(quote),
        };
        if (!handTyped)
        {
            for (var i = 0; i < blocks.Count; i++)
                draft.Blocks.Add(new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, Position = i, BlockKey = blocks[i].Id, BlockJson = DraftJson.Write(blocks[i]), RequirementsJson = DraftJson.Write(requirements ?? new DraftBlockRequirementsDto()) });
            var position = 0;
            foreach (var line in ServiceAgreementDraftService.GroupLines(quote, blocks)) { line.Id = Guid.NewGuid(); line.DraftId = draft.Id; line.Position = position++; draft.Lines.Add(line); }
        }
        else
        {
            draft.Lines.Add(new ServiceAgreementDraftLine { Id = Guid.NewGuid(), DraftId = draft.Id, ServiceType = "Community access", ItemCode = "04_104_0125_6_1", Hours = 10, UnitPrice = 73.58m, CatalogueVersion = "2026-27", CatalogueEffectiveFrom = new DateOnly(2026, 7, 1) });
        }

        return draft;
    }

    public static PlanQuote WithIssue(PlanQuote quote, string blockId, PlanFailureReason reason, string message, int count = 3, DateOnly? first = null) =>
        quote with { Issues = quote.Issues.Append(new PlanIssue(blockId, reason, message, count, first ?? new DateOnly(2026, 10, 13))).ToList() };
}
