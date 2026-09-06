using System;
using Odip.Domain.Entities;
using Xunit;

namespace Odip.Tests.DomainTests;

public class UserTests
{
    private static User BuildUser() => new()
    {
        Id = Guid.NewGuid(),
        TenantId = Guid.NewGuid(),
        Username = "jsmith",
        Email = "jsmith@example.com",
        FirstName = "Jamie",
        LastName = "Smith",
    };

    [Fact]
    public void HasExpiredQualifications_IsTrue_WhenOnlyWorkerScreeningHasExpired()
    {
        var user = BuildUser();
        user.WorkerScreeningNumber = "WWCC-12345";
        user.WorkerScreeningExpiryDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);

        Assert.True(user.HasExpiredQualifications);
    }

    [Fact]
    public void HasExpiredQualifications_IsFalse_WhenWorkerScreeningExpiryIsInTheFuture_AndNothingElseIsSet()
    {
        var user = BuildUser();
        user.WorkerScreeningNumber = "WWCC-12345";
        user.WorkerScreeningExpiryDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(30);

        Assert.False(user.HasExpiredQualifications);
    }

    [Fact]
    public void HasExpiredQualifications_IsFalse_WhenNoExpiryDatesAreSetAtAll()
    {
        var user = BuildUser();

        Assert.False(user.HasExpiredQualifications);
    }

    [Fact]
    public void HasExpiredQualifications_IsTrue_WhenAnExistingFlagStillDetectsExpiry_RegressionGuard()
    {
        var user = BuildUser();
        user.IsFirstAidQualified = true;
        user.FirstAidExpiryDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);

        Assert.True(user.HasExpiredQualifications);
    }
}
