using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Odip.Application.DTOs;

namespace Odip.Infrastructure.Integrations;

/// <summary>
/// Google Places API (New): autocomplete for the address fields, and Place Details for the pick. A typed HttpClient like EmploymentHeroClient (Program.cs sets the 5 s timeout).
/// Both calls return null on any failure, so the caller decides what a failure means. Australia only, and the field masks ask for no coordinates. The key goes only into the
/// X-Goog-Api-Key header. Nothing that was typed is logged: a failure logs the status code and the elapsed time, never the text, the response body or an exception message.
/// </summary>
public sealed class GooglePlacesClient(HttpClient http, ILogger<GooglePlacesClient> logger)
{
    public const string BaseUrl = "https://places.googleapis.com/";
    public const string SuggestFieldMask = "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat";
    public const string DetailsFieldMask = "addressComponents,formattedAddress";
    private const string Language = "en-AU";

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<AddressSuggestionDto>?> SuggestAsync(string apiKey, string input, string session, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Post, "v1/places:autocomplete", apiKey, SuggestFieldMask);
        request.Content = JsonContent.Create(new { input, includedRegionCodes = new[] { "au" }, regionCode = "au", languageCode = Language, sessionToken = session }, options: Web);
        var reply = await SendAsync<SuggestReply>(request, ct);
        if (reply is null) return null;
        return (reply.Suggestions ?? new())
            .Select(s => s.PlacePrediction)
            .Where(p => !string.IsNullOrEmpty(p?.PlaceId))
            .Select(p => new AddressSuggestionDto(p!.PlaceId!, p.StructuredFormat?.MainText?.Text ?? "", AddressComponentsParser.WithoutCountry(p.StructuredFormat?.SecondaryText?.Text)))
            .ToList();
    }

    public async Task<AddressDetailsDto?> DetailsAsync(string apiKey, string placeId, string session, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Get, $"v1/places/{placeId}?sessionToken={session}&languageCode={Language}&regionCode=au", apiKey, DetailsFieldMask);
        var reply = await SendAsync<DetailsReply>(request, ct);
        return reply is null ? null : AddressComponentsParser.Parse(reply.AddressComponents, reply.FormattedAddress);
    }

    private static HttpRequestMessage Request(HttpMethod method, string path, string apiKey, string fieldMask)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Add("X-Goog-Api-Key", apiKey);
        request.Headers.Add("X-Goog-FieldMask", fieldMask);
        return request;
    }

    private async Task<T?> SendAsync<T>(HttpRequestMessage request, CancellationToken ct) where T : class
    {
        var clock = Stopwatch.StartNew();
        try
        {
            using var response = await http.SendAsync(request, ct);
            if (response.IsSuccessStatusCode) return await response.Content.ReadFromJsonAsync<T>(Web, ct);
            logger.LogWarning("Google Places answered {Status} after {ElapsedMs} ms", (int)response.StatusCode, clock.ElapsedMilliseconds);
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or NotSupportedException || (e is OperationCanceledException && !ct.IsCancellationRequested))
        {
            // The type only: an exception message can carry the request URI or part of the body.
            logger.LogWarning("Google Places failed ({Failure}) after {ElapsedMs} ms", e.GetType().Name, clock.ElapsedMilliseconds);
        }
        return null;
    }

    private sealed record SuggestReply(List<SuggestionItem>? Suggestions);
    private sealed record SuggestionItem(Prediction? PlacePrediction);
    private sealed record Prediction(string? PlaceId, Structured? StructuredFormat);
    private sealed record Structured(Words? MainText, Words? SecondaryText);
    private sealed record Words(string? Text);
    private sealed record DetailsReply(List<GoogleAddressComponent>? AddressComponents, string? FormattedAddress);
}

public static class GooglePlacesClientRegistration
{
    /// <summary>HttpClient's own logging category for the typed client.</summary>
    public const string Category = "System.Net.Http.HttpClient.GooglePlacesClient";

    /// <summary>The 5 s timeout, and the key header kept out of HttpClient's request logging.</summary>
    public static IHttpClientBuilder AddGooglePlacesClient(this IServiceCollection services) =>
        services.AddHttpClient<GooglePlacesClient>(c =>
        {
            c.BaseAddress = new Uri(GooglePlacesClient.BaseUrl);
            c.Timeout = TimeSpan.FromSeconds(5);
        }).RedactLoggedHeaders(new[] { "X-Goog-Api-Key" });

    /// <summary>Keeps each request URL (the details call names a place id and the session) out of the Information log.</summary>
    public static ILoggingBuilder QuietGooglePlacesClient(this ILoggingBuilder logging) => logging.AddFilter(Category, LogLevel.Warning);
}
