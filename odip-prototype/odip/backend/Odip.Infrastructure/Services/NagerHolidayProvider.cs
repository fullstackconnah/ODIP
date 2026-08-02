using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Odip.Infrastructure.Services;

public record HolidayRecord(DateOnly Date, string Name, string[] Counties);

public interface IHolidayProvider
{
    Task<IEnumerable<HolidayRecord>> GetHolidaysAsync(int year, string countryCode);
}

public class NagerHolidayProvider : IHolidayProvider
{
    private readonly HttpClient _http;

    public NagerHolidayProvider(HttpClient http) => _http = http;

    public async Task<IEnumerable<HolidayRecord>> GetHolidaysAsync(int year, string countryCode)
    {
        var url = $"https://date.nager.at/api/v3/PublicHolidays/{year}/{countryCode}";
        var items = await _http.GetFromJsonAsync<NagerHolidayDto[]>(url);
        if (items is null) return [];
        return items.Select(h => new HolidayRecord(
            DateOnly.Parse(h.Date),
            h.LocalName,
            h.Counties?.ToArray() ?? []
        ));
    }

    private sealed class NagerHolidayDto
    {
        [JsonPropertyName("date")] public string Date { get; set; } = "";
        [JsonPropertyName("localName")] public string LocalName { get; set; } = "";
        [JsonPropertyName("counties")] public string[]? Counties { get; set; }
    }
}
