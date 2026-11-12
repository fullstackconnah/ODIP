namespace Odip.Application.DTOs;

/// <summary>The caller's saved screen choices. <c>ItineraryView</c> is <c>days</c> or <c>list</c>, null when never chosen.</summary>
public class UiPreferencesDto
{
    public string? ItineraryView { get; set; }
}
