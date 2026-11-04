using Odip.Domain.Entities;

namespace Odip.Domain.Rostering;

/// <summary>What the Start check found. Printed as a sentence on the approval line, never as a pill.</summary>
public enum LocationCheckStatus
{
    AtLocation = 0,
    NotAtLocation = 1,
    Unavailable = 2,
    NoLocationSet = 3
}

/// <summary>The saved result of one Start check: no coordinate, only the answer and the distance.</summary>
public readonly record struct LocationCheckResult(LocationCheckStatus Status, int? DistanceMetres, int? AccuracyMetres, string? DefaultReason);

/// <summary>
/// Compares the phone's fix at Start with the shift's service location. Pure: the coordinates come in by value and nothing here keeps them.
/// In range means the distance, less the phone's own accuracy, is within the place's radius (owner ruling Q5, 2026-11-04).
/// </summary>
public static class LocationCheck
{
    public const int MaxReasonLength = 300;
    public const int MaxAccuracyMetres = 100000;
    public const string StartedOfflineReason = "Started offline";
    private const double EarthRadiusMetres = 6_371_008.8;

    public static LocationCheckResult Evaluate(ServiceLocation? place, decimal? latitude, decimal? longitude, double? accuracyMetres, bool declined, bool queued)
    {
        if (place is null) return new(LocationCheckStatus.NoLocationSet, null, null, null);
        if (queued) return new(LocationCheckStatus.Unavailable, null, null, StartedOfflineReason);
        if (declined || latitude is null || longitude is null) return new(LocationCheckStatus.Unavailable, null, null, null);

        var distance = (int)Math.Round(HaversineMetres((double)latitude.Value, (double)longitude.Value, (double)place.Latitude, (double)place.Longitude), MidpointRounding.AwayFromZero);
        int? accuracy = accuracyMetres is { } a && !double.IsNaN(a) ? (int)Math.Round(Math.Clamp(a, 0, MaxAccuracyMetres), MidpointRounding.AwayFromZero) : null;
        var status = distance - (accuracy ?? 0) <= place.RadiusMetres ? LocationCheckStatus.AtLocation : LocationCheckStatus.NotAtLocation;
        return new(status, distance, accuracy, null);
    }

    /// <summary>The worker's typed reason: trimmed, empty is none, cut to the column length (never a 400 on Start).</summary>
    public static string? CleanReason(string? reason)
    {
        var trimmed = reason?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return trimmed.Length > MaxReasonLength ? trimmed[..MaxReasonLength] : trimmed;
    }

    private static double HaversineMetres(double lat1, double lon1, double lat2, double lon2)
    {
        static double Rad(double d) => d * Math.PI / 180d;
        var dLat = Rad(lat2 - lat1);
        var dLon = Rad(lon2 - lon1);
        var h = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * EarthRadiusMetres * Math.Asin(Math.Min(1d, Math.Sqrt(h)));
    }
}
