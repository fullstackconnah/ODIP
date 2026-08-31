using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Contacts;

/// <summary>Pure-logic coverage for CONTACT-02/03's shared gating/uniqueness rules.</summary>
public class ContactRoleRulesTests
{
    // ── CalculateAge ─────────────────────────────────────────────────────

    [Theory]
    [InlineData(2010, 1, 1, 2026, 8, 31, 16)]
    [InlineData(2008, 9, 1, 2026, 8, 31, 17)] // birthday tomorrow — hasn't turned 18 yet
    [InlineData(2008, 8, 31, 2026, 8, 31, 18)] // birthday is today
    public void CalculateAge_ReturnsWholeYears(int dobY, int dobM, int dobD, int asOfY, int asOfM, int asOfD, int expected)
    {
        var age = ContactRoleRules.CalculateAge(new DateOnly(dobY, dobM, dobD), new DateOnly(asOfY, asOfM, asOfD));
        Assert.Equal(expected, age);
    }

    [Fact]
    public void CalculateAge_NullDateOfBirth_ReturnsNull()
    {
        Assert.Null(ContactRoleRules.CalculateAge(null));
    }

    // ── Validate (CONTACT-02 gating) ─────────────────────────────────────

    [Fact]
    public void Validate_PlanManagerForPlanManaged_IsAllowed()
    {
        Assert.Null(ContactRoleRules.Validate(ContactRoleType.PlanManager, PlanType.PlanManaged, null, null));
    }

    [Theory]
    [InlineData(PlanType.SelfManaged)]
    [InlineData(PlanType.AgencyManaged)]
    public void Validate_PlanManagerForNonPlanManaged_IsRejected(PlanType planType)
    {
        var error = ContactRoleRules.Validate(ContactRoleType.PlanManager, planType, null, null);
        Assert.NotNull(error);
        Assert.Contains("plan-managed", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Validate_ProviderContactForAgencyManagedWithoutRegisteredFlag_IsRejected()
    {
        var error = ContactRoleRules.Validate(ContactRoleType.ProviderContact, PlanType.AgencyManaged, null, registeredProviderFlag: false);
        Assert.NotNull(error);
        Assert.Contains("registered-provider", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Validate_ProviderContactForAgencyManagedWithRegisteredFlag_IsAllowed()
    {
        Assert.Null(ContactRoleRules.Validate(ContactRoleType.ProviderContact, PlanType.AgencyManaged, null, registeredProviderFlag: true));
    }

    [Theory]
    [InlineData(PlanType.PlanManaged)]
    [InlineData(PlanType.SelfManaged)]
    public void Validate_ProviderContactForNonAgencyManaged_UnregisteredIsAllowed(PlanType planType)
    {
        Assert.Null(ContactRoleRules.Validate(ContactRoleType.ProviderContact, planType, null, registeredProviderFlag: false));
    }

    [Fact]
    public void Validate_PlanNomineeForUnder18_IsRejected()
    {
        var dob = DateOnly.FromDateTime(DateTime.UtcNow.AddYears(-10));
        var error = ContactRoleRules.Validate(ContactRoleType.PlanNominee, PlanType.SelfManaged, dob, null);
        Assert.NotNull(error);
        Assert.Contains("under 18", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Validate_PlanNomineeForAdult_IsAllowed()
    {
        var dob = DateOnly.FromDateTime(DateTime.UtcNow.AddYears(-30));
        Assert.Null(ContactRoleRules.Validate(ContactRoleType.PlanNominee, PlanType.SelfManaged, dob, null));
    }

    [Fact]
    public void Validate_PlanNomineeWithUnknownDateOfBirth_IsAllowed()
    {
        // Conservative per this task's brief: an unknown age never gates a role away.
        Assert.Null(ContactRoleRules.Validate(ContactRoleType.PlanNominee, PlanType.SelfManaged, null, null));
    }

    [Fact]
    public void Validate_ChildRepresentativeForAdult_IsAllowed()
    {
        // Research: "becomes read-only/historical" on turning 18 — a transition prompt, not a
        // hard server-side block, unlike PlanNominee's under-18 rejection.
        var dob = DateOnly.FromDateTime(DateTime.UtcNow.AddYears(-30));
        Assert.Null(ContactRoleRules.Validate(ContactRoleType.ChildRepresentative, PlanType.SelfManaged, dob, null));
    }

    [Theory]
    [InlineData(PlanType.SelfManaged)]
    [InlineData(PlanType.PlanManaged)]
    [InlineData(PlanType.AgencyManaged)]
    public void Validate_SupportCoordinator_NeverGatedOnPlanManagementType(PlanType planType)
    {
        Assert.Null(ContactRoleRules.Validate(ContactRoleType.SupportCoordinator, planType, null, null));
    }

    [Theory]
    [InlineData(PlanType.SelfManaged)]
    [InlineData(PlanType.PlanManaged)]
    [InlineData(PlanType.AgencyManaged)]
    public void Validate_Guardian_NeverGatedOnPlanManagementType(PlanType planType)
    {
        Assert.Null(ContactRoleRules.Validate(ContactRoleType.Guardian, planType, null, null));
    }

    // ── ValidateUniqueness (CONTACT-03) ──────────────────────────────────

    [Fact]
    public void ValidateUniqueness_SecondActivePlanManager_IsRejected()
    {
        var existing = new[] { (ContactRoleType.PlanManager, false, ContactRoleStatus.Active) };
        var error = ContactRoleRules.ValidateUniqueness(ContactRoleType.PlanManager, false, ContactRoleStatus.Active, existing);
        Assert.NotNull(error);
    }

    [Fact]
    public void ValidateUniqueness_SecondPlanManagerWhenFirstIsExpired_IsAllowed()
    {
        var existing = new[] { (ContactRoleType.PlanManager, false, ContactRoleStatus.Expired) };
        Assert.Null(ContactRoleRules.ValidateUniqueness(ContactRoleType.PlanManager, false, ContactRoleStatus.Active, existing));
    }

    [Fact]
    public void ValidateUniqueness_SecondPrimaryNextOfKin_IsRejected()
    {
        var existing = new[] { (ContactRoleType.NextOfKin, true, ContactRoleStatus.Active) };
        var error = ContactRoleRules.ValidateUniqueness(ContactRoleType.NextOfKin, true, ContactRoleStatus.Active, existing);
        Assert.NotNull(error);
    }

    [Fact]
    public void ValidateUniqueness_SecondNonPrimaryNextOfKin_IsAllowed()
    {
        var existing = new[] { (ContactRoleType.NextOfKin, true, ContactRoleStatus.Active) };
        Assert.Null(ContactRoleRules.ValidateUniqueness(ContactRoleType.NextOfKin, false, ContactRoleStatus.Active, existing));
    }

    [Fact]
    public void ValidateUniqueness_UnlimitedSpecialistsAndProviderContacts_IsAllowed()
    {
        var existing = new[]
        {
            (ContactRoleType.Specialist, false, ContactRoleStatus.Active),
            (ContactRoleType.ProviderContact, false, ContactRoleStatus.Active),
        };
        Assert.Null(ContactRoleRules.ValidateUniqueness(ContactRoleType.Specialist, false, ContactRoleStatus.Active, existing));
        Assert.Null(ContactRoleRules.ValidateUniqueness(ContactRoleType.ProviderContact, false, ContactRoleStatus.Active, existing));
    }
}
