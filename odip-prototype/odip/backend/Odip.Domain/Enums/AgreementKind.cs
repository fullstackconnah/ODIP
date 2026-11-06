namespace Odip.Domain.Enums;

/// <summary>What a service agreement is for, chosen from a list when it starts (a participant can hold several at once). Stored as an int: never renumber.</summary>
public enum AgreementKind
{
    Core = 0,
    Trip = 1,
    NightSupport = 2,
    ShortTermAccommodation = 3,
    Other = 4,
}
