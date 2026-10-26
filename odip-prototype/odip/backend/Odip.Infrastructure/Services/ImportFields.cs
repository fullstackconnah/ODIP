using Odip.Application.DTOs;
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
    private static readonly IReadOnlyList<ImportField> FundingPlans = BuildFundingPlans();
    private static readonly IReadOnlyList<ImportField> PatternShifts = BuildShifts(ImportShiftShape.Pattern);
    private static readonly IReadOnlyList<ImportField> DatedShifts = BuildShifts(ImportShiftShape.Dated);

    private const string Payroll = "Won't be imported: your payroll system keeps employment details.";
    private const string NoField = "Won't be imported: Bunya Support has no field for this yet.";
    // Staff columns other platforms export that ODIP does not hold: shown as "won't be imported" so the Admin knows they were seen.
    private static readonly Dictionary<string, string> StaffNotImported = new()
    {
        ["employmenttype"] = Payroll, ["employment"] = Payroll, ["startdate"] = Payroll, ["datestarted"] = Payroll,
        ["wwcc"] = NoField, ["wwccnumber"] = NoField, ["workingwithchildrencheck"] = NoField,
        ["policecheck"] = NoField, ["nationalpolicecheck"] = NoField, ["cpr"] = NoField, ["cprexpiry"] = NoField,
    };

    public static IReadOnlyList<ImportField> For(ImportKind kind, ImportShiftShape? shape = null) => kind switch
    {
        ImportKind.Participants => Participants,
        ImportKind.Staff => Staff,
        ImportKind.FundingPlans => FundingPlans,
        ImportKind.UpcomingShifts => shape == ImportShiftShape.Dated ? DatedShifts : PatternShifts,
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    public static string Normalise(string header) => new(header.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());

    /// <summary>Why a column ODIP sees is not imported, for the Match columns step; null when there is nothing to say.</summary>
    public static string? NotImportedNote(ImportKind kind, string header) =>
        kind == ImportKind.Staff && StaffNotImported.TryGetValue(Normalise(header), out var note) ? note : null;

    public static List<string?> AutoMatch(ImportKind kind, IReadOnlyList<string> headers, ImportShiftShape? shape = null)
    {
        var taken = new HashSet<string>();
        var mapping = new List<string?>(headers.Count);
        foreach (var header in headers)
        {
            var h = Normalise(header);
            var field = For(kind, shape).FirstOrDefault(f => !taken.Contains(f.Key) && (Normalise(f.Label) == h || f.Synonyms.Any(s => Normalise(s) == h)));
            if (field != null) taken.Add(field.Key);
            mapping.Add(field?.Key);
        }
        return mapping;
    }

    /// <summary>
    /// Why a column mapping cannot be used, or null. <paramref name="requireAll"/> also asks for every required field: the import needs them,
    /// while a preview shows the columns so the Admin can match them.
    /// </summary>
    public static string? MappingError(ImportKind kind, IReadOnlyList<string?> mapping, int columnCount, bool requireAll, ImportShiftShape? shape = null)
    {
        var fields = For(kind, shape);
        if (mapping.Count != columnCount || mapping.Any(key => key != null && fields.All(f => f.Key != key))) return Mismatch;
        var twice = mapping.OfType<string>().GroupBy(key => key).FirstOrDefault(g => g.Count() > 1);
        if (twice != null) return $"Two columns are matched to {fields.First(f => f.Key == twice.Key).Label}. Choose one.";
        if (!requireAll) return null;
        var missing = fields.Where(f => f.Required && !mapping.Contains(f.Key)).Select(f => f.Label).ToList();
        if (missing.Count > 0) return $"Match a column to {string.Join(", ", missing)}.";
        if (kind == ImportKind.UpcomingShifts && !mapping.Contains("ndis") && !(mapping.Contains("participantName") && mapping.Contains("dateOfBirth")))
            return "Match a column to NDIS number, or to Participant name and Date of birth.";
        return null;
    }

    private static List<ImportField> BuildShifts(ImportShiftShape shape)
    {
        const string who = "Finds the participant: the NDIS number, or the name with the date of birth.";
        const string time = "A time like 9:00 am or 21:00.";
        var when = shape == ImportShiftShape.Dated
            ? new ImportField("date", "Date", true, ["shift date"], "dd/mm/yyyy or yyyy-mm-dd, from today up to 12 weeks ahead.")
            : new ImportField("weekday", "Weekday", true, ["day", "day of week"], "Mon to Sun or Monday to Sunday.");
        return
        [
            new("ndis", "NDIS number", false, ["ndis no", "ndis #", "ndis", "ndis id"], who),
            new("participantName", "Participant name", false, ["client", "client name", "participant", "customer"], who),
            new("dateOfBirth", "Date of birth", false, ["dob", "birth date", "birthdate"], "dd/mm/yyyy or yyyy-mm-dd."),
            when,
            new("start", "Start time", true, ["from", "start"], time),
            new("end", "End time", true, ["to", "finish", "end"], time + " An end before the start ends the next day."),
            new("staffEmail", "Staff email", false, ["worker email"], "Finds the staff member. Blank or not found: the shift has nobody on it."),
            new("staffName", "Staff name", false, ["worker", "support worker", "staff", "carer"], "Used when there is no email and the name is unique."),
            new("notes", "Notes", false, ["comments", "shift notes"], "Shown on the shift."),
        ];
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
            new("ndisNumber", "NDIS number", false, ["ndis no", "ndis", "ndis id", "ndis participant number"], "Finds people already in Bunya Support, who are skipped."),
            new("planType", "Plan type", false, ["plan management", "plan management type", "management type", "managed by"], "Self managed, Plan managed or NDIA managed. Plan managed lets a contact be the plan manager."),
            new("planStartDate", "Plan start", false, ["plan start date", "ndis plan start", "plan from"], "dd/mm/yyyy or yyyy-mm-dd."),
            new("planEndDate", "Plan end", false, ["plan end date", "ndis plan end", "plan to"], "dd/mm/yyyy or yyyy-mm-dd. On or after Plan start."),
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

    private static List<ImportField> BuildFundingPlans()
    {
        const string date = "dd/mm/yyyy or yyyy-mm-dd.";
        const string byName = "With the other name and date of birth, finds the participant when the row has no NDIS number.";
        return
        [
            new("ndisNumber", "NDIS number", false, ["ndis no", "ndis", "ndis id", "ndis participant number"], "Finds the participant in Bunya Support. Leave it blank to find them by name and date of birth instead."),
            new("firstName", "First name", false, ["given name", "forename", "first"], byName),
            new("lastName", "Last name", false, ["surname", "family name", "last"], byName),
            new("dateOfBirth", "Date of birth", false, ["dob", "birth date", "birthdate"], date),
            new("planStart", "Plan start", true, ["plan start date", "start date", "plan from"], "Required. " + date),
            new("planEnd", "Plan end", true, ["plan end date", "end date", "plan to"], "Required. " + date),
            new("category", "Support category", true, ["category", "support category number", "pace category", "budget category"],
                "Required. The category number (01 to 21), its name, or Core. Categories 01 to 04 are added together into one Core (flexible) pool."),
            new("management", "Managed by", true, ["management", "management type", "plan management", "plan type", "funding management"],
                "Required. Self managed, Plan managed or NDIA managed."),
            new("amount", "Amount", true, ["plan amount", "budget", "budget amount", "allocated", "allocation", "total"],
                "Required. In dollars and cents, like 12500.00. A $ sign and commas are fine."),
        ];
    }
}
