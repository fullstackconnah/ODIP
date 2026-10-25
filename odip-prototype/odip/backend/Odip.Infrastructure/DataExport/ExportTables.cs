using System.Linq.Expressions;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Odip.Application.Serialization;
using Odip.Domain.Entities;
using Odip.Domain.Funding;
using Odip.Domain.Integrations;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.DataExport;

/// <summary>One CSV file of the export: its name in the ZIP, the entity it holds, its README line, and the organisation's rows of it.</summary>
public sealed record ExportTable(string FileName, Type EntityType, string Description, Func<OdipDbContext, Guid, IQueryable<object>> Rows)
{
    /// <summary>Columns left out of the file, each with the reason the README gives.</summary>
    public IReadOnlyDictionary<string, string> Omit { get; init; } = new Dictionary<string, string>();
}

/// <summary>A column of an export file: its header, whether it holds provider-local time, and how one row's value is written.</summary>
public sealed record ExportColumn(string Name, bool WallClock, Func<object, string> Cell);

/// <summary>
/// Everything the data export writes, and what it deliberately leaves out (the spec: vault Specs/2026-10-14-data-export-and-retention-design).
/// Every table is scoped EXPLICITLY to the organisation id it is given, never by "whatever the query filter lets through":
/// - a tenant-owned table by its own TenantId;
/// - a table with no TenantId through its tenant-owned parent, with the id in the parent's subquery too. A SuperAdmin context has the filter off,
///   and so would any future caller.
/// The parents follow the house rules:
/// - a claim is its trip's or its participant's (ClaimsController.TenantClaims);
/// - an incident is the reporting user's (IncidentsController.TenantIncidents);
/// - a booking, and everything else on a trip, is the trip's.
/// ExportTablesTests fails on any entity in the model that is in neither list, so a new table can't be missed or leaked without a decision.
/// </summary>
public static class ExportTables
{
    public const string DocumentsFolder = "documents/";

    public static readonly IReadOnlyDictionary<Type, string> LeftOut = new Dictionary<Type, string>
    {
        [typeof(EmploymentHeroConnection)] = "Integration credentials (encrypted API key) and connection settings: never exported.",
        [typeof(AuditLog)] = "The change history (audit log). It has no organisation column, so it can't yet be separated safely from other organisations' history.",
        [typeof(NotificationOutbox)] = "Queued notification messages and their contents.",
        [typeof(InAppNotification)] = "Bell notices for each person. They are short-lived and purged after 90 days, like the queued notification messages.",
        [typeof(SupportCatalogueItem)] = "The NDIS support catalogue, which is the same for every organisation.",
        [typeof(SupportActivityGroup)] = "The support catalogue's activity groups, which are the same for every organisation.",
        [typeof(PublicHoliday)] = "The public holiday calendar, which is the same for every organisation.",
        [typeof(PublicHolidayOverride)] = "Changes to the public holiday calendar, which apply to every organisation.",
        [typeof(WhatsNewEntry)] = "Release notes from Bunya Support, which are the same for every organisation.",
        [typeof(WhatsNewUserState)] = "When each person last opened What's new, which is screen state, not your organisation's records.",
        [typeof(EarlyAccessRequest)] = "Early access requests from the ODIP website, which aren't your organisation's records.",
        [typeof(InvoiceNumberCounter)] = "ODIP's next-number counter; the numbers themselves are in invoices.csv.",
        [typeof(EarlyAccessLaterSubmission)] = "Repeat early access requests from the ODIP website, which aren't your organisation's records.",
    };

    /// <summary>
    /// The file's columns: the key first, then the rest in the order the entity declares them. Every mapped property is included except:
    /// - byte arrays (the intake PDFs go in documents/);
    /// - the table's Omit list.
    /// </summary>
    public static IReadOnlyList<ExportColumn> Columns(IModel model, ExportTable table)
    {
        var entity = model.FindEntityType(table.EntityType)!;
        var key = entity.FindPrimaryKey()?.Properties ?? [];
        return entity.GetProperties()
            .Where(p => p.ClrType != typeof(byte[]) && !table.Omit.ContainsKey(p.Name))
            .OrderBy(p => key.Contains(p) ? 0 : 1)
            .ThenBy(p => p.PropertyInfo?.MetadataToken ?? int.MaxValue)
            .Select(p =>
            {
                var getter = p.GetGetter();
                var wallClock = IsWallClock(p);
                return new ExportColumn(p.Name, wallClock, row => ExportValue.Cell(getter.GetClrValue(row), wallClock));
            })
            .ToList();
    }

