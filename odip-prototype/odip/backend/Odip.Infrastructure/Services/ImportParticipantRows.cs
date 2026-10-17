using Odip.Application.DTOs;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Services;

/// <summary>
/// A participant import row as the CreateParticipantDto the manual create takes, with every reason, in plain words, that it can't be imported.
/// Only the checks that need nothing but the file live here; people already in ODIP are the service's to find, and the create service checks
/// every rule again at commit.
/// </summary>
public static class ImportParticipantRows
{
    /// <summary>The template's example row (ImportTemplate writes it). Left in by mistake, it is skipped, never imported.</summary>
    public const string ExampleFirstName = "Example";
    public const string ExampleLastName = "Delete this row";

    private static readonly Dictionary<string, Gender> Genders = new(StringComparer.OrdinalIgnoreCase)
    {
        ["male"] = Gender.Male, ["m"] = Gender.Male, ["female"] = Gender.Female, ["f"] = Gender.Female,
        ["non-binary"] = Gender.NonBinary, ["nonbinary"] = Gender.NonBinary, ["non binary"] = Gender.NonBinary,
        ["prefer not to say"] = Gender.PreferNotToSay,
    };

    private static readonly Dictionary<string, string> States = new(StringComparer.OrdinalIgnoreCase)
    {
        ["NSW"] = "NSW", ["New South Wales"] = "NSW", ["VIC"] = "VIC", ["Victoria"] = "VIC", ["QLD"] = "QLD", ["Queensland"] = "QLD",
        ["SA"] = "SA", ["South Australia"] = "SA", ["WA"] = "WA", ["Western Australia"] = "WA", ["TAS"] = "TAS", ["Tasmania"] = "TAS",
        ["NT"] = "NT", ["Northern Territory"] = "NT", ["ACT"] = "ACT", ["Australian Capital Territory"] = "ACT",
    };

    private static readonly Dictionary<string, ContactRoleType> Relationships = new(StringComparer.OrdinalIgnoreCase)
    {
        ["next of kin"] = ContactRoleType.NextOfKin, ["nok"] = ContactRoleType.NextOfKin, ["guardian"] = ContactRoleType.Guardian,
        ["plan nominee"] = ContactRoleType.PlanNominee, ["nominee"] = ContactRoleType.PlanNominee, ["plan manager"] = ContactRoleType.PlanManager,
    };

    // The DTO properties whose [StringLength] the import checks itself. Postcode, phone and email format have their own validators below.
    private static readonly Dictionary<string, string> Labels = new()
    {
        [nameof(CreateParticipantDto.FirstName)] = "First name", [nameof(CreateParticipantDto.LastName)] = "Last name",
        [nameof(CreateParticipantDto.PreferredName)] = "Preferred name", [nameof(CreateParticipantDto.NdisNumber)] = "NDIS number",
        [nameof(CreateParticipantDto.Email)] = "Email", [nameof(CreateParticipantDto.AddressStreet)] = "Street",
        [nameof(CreateParticipantDto.AddressSuburb)] = "Suburb",
    };

    /// <summary>Letters and digits only, upper-case: "430 000 001" and "430000001" are the same NDIS number.</summary>
    public static string NdisKey(string ndisNumber) => new(ndisNumber.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());

    /// <summary>An NDIS number is 9 digits (NdisKey has already dropped the spaces). Only such a value is ever used to match or de-duplicate people.</summary>
    public static bool IsNdisNumber(string key) => key.Length == 9 && key.All(char.IsAsciiDigit);

    private static readonly string[] DateKeys = ["dateOfBirth", "planStartDate", "planEndDate"];

    public static List<ImportRowPlan> Build(ImportTable table, IReadOnlyList<string?> mapping, DateOnly asOf)
    {
        var column = new Dictionary<string, int>();
        for (var i = 0; i < mapping.Count; i++)
            if (mapping[i] is { } key) column[key] = i;
        var monthFirst = DateKeys.ToDictionary(key => key,
            key => column.TryGetValue(key, out var c) && table.Rows.Any(r => ImportValues.LooksMonthFirst(table.Cell(r, c))));

        var plans = new List<ImportRowPlan>(table.Rows.Count);
        foreach (var row in table.Rows)
        {
            string Get(string key) => column.TryGetValue(key, out var i) ? table.Cell(row, i) : "";
            plans.Add(BuildRow(row.RowNumber, Get, monthFirst, asOf));
        }
        return plans;
    }

