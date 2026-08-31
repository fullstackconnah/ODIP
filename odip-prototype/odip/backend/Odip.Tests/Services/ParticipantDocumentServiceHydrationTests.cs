using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>
/// DOC-01 review polish — closes a hydration gap the composer tests can't reach:
/// <see cref="ParticipantDocumentComposerTests"/> hand-builds an in-memory <see cref="Participant"/>
/// with every nav collection already populated, so it can never notice a missing
/// <c>.Include(...)</c> on <see cref="ParticipantDocumentService"/>'s EF query — an empty
/// (un-hydrated) collection composes into an empty table exactly as validly as a genuinely-empty
/// one. Verified by manually deleting <c>.Include(x => x.HealthConditions)</c> from
/// <c>ParticipantDocumentService.LoadParticipantAsync</c> and re-running: this suite's
/// <see cref="ComposeParticipantProfileAsync_HydratesAndComposes_EveryChildCollection"/> test failed
/// (the Health Conditions marker vanished from the composed model) while every other existing test
/// in the solution kept passing — restored before committing.
///
/// Deliberately asserts on the returned <see cref="ParticipantDocumentModel"/>'s content (walking
/// Sections/Fields/Tables for a distinctive marker string per child collection), NOT on rendered
/// PDF bytes — QuestPDF's output stream is compressed, so byte-level text search is unreliable and
/// was explicitly ruled out for this coverage gap. Calls
/// <see cref="ParticipantDocumentService.ComposeIntakeFormAsync"/> /
/// <see cref="ParticipantDocumentService.ComposeParticipantProfileAsync"/> directly — the load+
/// compose seam extracted out of <c>GenerateIntakeFormAsync</c>/<c>GenerateParticipantProfileAsync</c>
/// specifically so a test can reach the hydrated model without going through QuestPDF rendering or
/// re-implementing the EF load itself.
///
/// IMPORTANT — seeding and querying MUST use two separate <see cref="OdipDbContext"/> instances
/// (same backing InMemory database name, via <see cref="CreateDb"/>, disposing the seeding context
/// before opening the querying one): a first pass at this suite seeded and queried through the SAME
/// context instance, and EF Core's change-tracker relationship fixup silently populated every
/// navigation collection from the tracked graph regardless of <c>.Include(...)</c> — which meant
/// deleting an Include did NOT fail the test, defeating its entire purpose. Using a fresh context
/// for the query forces a real hydration through <c>LoadParticipantAsync</c>'s Include chain, same
/// as the real controller path (a genuinely separate request/DbContext from whatever wrote the
/// data).
/// </summary>
public class ParticipantDocumentServiceHydrationTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    // Distinctive, unmistakable marker strings — one per child collection under test — so a
    // present/absent check can't be confused with any of the composer's own fixed vocabulary
    // (placeholders, enum labels, section headings, etc).
    private const string ContactMarker = "Zzyzxauthor Testcontact";
    private const string ConsentMarker = "Zzyzxconsent Signatory";
    private const string HealthConditionMarker = "Zzyzxhealth marker notes";
    private const string AdlMarker = "Zzyzxadl marker notes";
    private const string ChecklistMarker = "Zzyzxchecklist marker notes";
    private const string RiskEntryMarker = "Zzyzxrisk marker description";

    /// <summary>Seeds via its own throwaway context against <paramref name="dbName"/>, then disposes it — so the caller's own (separate) context has to genuinely query/Include, not ride the seeding context's change-tracker fixup. Returns just the id: the caller should load fresh.</summary>
    private static Guid SeedFullyPopulatedParticipant(string dbName)
    {
        using var db = CreateDb(dbName);
        var participant = new Participant
        {
            Id = Guid.NewGuid(),
            FirstName = "Hydration",
            LastName = "Coverage",
            NdisNumber = "999888777",
            ServiceStreams = ServiceStreams.CommunityAccessDailyLiving,
        };
        db.Participants.Add(participant);

        var person = new Person { Id = Guid.NewGuid(), FirstName = "Zzyzxauthor", LastName = "Testcontact" };
        db.People.Add(person);

        db.ParticipantContactRoles.Add(new ParticipantContactRole
        {
            Id = Guid.NewGuid(),
            ParticipantId = participant.Id,
            PersonId = person.Id,
            RoleType = ContactRoleType.NextOfKin,
            IsPrimary = true,
            Status = ContactRoleStatus.Active,
        });

        db.ParticipantConsents.Add(new ParticipantConsent
        {
            Id = Guid.NewGuid(),
            ParticipantId = participant.Id,
            ConsentType = ConsentType.PhotoVideo,
            Granted = true,
            SignedByName = ConsentMarker,
        });

        db.ParticipantHealthConditions.Add(new ParticipantHealthCondition
        {
            Id = Guid.NewGuid(),
            ParticipantId = participant.Id,
            ConditionType = HealthConditionType.Epilepsy,
            Has = true, // required to survive the "answers only" (Has == true) table filter
            Notes = HealthConditionMarker,
        });

        db.ParticipantAdlAssessments.Add(new ParticipantAdlAssessment
        {
            Id = Guid.NewGuid(),
            ParticipantId = participant.Id,
            AdlType = AdlType.Dressing,
            Level = AdlLevel.Supervision, // non-null Level so the row is meaningfully populated
            Notes = AdlMarker,
        });

        db.ParticipantChecklistItems.Add(new ParticipantChecklistItem
        {
            Id = Guid.NewGuid(),
            ParticipantId = participant.Id,
            ItemType = ChecklistItemType.UsesWheelchair,
            Value = ChecklistItemValue.Yes, // required to survive the "answered-only" (Value.HasValue) table filter
            Notes = ChecklistMarker,
        });

        db.ParticipantRiskEntries.Add(new ParticipantRiskEntry
        {
            Id = Guid.NewGuid(),
            ParticipantId = participant.Id,
            AtRiskParty = AtRiskParty.Participant,
            Description = RiskEntryMarker,
            IsActive = true,
        });

        db.SaveChanges();
        return participant.Id;
    }

    /// <summary>Walks every field value and every table cell in the model looking for <paramref name="marker"/> — a model-content assertion, not merely "no exception was thrown".</summary>
    private static bool ModelContainsMarker(ParticipantDocumentModel model, string marker) =>
        model.Sections.Any(section =>
            section.Fields.Any(field => field.Value.Contains(marker, StringComparison.Ordinal)) ||
            section.Tables.Any(table => table.Rows.Any(row => row.Any(cell => cell.Contains(marker, StringComparison.Ordinal)))));

    [Fact]
    public async Task ComposeParticipantProfileAsync_HydratesAndComposes_EveryChildCollection()
    {
        var dbName = Guid.NewGuid().ToString();
        var participantId = SeedFullyPopulatedParticipant(dbName);

        using var db = CreateDb(dbName);
        var service = new ParticipantDocumentService(db);

        var model = await service.ComposeParticipantProfileAsync(participantId, CancellationToken.None);

        Assert.NotNull(model);
        // Contacts is Shared (both documents) per ParticipantDocumentFieldMap — the rest
        // (Consents, Health Conditions, ADL Assessments, Checklist Items, Risk Entries) are
        // Participant Profile-only, so this document is the one place all six can be checked.
        Assert.True(ModelContainsMarker(model!, ContactMarker), "Contacts table did not surface the seeded contact — .Include(ContactRoles)/ThenInclude(Person) not hydrating?");
        Assert.True(ModelContainsMarker(model!, ConsentMarker), "Consents table did not surface the seeded consent — .Include(Consents) not hydrating?");
        Assert.True(ModelContainsMarker(model!, HealthConditionMarker), "Health Conditions table did not surface the seeded condition — .Include(HealthConditions) not hydrating?");
        Assert.True(ModelContainsMarker(model!, AdlMarker), "ADL Assessments table did not surface the seeded assessment — .Include(AdlAssessments) not hydrating?");
        Assert.True(ModelContainsMarker(model!, ChecklistMarker), "Checklist Items table did not surface the seeded item — .Include(ChecklistItems) not hydrating?");
        Assert.True(ModelContainsMarker(model!, RiskEntryMarker), "Risk Entries table did not surface the seeded entry — the separate ParticipantRiskEntries query is broken?");
    }

    [Fact]
    public async Task ComposeIntakeFormAsync_HydratesAndComposes_TheSharedContactsTable()
    {
        var dbName = Guid.NewGuid().ToString();
        var participantId = SeedFullyPopulatedParticipant(dbName);

        using var db = CreateDb(dbName);
        var service = new ParticipantDocumentService(db);

        var model = await service.ComposeIntakeFormAsync(participantId, CancellationToken.None);

        Assert.NotNull(model);
        Assert.True(ModelContainsMarker(model!, ContactMarker), "Contacts table (Shared, present on the Intake Form too) did not surface the seeded contact — .Include(ContactRoles)/ThenInclude(Person) not hydrating?");
    }
}
