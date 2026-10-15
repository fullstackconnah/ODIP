using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Services;

/// <summary>
/// A staff import row as the CreateStaffDto the staff form sends, with every reason it can't be imported. The address rules that need the
/// database (another organisation, the reserved domain, the unusual-domain warning) are the service's; StaffCreateService checks all of them
/// again at commit.
/// </summary>
public static class ImportStaffRows
{
    private static readonly Dictionary<string, UserRole> Roles = new(StringComparer.OrdinalIgnoreCase)
    {
        ["support worker"] = UserRole.SupportWorker, ["supportworker"] = UserRole.SupportWorker, ["worker"] = UserRole.SupportWorker,
        ["coordinator"] = UserRole.Coordinator, ["read only"] = UserRole.ReadOnly, ["readonly"] = UserRole.ReadOnly, ["read-only"] = UserRole.ReadOnly,
    };
    private static readonly HashSet<string> AdminRoles = new(StringComparer.OrdinalIgnoreCase) { "admin", "administrator", "superadmin", "super admin" };

    private static readonly Dictionary<string, Position> Positions = new(StringComparer.OrdinalIgnoreCase)
    {
        ["support worker"] = Position.SupportWorker, ["senior support worker"] = Position.SeniorSupportWorker, ["coordinator"] = Position.Coordinator,
        ["team leader"] = Position.TeamLeader, ["other"] = Position.Other,
    };

    // [StringLength]/[EmailAddress] on CreateStaffDto. Mobile is checked against the column's 20 (the DTO allows 50, the database holds 20).
    private static readonly Dictionary<string, string> Labels = new()
    {
        [nameof(CreateStaffDto.FirstName)] = "First name", [nameof(CreateStaffDto.LastName)] = "Last name",
        [nameof(CreateStaffDto.Email)] = "Email", [nameof(CreateStaffDto.Region)] = "Region",
    };

    private static readonly string[] DateKeys = ["driversLicenceExpiry", "firstAidExpiry", "medicationExpiry", "manualHandlingExpiry", "workerScreeningExpiry"];

    public static List<ImportRowPlan> Build(ImportTable table, IReadOnlyList<string?> mapping)
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
            plans.Add(BuildRow(row.RowNumber, Get, monthFirst));
        }
        return plans;
    }

    private static ImportRowPlan BuildRow(int rowNumber, Func<string, string> get, Dictionary<string, bool> monthFirst)
    {
        var reasons = new List<string>();
        var first = get("firstName");
        var last = get("lastName");
        var email = get("email");
        if (first.Length == 0) reasons.Add("First name is required.");
        if (last.Length == 0) reasons.Add("Last name is required.");
        if (email.Length == 0) reasons.Add("Email is required.");

        var role = UserRole.SupportWorker;
        var roleText = get("role");
        if (AdminRoles.Contains(roleText)) reasons.Add("Admin can't be given through an import. Import them with another role, then change it on the Staff page.");
        else if (roleText.Length > 0)
        {
            if (Roles.TryGetValue(roleText, out var r)) role = r;
            else reasons.Add("Role must be Support worker, Coordinator or Read only.");
        }

        var position = Position.SupportWorker;
        var positionText = get("position");
        if (positionText.Length > 0)
        {
            if (Positions.TryGetValue(positionText, out var p)) position = p;
            else reasons.Add("Position must be Support worker, Senior support worker, Coordinator, Team leader or Other.");
        }

        bool YesNo(string key, string label)
        {
            var (value, error) = ImportValues.YesNo(get(key), label);
            if (error != null) reasons.Add(error);
            return value ?? false;
        }
        DateOnly? Date(string key, string label)
        {
            var (value, error) = ImportValues.Date(get(key), label, monthFirst[key]);
            if (error != null) reasons.Add(error);
            return value;
        }

        var mobile = get("mobile");
        if (mobile.Length > 20) reasons.Add("Mobile is longer than 20 characters.");
        var screening = get("workerScreeningNumber");
        if (screening.Length > 50) reasons.Add("NDIS worker screening number is longer than 50 characters.");

        var dto = new CreateStaffDto
        {
            FirstName = first, LastName = last, Email = email, Role = role, Position = position,
            Mobile = mobile.Length == 0 ? null : mobile, Region = get("region") is { Length: > 0 } region ? region : null,
            IsDriverEligible = YesNo("driversLicence", "Driver's licence"), DriverLicenceExpiryDate = Date("driversLicenceExpiry", "Driver's licence expiry"),
            IsFirstAidQualified = YesNo("firstAid", "First aid"), FirstAidExpiryDate = Date("firstAidExpiry", "First aid expiry"),
            IsMedicationCompetent = YesNo("medication", "Medication competent"), MedicationCompetencyExpiryDate = Date("medicationExpiry", "Medication competency expiry"),
            IsManualHandlingCompetent = YesNo("manualHandling", "Manual handling"), ManualHandlingExpiryDate = Date("manualHandlingExpiry", "Manual handling expiry"),
            IsOvernightEligible = YesNo("overnight", "Overnight eligible"),
            WorkerScreeningNumber = screening.Length == 0 ? null : screening, WorkerScreeningExpiryDate = Date("workerScreeningExpiry", "NDIS worker screening expiry"),
        };
        // Required names and email are worded above, so the attribute pass drops its own "is required" lines rather than repeat them.
        if (email.Length > 0) reasons.AddRange(ImportValues.AnnotationErrors(dto, Labels).Where(r => !r.EndsWith(" is required.")));

        var plan = new ImportRowPlan
        {
            RowNumber = rowNumber, Name = $"{first} {last}".Trim(), Staff = dto,
            DuplicateKey = email.Length == 0 ? null : EmailIdentity.Normalise(email),
        };
        if (first == ImportParticipantRows.ExampleFirstName && last == ImportParticipantRows.ExampleLastName) plan.Skip("This is the template's example row.");
        else reasons.ForEach(plan.Refuse);
        return plan;
    }
}
