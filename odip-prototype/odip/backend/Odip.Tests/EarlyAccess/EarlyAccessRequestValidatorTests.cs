using Odip.Application.DTOs;
using Odip.Application.EarlyAccess;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>
/// Field rules for the public early-access form. The error keys asserted here (name / organisation /
/// email) are part of the API contract the landing page is built against.
/// </summary>
public class EarlyAccessRequestValidatorTests
{
    private static EarlyAccessRequestDto Valid() => new()
    {
        Name = "Jane Citizen",
        Organisation = "Sample Support Co",
        Email = "jane.citizen@example.com.au",
    };

    [Fact]
    public void ValidRequest_IsValid_AndValuesAreTrimmed()
    {
        var result = EarlyAccessRequestValidator.Validate(new EarlyAccessRequestDto
        {
            Name = "  Jane Citizen ",
            Organisation = "\tSample Support Co  ",
            Email = "  jane.citizen@example.com.au ",
        });

        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
        Assert.Equal("Jane Citizen", result.Name);
        Assert.Equal("Sample Support Co", result.Organisation);
        Assert.Equal("jane.citizen@example.com.au", result.Email);
    }

    [Fact]
    public void Email_IsLowerCased_ForTheUniqueIndex()
    {
        var dto = Valid();
        dto.Email = "Jane.CITIZEN@Example.COM.au";

        Assert.Equal("jane.citizen@example.com.au", EarlyAccessRequestValidator.Validate(dto).Email);
    }

    // SkippableFact: the deploy image runs the suite under invariant globalization, where a non-invariant
    // culture cannot be created (PredefinedCulturesOnly). CI runs with real ICU, so it still runs there.
    [SkippableFact]
    public void Email_LowerCasing_IsCultureInvariant()
    {
        // Turkish culture lower-cases "I" to a dotless "ı"; the stored form must not depend on the host culture.
        var turkish = TryGetCulture("tr-TR");
        Skip.If(turkish is null, "tr-TR is not available under invariant globalization");

        var original = Thread.CurrentThread.CurrentCulture;
        try
        {
            Thread.CurrentThread.CurrentCulture = turkish!;
            var dto = Valid();
            dto.Email = "INFO@EXAMPLE.COM";

            Assert.Equal("info@example.com", EarlyAccessRequestValidator.Validate(dto).Email);
        }
        finally
        {
            Thread.CurrentThread.CurrentCulture = original;
        }
    }

    private static System.Globalization.CultureInfo? TryGetCulture(string name)
    {
        try { return new System.Globalization.CultureInfo(name); }
        catch (System.Globalization.CultureNotFoundException) { return null; }
    }

