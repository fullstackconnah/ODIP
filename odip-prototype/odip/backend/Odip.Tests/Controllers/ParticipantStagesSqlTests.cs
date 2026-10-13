using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Services;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The lifecycle-stage predicates the Enquiries and Onboarding tabs read (<see cref="ParticipantStages"/>) compose into the list SQL, so they
/// are checked against the NPGSQL provider's translation as well as in memory: EF InMemory evaluates any LINQ client-side and would stay green
/// even if one stopped translating on PostgreSQL. <c>ToQueryString</c> only builds SQL; nothing connects.
/// </summary>
public class ParticipantStagesSqlTests
{
    private static OdipDbContext NpgsqlDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql("Host=localhost;Database=odip_sql_translation_test;Username=postgres;Password=postgres")
            .Options;
        return new OdipDbContext(options, tenant.Object);
    }

    [Fact]
    public void InOnboarding_TranslatesToAFilterOnTheParticipantsOwnFlags_NeverOnAnOnboardingRow()
    {
        using var db = NpgsqlDb();

        var sql = ParticipantStages.InOnboarding(db.Participants).ToQueryString();

        Assert.Contains("\"IsDraft\"", sql);
        Assert.Contains("\"IntakeCompletedAt\" IS NOT NULL", sql);
        Assert.DoesNotContain("ParticipantOnboardings", sql);
        // A draft's stage follows its intake alone. The select list names every column, IsActive included, so only the filter is checked: if it
        // asks about IsActive too, a draft that is marked active (the seeded demo draft is) falls off every tab once its intake is complete.
        var filter = sql[sql.IndexOf("WHERE", StringComparison.Ordinal)..];
        Assert.DoesNotContain("\"IsActive\"", filter);
    }

    [Fact]
    public void DirectIntakes_TranslateToANotExistsOverTheEnquiries_AndAnOpenIntake()
    {
        using var db = NpgsqlDb();

        var sql = ParticipantStages.DirectIntakes(db, db.Participants).ToQueryString();

        Assert.Contains("\"IsDraft\"", sql);
        Assert.Contains("\"IntakeCompletedAt\" IS NULL", sql);
        Assert.Contains("NOT EXISTS", sql);
        Assert.Contains("\"ParticipantInquiries\"", sql);
    }

    [Fact]
    public void CanReceiveServices_TranslatesToAFilterOnActiveDraftAndServicesStarted()
    {
        using var db = NpgsqlDb();

        var sql = db.Participants.Where(Participant.CanReceiveServicesRule).ToQueryString();
        var filter = sql[sql.IndexOf("WHERE", StringComparison.Ordinal)..];

        Assert.Contains("\"IsActive\"", filter);
        Assert.Contains("\"IsDraft\"", filter);
        Assert.Contains("\"ServicesStartedAt\" IS NOT NULL", filter);
    }

    [Fact]
    public void TheChecklistsDerivedItems_TranslateToSql()
    {
        using var db = NpgsqlDb();

        var profile = ParticipantReadinessGate.ProfileDetailsParticipants(db).ToQueryString();
        var serviceNeeds = ParticipantReadinessGate.ServiceNeedsParticipants(db).ToQueryString();
        var issuesFilter = ParticipantReadinessGate.ActivationEvidenceParticipantsForApprovedSourceForTesting(db).ToQueryString();

        Assert.Contains("\"DateOfBirth\" IS NOT NULL", profile);
        Assert.Contains("\"NdisNumber\"", profile);
        Assert.DoesNotContain("\"Gender\"", profile[profile.IndexOf("WHERE", StringComparison.Ordinal)..]);
        Assert.Contains("\"ServiceAgreementDraftLines\"", serviceNeeds);
        Assert.Contains("\"Version\" >", serviceNeeds);
        Assert.DoesNotContain("\"ProfileComplete\"", issuesFilter);
        Assert.DoesNotContain("\"ServiceTypeConfirmed\"", issuesFilter);
    }

    [Theory]
    [InlineData("A", "B", true, "431", true)]
    [InlineData(" ", "B", true, "431", false)]
    [InlineData("A", "", true, "431", false)]
    [InlineData("A", "B", false, "431", false)]
    [InlineData("A", "B", true, " ", false)]
    [InlineData("A", "B", true, null, false)]
    public void ProfileDetails_TheRuleAndTheMissingWordsAgree(string first, string last, bool dob, string? ndis, bool done)
    {
        var p = new Participant { FirstName = first, LastName = last, DateOfBirth = dob ? new DateOnly(1990, 1, 1) : null, NdisNumber = ndis, FundingSource = Odip.Domain.Enums.ParticipantFundingSource.Ndis };

        Assert.Equal(done, new[] { p }.AsQueryable().Any(ParticipantReadinessGate.ProfileDetailsRule));
        Assert.Equal(done, Odip.Api.Controllers.ParticipantInquiriesController.ProfileMissing(p).Count == 0);
    }

    [Theory]
    [InlineData(false, true, false, true, true)]    // finalised and active
    [InlineData(false, false, false, false, true)]  // archived: past services, not active
    [InlineData(true, true, true, true, true)]      // services started, still onboarding
    [InlineData(true, true, false, false, false)]   // a draft (marked active) whose services have not started
    [InlineData(true, false, true, false, true)]    // services started, then switched off
    public void CanReceiveServices_AgreesBetweenTheQueryAndTheInMemoryCheck(bool isDraft, bool isActive, bool started, bool canReceive, bool begun)
    {
        var participant = new Participant { Id = Guid.NewGuid(), IsDraft = isDraft, IsActive = isActive, ServicesStartedAt = started ? DateTime.UtcNow : null };
        var asQuery = new[] { participant }.AsQueryable();

        Assert.Equal(canReceive, Participant.CanReceiveServices(participant));
        Assert.Equal(canReceive, asQuery.Any(Participant.CanReceiveServicesRule));
        Assert.Equal(begun, Participant.ServicesBegun(participant));
        Assert.Equal(begun, asQuery.Any(Participant.ServicesBegunRule));
    }

    /// <summary>The in-memory check and the query predicate are one rule; this holds the two forms together over every flag combination.</summary>
    [Theory]
    [InlineData(true, false, true, true)]    // draft, intake complete: in onboarding
    [InlineData(true, false, false, false)]  // draft with an open intake: an Enquiries-tab row
    [InlineData(true, true, true, true)]     // a draft marked active (the seeded demo draft: Participant.IsActive defaults to true) is in onboarding too
    [InlineData(true, true, false, false)]   // the same draft while its intake is open: an Enquiries-tab row
    [InlineData(false, false, true, false)]  // finalised and inactive: Archived
    [InlineData(false, true, true, false)]   // finalised and active: the Active tab
    [InlineData(false, true, false, false)]  // legacy active participant, intake never stamped
    public void InOnboarding_AgreesBetweenTheQueryAndTheInMemoryCheck(bool isDraft, bool isActive, bool intakeDone, bool expected)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "A", LastName = "B", IsDraft = isDraft, IsActive = isActive,
            IntakeCompletedAt = intakeDone ? DateTime.UtcNow : null,
        };

        Assert.Equal(expected, ParticipantStages.IsInOnboarding(participant));
        Assert.Equal(expected, ParticipantStages.InOnboarding(new[] { participant }.AsQueryable()).Any());
    }
}