    /// <summary>
    /// A DateTime column that holds provider-local digits rather than an instant. It is taken from the API's own marks: an entity property named
    /// like a member marked [WallClock] (DateTimeWireInventoryTests lists each one with its reason). Today that gives 12 columns, and
    /// ExportTablesTests pins them.
    /// </summary>
    public static bool IsWallClock(IReadOnlyProperty property) =>
        (property.ClrType == typeof(DateTime) || property.ClrType == typeof(DateTime?)) && WallClockNames.Contains(property.Name);

    private static readonly HashSet<string> WallClockNames = typeof(WallClockAttribute).Assembly.GetTypes()
        .SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        .Where(p => p.IsDefined(typeof(WallClockAttribute), inherit: false))
        .Select(p => p.Name)
        .ToHashSet();

    private static ExportTable Own<T>(string file, string description) where T : class, ITenantEntity =>
        new(file, typeof(T), description, (db, t) => WithoutBytes(db, db.Set<T>().AsNoTracking().Where(e => e.TenantId == t)));

    /// <summary>
    /// The rows with every byte-array column left unread, built from the model so a new column can't be missed. The CSV never writes bytes
    /// (Columns skips them), and the intake PDFs are read once, for documents/.
    /// </summary>
    private static IQueryable<T> WithoutBytes<T>(OdipDbContext db, IQueryable<T> rows) where T : class
    {
        var mapped = db.Model.FindEntityType(typeof(T))!.GetProperties().Where(p => p.PropertyInfo is not null).ToList();
        if (mapped.All(p => p.ClrType != typeof(byte[]))) return rows;
        var row = Expression.Parameter(typeof(T), "row");
        var copy = Expression.MemberInit(Expression.New(typeof(T)),
            mapped.Where(p => p.ClrType != typeof(byte[])).Select(p => Expression.Bind(p.PropertyInfo!, Expression.Property(row, p.PropertyInfo!))));
        return rows.Select(Expression.Lambda<Func<T, T>>(copy, row));
    }

    private static ExportTable Via<T>(string file, string description, Func<OdipDbContext, Guid, IQueryable<T>> rows) where T : class =>
        new(file, typeof(T), description, (db, t) => rows(db, t).AsNoTracking());

    private static IQueryable<Participant> Participants(OdipDbContext db, Guid t) => db.Participants.Where(p => p.TenantId == t);
    private static IQueryable<User> Staff(OdipDbContext db, Guid t) => db.Users.Where(u => u.TenantId == t);
    private static IQueryable<TripInstance> Trips(OdipDbContext db, Guid t) => db.TripInstances.Where(x => x.TenantId == t);
    private static IQueryable<ServiceAgreementDraft> Drafts(OdipDbContext db, Guid t) => db.ServiceAgreementDrafts.Where(d => d.TenantId == t);

    private static IQueryable<TripClaim> Claims(OdipDbContext db, Guid t)
    {
        var trips = Trips(db, t);
        var people = Participants(db, t);
        return db.TripClaims.Where(c => trips.Any(x => x.Id == c.TripInstanceId) || people.Any(p => p.Id == c.ParticipantId));
    }

    private static IQueryable<IncidentReport> Incidents(OdipDbContext db, Guid t)
    {
        var staff = Staff(db, t);
        return db.IncidentReports.Where(i => staff.Any(u => u.Id == i.ReportedByUserId));
    }