    [Fact]
    public void NullRequest_ReportsEveryField()
    {
        var result = EarlyAccessRequestValidator.Validate(null);

        Assert.False(result.IsValid);
        Assert.Equal(new[] { "email", "name", "organisation" }, result.Errors.Keys.OrderBy(k => k, StringComparer.Ordinal));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t \n")]
    public void MissingOrBlankFields_AreReportedPerField(string? blank)
    {
        var result = EarlyAccessRequestValidator.Validate(new EarlyAccessRequestDto { Name = blank, Organisation = blank, Email = blank });

        Assert.Equal("Enter your name.", Assert.Single(result.Errors["name"]));
        Assert.Equal("Enter your organisation.", Assert.Single(result.Errors["organisation"]));
        Assert.Equal("Enter your email address.", Assert.Single(result.Errors["email"]));
    }

    [Fact]
    public void OnlyTheBadFieldIsReported()
    {
        var dto = Valid();
        dto.Organisation = "";

        var result = EarlyAccessRequestValidator.Validate(dto);

        Assert.Equal("organisation", Assert.Single(result.Errors.Keys));
    }

    [Theory]
    [InlineData(100, true)]
    [InlineData(101, false)]
    public void Name_LengthLimit_Is100(int length, bool valid)
    {
        var dto = Valid();
        dto.Name = new string('n', length);

        var result = EarlyAccessRequestValidator.Validate(dto);

        Assert.Equal(valid, result.IsValid);
        if (!valid)
            Assert.Equal("Name must be 100 characters or fewer.", Assert.Single(result.Errors["name"]));
    }

    [Theory]
    [InlineData(150, true)]
    [InlineData(151, false)]
    public void Organisation_LengthLimit_Is150(int length, bool valid)
    {
        var dto = Valid();
        dto.Organisation = new string('o', length);

        var result = EarlyAccessRequestValidator.Validate(dto);

        Assert.Equal(valid, result.IsValid);
        if (!valid)
            Assert.Equal("Organisation must be 150 characters or fewer.", Assert.Single(result.Errors["organisation"]));
    }

    [Fact]
    public void LengthLimits_ApplyAfterTrimming()
    {
        var dto = Valid();
        dto.Name = new string(' ', 30) + new string('n', 100) + new string(' ', 30);

        Assert.True(EarlyAccessRequestValidator.Validate(dto).IsValid);
    }

    [Fact]
    public void Email_AtTheAddressLimit_IsAccepted_AndOneOverIsRejected()
    {
        // 64-char local part + "@" + a dotted domain padded to make the whole address exactly 254 characters.
        var local = new string('a', 64);
        var domain = string.Join('.', new string('b', 63), new string('c', 63), new string('d', 57)) + ".com";
        var atLimit = $"{local}@{domain}";
        Assert.Equal(EarlyAccessRequestValidator.MaxEmailLength, atLimit.Length);

        var dto = Valid();
        dto.Email = atLimit;
        Assert.True(EarlyAccessRequestValidator.Validate(dto).IsValid);

        dto.Email = atLimit + "m";
        var result = EarlyAccessRequestValidator.Validate(dto);
        Assert.Equal("Email must be 254 characters or fewer.", Assert.Single(result.Errors["email"]));
    }

    [Theory]
    [InlineData("jane@example.com")]
    [InlineData("jane.citizen+odip@example.com.au")]
    [InlineData("o'brien@example.co.uk")]
    [InlineData("first_last-name@sub.domain.example.org")]
    [InlineData("a@bc.io")]
    public void ValidEmails_AreAccepted(string email)
    {
        var dto = Valid();
        dto.Email = email;

        Assert.True(EarlyAccessRequestValidator.Validate(dto).IsValid, email);
    }

    [Theory]
    [InlineData("plainaddress")]
    [InlineData("@example.com")]
    [InlineData("jane@")]
    [InlineData("jane@example")]
    [InlineData("jane@example.")]
    [InlineData("jane@.example.com")]
    [InlineData("jane@exa..mple.com")]
    [InlineData("jane@example.c")]
    [InlineData("jane@@example.com")]
    [InlineData("jane@exam@ple.com")]
    [InlineData("ja ne@example.com")]
    [InlineData("jane@exa mple.com")]
    [InlineData("Jane Citizen <jane@example.com>")]
    [InlineData("<jane@example.com>")]
    [InlineData("\"jane\"@example.com")]
    [InlineData("jane@[127.0.0.1]")]
    [InlineData("jane@example.com,other@example.com")]
    [InlineData("jane\u202E@example.com")]
    [InlineData("jane@exa\u2066mple.com")]
    [InlineData("jane@example.com\u2028Bcc: x@example.com")]
    public void InvalidEmails_AreRejected_WithAnEmailError(string email)
    {
        var dto = Valid();
        dto.Email = email;

        var result = EarlyAccessRequestValidator.Validate(dto);

        Assert.False(result.IsValid, email);
        Assert.Equal("Enter a valid email address.", Assert.Single(result.Errors["email"]));
        Assert.Single(result.Errors); // nothing else flagged
    }

    [Fact]
    public void Email_LocalPartOver64Characters_IsRejected()
    {
        var dto = Valid();
        dto.Email = new string('a', 65) + "@example.com";

        Assert.Equal("Enter a valid email address.", Assert.Single(EarlyAccessRequestValidator.Validate(dto).Errors["email"]));
    }

    [Theory]
    [InlineData("Jane\u2028Organisation: fake")]
    [InlineData("Jane\u2029Organisation: fake")]
    [InlineData("Jane\u202Egnikcart")]
    [InlineData("Jane\u2066isolated\u2069")]
    [InlineData("Jane\r\nBcc: x@example.com")]
    [InlineData("Jane\nCitizen")]
    [InlineData("Jane\tCitizen")]
    [InlineData("Jane\u0000Citizen")]
    public void ControlCharacters_InNameAndOrganisation_AreRejected(string value)
    {
        var dto = Valid();
        dto.Name = value;
        dto.Organisation = value;

        var result = EarlyAccessRequestValidator.Validate(dto);

        Assert.Equal("Name contains characters that are not allowed.", Assert.Single(result.Errors["name"]));
        Assert.Equal("Organisation contains characters that are not allowed.", Assert.Single(result.Errors["organisation"]));
    }

    [Theory]
    [InlineData("\u200B")]
    [InlineData("\u2060\uFEFF")]
    [InlineData("---")]
    [InlineData(". , ;")]
    public void NameAndOrganisation_WithNoLetterOrDigit_AreTreatedAsMissing(string value)
    {
        var dto = Valid();
        dto.Name = value;
        dto.Organisation = value;

        var result = EarlyAccessRequestValidator.Validate(dto);

        Assert.Equal("Enter your name.", Assert.Single(result.Errors["name"]));
        Assert.Equal("Enter your organisation.", Assert.Single(result.Errors["organisation"]));
    }

    [Theory]
    [InlineData("3M")]
    [InlineData("\u674e")]
    [InlineData("\u00d8rsted A/S")]
    public void ShortOrNonLatinNamesWithALetterOrDigit_AreAccepted(string value)
    {
        var dto = Valid();
        dto.Name = value;
        dto.Organisation = value;

        Assert.True(EarlyAccessRequestValidator.Validate(dto).IsValid);
    }

    [Theory]
    [InlineData("\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645")]   // Persian: ZWNJ is part of ordinary spelling
    [InlineData("Zo\u00eb \u2019O\u2019Brien")]                                // curly apostrophes
    public void OrdinaryFormatCharacters_AreStillAllowed(string value)
    {
        var dto = Valid();
        dto.Name = value;

        Assert.True(EarlyAccessRequestValidator.Validate(dto).IsValid);
    }

    [Fact]
    public void MarkupAndUnicode_AreAllowedInNameAndOrganisation_TheyAreEncodedWhereTheyAreRendered()
    {
        // Validation is not the XSS defence (output encoding is); names like "O'Brien & Sons <Pty>" or
        // "Zoë" are legitimate input and must not be rejected.
        var dto = Valid();
        dto.Name = "Zoë O'Brien";
        dto.Organisation = "Brown & Sons <Pty> Ltd";

        var result = EarlyAccessRequestValidator.Validate(dto);

        Assert.True(result.IsValid);
        Assert.Equal("Brown & Sons <Pty> Ltd", result.Organisation);
    }
}
