namespace Odip.Domain.Entities;

/// <summary>
/// One person's saved screen choices (today only the trip itinerary view). Keyed on the user, not the tenant, and read
/// and written only for the signed-in user. NOT an <see cref="Interfaces.ITenantEntity"/> and not audited (a view
/// toggle is not a record change). One typed column per choice: the next saved choice adds a column.
/// </summary>
public class UserUiPreference
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    /// <summary><c>days</c> or <c>list</c>; null until the person picks one.</summary>
    public string? ItineraryView { get; set; }

    public DateTime UpdatedAt { get; set; }
}
