using Odip.Domain.Billing.Services;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// Coverage for the shared day-type resolver extracted from
/// <c>ClaimGenerationService.ResolveDayType</c> (connection-map item 8) — each branch of the
/// public-holiday / Saturday / Sunday / weekday classification, on both overloads.
/// </summary>
public class DayTypeResolverTests
{
    // A known Monday, Saturday, Sunday triplet in the same week for stable DayOfWeek assertions.
    private static readonly DateOnly Monday = new(2026, 8, 24);
    private static readonly DateOnly Saturday = new(2026, 8, 29);
    private static readonly DateOnly Sunday = new(2026, 8, 30);

    [Fact]
    public void Resolve_WithFlag_PublicHolidayTakesPriorityOverWeekday()
    {
        Assert.Equal(ClaimDayType.PublicHoliday, DayTypeResolver.Resolve(Monday, isPublicHoliday: true));
    }

    [Fact]
    public void Resolve_WithFlag_PublicHolidayTakesPriorityOverSaturday()
    {
        Assert.Equal(ClaimDayType.PublicHoliday, DayTypeResolver.Resolve(Saturday, isPublicHoliday: true));
    }

    [Fact]
    public void Resolve_WithFlag_PublicHolidayTakesPriorityOverSunday()
    {
        Assert.Equal(ClaimDayType.PublicHoliday, DayTypeResolver.Resolve(Sunday, isPublicHoliday: true));
    }

    [Fact]
    public void Resolve_WithFlag_Saturday_ReturnsSaturday()
    {
        Assert.Equal(ClaimDayType.Saturday, DayTypeResolver.Resolve(Saturday, isPublicHoliday: false));
    }

    [Fact]
    public void Resolve_WithFlag_Sunday_ReturnsSunday()
    {
        Assert.Equal(ClaimDayType.Sunday, DayTypeResolver.Resolve(Sunday, isPublicHoliday: false));
    }

    [Fact]
    public void Resolve_WithFlag_Weekday_ReturnsWeekday()
    {
        Assert.Equal(ClaimDayType.Weekday, DayTypeResolver.Resolve(Monday, isPublicHoliday: false));
    }

    [Fact]
    public void Resolve_WithSet_DateInSet_ReturnsPublicHoliday()
    {
        var holidays = new HashSet<DateOnly> { Monday };
        Assert.Equal(ClaimDayType.PublicHoliday, DayTypeResolver.Resolve(Monday, holidays));
    }

    [Fact]
    public void Resolve_WithSet_DateNotInSet_FallsBackToDayOfWeek()
    {
        var holidays = new HashSet<DateOnly> { Sunday };
        Assert.Equal(ClaimDayType.Weekday, DayTypeResolver.Resolve(Monday, holidays));
        Assert.Equal(ClaimDayType.Saturday, DayTypeResolver.Resolve(Saturday, holidays));
    }

    [Fact]
    public void Resolve_WithSet_EmptySet_FallsBackToDayOfWeek()
    {
        var holidays = new HashSet<DateOnly>();
        Assert.Equal(ClaimDayType.Sunday, DayTypeResolver.Resolve(Sunday, holidays));
    }
}
