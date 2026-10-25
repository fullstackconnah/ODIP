using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>Participant ID-number masking for SupportWorker and ReadOnly (owner Q1, 2026-10-25).</summary>
public class ParticipantIdMaskTests
{
    private const string Dots = "••••••••";

    // ── T1: the mask rule ────────────────────────────────────────────────

    [Theory]
    [InlineData(null, null)]
    [InlineData("", "")]
    [InlineData("  ", "  ")]
    [InlineData("5", Dots)]
    [InlineData("12", Dots + "2")]
    [InlineData("430000017", Dots + "7")]
    [InlineData("430000017 ", Dots + "7")]
    public void Mask_FormatIsTheListRule(string? input, string? expected) =>
        Assert.Equal(expected, ParticipantIdMask.Mask(input));

    // ── T8: every participant write is office-only ───────────────────────

    [Fact]
    public void ParticipantWrites_AreOfficeOnly()
    {
        var bound = new[] { typeof(CreateParticipantDto), typeof(UpdateParticipantDto), typeof(PatchParticipantDto) };
        var writes = typeof(ParticipantsController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetParameters().Any(p => bound.Contains(p.ParameterType))).ToList();
        Assert.NotEmpty(writes);
        foreach (var m in writes)
        {
            var roles = m.GetCustomAttributes<AuthorizeAttribute>().Single().Roles;
            Assert.Equal("Admin,Coordinator,SuperAdmin", roles);
        }
    }

    // ── T9: a masked value is rejected on every write DTO ────────────────

    public static IEnumerable<object[]> GuardedProperties() =>
        new[] { typeof(CreateParticipantDto), typeof(UpdateParticipantDto), typeof(PatchKeyIdentifiersDto), typeof(PatchNdisPlanDto) }
            .SelectMany(t => ParticipantIdMask.PropertyNames
                .Where(n => t.GetProperty(n) != null).Select(n => new object[] { t, n }));

    [Theory]
    [MemberData(nameof(GuardedProperties))]
    public void MaskedValue_IsRejected_OnEveryWriteDto(Type type, string property)
    {
        Assert.NotNull(type.GetProperty(property)!.GetCustomAttribute<NoMaskedIdAttribute>());
        Assert.Contains(property, Errors(type, property, Dots + "7"));
        Assert.Empty(Errors(type, property, "430000017"));
        Assert.Empty(Errors(type, property, ""));
        Assert.Empty(Errors(type, property, null));
    }

    [Fact]
    public void GuardedProperties_CoverEveryIdNumberOnTheWriteDtos()
    {
        Assert.Equal(6, GuardedProperties().Count(a => (Type)a[0] == typeof(CreateParticipantDto)));
        Assert.Equal(1, GuardedProperties().Count(a => (Type)a[0] == typeof(PatchNdisPlanDto)));
        Assert.Equal(5, GuardedProperties().Count(a => (Type)a[0] == typeof(PatchKeyIdentifiersDto)));
    }

    private static List<string> Errors(Type type, string property, string? value)
    {
        var dto = Activator.CreateInstance(type)!;
        type.GetProperty(property)!.SetValue(dto, value); // init-only: reflection still sets it
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(dto, new ValidationContext(dto), results, validateAllProperties: true);
        return results.SelectMany(r => r.MemberNames).ToList();
    }
}
