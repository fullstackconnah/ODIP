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
        Assert.Contains("NOT (", sql); // not active
        Assert.Contains("\"IsActive\"", sql);
        Assert.Contains("\"IntakeCompletedAt\" IS NOT NULL", sql);
        Assert.DoesNotContain("ParticipantOnboardings", sql);
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

    /// <summary>The in-memory check and the query predicate are one rule; this holds the two forms together over every flag combination.</summary>
    [Theory]
    [InlineData(true, false, true, true)]    // draft, intake complete, not active: in onboarding
    [InlineData(true, false, false, false)]  // draft with an open intake: an Enquiries-tab row
    [InlineData(true, true, true, false)]    // a draft that is somehow active is not "not yet active"
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
