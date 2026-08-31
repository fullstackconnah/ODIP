using System.Reflection;
using System.Text.RegularExpressions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using static Odip.Infrastructure.Services.ParticipantDocumentValueFormatting;

namespace Odip.Infrastructure.Services;

/// <summary>
/// DOC-01 — pure composer: turns a fully-hydrated <see cref="Participant"/> (every nav collection
/// referenced by <see cref="ParticipantDocumentFieldMap"/>'s six tables must already be loaded by
/// the caller — see <see cref="ParticipantDocumentService"/>) plus a separately-queried
/// <see cref="ParticipantRiskEntry"/> list into a <see cref="ParticipantDocumentModel"/>.
///
/// Deliberately has NO EF Core query calls and NO QuestPDF calls — everything here operates on
/// already-materialised collections, which is what makes it unit-testable against a hand-built
/// in-memory <see cref="Participant"/> with zero database/rendering infrastructure (see
/// <c>Odip.Tests/Services/ParticipantDocumentComposerTests.cs</c>).
/// </summary>
public static class ParticipantDocumentComposer
{
    public static ParticipantDocumentModel ComposeIntakeForm(Participant participant, IReadOnlyList<ParticipantRiskEntry> riskEntries) =>
        Compose(
            "Intake Form",
            participant,
            riskEntries,
            tag => tag is ParticipantDocumentTag.Intake or ParticipantDocumentTag.Shared,
            includeCommunityAccess: false);

    public static ParticipantDocumentModel ComposeParticipantProfile(Participant participant, IReadOnlyList<ParticipantRiskEntry> riskEntries) =>
        Compose(
            "Participant Profile",
            participant,
            riskEntries,
            tag => tag is ParticipantDocumentTag.Profile or ParticipantDocumentTag.Shared,
            includeCommunityAccess: participant.ServiceStreams.HasFlag(ServiceStreams.CommunityAccessDailyLiving));

    private static ParticipantDocumentModel Compose(
        string title,
        Participant participant,
        IReadOnlyList<ParticipantRiskEntry> riskEntries,
        Func<ParticipantDocumentTag, bool> tagMatches,
        bool includeCommunityAccess)
    {
        var sections = new List<ParticipantDocumentSection>();

        // GroupBy preserves first-seen order of keys for an in-memory LINQ source, so sections
        // come out in ParticipantDocumentFieldMap.Entries' declared order (the wizard step family
        // order documented on that class) with no extra ordering step needed here.
        foreach (var group in ParticipantDocumentFieldMap.Entries.GroupBy(e => e.SectionHeading))
        {
            var fields = new List<ParticipantDocumentField>();
            var tables = new List<ParticipantDocumentTable>();

            foreach (var entry in group)
            {
                if (entry.IsCommunityAccessGated && !includeCommunityAccess) continue;
                if (!tagMatches(entry.Tag)) continue;

                if (entry.IsTable)
                {
                    tables.Add(BuildTable(entry.FieldId, entry.Label, participant, riskEntries, includeCommunityAccess));
                }
                else
                {
                    var value = FormatParticipantProperty(participant, entry.ParticipantPropertyName!);
                    fields.Add(new ParticipantDocumentField(entry.Label, value));
                }
            }

            // Per the DOC-01 spec: a section is included only if it ends up with at least one
            // field or table for this document, once filtered by tag + CA gate above — so e.g.
            // "Key Identifiers" naturally never appears on the Intake Form, and "Community Access"
            // naturally never appears unless the participant has that stream.
            if (fields.Count == 0 && tables.Count == 0) continue;
            sections.Add(new ParticipantDocumentSection(group.Key, fields, tables));
        }

        return new ParticipantDocumentModel(title, participant.FullName, participant.NdisNumber, DateTime.UtcNow, sections);
    }

    // ── Scalar field formatting ──────────────────────────────────────────────────────────

    private static string FormatParticipantProperty(Participant participant, string propertyName)
    {
        var property = typeof(Participant).GetProperty(propertyName)
            ?? throw new InvalidOperationException($"ParticipantDocumentFieldMap references unknown Participant property '{propertyName}'.");
        return FormatValue(property.GetValue(participant));
    }

    private static string FormatValue(object? raw)
    {
        switch (raw)
        {
            case null:
                return EmptyPlaceholder;
            case string s:
                return OrPlaceholder(s);
            case bool b:
                return YesNo(b);
            case DateOnly d:
                return d.ToString("dd MMM yyyy");
            case DateTime dt:
                return dt.ToString("dd MMM yyyy");
            case decimal m:
                return m.ToString("0.##");
            case Enum e:
                return FormatEnum(e);
            case System.Collections.IEnumerable list:
                var items = list.Cast<object?>().Select(o => o?.ToString()).Where(s => !string.IsNullOrWhiteSpace(s)).ToList();
                return items.Count == 0 ? EmptyPlaceholder : string.Join(", ", items);
            default:
                return raw.ToString() is { Length: > 0 } str ? str : EmptyPlaceholder;
        }
    }