    /// <summary>The exported tables, in the order of the files in the ZIP and the manifest.</summary>
    public static readonly IReadOnlyList<ExportTable> All =
    [
        // Your organisation and its settings
        Via("organisation.csv", "Your organisation: its name and email domain.", (db, t) => db.Tenants.Where(x => x.Id == t)),
        Own<ProviderSettings>("provider-settings.csv", "Provider details: registration, ABN, address, bank and invoice details, and the readiness and competency checks."),
        Own<AppSettings>("app-settings.csv", "General settings, such as how early qualification warnings start."),
        Own<PlanPricingSettings>("plan-pricing-settings.csv", "Plan pricing settings: registration groups, the crossing policy and travel rates."),
        Own<BudgetSettings>("budget-settings.csv", "What a budget check does, and when a participant counts as approaching their budget."),

        // Staff
        Own<User>("staff.csv", "Staff and other users: name, contact details, role, qualifications with their expiry dates, and worker screening number."),
        Via("staff-availability.csv", "Staff availability and unavailability from the older availability screen.",
            (db, t) => { var staff = Staff(db, t); return db.StaffAvailabilities.Where(a => staff.Any(u => u.Id == a.UserId)); }),
        Own<LeaveRequest>("leave-requests.csv", "Leave requests and their decisions, including leave entered in Employment Hero and the hours sent to it."),
        Own<RecurringUnavailability>("recurring-unavailability.csv", "Regular times staff can't work, and their decisions."),
        Own<NotificationPreference>("notification-preferences.csv", "Which emails and text messages each person has turned on."),
        Own<NotificationLog>("notification-log.csv", "Emails and text messages sent: when, how and to which address."),

        // Participants
        Own<Participant>("participants.csv", "Participants: personal, NDIS, Medicare and card details, diagnoses, support needs and plan details."),
        Own<ParticipantInquiry>("participant-inquiries.csv", "Enquiries from people who might become participants."),
        Own<InquiryContact>("inquiry-contacts.csv", "Contacts noted on enquiries before intake started: family, guardians and others to keep in touch with."),
        Own<ParticipantOnboarding>("participant-onboarding.csv", "Each participant's onboarding steps and when they were done."),
        Own<ParticipantIntakeSnapshot>("participant-intake-snapshots.csv", "Each completed intake: when, by whom, and its data. The PDF of each is in documents/."),
        Own<Person>("people.csv", "People connected to participants: family, guardians, nominees, plan managers and health professionals."),
        Own<ParticipantContactRole>("participant-contact-roles.csv", "How each person is connected to a participant, with any order or appointment details."),
        Via("contacts.csv", "Contacts from the older contact list that are linked to your participants.", (db, t) =>
        {
            var people = Participants(db, t);
            var links = db.ParticipantContacts.Where(pc => people.Any(p => p.Id == pc.ParticipantId));
            return db.Contacts.Where(c => links.Any(l => l.ContactId == c.Id) || people.Any(p => p.PlanManagerContactId == c.Id));
        }),
        Via("participant-contacts.csv", "Links between participants and the older contact list.",
            (db, t) => { var people = Participants(db, t); return db.ParticipantContacts.Where(pc => people.Any(p => p.Id == pc.ParticipantId)); }),
        Via("support-profiles.csv", "Support profiles: behaviour, communication and personal care notes.",
            (db, t) => { var people = Participants(db, t); return db.SupportProfiles.Where(s => people.Any(p => p.Id == s.ParticipantId)); }),
        Own<ParticipantNote>("participant-notes.csv", "Notes on participants, archived ones included."),
        Own<ParticipantRoutine>("participant-routines.csv", "Participants' daily routines."),
        Own<ParticipantRiskEntry>("participant-risks.csv", "Participants' risk register entries."),
        Own<ParticipantConsent>("participant-consents.csv", "The consents each participant has given."),
        Own<ParticipantHealthCondition>("participant-health-conditions.csv", "Health conditions and how they are managed."),
        Own<ParticipantAdlAssessment>("participant-adl-assessments.csv", "Daily living assessments."),
        Own<ParticipantChecklistItem>("participant-checklist-items.csv", "Participant checklist answers."),
        Own<ParticipantCommunityAccessRiskItem>("participant-community-access-risks.csv", "Community access risk ratings."),
        Own<RestrictivePractice>("restrictive-practices.csv", "Restrictive practices and their authorisations."),
        Own<CaregiverProfileSubmission>("caregiver-submissions.csv", "Profile changes sent in by families and carers, and their review.") with
        {
            Omit = new Dictionary<string, string> { [nameof(CaregiverProfileSubmission.TokenHash)] = "the secret behind the family's form link, which nobody needs to read" },
        },
        Own<ParticipantMedication>("medications.csv", "Medications: dose, directions, prescriber, consent and review dates, ceased ones included."),
        Own<MedicationAdministration>("medication-administrations.csv", "Every dose given, refused or missed, with who recorded and witnessed it."),
        Own<FundingPlan>("funding-plans.csv", "NDIS plans: dates, how they are managed, and the evidence."),
        Own<FundingPool>("funding-pools.csv", "Each plan's budgets by support category."),
        Own<FundingPeriod>("funding-periods.csv", "Each budget's periods and amounts."),

        // Service agreements
        Own<ServiceAgreementDraft>("service-agreements.csv", "Service agreements: plan and agreement dates, services and pricing."),
        Via("service-agreement-lines.csv", "The priced lines of each service agreement.",
            (db, t) => { var drafts = Drafts(db, t); return db.ServiceAgreementDraftLines.Where(l => drafts.Any(d => d.Id == l.DraftId)); }),
        Via("service-agreement-blocks.csv", "The weekly support blocks of each service agreement.",
            (db, t) => { var drafts = Drafts(db, t); return db.ServiceAgreementDraftBlocks.Where(b => drafts.Any(d => d.Id == b.DraftId)); }),
        Own<ServiceAgreementDraftApproval>("service-agreement-approvals.csv", "Approvals of service agreements."),
        Own<ElectronicSigningSnapshot>("signing-snapshots.csv", "Each agreement document as it was sent for signing."),
        Own<ElectronicSigningEvidence>("signing-evidence.csv", "Signing evidence: who signed, in what capacity, when, and the evidence hashes."),

        // Rostering
        Own<ShiftPattern>("shift-patterns.csv", "Repeating shift patterns."),
        Own<RosterWeek>("roster-weeks.csv", "The roster weeks that have been started."),
        Own<Shift>("shifts.csv", "Shifts: participant, worker, date, times and status."),
        Own<ShiftNote>("shift-notes.csv", "Notes written on shifts."),
        Own<ShiftCompletion>("shift-completions.csv", "Shift finishes: actual times, what happened, and the review."),
        Own<ShiftBreak>("shift-breaks.csv", "Breaks taken during shifts."),
        Own<ShiftRoutineCheck>("shift-routine-checks.csv", "Routines ticked off during shifts."),
        Own<HandoverAcknowledgement>("handover-acknowledgements.csv", "Who read each shift handover, and when."),
        Own<StaffParticipantCompatibility>("staff-participant-compatibility.csv", "Which staff suit which participants."),

        // Trips
        Own<EventTemplate>("event-templates.csv", "Trip templates."),
        Own<Activity>("activities.csv", "The activity library."),
        Own<TripInstance>("trips.csv", "Trips: dates, places, status and coordinator."),
        Via("trip-days.csv", "The days of each trip.",
            (db, t) => { var trips = Trips(db, t); return db.TripDays.Where(d => trips.Any(x => x.Id == d.TripInstanceId)); }),
        Via("scheduled-activities.csv", "The activities planned on each trip day.", (db, t) =>
        {
            var trips = Trips(db, t);
            var days = db.TripDays.Where(d => trips.Any(x => x.Id == d.TripInstanceId));
            return db.ScheduledActivities.Where(a => days.Any(d => d.Id == a.TripDayId));
        }),
        Via("bookings.csv", "Participants booked on trips: status, payment, insurance and claim status.",
            (db, t) => { var trips = Trips(db, t); return db.ParticipantBookings.Where(b => trips.Any(x => x.Id == b.TripInstanceId)); }),
        Own<AccommodationProperty>("accommodation-properties.csv", "Accommodation you use."),
        Via("accommodation-reservations.csv", "Accommodation booked for trips.",
            (db, t) => { var trips = Trips(db, t); return db.AccommodationReservations.Where(r => trips.Any(x => x.Id == r.TripInstanceId)); }),
        Own<Vehicle>("vehicles.csv", "Vehicles: registration, seats and service dates."),
        Via("vehicle-assignments.csv", "Vehicles and drivers assigned to trips.",
            (db, t) => { var trips = Trips(db, t); return db.VehicleAssignments.Where(v => trips.Any(x => x.Id == v.TripInstanceId)); }),
        Via("staff-assignments.csv", "Staff assigned to trips.",
            (db, t) => { var trips = Trips(db, t); return db.StaffAssignments.Where(s => trips.Any(x => x.Id == s.TripInstanceId)); }),
        Via("trip-documents.csv", "Documents recorded against trips: their details only, as ODIP stores no files for them.",
            (db, t) => { var trips = Trips(db, t); return db.TripDocuments.Where(d => trips.Any(x => x.Id == d.TripInstanceId)); }) with
        {
            Omit = new Dictionary<string, string> { [nameof(TripDocument.FilePath)] = "a location on ODIP's own server, which means nothing outside ODIP" },
        },

        // Incidents
        Via("incidents.csv", "Incident reports: what happened, who was involved, the compliance steps and the review.", (db, t) => Incidents(db, t)),
        Via("incident-injuries.csv", "Injuries recorded on incidents.",
            (db, t) => { var incidents = Incidents(db, t); return db.IncidentInjuries.Where(i => incidents.Any(x => x.Id == i.IncidentReportId)); }),
        Via("incident-witnesses.csv", "Witnesses to incidents, and their statements.",
            (db, t) => { var incidents = Incidents(db, t); return db.IncidentWitnesses.Where(w => incidents.Any(x => x.Id == w.IncidentReportId)); }),

        // Claims
        Via("claims.csv", "Claims: reference, period, status, totals and dates.", (db, t) => Claims(db, t)),
        Via("claim-lines.csv", "The lines of each claim: support item, dates, hours and price.",
            (db, t) => { var claims = Claims(db, t); return db.ClaimLineItems.Where(l => claims.Any(c => c.Id == l.TripClaimId)); }),
        Own<Invoice>("invoices.csv", "Numbered invoices and credit notes as issued: payer, seller and bank details, totals, and voids, including those whose claim was deleted."),
        Own<InvoiceLine>("invoice-lines.csv", "The lines of each invoice and credit note, as issued."),

        // Tasks and imports
        Own<BookingTask>("tasks.csv", "Tasks: what, for whom, when due, and their status."),
        Own<ImportBatch>("import-batches.csv", "Imports of participants and staff, and their undos."),
        Via("import-batch-items.csv", "The records each import created.",
            (db, t) => { var batches = db.ImportBatches.Where(b => b.TenantId == t); return db.ImportBatchItems.Where(i => batches.Any(b => b.Id == i.BatchId)); }),

        // Employment Hero (the connection itself, with its encrypted key, is in LeftOut)
        Own<EmploymentHeroAttention>("employment-hero-attention.csv", "Staff the Employment Hero sync needs an Admin to look at, and why.") with
        {
            Omit = new Dictionary<string, string> { [nameof(EmploymentHeroAttention.Key)] = "ODIP's own label for the item (its kind and the person's id, both already in the file)" },
        },
        Own<EmploymentHeroSyncLog>("employment-hero-sync-log.csv", "Each Employment Hero staff sync and timesheet send of the last 90 days: when, which business, what changed, and any error."),
        Own<EmploymentHeroOutbox>("employment-hero-timesheets.csv", "Hours sent to or waiting for Employment Hero Payroll: one row per approved shift, with what happened.") with
        {
            Omit = new Dictionary<string, string> { [nameof(EmploymentHeroOutbox.PayloadHash)] = "a fingerprint of the last payload sent, not data" },
        },
    ];
}
