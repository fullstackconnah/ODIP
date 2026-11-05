using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.DataExport;

/// <summary>One register as a table of cells already escaped for CSV (CsvCell.Text for typed text, CsvCell.Quote for what the code formats).</summary>
public sealed record RegisterFile(IReadOnlyList<string> Headers, IReadOnlyList<string[]> Rows)
{
    private static readonly UTF8Encoding Utf8WithBom = new(encoderShouldEmitUTF8Identifier: true);

    /// <summary>UTF-8 with a BOM, CRLF line ends, RFC 4180: the encoding of the raw export's files.</summary>
    public byte[] ToCsv()
    {
        var lines = Rows.Prepend(Headers.Select(CsvCell.Quote).ToArray()).Select(r => string.Join(',', r) + "\r\n");
        return Utf8WithBom.GetPreamble().Concat(Utf8WithBom.GetBytes(string.Concat(lines))).ToArray();
    }
}

/// <summary>
/// The five curated registers an auditor asks for (Settings › Data export › Registers for auditors). Each query names the tenant itself, on top of the
/// global filter, and each register is held in memory.
/// shortcut: no row cap; stream like DataExportWriter if an organisation passes about 50k rows in a register.
/// </summary>
public static class Registers
{
    private static string Text(string? v) => CsvCell.Text(v ?? "");
    private static string Q(string? v) => CsvCell.Quote(v ?? "");
    private static string Date(DateOnly? d) => d is { } v ? v.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture) : "";
    private static string YesNo(bool? b) => b is { } v ? (v ? "Yes" : "No") : "";

    /// <summary>A date-time stored as provider-local wall clock: written as it is.</summary>
    private static string Local(DateTime? d) => d is { } v ? v.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture) : "";

    /// <summary>A date-time stored as a UTC instant: shown in the provider's zone.</summary>
    private static string Utc(DateTime? d, TimeZoneInfo zone) =>
        d is { } v ? ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(v), zone).ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture) : "";

    private static string UtcDate(DateTime d, TimeZoneInfo zone) =>
        ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(d), zone).ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    // The house one-liner (ParticipantDocumentComposer.Humanize).
    private static string Label(object? e) => e is null ? "" : Regex.Replace(e.ToString()!, @"(\B[A-Z])", " $1");

    private static string? Person(string? first, string? last) => first is null ? null : $"{first} {last}".Trim();

    // Participant.FullName: the preferred name stands in for the first.
    private static string? Participant(string? first, string? preferred, string? last) =>
        first is null ? null : $"{(string.IsNullOrWhiteSpace(preferred) ? first : preferred)} {last}".Trim();

    public static readonly string[] IncidentHeaders =
    [
        "Date and time", "Title", "Type", "Severity", "Status", "Participant", "Staff member involved", "Reported by", "Location", "Description",
        "Immediate actions", "Emergency services called", "Restrictive practice used", "Reportable class", "Notify the Commission by",
        "Detailed report due", "Commission reporting status", "Commission notified", "Commission reference", "Detailed report sent",
        "Final report sent", "Reviewed by", "Reviewed", "Corrective actions", "Resolved", "Family notified",
    ];

    public static readonly string[] ComplaintHeaders =
    [
        "Received", "Channel", "Complainant", "Complainant name", "Participant", "Summary", "Status", "Acknowledged", "Actions taken", "Outcome",
        "Outcome communicated", "Told about the NDIS Commission", "Told on", "Closed", "Handled by", "Linked incident",
    ];

    public static readonly string[] RestrictivePracticeHeaders =
    [
        "Participant", "Practice type", "Description", "Use", "Authorised by", "Authorised on", "Authorisation ends", "First used", "Review due",
        "Interim behaviour support plan", "Comprehensive behaviour support plan", "Reportable to the Commission", "Commission reference",
    ];

    public static readonly string[] RiskHeaders = ["Participant", "Kind", "Risk", "Rating", "Description", "Mitigation or strategy", "Recorded"];

    public static readonly string[] StaffHeaders =
    [
        "Name", "Role", "Position", "Employment started", "Worker screening number", "Worker screening expires", "First aid", "First aid expires",
        "CPR", "CPR expires", "Manual handling", "Manual handling expires", "Medication competency", "Medication competency expires", "Driver",
        "Driver licence expires", "Anything expired today",
    ];

    /// <summary>IncidentDateTime is provider-local wall clock, so the range is a plain local compare: from 00:00 up to the day after <paramref name="to"/> at 00:00.</summary>
    public static async Task<RegisterFile> IncidentsAsync(OdipDbContext db, Guid tenantId, DateOnly from, DateOnly to, TimeZoneInfo zone, CancellationToken ct)
    {
        var start = from.ToDateTime(TimeOnly.MinValue);
        var end = to.AddDays(1).ToDateTime(TimeOnly.MinValue);
        // Scoped through the reporter as ExportTables.Incidents is, because IncidentReport.TenantId is nullable; a row that does name a tenant must name this one.
        var staff = db.Users.Where(u => u.TenantId == tenantId);
        var rows = await db.IncidentReports.AsNoTracking()
            .Where(i => i.IsActive && staff.Any(u => u.Id == i.ReportedByUserId) && (i.TenantId == null || i.TenantId == tenantId))
            .Where(i => i.IncidentDateTime >= start && i.IncidentDateTime < end)
            .OrderBy(i => i.IncidentDateTime)
            .Select(i => new
            {
                i.IncidentDateTime, i.Title, i.IncidentType, i.OtherTypeSpecify, i.Severity, i.Status,
                PFirst = i.InvolvedParticipant!.FirstName, PPref = i.InvolvedParticipant!.PreferredName, PLast = i.InvolvedParticipant!.LastName,
                IFirst = i.InvolvedUser!.FirstName, ILast = i.InvolvedUser!.LastName,
                RFirst = i.ReportedByUser.FirstName, RLast = i.ReportedByUser.LastName,
                i.Location, i.Description, i.ImmediateActionsTaken, i.WereEmergencyServicesCalled, i.RestrictivePracticeType, i.ReportableClass,
                i.NotifyDueAt, i.DetailedReportDueAt, i.QscReportingStatus, i.QscReportedAt, i.QscReferenceNumber,
                i.CommissionDetailedReportedAt, i.CommissionFinalReportedAt,
                VFirst = i.ReviewedByUser!.FirstName, VLast = i.ReviewedByUser!.LastName,
                i.ReviewedAt, i.CorrectiveActions, i.ResolvedAt, i.FamilyNotified,
            })
            .ToListAsync(ct);
        // Local, as stored: the incident time and the Commission's reported times (a person types them). UTC, shown in the zone: the due times and the
        // review and resolve stamps, which the server sets from its clock (IncidentsController.cs :80-83, :915, :1006, :1010).
        return new(IncidentHeaders, rows.Select(r => new[]
        {
            Q(Local(r.IncidentDateTime)), Text(r.Title),
            r.IncidentType == IncidentType.Other && !string.IsNullOrWhiteSpace(r.OtherTypeSpecify) ? Text("Other: " + r.OtherTypeSpecify) : Q(Label(r.IncidentType)),
            Q(Label(r.Severity)), Q(Label(r.Status)), Text(Participant(r.PFirst, r.PPref, r.PLast)), Text(Person(r.IFirst, r.ILast)),
            Text(Person(r.RFirst, r.RLast)), Text(r.Location), Text(r.Description), Text(r.ImmediateActionsTaken), Q(YesNo(r.WereEmergencyServicesCalled)),
            Q(Label(r.RestrictivePracticeType)), Q(Label(r.ReportableClass)), Q(Utc(r.NotifyDueAt, zone)), Q(Utc(r.DetailedReportDueAt, zone)),
            Q(Label(r.QscReportingStatus)), Q(Local(r.QscReportedAt)), Text(r.QscReferenceNumber), Q(Local(r.CommissionDetailedReportedAt)),
            Q(Local(r.CommissionFinalReportedAt)), Text(Person(r.VFirst, r.VLast)), Q(Utc(r.ReviewedAt, zone)), Text(r.CorrectiveActions),
            Q(Utc(r.ResolvedAt, zone)), Q(YesNo(r.FamilyNotified)),
        }).ToList());
    }

    public static async Task<RegisterFile> ComplaintsAsync(OdipDbContext db, Guid tenantId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var rows = await db.Complaints.AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.IsActive && c.ReceivedOn >= from && c.ReceivedOn <= to)
            .OrderBy(c => c.ReceivedOn).ThenBy(c => c.CreatedAt)
            .Select(c => new
            {
                c.ReceivedOn, c.Channel, c.ComplainantKind, c.ComplainantName,
                PFirst = c.Participant!.FirstName, PPref = c.Participant!.PreferredName, PLast = c.Participant!.LastName,
                c.Summary, c.Status, c.AcknowledgedOn, c.ActionsTaken, c.Outcome, c.OutcomeCommunicatedOn, c.ToldAboutCommission, c.ToldAboutCommissionOn,
                c.ClosedOn, HFirst = c.HandledBy!.FirstName, HLast = c.HandledBy!.LastName, Incident = c.IncidentReport!.Title,
            })
            .ToListAsync(ct);
        return new(ComplaintHeaders, rows.Select(r => new[]
        {
            Q(Date(r.ReceivedOn)), Q(Label(r.Channel)), Q(Label(r.ComplainantKind)), Text(r.ComplainantName), Text(Participant(r.PFirst, r.PPref, r.PLast)),
            Text(r.Summary), Q(Label(r.Status)), Q(Date(r.AcknowledgedOn)), Text(r.ActionsTaken), Text(r.Outcome), Q(Date(r.OutcomeCommunicatedOn)),
            Q(YesNo(r.ToldAboutCommission)), Q(Date(r.ToldAboutCommissionOn)), Q(Date(r.ClosedOn)), Text(Person(r.HFirst, r.HLast)), Text(r.Incident),
        }).ToList());
    }

    public static async Task<RegisterFile> RestrictivePracticesAsync(OdipDbContext db, Guid tenantId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        // In force at any time in the range. A practice with no start date is included: never hide one from an auditor.
        var rows = await db.RestrictivePractices.AsNoTracking()
            .Where(p => p.TenantId == tenantId && p.IsActive
                && ((p.AuthorisationDate ?? p.FirstUsedOn) == null || (p.AuthorisationDate ?? p.FirstUsedOn) <= to)
                && (p.AuthorisationEndDate == null || p.AuthorisationEndDate >= from))
            .Select(p => new
            {
                PFirst = p.Participant!.FirstName, PPref = p.Participant!.PreferredName, PLast = p.Participant!.LastName,
                p.Type, p.Description, p.UseKind, p.AuthorisedBy, p.AuthorisationDate, p.AuthorisationEndDate, p.FirstUsedOn, p.ReviewDate,
                p.InterimBspDate, p.ComprehensiveBspDate, p.RequiresReporting, p.CommissionReference,
            })
            .ToListAsync(ct);
        return new(RestrictivePracticeHeaders, rows
            .OrderBy(r => Participant(r.PFirst, r.PPref, r.PLast), StringComparer.OrdinalIgnoreCase).ThenBy(r => r.AuthorisationDate)
            .Select(r => new[]
            {
                Text(Participant(r.PFirst, r.PPref, r.PLast)), Q(Label(r.Type)), Text(r.Description), Q(Label(r.UseKind)), Text(r.AuthorisedBy),
                Q(Date(r.AuthorisationDate)), Q(Date(r.AuthorisationEndDate)), Q(Date(r.FirstUsedOn)), Q(Date(r.ReviewDate)), Q(Date(r.InterimBspDate)),
                Q(Date(r.ComprehensiveBspDate)), Q(YesNo(r.RequiresReporting)), Text(r.CommissionReference),
            }).ToList());
    }

    /// <summary>Both risk sources in one file: the participant's risk entries and the community access items (the only ones with a rating). A snapshot as at today.</summary>
    public static async Task<RegisterFile> RisksAsync(OdipDbContext db, Guid tenantId, TimeZoneInfo zone, CancellationToken ct)
    {
        var risks = await db.ParticipantRiskEntries.AsNoTracking().Where(r => r.TenantId == tenantId && r.IsActive)
            .Select(r => new
            {
                PFirst = r.Participant!.FirstName, PPref = r.Participant!.PreferredName, PLast = r.Participant!.LastName,
                r.AtRiskParty, r.Description, r.MitigationNotes, r.CreatedAt,
            }).ToListAsync(ct);
        var access = await db.ParticipantCommunityAccessRiskItems.AsNoTracking().Where(r => r.TenantId == tenantId)
            .Select(r => new
            {
                PFirst = r.Participant!.FirstName, PPref = r.Participant!.PreferredName, PLast = r.Participant!.LastName,
                r.ItemType, r.Rating, r.StrategyNotes, r.CreatedAt,
            }).ToListAsync(ct);
        var all = risks.Select(r => (Name: Participant(r.PFirst, r.PPref, r.PLast) ?? "", Kind: "Risk",
                Cells: new[] { "Risk", Q(Label(r.AtRiskParty)), "", Text(r.Description), Text(r.MitigationNotes), UtcDate(r.CreatedAt, zone) }))
            .Concat(access.Select(r => (Name: Participant(r.PFirst, r.PPref, r.PLast) ?? "", Kind: "Community access",
                Cells: new[] { "Community access", Q(Label(r.ItemType)), Q(Label(r.Rating)), "", Text(r.StrategyNotes), UtcDate(r.CreatedAt, zone) })))
            .OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Kind, StringComparer.Ordinal);
        return new(RiskHeaders, all.Select(x => x.Cells.Prepend(Text(x.Name)).ToArray()).ToList());
    }

    public static async Task<RegisterFile> StaffCredentialsAsync(OdipDbContext db, Guid tenantId, DateOnly today, CancellationToken ct)
    {
        var rows = await db.Users.AsNoTracking().Where(u => u.TenantId == tenantId && u.IsActive)
            .OrderBy(u => u.LastName).ThenBy(u => u.FirstName).ToListAsync(ct);
        return new(StaffHeaders, rows.Select(u => new[]
        {
            Text(u.FullName), Q(Label(u.Role)), Q(Label(u.Position)), Q(Date(u.EmploymentStartDate)), Text(u.WorkerScreeningNumber),
            Q(Date(u.WorkerScreeningExpiryDate)), Q(YesNo(u.IsFirstAidQualified)), Q(Date(u.FirstAidExpiryDate)), Q(YesNo(u.IsCprQualified)),
            Q(Date(u.CprExpiryDate)), Q(YesNo(u.IsManualHandlingCompetent)), Q(Date(u.ManualHandlingExpiryDate)), Q(YesNo(u.IsMedicationCompetent)),
            Q(Date(u.MedicationCompetencyExpiryDate)), Q(YesNo(u.IsDriverEligible)), Q(Date(u.DriverLicenceExpiryDate)),
            Q(YesNo(u.HasExpiredQualificationsOn(today))),
        }).ToList());
    }
}
