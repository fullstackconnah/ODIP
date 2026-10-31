using Odip.Domain.Complaints;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Complaints;

/// <summary>"Open N days" is whole provider-local calendar days from ReceivedOn, only while the complaint is Open or Investigating; "long open" is exactly more than 21 of them.</summary>
public class ComplaintAgeTests
{
    private static readonly DateOnly Today = new(2026, 10, 31);

    [Fact]
    public void OpenDays_IsZeroOnTheDayItWasReceived() =>
        Assert.Equal(0, ComplaintAge.OpenDays(ComplaintStatus.Open, Today, Today));

    [Theory]
    [InlineData(ComplaintStatus.Resolved)]
    [InlineData(ComplaintStatus.Closed)]
    public void OpenDays_IsNullOnceResolvedOrClosed(ComplaintStatus status) =>
        Assert.Null(ComplaintAge.OpenDays(status, Today.AddDays(-40), Today));

    [Fact]
    public void Investigating_CountsAsOpen() =>
        Assert.Equal(5, ComplaintAge.OpenDays(ComplaintStatus.Investigating, Today.AddDays(-5), Today));

    [Theory]
    [InlineData(21, false)]
    [InlineData(22, true)]
    public void LongOpen_IsMoreThan21Days(int days, bool expected)
    {
        var received = Today.AddDays(-days);
        Assert.Equal(expected, ComplaintAge.OpenDays(ComplaintStatus.Open, received, Today) > ComplaintAge.LongOpenDays);
        var rows = new[] { new Odip.Domain.Entities.Complaint { Status = ComplaintStatus.Open, ReceivedOn = received } };
        Assert.Equal(expected, rows.AsQueryable().Where(ComplaintAge.IsOpenLongerThanExpr(Today)).Any());
    }

    [Fact]
    public void LongOpen_ExcludesAResolvedComplaintOfAnyAge()
    {
        var rows = new[] { new Odip.Domain.Entities.Complaint { Status = ComplaintStatus.Resolved, ReceivedOn = Today.AddDays(-40) } };
        Assert.Empty(rows.AsQueryable().Where(ComplaintAge.IsOpenLongerThanExpr(Today)));
    }

    [Fact]
    public void Today_IsTheProviderDate_NotTheUtcDate()
    {
        // 23:30 UTC on 30 Oct is already 31 Oct in Sydney (UTC+11 in summer time).
        var utc = new DateTime(2026, 10, 30, 23, 30, 0, DateTimeKind.Utc);
        var providerToday = ProviderLocalTime.TodayIn(utc, ProviderTimeZoneResolver.For(null, "NSW").Zone);
        Assert.Equal(new DateOnly(2026, 10, 31), providerToday);
        Assert.Equal(1, ComplaintAge.OpenDays(ComplaintStatus.Open, new DateOnly(2026, 10, 30), providerToday));
        Assert.Equal(0, ComplaintAge.OpenDays(ComplaintStatus.Open, new DateOnly(2026, 10, 30), DateOnly.FromDateTime(utc)));
    }
}
