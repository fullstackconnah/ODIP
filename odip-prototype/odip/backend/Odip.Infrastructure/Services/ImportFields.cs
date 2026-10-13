using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>One ODIP field an import column can fill. The label is the template's header; <see cref="Hint"/> goes on the template's Notes sheet.</summary>
public sealed record ImportField(string Key, string Label, bool Required, string[] Synonyms, string Hint);

/// <summary>
/// The fields each import kind fills, and the header matcher: a header matches a field when, reduced to lower-case letters and digits, it equals
/// the field's label or one of its synonyms ("Given_Name" and "given name" both match First name). Each field goes to the first column that names it.
/// </summary>
public static class ImportFields
{
    private const string Mismatch = "The column matches don't fit this file. Upload it again.";

    private static readonly IReadOnlyList<ImportField> Participants = BuildParticipants();
    private static readonly IReadOnlyList<ImportField> Staff = BuildStaff();

    private const string EmploymentHero = "Won't be imported: Employment Hero will hold employment details.";
    private const string NoField = "Won't be imported: ODIP has no field for this yet.";
    // Staff columns other platforms export that ODIP does not hold: shown as "won't be imported" so the Admin knows they were seen.
    private static readonly Dictionary<string, string> StaffNotImported = new()
    {
        ["employmenttype"] = EmploymentHero, ["employment"] = EmploymentHero, ["startdate"] = EmploymentHero, ["datestarted"] = EmploymentHero,
        ["wwcc"] = NoField, ["wwccnumber"] = NoField, ["workingwithchildrencheck"] = NoField,
        ["policecheck"] = NoField, ["nationalpolicecheck"] = NoField, ["cpr"] = NoField, ["cprexpiry"] = NoField,
    };