    private static ImportRowPlan BuildRow(int rowNumber, Func<string, string> get, Dictionary<string, bool> monthFirst, DateOnly asOf)
    {
        var reasons = new List<string>();
        var warnings = new List<string>();
        var (dateOfBirth, dobError) = ImportValues.Date(get("dateOfBirth"), "Date of birth", monthFirst["dateOfBirth"]);
        if (dobError != null) reasons.Add(dobError);
        var (planStart, startError) = ImportValues.Date(get("planStartDate"), "Plan start", monthFirst["planStartDate"]);
        if (startError != null) reasons.Add(startError);
        var (planEnd, endError) = ImportValues.Date(get("planEndDate"), "Plan end", monthFirst["planEndDate"]);
        if (endError != null) reasons.Add(endError);
        if (planStart > planEnd) reasons.Add("Plan end is before Plan start.");
        var (planType, planTypeError) = ImportValues.PlanManagement(get("planType"), "Plan type");
        if (planTypeError != null) reasons.Add(planTypeError);

        Gender? gender = null;
        var genderText = get("gender");
        if (genderText.Length > 0)
        {
            if (Genders.TryGetValue(genderText, out var g)) gender = g;
            else reasons.Add(genderText.Equals("other", StringComparison.OrdinalIgnoreCase)
                ? "Gender: Other needs a self-description, which the import can't take. Leave the cell blank and add it on the participant's profile."
                : "Gender must be Male, Female, Non-binary or Prefer not to say.");
        }

        string? state = null;
        var stateText = get("addressState");
        if (stateText.Length > 0)
        {
            if (States.TryGetValue(stateText, out var code)) state = code;
            else reasons.Add("State must be NSW, VIC, QLD, SA, WA, TAS, NT or ACT.");
        }

        var contacts = new List<CreateParticipantContactRoleDto>();
        var rolesSoFar = new List<(ContactRoleType, bool, ContactRoleStatus)>();
        for (var n = 1; n <= 3; n++)
        {
            var name = get($"contact{n}Name");
            var relationship = get($"contact{n}Relationship");
            var phone = get($"contact{n}Phone");
            var email = get($"contact{n}Email");
            if (name.Length + relationship.Length + phone.Length + email.Length == 0) continue;
            if (name.Length == 0) { reasons.Add($"Contact {n} needs a name."); continue; }
            if (!Relationships.TryGetValue(relationship, out var roleType))
            {
                reasons.Add($"Contact {n} relationship must be next of kin, guardian, plan nominee or plan manager.");
                continue;
            }
            if (roleType == ContactRoleType.PlanManager && planType is null)
            {
                warnings.Add($"Contact {n} won't be imported: a plan manager needs Plan type to be Plan managed.");
                continue;
            }
            var split = name.LastIndexOf(' ');
            var contact = new CreateParticipantContactRoleDto
            {
                NewPersonFirstName = split < 0 ? name : name[..split].Trim(),
                NewPersonLastName = split < 0 ? null : name[(split + 1)..],
                NewPersonPhone = NullIfEmpty(phone), NewPersonEmail = NullIfEmpty(email), RoleType = roleType,
            };
            reasons.AddRange(ImportValues.AnnotationErrors(contact, new Dictionary<string, string>
            {
                [nameof(contact.NewPersonFirstName)] = $"Contact {n} name", [nameof(contact.NewPersonLastName)] = $"Contact {n} name",
                [nameof(contact.NewPersonPhone)] = $"Contact {n} phone", [nameof(contact.NewPersonEmail)] = $"Contact {n} email",
            }));
            // The manual create's contact rules, against the file's plan type (self-managed when it gives none, the manual create's default).
            if (ContactRoleRules.Validate(roleType, planType ?? PlanType.SelfManaged, dateOfBirth, null, asOf) is { } gate) reasons.Add($"Contact {n}: {gate}");
            if (ContactRoleRules.ValidateUniqueness(roleType, false, ContactRoleStatus.Active, rolesSoFar) is { } unique) reasons.Add($"Contact {n}: {unique}");
            rolesSoFar.Add((roleType, false, ContactRoleStatus.Active));
            contacts.Add(contact);
        }

        var first = get("firstName");
        var last = get("lastName");
        var ndis = get("ndisNumber");
        var dto = new CreateParticipantDto
        {
            FirstName = first, LastName = last, PreferredName = NullIfEmpty(get("preferredName")), DateOfBirth = dateOfBirth, Gender = gender,
            NdisNumber = NullIfEmpty(ndis), PlanType = planType ?? PlanType.SelfManaged, PlanStartDate = planStart, PlanEndDate = planEnd,
            Phone = NullIfEmpty(get("phone")), Email = NullIfEmpty(get("email")),
            AddressStreet = NullIfEmpty(get("addressStreet")), AddressSuburb = NullIfEmpty(get("addressSuburb")), AddressState = state,
            AddressPostcode = NullIfEmpty(get("addressPostcode")), ContactRoles = contacts,
        };
        reasons.AddRange(new[]
        {
            ParticipantPatchApplier.ValidateNames(dto), ParticipantPatchApplier.ValidatePhone(dto),
            ParticipantPatchApplier.ValidateEmail(dto), ParticipantPatchApplier.ValidateAddressPostcode(dto),
        }.OfType<string>());
        reasons.AddRange(ImportValues.AnnotationErrors(dto, Labels));

        // "N/A", "TBC" or "-" are not numbers: keying on them would make every such row a repeat of the first, or match a stored "TBC".
        var ndisKey = NdisKey(ndis);
        if (ndis.Length > 0 && !IsNdisNumber(ndisKey)) warnings.Add("NDIS number isn't 9 digits, so it wasn't used to match anyone.");
        var plan = new ImportRowPlan
        {
            RowNumber = rowNumber, Name = $"{first} {last}".Trim(), Participant = dto,
            DuplicateKey = IsNdisNumber(ndisKey) ? ndisKey : null,
        };
        plan.Warnings.AddRange(warnings);
        if (first == ExampleFirstName && last == ExampleLastName) plan.Skip("This is the template's example row.");
        else reasons.ForEach(plan.Refuse);
        return plan;
    }

    private static string? NullIfEmpty(string value) => value.Length == 0 ? null : value;
}