    /// <summary>
    /// A [Flags] enum (e.g. <see cref="HidpaSupportCategory"/>) renders as a comma-joined list of
    /// its set values (per the DOC-01 spec's explicit call-out on hidpaSupportCategories); any
    /// other enum renders as its single humanized value.
    /// </summary>
    private static string FormatEnum(Enum value)
    {
        var type = value.GetType();
        if (type.GetCustomAttribute<FlagsAttribute>() == null)
            return Humanize(value.ToString());

        var numeric = Convert.ToInt64(value);
        if (numeric == 0) return EmptyPlaceholder;

        var setFlags = Enum.GetValues(type).Cast<Enum>()
            .Where(v => Convert.ToInt64(v) != 0 && value.HasFlag(v))
            .Select(v => Humanize(v.ToString()))
            .ToList();
        return setFlags.Count == 0 ? EmptyPlaceholder : string.Join(", ", setFlags);
    }

    /// <summary>PascalCase -> spaced words (e.g. "PhotoVideo" -> "Photo Video"). Per the DOC-01 spec, this simple regex is sufficient — no display-name attribute system exists elsewhere in this codebase.</summary>
    private static string Humanize(string pascalCase) => Regex.Replace(pascalCase, @"(\B[A-Z])", " $1");

    // ── Table building ───────────────────────────────────────────────────────────────────

    private static ParticipantDocumentTable BuildTable(
        string fieldId, string heading, Participant participant, IReadOnlyList<ParticipantRiskEntry> riskEntries, bool includeCommunityAccess) =>
        fieldId switch
        {
            "contactRoles" => BuildContactsTable(heading, participant),
            "healthConditions" => BuildHealthConditionsTable(heading, participant),
            "consents" => BuildConsentsTable(heading, participant),
            "adlAssessments" => BuildAdlAssessmentsTable(heading, participant, includeCommunityAccess),
            "checklistItems" => BuildChecklistItemsTable(heading, participant),
            "riskEntries" => BuildRiskEntriesTable(heading, riskEntries),
            _ => throw new InvalidOperationException($"No table builder registered for field id '{fieldId}'."),
        };

    /// <summary>Contacts — every row (no filtering). Columns: Role, Name, Phone, Email, Primary, Status.</summary>
    private static ParticipantDocumentTable BuildContactsTable(string heading, Participant participant)
    {
        var columns = new[] { "Role", "Name", "Phone", "Email", "Primary", "Status" };
        var rows = participant.ContactRoles.Select(cr =>
        {
            var person = cr.Person;
            IReadOnlyList<string> row = new[]
            {
                Humanize(cr.RoleType.ToString()),
                person != null ? OrPlaceholder(person.FullName) : EmptyPlaceholder,
                person != null ? OrPlaceholder(person.Phone ?? person.Mobile) : EmptyPlaceholder,
                person != null ? OrPlaceholder(person.Email) : EmptyPlaceholder,
                YesNo(cr.IsPrimary),
                Humanize(cr.Status.ToString()),
            };
            return row;
        }).ToList();
        return new ParticipantDocumentTable(heading, columns, rows);
    }

    /// <summary>Health Conditions — rows with Has == true only. Columns: Condition, Severity, Plan Provided, Training Required, Notes.</summary>
    private static ParticipantDocumentTable BuildHealthConditionsTable(string heading, Participant participant)
    {
        var columns = new[] { "Condition", "Severity", "Plan Provided", "Training Required", "Notes" };
        var rows = participant.HealthConditions
            .Where(c => c.Has == true)
            .Select(c => (IReadOnlyList<string>) new[]
            {
                Humanize(c.ConditionType.ToString()),
                OrPlaceholder(c.Severity),
                YesNoOrPlaceholder(c.PlanProvided),
                YesNoOrPlaceholder(c.TrainingRequired),
                OrPlaceholder(c.Notes),
            })
            .ToList();
        return new ParticipantDocumentTable(heading, columns, rows);
    }