    public static IReadOnlyList<ImportField> For(ImportKind kind) => kind switch
    {
        ImportKind.Participants => Participants,
        ImportKind.Staff => Staff,
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    public static string Normalise(string header) => new(header.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());

    /// <summary>Why a column ODIP sees is not imported, for the Match columns step; null when there is nothing to say.</summary>
    public static string? NotImportedNote(ImportKind kind, string header) =>
        kind == ImportKind.Staff && StaffNotImported.TryGetValue(Normalise(header), out var note) ? note : null;

    public static List<string?> AutoMatch(ImportKind kind, IReadOnlyList<string> headers)
    {
        var taken = new HashSet<string>();
        var mapping = new List<string?>(headers.Count);
        foreach (var header in headers)
        {
            var h = Normalise(header);
            var field = For(kind).FirstOrDefault(f => !taken.Contains(f.Key) && (Normalise(f.Label) == h || f.Synonyms.Any(s => Normalise(s) == h)));
            if (field != null) taken.Add(field.Key);
            mapping.Add(field?.Key);
        }
        return mapping;
    }

    /// <summary>
    /// Why a column mapping cannot be used, or null. <paramref name="requireAll"/> also asks for every required field: the import needs them,
    /// while a preview shows the columns so the Admin can match them.
    /// </summary>
    public static string? MappingError(ImportKind kind, IReadOnlyList<string?> mapping, int columnCount, bool requireAll)
    {
        var fields = For(kind);
        if (mapping.Count != columnCount || mapping.Any(key => key != null && fields.All(f => f.Key != key))) return Mismatch;
        var twice = mapping.OfType<string>().GroupBy(key => key).FirstOrDefault(g => g.Count() > 1);
        if (twice != null) return $"Two columns are matched to {fields.First(f => f.Key == twice.Key).Label}. Choose one.";
        if (!requireAll) return null;
        var missing = fields.Where(f => f.Required && !mapping.Contains(f.Key)).Select(f => f.Label).ToList();
        return missing.Count == 0 ? null : $"Match a column to {string.Join(", ", missing)}.";
    }

    private static List<ImportField> BuildParticipants()
    {
        var fields = new List<ImportField>
        {
            new("firstName", "First name", true, ["given name", "forename", "first"], "Required."),
            new("lastName", "Last name", true, ["surname", "family name", "last"], "Required."),
            new("preferredName", "Preferred name", false, ["known as", "nickname"], "What they like to be called."),
            new("dateOfBirth", "Date of birth", false, ["dob", "birth date", "birthdate"], "dd/mm/yyyy or yyyy-mm-dd."),
            new("gender", "Gender", false, ["sex"], "Male, Female, Non-binary or Prefer not to say."),
            new("ndisNumber", "NDIS number", false, ["ndis no", "ndis", "ndis id", "ndis participant number"], "Finds people already in ODIP, who are skipped."),
            new("phone", "Phone", false, ["phone number", "mobile", "mobile number", "contact number", "telephone"], "6 to 20 digits; spaces, brackets and + are fine."),
            new("email", "Email", false, ["email address", "e-mail"], "Their own email address."),
            new("addressStreet", "Street", false, ["address", "street address", "address line 1", "address 1"], "Street number and name."),
            new("addressSuburb", "Suburb", false, ["city", "town", "locality"], "Suburb or town."),
            new("addressState", "State", false, ["state/territory", "territory"], "NSW, VIC, QLD, SA, WA, TAS, NT or ACT."),
            new("addressPostcode", "Postcode", false, ["post code", "postal code", "zip"], "4 digits."),
        };
        for (var n = 1; n <= 3; n++)
        {
            fields.Add(new($"contact{n}Name", $"Contact {n} name", false, [], "First and last name."));
            fields.Add(new($"contact{n}Relationship", $"Contact {n} relationship", false, [], "Next of kin, Guardian, Plan nominee or Plan manager."));
            fields.Add(new($"contact{n}Phone", $"Contact {n} phone", false, [], "Their phone number."));
            fields.Add(new($"contact{n}Email", $"Contact {n} email", false, [], "Their email address."));
        }
        return fields;
    }

    private static List<ImportField> BuildStaff()
    {
        const string yesNo = "Yes or no.";
        const string date = "dd/mm/yyyy or yyyy-mm-dd.";
        return
        [
            new("firstName", "First name", true, ["given name", "forename", "first"], "Required."),
            new("lastName", "Last name", true, ["surname", "family name", "last"], "Required."),
            new("email", "Email", true, ["email address", "e-mail", "work email"], "Required. Their sign-in address; it must not be used in another organisation."),
            new("mobile", "Mobile", false, ["mobile number", "phone", "phone number", "contact number"], "Up to 20 characters."),
            new("role", "Role", false, ["access", "access level", "user role"], "Support worker (the default), Coordinator or Read only. Admin can't be given through an import."),
            new("position", "Position", false, ["job title", "title"], "Support worker, Senior support worker, Coordinator, Team leader or Other."),
            new("region", "Region", false, ["area", "location", "team"], "Their region or team."),
            new("driversLicence", "Driver's licence", false, ["drivers license", "licence", "license", "driver"], yesNo),
            new("driversLicenceExpiry", "Driver's licence expiry", false, ["licence expiry", "license expiry"], date),
            new("firstAid", "First aid", false, ["first aid certificate"], yesNo),
            new("firstAidExpiry", "First aid expiry", false, [], date),
            new("medication", "Medication competent", false, ["medication", "medication competency"], yesNo),
            new("medicationExpiry", "Medication competency expiry", false, ["medication expiry"], date),
            new("manualHandling", "Manual handling", false, [], yesNo),
            new("manualHandlingExpiry", "Manual handling expiry", false, [], date),
            new("overnight", "Overnight eligible", false, ["overnight", "sleepover", "sleepovers"], yesNo),
            new("workerScreeningNumber", "NDIS worker screening number", false, ["worker screening number", "screening number", "nwsc", "nwsc number"], "Up to 50 characters."),
            new("workerScreeningExpiry", "NDIS worker screening expiry", false, ["worker screening expiry", "screening expiry", "nwsc expiry"], date),
        ];
    }
}
