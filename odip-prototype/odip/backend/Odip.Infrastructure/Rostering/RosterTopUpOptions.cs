using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// How far ahead the roster is kept for the patterns an approved agreement made. <c>RosterTopUp:Enabled</c> (default true) switches the daily job that tops the open shifts up, and
/// <c>RosterTopUp:HorizonDays</c> (default 56, eight weeks) is how many days ahead of the provider's today shifts are generated: by the job every day, and by an approval at once. A
/// horizon outside 7 to 366 days, or text that is not a whole number, is not trusted and reads as the default.
/// </summary>
public sealed record RosterTopUpOptions(bool Enabled, int HorizonDays)
{
    public const int DefaultHorizonDays = 56, MinHorizonDays = 7, MaxHorizonDays = 366;

    public static readonly RosterTopUpOptions Default = new(true, DefaultHorizonDays);

    public static RosterTopUpOptions From(IConfiguration? configuration)
    {
        if (configuration is null) return Default;
        var enabled = !bool.TryParse(configuration["RosterTopUp:Enabled"], out var parsed) || parsed;
        var horizon = int.TryParse(configuration["RosterTopUp:HorizonDays"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var days) && days is >= MinHorizonDays and <= MaxHorizonDays
            ? days : DefaultHorizonDays;
        return new RosterTopUpOptions(enabled, horizon);
    }
}