    /// <summary>
    /// Consents — a fixed-grid form field: every <see cref="ConsentType"/> is always shown,
    /// unfiltered (not a filtered log), materialized from whatever rows exist plus a placeholder
    /// for any type with no row yet — mirrors ParticipantConsentsController.MaterializeAll's
    /// shape, reimplemented locally since this composer cannot reference Odip.Api types.
    /// </summary>
    private static ParticipantDocumentTable BuildConsentsTable(string heading, Participant participant)
    {
        var columns = new[] { "Consent Type", "Status", "Recorded At", "Signed By", "Signed Date" };
        var byType = participant.Consents.ToDictionary(c => c.ConsentType);
        var rows = Enum.GetValues<ConsentType>().Select(type =>
        {
            byType.TryGetValue(type, out var row);
            var status = row?.Granted switch { true => "Granted", false => "Not Granted", null => "Not Recorded" };
            IReadOnlyList<string> cells = new[]
            {
                Humanize(type.ToString()),
                status ?? "Not Recorded",
                row?.RecordedAt is { } recordedAt ? recordedAt.ToString("dd MMM yyyy") : EmptyPlaceholder,
                OrPlaceholder(row?.SignedByName),
                row?.SignedDate is { } signedDate ? signedDate.ToString("dd MMM yyyy") : EmptyPlaceholder,
            };
            return cells;
        }).ToList();
        return new ParticipantDocumentTable(heading, columns, rows);
    }

    /// <summary>
    /// ADL Assessments — NOT CommunityAccessDailyLiving-gated at the table level (the base grid is
    /// relevant regardless of stream — see documentMapping.ts's adlAssessments note). Fixed row
    /// order via AdlTypeGroups.Personal.Concat(AdlTypeGroups.CommunityDomestic); a type with no
    /// ParticipantAdlAssessment row yet still gets a blank materialized row. The "How To Help"
    /// column is included only when <paramref name="includeCommunityAccess"/> is true — omitted
    /// entirely (not just left blank) otherwise.
    /// </summary>
    private static ParticipantDocumentTable BuildAdlAssessmentsTable(string heading, Participant participant, bool includeCommunityAccess)
    {
        var columns = includeCommunityAccess
            ? new[] { "ADL", "Level", "Notes", "How To Help" }
            : new[] { "ADL", "Level", "Notes" };

        var byType = participant.AdlAssessments.ToDictionary(a => a.AdlType);
        var orderedTypes = AdlTypeGroups.Personal.Concat(AdlTypeGroups.CommunityDomestic);
        var rows = orderedTypes.Select(type =>
        {
            byType.TryGetValue(type, out var row);
            var cells = new List<string>
            {
                Humanize(type.ToString()),
                row?.Level is { } level ? Humanize(level.ToString()) : EmptyPlaceholder,
                OrPlaceholder(row?.Notes),
            };
            if (includeCommunityAccess) cells.Add(OrPlaceholder(row?.HowToHelpNotes));
            return (IReadOnlyList<string>) cells;
        }).ToList();
        return new ParticipantDocumentTable(heading, columns, rows);
    }

    /// <summary>
    /// Checklist Items — fixed row order via ChecklistItemTypeGroups (Community Mobility & Transport
    /// Risk first, then Community Behaviours of Concern), filtered to rows where Value.HasValue
    /// ("checklists answered-only" per the DOC-01 brief).
    /// </summary>
    private static ParticipantDocumentTable BuildChecklistItemsTable(string heading, Participant participant)
    {
        var columns = new[] { "Item", "Value", "Notes" };
        var byType = participant.ChecklistItems.ToDictionary(c => c.ItemType);
        var orderedTypes = ChecklistItemTypeGroups.CommunityMobilityRisk.Concat(ChecklistItemTypeGroups.CommunityBehaviourOfConcern);
        var rows = orderedTypes
            .Select(type => byType.TryGetValue(type, out var row) ? row : null)
            .Where(row => row is { Value: not null })
            .Select(row => (IReadOnlyList<string>) new[]
            {
                Humanize(row!.ItemType.ToString()),
                Humanize(row.Value!.Value.ToString()),
                OrPlaceholder(row.Notes),
            })
            .ToList();
        return new ParticipantDocumentTable(heading, columns, rows);
    }

    /// <summary>Risk Entries — rows with IsActive == true only. Columns: At-Risk Party, Description, Mitigation Notes, Active.</summary>
    private static ParticipantDocumentTable BuildRiskEntriesTable(string heading, IReadOnlyList<ParticipantRiskEntry> riskEntries)
    {
        var columns = new[] { "At-Risk Party", "Description", "Mitigation Notes", "Active" };
        var rows = riskEntries
            .Where(r => r.IsActive)
            .Select(r => (IReadOnlyList<string>) new[]
            {
                Humanize(r.AtRiskParty.ToString()),
                OrPlaceholder(r.Description),
                OrPlaceholder(r.MitigationNotes),
                YesNo(r.IsActive),
            })
            .ToList();
        return new ParticipantDocumentTable(heading, columns, rows);
    }
}
