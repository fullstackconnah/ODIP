using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Services;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Readiness;

/// <summary>
/// The readiness queries that compose into SQL (the register filter, the per-organisation mode
/// subquery, the signed-agreement clause) are checked against the NPGSQL provider's translation,
/// not just EF InMemory: InMemory evaluates any LINQ in memory, so it would stay green even if one
/// of these stopped translating on PostgreSQL (the same blind spot that hid a Distinct-after-OrderBy
/// bug before). <c>ToQueryString</c> only builds SQL; nothing connects, so this needs no database.
/// </summary>
public class ParticipantReadinessSqlTests
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
    public void Register_Predicate_TranslatesToPostgresSql_AndReadsTheOrganisationsMode()
    {
        using var db = NpgsqlDb();

        var sql = ParticipantReadiness.OperationalRegister(db, db.Participants).ToQueryString();

        Assert.Contains("\"ParticipantOnboardings\"", sql);
        Assert.Contains("\"ProviderSettings\"", sql);
        Assert.Contains("\"ParticipantReadinessMode\" = 1", sql); // Enforce, compared as the stored integer
        Assert.Contains("\"IsDraft\"", sql);
    }

    [Fact]
    public void EnforcingTenants_TranslatesToAPlainFilteredSelect()
    {
        using var db = NpgsqlDb();

        var sql = ParticipantReadiness.EnforcingTenantIds(db).ToQueryString();

        Assert.Contains("\"ProviderSettings\"", sql);
        Assert.Contains("\"ParticipantReadinessMode\" = 1", sql);
        Assert.Contains("\"TenantId\"", sql);
    }

    [Fact]
    public void SignedAgreementClause_TranslatesToPostgresSql()
    {
        using var db = NpgsqlDb();

        var sql = ParticipantReadiness.SignedAgreementParticipantsForApprovedSourceForTesting(db).ToQueryString();

        Assert.Contains("\"ElectronicSigningSnapshots\"", sql);
        Assert.Contains("\"ElectronicSigningEvidence\"", sql);
        Assert.Contains("\"ServiceAgreementDrafts\"", sql);
        Assert.Contains("'Verified'", sql);
    }

    [Fact]
    public void SignedAgreement_WhileTheSourceIsUnapproved_IsAConstantFalse_NotAnEvidenceLookup()
    {
        using var db = NpgsqlDb();

        var sql = ParticipantReadiness.SignedAgreementParticipants(db).ToQueryString();

        Assert.DoesNotContain("ElectronicSigningEvidence", sql);
        Assert.Contains("FALSE", sql, StringComparison.OrdinalIgnoreCase);
    }
}
