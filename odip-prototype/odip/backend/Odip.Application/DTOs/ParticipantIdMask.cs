using System.ComponentModel.DataAnnotations;
using System.Security.Claims;

namespace Odip.Application.DTOs;

/// <summary>
/// ID numbers that support workers and read-only users see masked (owner Q1, 2026-10-25).
/// The role comes from the JWT; a SuperAdmin using "view as" keeps the SuperAdmin role.
/// </summary>
public static class ParticipantIdMask
{
    public static readonly IReadOnlySet<string> PropertyNames = new HashSet<string>
    {
        nameof(ParticipantDetailDto.NdisNumber), nameof(ParticipantDetailDto.PensionCardNumber),
        nameof(ParticipantDetailDto.MedicareNumber), nameof(ParticipantDetailDto.CompanionCardNumber),
        nameof(ParticipantDetailDto.PrivateHealthMembershipNumber), nameof(ParticipantDetailDto.TaxiCardNumber),
    };

    /// <summary>Blank stays as it is; under 2 characters shows bullets only; otherwise bullets plus the last character.</summary>
    public static string? Mask(string? value) =>
        string.IsNullOrWhiteSpace(value) ? value : value.Trim().Length < 2 ? "••••••••" : "••••••••" + value.Trim()[^1];

    /// <summary>Fail closed: only the office roles see full numbers; a missing principal is masked.</summary>
    public static bool AppliesTo(ClaimsPrincipal? user) =>
        !(user?.IsInRole("SuperAdmin") == true || user?.IsInRole("Admin") == true || user?.IsInRole("Coordinator") == true);

    public static ParticipantDetailDto Apply(ParticipantDetailDto d) => d with
    {
        NdisNumber = Mask(d.NdisNumber), PensionCardNumber = Mask(d.PensionCardNumber), MedicareNumber = Mask(d.MedicareNumber),
        CompanionCardNumber = Mask(d.CompanionCardNumber), PrivateHealthMembershipNumber = Mask(d.PrivateHealthMembershipNumber),
        TaxiCardNumber = Mask(d.TaxiCardNumber),
    };
}

/// <summary>Rejects the mask glyph, so a masked value read by a support worker can never be written back as a real number.</summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class NoMaskedIdAttribute : ValidationAttribute
{
    public NoMaskedIdAttribute() : base("Enter the full number.") { }
    public override bool IsValid(object? value) => value is not string s || !s.Contains('•');
}
