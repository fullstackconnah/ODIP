using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// CRUD operations for NDIS participants.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/participants")]
public class ParticipantsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly StaffCompatibilityLinkService _compatLink;
    private readonly ParticipantDocumentService _documentService;
    private readonly SafetyNoteSyncService _safetyNoteSync;
    public ParticipantsController(OdipDbContext db, StaffCompatibilityLinkService compatLink, ParticipantDocumentService documentService, SafetyNoteSyncService safetyNoteSync)
    {
        _db = db;
        _compatLink = compatLink;
        _documentService = documentService;
        _safetyNoteSync = safetyNoteSync;
    }

    /// <summary>
    /// §4.4 same-tenant validation for the preferred-staff (now preferred-user) picker: null is
    /// always fine, otherwise the id must resolve to an active User — same-tenant scoping comes
    /// for free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidPreferredUserRefAsync(Guid? userId, CancellationToken ct) =>
        userId.HasValue
            ? _db.Users.AnyAsync(u => u.Id == userId.Value && u.IsActive, ct)
            : Task.FromResult(true);

    /// <summary>
    /// INTAKE sub-wave B — upserts every consent row submitted with a create/update payload,
    /// keyed by <see cref="Domain.Enums.ConsentType"/> rather than blindly inserting (unlike
    /// RiskEntries' insert-only Create loop): the wizard's Cultural &amp; Consent step remains
    /// editable in edit mode too (see CreateParticipantDto.Consents' doc), so a second/third save
    /// of the same participant must update the SAME seven rows, not create duplicates. For a
    /// brand-new participant (no existing rows) this degenerates to a plain insert loop, same
    /// effective behaviour as Create previously had. Shares the exact same answer-application
    /// semantics (RecordedAt only re-stamped when Granted actually changes) as
    /// ParticipantConsentsController.Upsert via <see cref="ParticipantConsentsController.ApplyAnswer"/>,
    /// so a wizard save and a detail-page edit never disagree about what "recorded" means. Called
    /// before SaveChangesAsync so every row lands in the same transaction as the participant
    /// insert/update.
    /// </summary>
    private async Task UpsertConsentsAsync(Guid participantId, List<CreateParticipantConsentDto> consents, CancellationToken ct)
    {
        // Load-bearing guard, not just an optimisation: an Update caller that never mentions
        // Consents (e.g. ParticipantsPage's isActive-only toggle, or any older client built
        // before this field existed) round-trips CreateParticipantDto/UpdateParticipantDto with
        // Consents defaulted to an empty list — without this early return, an empty submission
        // would be indistinguishable from "delete every consent answer" and this loop would have
        // nothing to iterate anyway, but the intent must read as "leave existing rows alone",
        // which is exactly what returning before touching the database achieves. `consents is
        // null` additionally covers a raw `"consents": null` JSON payload — System.Text.Json
        // overwrites the DTO's `= new()` initializer with an explicit null when the property IS
        // present (even if null) in the request body, so the empty-list default alone doesn't
        // guarantee non-null at runtime despite the non-nullable parameter type.
        if (consents is null || consents.Count == 0) return;
        var existing = await _db.ParticipantConsents.Where(c => c.ParticipantId == participantId).ToListAsync(ct);
        var byType = existing.ToDictionary(c => c.ConsentType);
        foreach (var dto in consents)
        {
            if (!byType.TryGetValue(dto.ConsentType, out var row))
            {
                row = new ParticipantConsent { Id = Guid.NewGuid(), ParticipantId = participantId, ConsentType = dto.ConsentType };
                _db.ParticipantConsents.Add(row);
                byType[dto.ConsentType] = row;
            }
            ParticipantConsentsController.ApplyAnswer(row, dto.Granted, dto.SignedByName, dto.SignedDate);
        }
    }

    /// <summary>
    /// INTAKE sub-wave C1 — upserts every health-condition row submitted with a create/update
    /// payload, keyed by <see cref="Domain.Enums.HealthConditionType"/>. Copies
    /// <see cref="UpsertConsentsAsync"/>'s documented pattern exactly, including the load-bearing
    /// empty/null guard below (same reasoning: an Update caller that never mentions
    /// HealthConditions round-trips an empty list, which must mean "leave existing rows alone", not
    /// "clear every condition answer"). Called before SaveChangesAsync so every row lands in the
    /// same transaction as the participant insert/update.
    /// </summary>
    private async Task UpsertHealthConditionsAsync(Guid participantId, List<CreateParticipantHealthConditionDto> conditions, CancellationToken ct)
    {
        if (conditions is null || conditions.Count == 0) return;
        var existing = await _db.ParticipantHealthConditions.Where(c => c.ParticipantId == participantId).ToListAsync(ct);
        var byType = existing.ToDictionary(c => c.ConditionType);
        foreach (var dto in conditions)
        {
            if (!byType.TryGetValue(dto.ConditionType, out var row))
            {
                row = new ParticipantHealthCondition { Id = Guid.NewGuid(), ParticipantId = participantId, ConditionType = dto.ConditionType };
                _db.ParticipantHealthConditions.Add(row);
                byType[dto.ConditionType] = row;
            }
            ParticipantHealthConditionsController.ApplyAnswer(row, dto.Has, dto.Severity, dto.PlanProvided, dto.TrainingRequired, dto.Notes);
        }
    }

    /// <summary>
    /// INTAKE sub-wave C2 — upserts every ADL-assessment row submitted with a create/update
    /// payload, keyed by <see cref="Domain.Enums.AdlType"/>. Copies UpsertHealthConditionsAsync's
    /// documented pattern exactly, including the load-bearing empty/null guard below (same
    /// reasoning: an Update caller that never mentions AdlAssessments round-trips an empty list,
    /// which must mean "leave existing rows alone", not "clear every ADL answer"). Called before
    /// SaveChangesAsync so every row lands in the same transaction as the participant insert/update.
    /// Sparse on creation (see the guard inside the loop below): the wizard always submits the
    /// full fixed twenty-row array with every hidden/unanswered row already null (see
    /// <see cref="CreateParticipantAdlAssessmentDto"/>'s doc), so a blank incoming row must not
    /// become a permanent database row just because it was present in the payload.
    /// </summary>
    private async Task UpsertAdlAssessmentsAsync(Guid participantId, List<CreateParticipantAdlAssessmentDto> assessments, CancellationToken ct)
    {
        if (assessments is null || assessments.Count == 0) return;
        var existing = await _db.ParticipantAdlAssessments.Where(a => a.ParticipantId == participantId).ToListAsync(ct);
        var byType = existing.ToDictionary(a => a.AdlType);
        foreach (var dto in assessments)
        {
            if (!byType.TryGetValue(dto.AdlType, out var row))
            {
                // Load-bearing skip, not just an optimisation: the client (both the wizard's
                // create/draft submissions and any Update caller) always sends the full
                // fixed-length AdlAssessments array — every AdlType, every time — with
                // hidden/never-assessed rows carrying Level/Notes/HowToHelpNotes all null (see
                // CreateParticipantAdlAssessmentDto's doc). Without this skip, EVERY participant
                // would get all twenty ParticipantAdlAssessment rows persisted permanently on
                // first save, even for streams that never show the ADL grid at all. Only skip when
                // there both is no existing row for this type AND the incoming dto carries no
                // answer whatsoever; a dto that clears an EXISTING row to null still falls through
                // to ApplyAnswer below and keeps the row, same clear-to-null-keeps-the-row
                // convention as UpsertConsentsAsync.
                if (dto.Level is null && string.IsNullOrWhiteSpace(dto.Notes) && string.IsNullOrWhiteSpace(dto.HowToHelpNotes)) continue;
                row = new ParticipantAdlAssessment { Id = Guid.NewGuid(), ParticipantId = participantId, AdlType = dto.AdlType };
                _db.ParticipantAdlAssessments.Add(row);
                byType[dto.AdlType] = row;
            }
            ParticipantAdlAssessmentsController.ApplyAnswer(row, dto.Level, dto.Notes, dto.HowToHelpNotes);
        }
    }

    /// <summary>
    /// INTAKE-03/04, CommunityAccessDailyLiving stream — upserts every checklist-item row
    /// submitted with a create/update payload, keyed by <see cref="Domain.Enums.ChecklistItemType"/>.
    /// Copies UpsertAdlAssessmentsAsync's documented pattern exactly, including the load-bearing
    /// empty/null guard below (same reasoning: an Update caller that never mentions ChecklistItems
    /// round-trips an empty list, which must mean "leave existing rows alone", not "clear every
    /// checklist answer"). Called before SaveChangesAsync so every row lands in the same
    /// transaction as the participant insert/update. Sparse on creation (see the guard inside the
    /// loop below): the wizard always submits the full fixed twenty-one-row array with every
    /// hidden/unanswered row already null (see <see cref="CreateParticipantChecklistItemDto"/>'s
    /// doc), so a blank incoming row must not become a permanent database row just because it was
    /// present in the payload.
    /// </summary>
    private async Task UpsertChecklistItemsAsync(Guid participantId, List<CreateParticipantChecklistItemDto> items, CancellationToken ct)
    {
        if (items is null || items.Count == 0) return;
        var existing = await _db.ParticipantChecklistItems.Where(a => a.ParticipantId == participantId).ToListAsync(ct);
        var byType = existing.ToDictionary(a => a.ItemType);
        foreach (var dto in items)
        {
            if (!byType.TryGetValue(dto.ItemType, out var row))
            {
                // Load-bearing skip, not just an optimisation: the client (both the wizard's
                // create/draft submissions and any Update caller) always sends the full
                // fixed-length ChecklistItems array — every ChecklistItemType, every time — with
                // hidden/never-assessed rows carrying Value/Notes both null (see
                // CreateParticipantChecklistItemDto's doc). Without this skip, EVERY participant
                // would get all twenty-one ParticipantChecklistItem rows persisted permanently on
                // first save, even for participants with no CommunityAccessDailyLiving stream at
                // all. Only skip when there both is no existing row for this type AND the incoming
                // dto carries no answer whatsoever; a dto that clears an EXISTING row to null
                // still falls through to ApplyAnswer below and keeps the row, same
                // clear-to-null-keeps-the-row convention as UpsertConsentsAsync.
                if (dto.Value is null && string.IsNullOrWhiteSpace(dto.Notes)) continue;
                row = new ParticipantChecklistItem { Id = Guid.NewGuid(), ParticipantId = participantId, ItemType = dto.ItemType };
                _db.ParticipantChecklistItems.Add(row);
                byType[dto.ItemType] = row;
            }
            ParticipantChecklistItemsController.ApplyAnswer(row, dto.Value, dto.Notes);
        }
    }

    /// <summary>
    /// PF-10.2, CommunityAccessDailyLiving stream — upserts every Community Access Risk Assessment
    /// row submitted with a create/update payload, keyed by
    /// <see cref="Domain.Enums.CommunityAccessRiskItemType"/>. Copies UpsertChecklistItemsAsync's
    /// documented pattern exactly, including the load-bearing empty/null guard below (same
    /// reasoning: an Update caller that never mentions CommunityAccessRiskItems round-trips an
    /// empty list, which must mean "leave existing rows alone", not "clear every rating"). Called
    /// before SaveChangesAsync so every row lands in the same transaction as the participant
    /// insert/update. Sparse on creation (see the guard inside the loop below): the wizard always
    /// submits the full fixed twenty-two-row array with every hidden/unrated row already null (see
    /// <see cref="CreateParticipantCommunityAccessRiskItemDto"/>'s doc), so a blank incoming row
    /// must not become a permanent database row just because it was present in the payload.
    /// </summary>
    private async Task UpsertCommunityAccessRiskItemsAsync(Guid participantId, List<CreateParticipantCommunityAccessRiskItemDto> items, CancellationToken ct)
    {
        if (items is null || items.Count == 0) return;
        var existing = await _db.ParticipantCommunityAccessRiskItems.Where(a => a.ParticipantId == participantId).ToListAsync(ct);
        var byType = existing.ToDictionary(a => a.ItemType);
        foreach (var dto in items)
        {
            if (!byType.TryGetValue(dto.ItemType, out var row))
            {
                // Load-bearing skip — same reasoning as UpsertChecklistItemsAsync's: only skip
                // when there is both no existing row for this type AND the incoming dto carries no
                // answer whatsoever; a dto that clears an EXISTING row to null still falls through
                // to ApplyAnswer below and keeps the row.
                if (dto.Rating is null && string.IsNullOrWhiteSpace(dto.StrategyNotes)) continue;
                row = new ParticipantCommunityAccessRiskItem { Id = Guid.NewGuid(), ParticipantId = participantId, ItemType = dto.ItemType };
                _db.ParticipantCommunityAccessRiskItems.Add(row);
                byType[dto.ItemType] = row;
            }
            ParticipantCommunityAccessRiskItemsController.ApplyAnswer(row, dto.Rating, dto.StrategyNotes);
        }
    }

    /// <summary>
    /// INTAKE-08: FirstName/LastName requiredness, gated on <see cref="CreateParticipantDto.IsDraft"/>
    /// rather than the [Required] attribute (see that property's doc for why) — a draft only needs
    /// enough to be findable in the list (at least one of the two names), while a full
    /// create/update (IsDraft false, including a final wizard submission) requires both, exactly
    /// as [Required] used to. Called first, ahead of every other validator below, in both
    /// Create and Update.
    /// </summary>
    private static string? ValidateNames(CreateParticipantDto dto)
    {
        var firstBlank = string.IsNullOrWhiteSpace(dto.FirstName);
        var lastBlank = string.IsNullOrWhiteSpace(dto.LastName);
        if (dto.IsDraft)
            return firstBlank && lastBlank ? "Provide at least a first or last name to save a draft." : null;
        if (firstBlank) return "First name is required.";
        if (lastBlank) return "Last name is required.";
        return null;
    }

    /// <summary>INTAKE-05: Gender "Other" requires the self-description free-text field, both ends.</summary>
    private static string? ValidateGender(CreateParticipantDto dto) =>
        dto.Gender == Gender.Other && string.IsNullOrWhiteSpace(dto.GenderSelfDescription)
            ? "Please provide a gender self-description."
            : null;

    /// <summary>
    /// FUND-02: FundingSource "Other" requires the (reused) FundingOrganisation free-text field,
    /// both ends — mirrors ValidateGender's shape exactly. Ndis ignores whatever
    /// FundingOrganisation carries (the frontend's INTAKE-07 engine excludes it from the payload
    /// entirely in that case; this validator does not error on a stray/legacy value either way).
    /// </summary>
    private static string? ValidateFundingSource(CreateParticipantDto dto) =>
        dto.FundingSource == ParticipantFundingSource.Other && string.IsNullOrWhiteSpace(dto.FundingOrganisation)
            ? "Please specify the funding organisation."
            : null;

    /// <summary>
    /// LIVING-01/02/03/04: each arrangement type requires its one key identifying field, both
    /// ends — same shape as ValidateGender/ValidateFundingSource. Independent's WhoLivesWith is
    /// only required when LivesWithOthers is true (a second level of conditionality nested inside
    /// the arrangement-type gate).
    /// </summary>
    private static string? ValidateLivingArrangement(CreateParticipantDto dto)
    {
        if (dto.LivingArrangement == Domain.Enums.LivingArrangement.Family && string.IsNullOrWhiteSpace(dto.MainSupportPersonName))
            return "Please provide the main support person's name.";
        if (dto.LivingArrangement == Domain.Enums.LivingArrangement.Independent && dto.LivesWithOthers == true && string.IsNullOrWhiteSpace(dto.WhoLivesWith))
            return "Please specify who the participant lives with.";
        if (dto.LivingArrangement == Domain.Enums.LivingArrangement.SupportedAccommodation && string.IsNullOrWhiteSpace(dto.SilProviderName))
            return "Please provide the SIL provider name.";
        return null;
    }

    /// <summary>INTAKE-06: AU postcode is exactly 4 digits when supplied (optional field, so blank is fine).</summary>
    private static string? ValidateAddressPostcode(CreateParticipantDto dto) =>
        !string.IsNullOrWhiteSpace(dto.AddressPostcode) && !System.Text.RegularExpressions.Regex.IsMatch(dto.AddressPostcode, @"^\d{4}$")
            ? "Postcode must be exactly 4 digits."
            : null;

    /// <summary>
    /// INTAKE sub-wave A (research spec §5 "Participant Details"): the participant's OWN phone
    /// number — a foundational gap the spec flagged (Participant previously had no phone field of
    /// any kind, only Contact/Person rows did). AU-tolerant, deliberately non-strict: allows an
    /// optional leading "+", digits, spaces, hyphens, and parentheses, with 6-20 total characters
    /// — wide enough to accept "0400 000 000", "+61 400 000 000", "(07) 3123 4567", or "07 3123
    /// 4567" without hard-coding a specific AU number-length/area-code rule. Per INTAKE-08
    /// doctrine, this format check runs on whatever IS provided — including on a draft save — but
    /// absence (null/blank) never blocks a save either way.
    /// </summary>
    private static string? ValidatePhone(CreateParticipantDto dto) =>
        !string.IsNullOrWhiteSpace(dto.Phone) && !System.Text.RegularExpressions.Regex.IsMatch(dto.Phone, @"^\+?[\d\s\-()]{6,20}$")
            ? "Please provide a valid phone number."
            : null;

    /// <summary>
    /// INTAKE sub-wave A (research spec §5): the participant's OWN email — same foundational gap
    /// as <see cref="ValidatePhone"/>. A simple, deliberately non-strict shape check (something@
    /// something.something, no whitespace) rather than a full RFC 5322 validator — same
    /// "provided-value format check, absence never blocks" doctrine as ValidatePhone.
    /// </summary>
    private static string? ValidateEmail(CreateParticipantDto dto) =>
        !string.IsNullOrWhiteSpace(dto.Email) && !System.Text.RegularExpressions.Regex.IsMatch(dto.Email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$")
            ? "Please provide a valid email address."
            : null;

    /// <summary>
    /// INTAKE sub-wave A polish round: WeightKg is stored as numeric(5,2) (see OdipDbContext's
    /// HasPrecision(5, 2)), so anything outside 0 &lt; value &lt;= 999.99 either can't fit or is
    /// nonsensical for a participant's weight — reject it cleanly here rather than letting an
    /// out-of-range value fall through to an unhandled Npgsql numeric-overflow exception at
    /// SaveChangesAsync. Same "provided-value format check, absence never blocks" doctrine as
    /// ValidatePhone/ValidateEmail.
    /// </summary>
    private static string? ValidateWeight(CreateParticipantDto dto) =>
        dto.WeightKg.HasValue && (dto.WeightKg.Value <= 0 || dto.WeightKg.Value > 999.99m)
            ? "Weight must be greater than 0 and no more than 999.99 kg."
            : null;

    /// <summary>Same shape/reasoning as <see cref="ValidateWeight"/>, for HeightCm.</summary>
    private static string? ValidateHeight(CreateParticipantDto dto) =>
        dto.HeightCm.HasValue && (dto.HeightCm.Value <= 0 || dto.HeightCm.Value > 999.99m)
            ? "Height must be greater than 0 and no more than 999.99 cm."
            : null;

    /// <summary>
    /// DIAG-01: unlike ValidateGender/ValidateFundingSource/ValidateLivingArrangement (which
    /// enforce a required companion field), diagnoses are open text with a curated picklist as UI
    /// guidance only (see Diagnoses.cs's type doc) — so the only server-side rule is "not blank,
    /// not absurdly long" per entry, applied to both PrimaryDiagnosis and every OtherDiagnoses row.
    /// Called from both Create and Update (same dual-wiring as the four validators above it) —
    /// a PUT must reject a blank/over-long entry exactly like a POST does. Validation runs
    /// against the raw (untrimmed) value; Create/Update then trim PrimaryDiagnosis/each
    /// OtherDiagnoses entry before assigning it to the entity, so a caller sending " Epilepsy"
    /// (leading/trailing whitespace) still persists as the exact "Epilepsy" string the frontend's
    /// epilepsy-derivation rule matches on — see the .Trim() calls at the PrimaryDiagnosis/
    /// OtherDiagnoses assignments in both methods below. The <see cref="Odip.Domain.Enums.HidpaSupportCategory"/>
    /// doc comment and conditionalFields.ts's module doc both note the flip side of this: the
    /// derivation engine only ever defaults a HIDPA category ON, never forces it back OFF — so
    /// removing an Epilepsy diagnosis entirely (not just switching it away and back) still never
    /// silently clears an already-set EpilepsyManagement flag, deliberately.
    /// </summary>
    private static string? ValidateDiagnoses(CreateParticipantDto dto)
    {
        if (dto.PrimaryDiagnosis != null && dto.PrimaryDiagnosis.Trim().Length == 0)
            return "Primary diagnosis cannot be blank.";
        if (dto.OtherDiagnoses.Any(d => string.IsNullOrWhiteSpace(d)))
            return "Other diagnoses cannot contain a blank entry.";
        if (dto.OtherDiagnoses.Any(d => d.Length > 200))
            return "Each diagnosis must be 200 characters or fewer.";
        return null;
    }

    /// <summary>
    /// INTAKE-08 fix round 2 (Finding 1): true iff <paramref name="role"/> identifies a person
    /// either way CONTACT-03 allows (an existing Person via <see cref="CreateParticipantContactRoleDto.PersonId"/>,
    /// or a new one via a non-blank NewPersonFirstName/NewPersonLastName) — shared by
    /// <see cref="ValidateContactRoles"/> and <see cref="Create"/>'s persistence loop below so the
    /// two never disagree about which rows are "real".
    /// </summary>
    private static bool ContactRoleHasPerson(CreateParticipantContactRoleDto role) =>
        role.PersonId != null || !string.IsNullOrWhiteSpace(role.NewPersonFirstName) || !string.IsNullOrWhiteSpace(role.NewPersonLastName);

    /// <summary>
    /// CONTACT-02: server-side gate + CONTACT-03 uniqueness for every contact role row submitted
    /// transactionally with a new participant (mirrors RiskEntries' validate-before-save shape).
    /// Checked against <paramref name="dto"/>'s own PlanType/DateOfBirth (the participant entity
    /// doesn't exist yet at validation time) and against the other rows already in the same
    /// submission (a brand-new participant has no pre-existing rows to check against).
    ///
    /// INTAKE-08 fix round 2 (Finding 1): unlike every other validator in this controller, this
    /// one IS gated on <paramref name="dto"/>.IsDraft — mirrored on <see cref="ValidateNames"/>'s
    /// shape, not the "always runs identically" doctrine documented on
    /// <see cref="CreateParticipantDto.IsDraft"/>. Reason: the wizard's Contacts step lets a
    /// caller add a contact row and then abandon it mid-fill (or never touch it at all) before
    /// clicking "Save as draft" — <see cref="ContactRoleHasPerson"/>-false rows are silently
    /// skipped (not validated, not persisted — see Create's loop below) rather than hard-failing
    /// the entire draft save on the existing-or-new-person requirement. A row that DOES identify
    /// a person is still gated + uniqueness-checked exactly as a full submission, since a person
    /// being provided at all means it's actually going to be persisted. Format-level checks on
    /// whatever a caller DID provide (e.g. NewPersonFirstName's [StringLength(100)]) still run
    /// regardless of IsDraft — those are enforced automatically by [ApiController]'s model
    /// validation filter before this method is ever reached, same as every other DTO field. A
    /// non-draft (IsDraft false) submission hard-fails a personless row exactly as before.
    /// </summary>
    private static string? ValidateContactRoles(CreateParticipantDto dto)
    {
        var seen = new List<(ContactRoleType RoleType, bool IsPrimary, ContactRoleStatus Status)>();
        foreach (var role in dto.ContactRoles)
        {
            if (!ContactRoleHasPerson(role))
            {
                if (dto.IsDraft) continue;
                return "Each contact needs either an existing person or a new person's name.";
            }

            var gateError = ContactRoleRules.Validate(role.RoleType, dto.PlanType, dto.DateOfBirth, role.RegisteredProviderFlag);
            if (gateError != null) return gateError;

            var uniquenessError = ContactRoleRules.ValidateUniqueness(role.RoleType, role.IsPrimary, role.Status, seen);
            if (uniquenessError != null) return uniquenessError;

            seen.Add((role.RoleType, role.IsPrimary, role.Status));
        }
        return null;
    }

    /// <summary>
    /// PF-2 (SPEC-02): loads this participant's persisted, active contact roles and computes the
    /// advisory <see cref="ContactRoleRules.PlanTypeComplianceWarning"/> from them — never the
    /// submitted DTO, so a role row that failed some other validation and never persisted can't
    /// produce a false "satisfied" reading. Shared by GetById/Create/Update/Patch so all four
    /// response bodies compute the identical value from the identical source.
    /// </summary>
    private async Task<string?> ComputePlanTypeComplianceWarningAsync(Guid participantId, PlanType planType, CancellationToken ct)
    {
        var activeRoles = await _db.ParticipantContactRoles
            .Where(r => r.ParticipantId == participantId && r.Status == ContactRoleStatus.Active)
            .Select(r => new { r.RoleType, r.RegisteredProviderFlag, r.Status })
            .ToListAsync(ct);

        return ContactRoleRules.PlanTypeComplianceWarning(
            planType,
            activeRoles.Select(r => (r.RoleType, r.RegisteredProviderFlag, r.Status)));
    }

    /// <summary>
    /// LIVING-02/03/04 server-side clearing: defence in depth, mirroring FundingOrganisation's
    /// pattern in Create/Update above — a field belonging to a non-selected arrangement type (or,
    /// for WhoLivesWith, belonging to a LivesWithOthers=false Independent participant) is stored
    /// as null regardless of what a stale client payload sent, rather than trusting the
    /// frontend's INTAKE-07 payload exclusion alone.
    /// </summary>
    private static void ApplyLivingArrangementFields(Participant p, CreateParticipantDto dto)
    {
        var arrangement = dto.LivingArrangement;
        p.LivingArrangement = arrangement;

        var isFamily = arrangement == Domain.Enums.LivingArrangement.Family;
        p.MainSupportPersonName = isFamily ? dto.MainSupportPersonName : null;
        p.MainSupportPersonRelationship = isFamily ? dto.MainSupportPersonRelationship : null;
        p.OthersLivingInAccommodation = isFamily ? dto.OthersLivingInAccommodation : null;
        p.ResidentialInfo = isFamily ? dto.ResidentialInfo : null;

        var isIndependent = arrangement == Domain.Enums.LivingArrangement.Independent;
        p.LivesWithOthers = isIndependent ? dto.LivesWithOthers : null;
        p.WhoLivesWith = isIndependent && dto.LivesWithOthers == true ? dto.WhoLivesWith : null;

        var isSupported = arrangement == Domain.Enums.LivingArrangement.SupportedAccommodation;
        p.SilProviderName = isSupported ? dto.SilProviderName : null;
        p.SilProviderContactPhone = isSupported ? dto.SilProviderContactPhone : null;
        p.AccommodationType = isSupported ? dto.AccommodationType : null;
        p.OnSiteSupportHours = isSupported ? dto.OnSiteSupportHours : null;

        // Shared across all three arrangement types (LIVING-01) — cleared only when no
        // arrangement is selected at all.
        p.LivingArrangementNotes = arrangement != null ? dto.LivingArrangementNotes : null;
    }

    /// <summary>List participants with optional filters.</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<ParticipantListDto>>>> GetAll(
        [FromQuery] string? search, [FromQuery] string? region, [FromQuery] bool? isActive,
        [FromQuery] bool? wheelchairRequired, [FromQuery] bool? isHighSupport, [FromQuery] bool? isDraft,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.Participants.AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(p => (p.FirstName + " " + p.LastName).Contains(search) || (p.PreferredName != null && p.PreferredName.Contains(search)));
        if (!string.IsNullOrWhiteSpace(region)) query = query.Where(p => p.Region == region);
        if (isActive.HasValue) query = query.Where(p => p.IsActive == isActive.Value);
        if (wheelchairRequired.HasValue) query = query.Where(p => p.MobilityAidWheelchair == wheelchairRequired.Value);
        if (isHighSupport.HasValue) query = query.Where(p => p.IsHighSupport == isHighSupport.Value);
        // INTAKE-08: unfiltered by default (the plain participants list shows drafts, badged) —
        // every picker/aggregate surface that must exclude drafts passes isDraft=false explicitly
        // (see the report's enumerated surface list for every frontend call site that does).
        if (isDraft.HasValue) query = query.Where(p => p.IsDraft == isDraft.Value);

        var projectedQuery = query.OrderBy(p => p.LastName).ThenBy(p => p.FirstName)
            .Select(p => new ParticipantListDto
            {
                Id = p.Id, FirstName = p.FirstName, LastName = p.LastName,
                PreferredName = p.PreferredName,
                FullName = string.IsNullOrEmpty(p.PreferredName) ? p.FirstName + " " + p.LastName : p.PreferredName + " " + p.LastName,
                MaskedNdisNumber = p.NdisNumber != null ? p.NdisNumber.Length > 0 ? "••••••••" + p.NdisNumber.Substring(p.NdisNumber.Length - 1) : "•••" : null,
                PlanType = p.PlanType, Region = p.Region, IsRepeatClient = p.IsRepeatClient,
                IsActive = p.IsActive, MobilityAidWheelchair = p.MobilityAidWheelchair, MobilityAidWalker = p.MobilityAidWalker,
                IsHighSupport = p.IsHighSupport, IsIntensiveSupport = p.IsIntensiveSupport, SupportRatio = p.SupportRatio,
                OvernightSupport = p.OvernightSupport,
                // Derived: true iff the participant has any active restrictive-practice register row.
                HasRestrictivePracticeFlag = p.RestrictivePractices.Any(rp => rp.IsActive),
                ServiceStreams = p.ServiceStreams,
                HasActiveMedications = _db.ParticipantMedications.Any(m => m.ParticipantId == p.Id && m.Status != MedicationStatus.Ceased),
                IsDraft = p.IsDraft,
                IntakeCompletedAt = p.IntakeCompletedAt,
            });

        var result = await PagedResult<ParticipantListDto>.CreateAsync(projectedQuery, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<ParticipantListDto>>.Ok(result));
    }

    /// <summary>Get a single participant by ID.</summary>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var p = await _db.Participants
            .Include(x => x.PreferredUser)
            .Include(x => x.RestrictivePractices)
            .Include(x => x.Consents)
            .Include(x => x.HealthConditions)
            .Include(x => x.AdlAssessments)
            .Include(x => x.ChecklistItems)
            .Include(x => x.CommunityAccessRiskItems)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        var hasActiveMedications = await _db.ParticipantMedications
            .AnyAsync(m => m.ParticipantId == id && m.Status != MedicationStatus.Ceased, ct);
        var planTypeComplianceWarning = await ComputePlanTypeComplianceWarningAsync(p.Id, p.PlanType, ct);

        return Ok(ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto
        {
            Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, PreferredName = p.PreferredName,
            MiddleName = p.MiddleName,
            FullName = string.IsNullOrEmpty(p.PreferredName) ? p.FirstName + " " + p.LastName : p.PreferredName + " " + p.LastName,
            MaskedNdisNumber = p.NdisNumber != null ? p.NdisNumber.Length > 0 ? "••••••••" + p.NdisNumber[^1] : "•••" : null,
            NdisNumber = p.NdisNumber, DateOfBirth = p.DateOfBirth, Gender = p.Gender, GenderSelfDescription = p.GenderSelfDescription,
            PlaceOfBirth = p.PlaceOfBirth, Country = p.Country, Phone = p.Phone, Email = p.Email,
            PlanStartDate = p.PlanStartDate, PlanEndDate = p.PlanEndDate, PlanType = p.PlanType, Region = p.Region, IsDsoa = p.IsDsoa,
            // Key Identifiers (INTAKE sub-wave A).
            PensionCardNumber = p.PensionCardNumber, PensionCardExpiry = p.PensionCardExpiry,
            MedicareNumber = p.MedicareNumber, MedicareExpiry = p.MedicareExpiry,
            CompanionCardNumber = p.CompanionCardNumber, CompanionCardExpiry = p.CompanionCardExpiry,
            PrivateHealthFund = p.PrivateHealthFund, PrivateHealthMembershipNumber = p.PrivateHealthMembershipNumber,
            TaxiCardNumber = p.TaxiCardNumber, HairColour = p.HairColour, EyeColour = p.EyeColour,
            WeightKg = p.WeightKg, HeightCm = p.HeightCm,
            FundingSource = p.FundingSource, FundingOrganisation = p.FundingOrganisation, IsRepeatClient = p.IsRepeatClient, IsActive = p.IsActive,
            LivingArrangement = p.LivingArrangement,
            MainSupportPersonName = p.MainSupportPersonName, MainSupportPersonRelationship = p.MainSupportPersonRelationship,
            OthersLivingInAccommodation = p.OthersLivingInAccommodation, ResidentialInfo = p.ResidentialInfo,
            LivesWithOthers = p.LivesWithOthers, WhoLivesWith = p.WhoLivesWith,
            SilProviderName = p.SilProviderName, SilProviderContactPhone = p.SilProviderContactPhone,
            AccommodationType = p.AccommodationType, OnSiteSupportHours = p.OnSiteSupportHours,
            LivingArrangementNotes = p.LivingArrangementNotes,
            AddressStreet = p.AddressStreet, AddressSuburb = p.AddressSuburb,
            AddressState = p.AddressState, AddressPostcode = p.AddressPostcode,
            MobilityAidWheelchair = p.MobilityAidWheelchair, MobilityAidWalker = p.MobilityAidWalker,
            IsHighSupport = p.IsHighSupport, IsIntensiveSupport = p.IsIntensiveSupport, SupportRatio = p.SupportRatio,
            MobilitySupportOptions = p.MobilitySupportOptions,
            PrimaryDiagnosis = p.PrimaryDiagnosis, OtherDiagnoses = p.OtherDiagnoses, HidpaSupportCategories = p.HidpaSupportCategories,
            HidpaNotes = p.HidpaNotes,
            OvernightSupport = p.OvernightSupport, OvernightRatio = p.OvernightRatio,
            RequiresHiLoBed = p.RequiresHiLoBed, RequiresHoist = p.RequiresHoist, RequiresShowerChair = p.RequiresShowerChair,
            RequiresCommode = p.RequiresCommode, RequiresStandingMachine = p.RequiresStandingMachine,
            // Derived: true iff the participant has any active restrictive-practice register row.
            HasRestrictivePracticeFlag = p.RestrictivePractices.Any(rp => rp.IsActive),
            ServiceStreams = p.ServiceStreams,
            HasActiveMedications = hasActiveMedications,
            MobilityNotes = p.MobilityNotes, EquipmentRequirements = p.EquipmentRequirements,
            TransportRequirements = p.TransportRequirements, MedicalSummary = p.MedicalSummary,
            BehaviourRiskSummary = p.BehaviourRiskSummary, Notes = p.Notes,
            CreatedAt = p.CreatedAt, UpdatedAt = p.UpdatedAt,
            PreferredStaffId = p.PreferredUserId,
            PreferredStaffName = p.PreferredUser != null
                ? p.PreferredUser.FirstName + " " + p.PreferredUser.LastName
                : null,
            IsDraft = p.IsDraft,
            IntakeCompletedAt = p.IntakeCompletedAt,
            // INTAKE sub-wave B — Cultural & Consent step.
            IsCald = p.IsCald, IsLgbtqi = p.IsLgbtqi, IsFamilyCommunity = p.IsFamilyCommunity,
            IsAboriginalOrTorresStraitIslander = p.IsAboriginalOrTorresStraitIslander,
            ReceivedRightsAndResponsibilitiesInfo = p.ReceivedRightsAndResponsibilitiesInfo,
            ReceivedPrivacyAndConfidentialityInfo = p.ReceivedPrivacyAndConfidentialityInfo,
            ReceivedFeedbackInfo = p.ReceivedFeedbackInfo, ReceivedBeingSafeInfo = p.ReceivedBeingSafeInfo,
            ReceivedAdvocacyInfo = p.ReceivedAdvocacyInfo,
            PersonalInterests = p.PersonalInterests, ChoiceControlNotes = p.ChoiceControlNotes,
            Consents = ParticipantConsentsController.MaterializeAll(p.Id, p.Consents.ToList()),
            // INTAKE sub-wave C1 — Allergies/Anaphylaxis.
            AllergiesDetail = p.AllergiesDetail, IsAnaphylaxisRisk = p.IsAnaphylaxisRisk,
            AllergyManagementNotes = p.AllergyManagementNotes,
            HealthConditions = ParticipantHealthConditionsController.MaterializeAll(p.Id, p.HealthConditions.ToList()),
            // INTAKE sub-wave C1 — Mobility & Functional.
            AmbulantStatus = p.AmbulantStatus, FallsRiskRating = p.FallsRiskRating,
            UnevenGroundFlag = p.UnevenGroundFlag, LevelOfPersonalCare = p.LevelOfPersonalCare,
            Orthotics = p.Orthotics, ContinenceSupportDetail = p.ContinenceSupportDetail,
            BowelCareDetail = p.BowelCareDetail, MenstruationSupport = p.MenstruationSupport,
            SkinIntegrity = p.SkinIntegrity,
            // INTAKE sub-wave C1 — Behaviour & Communication.
            Memory = p.Memory, MemoryAids = p.MemoryAids,
            ImpairedUnderstanding = p.ImpairedUnderstanding, ImpairedJudgementReasoning = p.ImpairedJudgementReasoning,
            BehavioursOfConcernCurrent = p.BehavioursOfConcernCurrent,
            BehavioursOfConcernFiveYearHistory = p.BehavioursOfConcernFiveYearHistory,
            BehaviourRiskRating = p.BehaviourRiskRating,
            RidsLogged = p.RidsLogged, BspPlanProvided = p.BspPlanProvided, BocChartProvided = p.BocChartProvided,
            ExpressiveSkills = p.ExpressiveSkills, ReceptiveSkills = p.ReceptiveSkills,
            ReadingAbility = p.ReadingAbility, CommunicationAids = p.CommunicationAids,
            // INTAKE sub-wave C2 — the structured ADL rating grid (Daily Living step).
            AdlAssessments = ParticipantAdlAssessmentsController.MaterializeAll(p.Id, p.AdlAssessments.ToList()),
            // INTAKE sub-wave C2 — Meals & Diet.
            MealAssistanceDetail = p.MealAssistanceDetail, ChokingRiskMealDetail = p.ChokingRiskMealDetail,
            ModifiedDietDetail = p.ModifiedDietDetail, PegRegimeMealDetail = p.PegRegimeMealDetail,
            SpecialUtensilsDetail = p.SpecialUtensilsDetail, SpecialDietaryNeedsDetail = p.SpecialDietaryNeedsDetail,
            FavouriteBreakfast = p.FavouriteBreakfast, FavouriteLunch = p.FavouriteLunch, FavouriteDinner = p.FavouriteDinner,
            MedicationTricks = p.MedicationTricks, FoodsAlwaysEaten = p.FoodsAlwaysEaten,
            // INTAKE sub-wave C2 — About Me.
            Goals = p.Goals, SupportAreas = p.SupportAreas, StrengthsFears = p.StrengthsFears,
            ThingsToKnow = p.ThingsToKnow, WhoIsImportant = p.WhoIsImportant, LikesDislikes = p.LikesDislikes,
            // INTAKE-03/04, CommunityAccessDailyLiving stream — the structured checklist grid.
            ChecklistItems = ParticipantChecklistItemsController.MaterializeAll(p.Id, p.ChecklistItems.ToList()),
            // INTAKE-03 — Community Access Behaviour & Support Detail.
            SignsHappyAndSettled = p.SignsHappyAndSettled, WhatHelpsMeCalmDown = p.WhatHelpsMeCalmDown,
            BocTriggers = p.BocTriggers, BocEarlyWarningSigns = p.BocEarlyWarningSigns,
            BocDeEscalationStrategies = p.BocDeEscalationStrategies, BocWhatNotToDo = p.BocWhatNotToDo,
            SupportsLookLikeMorning = p.SupportsLookLikeMorning, SupportsLookLikeDay = p.SupportsLookLikeDay,
            SupportsLookLikeAfternoonEvening = p.SupportsLookLikeAfternoonEvening, SupportsLookLikeOvernight = p.SupportsLookLikeOvernight,
            // PF-10.2, CommunityAccessDailyLiving stream — the structured risk-assessment matrix grid.
            CommunityAccessRiskItems = ParticipantCommunityAccessRiskItemsController.MaterializeAll(p.Id, p.CommunityAccessRiskItems.ToList()),
            OverallCommunityAccessRiskRating = p.OverallCommunityAccessRiskRating,
            PlanTypeComplianceWarning = planTypeComplianceWarning,
        }));
    }

    /// <summary>Create a new participant.</summary>
    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> Create([FromBody] CreateParticipantDto dto, CancellationToken ct)
    {
        var namesError = ValidateNames(dto);
        if (namesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(namesError));

        var invalidOptions = dto.MobilitySupportOptions.Where(o => !MobilitySupportOptions.IsValid(o)).ToList();
        if (invalidOptions.Count > 0)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(
                $"Invalid mobility support option(s): {string.Join(", ", invalidOptions)}"));

        var genderError = ValidateGender(dto);
        if (genderError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(genderError));

        var fundingError = ValidateFundingSource(dto);
        if (fundingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(fundingError));

        var livingError = ValidateLivingArrangement(dto);
        if (livingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(livingError));

        var postcodeError = ValidateAddressPostcode(dto);
        if (postcodeError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(postcodeError));

        var phoneError = ValidatePhone(dto);
        if (phoneError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(phoneError));

        var emailError = ValidateEmail(dto);
        if (emailError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(emailError));

        var weightError = ValidateWeight(dto);
        if (weightError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(weightError));

        var heightError = ValidateHeight(dto);
        if (heightError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(heightError));

        var diagnosesError = ValidateDiagnoses(dto);
        if (diagnosesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(diagnosesError));

        var contactRolesError = ValidateContactRoles(dto);
        if (contactRolesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(contactRolesError));

        if (!await IsValidPreferredUserRefAsync(dto.PreferredStaffId, ct))
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Preferred staff member not found."));

        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = dto.FirstName, LastName = dto.LastName, PreferredName = dto.PreferredName,
            MiddleName = dto.MiddleName,
            DateOfBirth = dto.DateOfBirth, Gender = dto.Gender, GenderSelfDescription = dto.GenderSelfDescription,
            PlaceOfBirth = dto.PlaceOfBirth, Country = dto.Country, Phone = dto.Phone, Email = dto.Email,
            NdisNumber = dto.NdisNumber, PlanStartDate = dto.PlanStartDate, PlanEndDate = dto.PlanEndDate,
            PlanType = dto.PlanType, Region = dto.Region, IsDsoa = dto.IsDsoa,
            // Key Identifiers (INTAKE sub-wave A).
            PensionCardNumber = dto.PensionCardNumber, PensionCardExpiry = dto.PensionCardExpiry,
            MedicareNumber = dto.MedicareNumber, MedicareExpiry = dto.MedicareExpiry,
            CompanionCardNumber = dto.CompanionCardNumber, CompanionCardExpiry = dto.CompanionCardExpiry,
            PrivateHealthFund = dto.PrivateHealthFund, PrivateHealthMembershipNumber = dto.PrivateHealthMembershipNumber,
            TaxiCardNumber = dto.TaxiCardNumber, HairColour = dto.HairColour, EyeColour = dto.EyeColour,
            WeightKg = dto.WeightKg, HeightCm = dto.HeightCm,
            FundingSource = dto.FundingSource,
            // Ndis ignores whatever the client sent for the reused "Other — specify" field —
            // stored as null rather than trusting the client's INTAKE-07 payload exclusion alone.
            FundingOrganisation = dto.FundingSource == ParticipantFundingSource.Other ? dto.FundingOrganisation : null,
            IsRepeatClient = dto.IsRepeatClient,
            MobilityAidWheelchair = dto.MobilityAidWheelchair, MobilityAidWalker = dto.MobilityAidWalker,
            MobilitySupportOptions = dto.MobilitySupportOptions,
            PrimaryDiagnosis = dto.PrimaryDiagnosis?.Trim(), OtherDiagnoses = dto.OtherDiagnoses.Select(d => d.Trim()).ToList(), HidpaSupportCategories = dto.HidpaSupportCategories,
            IsHighSupport = dto.IsHighSupport, IsIntensiveSupport = dto.IsIntensiveSupport,
            OvernightSupport = dto.OvernightSupport, OvernightRatio = dto.OvernightRatio,
            RequiresHiLoBed = dto.RequiresHiLoBed, RequiresHoist = dto.RequiresHoist, RequiresShowerChair = dto.RequiresShowerChair,
            RequiresCommode = dto.RequiresCommode, RequiresStandingMachine = dto.RequiresStandingMachine,
            // HasRestrictivePracticeFlag is intentionally not set from dto — derived on read only.
            SupportRatio = dto.SupportRatio, MobilityNotes = dto.MobilityNotes,
            EquipmentRequirements = dto.EquipmentRequirements, TransportRequirements = dto.TransportRequirements,
            MedicalSummary = dto.MedicalSummary, BehaviourRiskSummary = dto.BehaviourRiskSummary, Notes = dto.Notes,
            PreferredUserId = dto.PreferredStaffId,
            ServiceStreams = dto.ServiceStreams,
            // INTAKE-06 — plain participant-level fields, not arrangement-conditional.
            AddressStreet = dto.AddressStreet, AddressSuburb = dto.AddressSuburb,
            AddressState = dto.AddressState, AddressPostcode = dto.AddressPostcode,
            IsDraft = dto.IsDraft,
            // SPEC-05 (PF-10.3) — stamped server-side, never client-supplied, only when the
            // Intake wizard's own final-step create call sets CompleteIntake; a mid-intake
            // "save as draft" POST (IsDraft=true, CompleteIntake omitted/false) must not stamp it.
            IntakeCompletedAt = dto.CompleteIntake ? DateTime.UtcNow : null,
            // INTAKE sub-wave B — Cultural & Consent step.
            IsCald = dto.IsCald, IsLgbtqi = dto.IsLgbtqi, IsFamilyCommunity = dto.IsFamilyCommunity,
            IsAboriginalOrTorresStraitIslander = dto.IsAboriginalOrTorresStraitIslander,
            ReceivedRightsAndResponsibilitiesInfo = dto.ReceivedRightsAndResponsibilitiesInfo,
            ReceivedPrivacyAndConfidentialityInfo = dto.ReceivedPrivacyAndConfidentialityInfo,
            ReceivedFeedbackInfo = dto.ReceivedFeedbackInfo, ReceivedBeingSafeInfo = dto.ReceivedBeingSafeInfo,
            ReceivedAdvocacyInfo = dto.ReceivedAdvocacyInfo,
            PersonalInterests = dto.PersonalInterests, ChoiceControlNotes = dto.ChoiceControlNotes,
            // INTAKE sub-wave C1 — Allergies/Anaphylaxis.
            AllergiesDetail = dto.AllergiesDetail, IsAnaphylaxisRisk = dto.IsAnaphylaxisRisk,
            AllergyManagementNotes = dto.AllergyManagementNotes,
            // INTAKE sub-wave C1 — Mobility & Functional.
            AmbulantStatus = dto.AmbulantStatus, FallsRiskRating = dto.FallsRiskRating,
            UnevenGroundFlag = dto.UnevenGroundFlag, LevelOfPersonalCare = dto.LevelOfPersonalCare,
            Orthotics = dto.Orthotics, ContinenceSupportDetail = dto.ContinenceSupportDetail,
            BowelCareDetail = dto.BowelCareDetail, MenstruationSupport = dto.MenstruationSupport,
            SkinIntegrity = dto.SkinIntegrity,
            // INTAKE sub-wave C1 — Behaviour & Communication.
            Memory = dto.Memory, MemoryAids = dto.MemoryAids,
            ImpairedUnderstanding = dto.ImpairedUnderstanding, ImpairedJudgementReasoning = dto.ImpairedJudgementReasoning,
            BehavioursOfConcernCurrent = dto.BehavioursOfConcernCurrent,
            BehavioursOfConcernFiveYearHistory = dto.BehavioursOfConcernFiveYearHistory,
            BehaviourRiskRating = dto.BehaviourRiskRating,
            RidsLogged = dto.RidsLogged, BspPlanProvided = dto.BspPlanProvided, BocChartProvided = dto.BocChartProvided,
            ExpressiveSkills = dto.ExpressiveSkills, ReceptiveSkills = dto.ReceptiveSkills,
            ReadingAbility = dto.ReadingAbility, CommunicationAids = dto.CommunicationAids,
            // INTAKE sub-wave C2 — Meals & Diet.
            MealAssistanceDetail = dto.MealAssistanceDetail, ChokingRiskMealDetail = dto.ChokingRiskMealDetail,
            ModifiedDietDetail = dto.ModifiedDietDetail, PegRegimeMealDetail = dto.PegRegimeMealDetail,
            SpecialUtensilsDetail = dto.SpecialUtensilsDetail, SpecialDietaryNeedsDetail = dto.SpecialDietaryNeedsDetail,
            FavouriteBreakfast = dto.FavouriteBreakfast, FavouriteLunch = dto.FavouriteLunch, FavouriteDinner = dto.FavouriteDinner,
            MedicationTricks = dto.MedicationTricks, FoodsAlwaysEaten = dto.FoodsAlwaysEaten,
            // INTAKE sub-wave C2 — About Me.
            Goals = dto.Goals, SupportAreas = dto.SupportAreas, StrengthsFears = dto.StrengthsFears,
            ThingsToKnow = dto.ThingsToKnow, WhoIsImportant = dto.WhoIsImportant, LikesDislikes = dto.LikesDislikes,
            // DIAG-02/INTAKE-03 reconciliation.
            HidpaNotes = dto.HidpaNotes,
            // INTAKE-03 — Community Access Behaviour & Support Detail.
            SignsHappyAndSettled = dto.SignsHappyAndSettled, WhatHelpsMeCalmDown = dto.WhatHelpsMeCalmDown,
            BocTriggers = dto.BocTriggers, BocEarlyWarningSigns = dto.BocEarlyWarningSigns,
            BocDeEscalationStrategies = dto.BocDeEscalationStrategies, BocWhatNotToDo = dto.BocWhatNotToDo,
            SupportsLookLikeMorning = dto.SupportsLookLikeMorning, SupportsLookLikeDay = dto.SupportsLookLikeDay,
            SupportsLookLikeAfternoonEvening = dto.SupportsLookLikeAfternoonEvening, SupportsLookLikeOvernight = dto.SupportsLookLikeOvernight,
            OverallCommunityAccessRiskRating = dto.OverallCommunityAccessRiskRating,
        };
        ApplyLivingArrangementFields(participant, dto);
        _db.Participants.Add(participant);
        // INTAKE-09: risk-entry rows submitted alongside a new participant are created in the
        // same SaveChangesAsync call as the participant insert below — transactional with it.
        // Edit-mode manages risk entries afterwards via the separate nested CRUD
        // (ParticipantRiskEntriesController), not via this DTO's collection.
        foreach (var entry in dto.RiskEntries)
        {
            _db.ParticipantRiskEntries.Add(new ParticipantRiskEntry
            {
                Id = Guid.NewGuid(),
                ParticipantId = participant.Id,
                AtRiskParty = entry.AtRiskParty,
                Description = entry.Description.Trim(),
                MitigationNotes = string.IsNullOrWhiteSpace(entry.MitigationNotes) ? null : entry.MitigationNotes.Trim(),
                IsActive = entry.IsActive,
            });
        }
        // CONTACT-02: contact-role rows submitted alongside a new participant, in the same
        // SaveChangesAsync call as the participant insert below — transactional with it, same
        // pattern as the RiskEntries loop above. Validated (gating + uniqueness) up-front by
        // ValidateContactRoles; a "new person" row creates its Person here, an "existing person"
        // row looks it up by id (already tenant-scoped via _db.People's query filter).
        foreach (var roleDto in dto.ContactRoles)
        {
            // INTAKE-08 fix round 2 (Finding 1): mirrors ValidateContactRoles' skip above — a
            // draft's wholly-empty/abandoned-mid-fill row (no person identified) is silently
            // dropped from the save entirely, rather than trying to create a Person with a blank
            // name. A non-draft reaches here having already 400'd on this same row inside
            // ValidateContactRoles, so this branch is unreachable for it.
            if (!ContactRoleHasPerson(roleDto) && dto.IsDraft) continue;

            Person person;
            if (roleDto.PersonId.HasValue)
            {
                var existingPerson = await _db.People.FirstOrDefaultAsync(p => p.Id == roleDto.PersonId.Value, ct);
                if (existingPerson == null)
                    return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Selected person not found"));
                person = existingPerson;
            }
            else
            {
                person = new Person
                {
                    Id = Guid.NewGuid(),
                    FirstName = (roleDto.NewPersonFirstName ?? "").Trim(), LastName = (roleDto.NewPersonLastName ?? "").Trim(),
                    Phone = roleDto.NewPersonPhone, Mobile = roleDto.NewPersonMobile, Email = roleDto.NewPersonEmail,
                    Organisation = roleDto.NewPersonOrganisation,
                };
                _db.People.Add(person);
            }

            var role = new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participant.Id, PersonId = person.Id };
            ParticipantContactRolesController.ApplyRoleFields(role, roleDto);
            _db.ParticipantContactRoles.Add(role);
        }

        // Task 6d: a preferred-staff selection on create also upserts a Preferred row in the
        // rostering compatibility matrix, in the same transaction as the participant insert.
        // INTAKE-08 fix round 1 (Finding 3): isDraft suppresses that upsert entirely for a draft.
        await _compatLink.SyncFromParticipantPreferredStaffAsync(participant.Id, null, dto.PreferredStaffId, ct, isDraft: dto.IsDraft);
        // INTAKE sub-wave B — consent rows submitted alongside a new/drafted participant, in the
        // same SaveChangesAsync call as the participant insert below.
        await UpsertConsentsAsync(participant.Id, dto.Consents, ct);
        // INTAKE sub-wave C1 — health-condition grid rows submitted alongside a new/drafted
        // participant, in the same SaveChangesAsync call as the participant insert below.
        await UpsertHealthConditionsAsync(participant.Id, dto.HealthConditions, ct);
        // INTAKE sub-wave C2 — ADL-assessment grid rows submitted alongside a new/drafted
        // participant, in the same SaveChangesAsync call as the participant insert below.
        await UpsertAdlAssessmentsAsync(participant.Id, dto.AdlAssessments, ct);
        // INTAKE-03/04 — Community Access checklist-item grid rows submitted alongside a
        // new/drafted participant, in the same SaveChangesAsync call as the participant insert below.
        await UpsertChecklistItemsAsync(participant.Id, dto.ChecklistItems, ct);
        // PF-10.2 — Community Access Risk Assessment matrix rows submitted alongside a
        // new/drafted participant, in the same SaveChangesAsync call as the participant insert below.
        await UpsertCommunityAccessRiskItemsAsync(participant.Id, dto.CommunityAccessRiskItems, ct);
        // PD-5: syncs the safety-critical auto-notes (allergies/behaviours-of-concern/falls-risk/
        // risks-hazards) in the same SaveChangesAsync as the participant insert. Reads
        // participant.RiskEntries via the change tracker (see SafetyNoteSyncService), which sees
        // the RiskEntries loop's just-added, not-yet-persisted rows above — closes the
        // "ParticipantRiskEntry rows" hole in SPEC-03's Trigger coverage table for the create path.
        await _safetyNoteSync.SyncFromParticipantAsync(participant, ct);
        await _db.SaveChangesAsync(ct);
        // PF-2: computed from what actually landed in the ParticipantContactRoles table (just
        // inserted above, in the same SaveChangesAsync), not from dto.ContactRoles — a role row
        // that failed some other validation and never persisted can't produce a false "satisfied"
        // reading.
        var createPlanTypeComplianceWarning = await ComputePlanTypeComplianceWarningAsync(participant.Id, participant.PlanType, ct);
        return CreatedAtAction(nameof(GetById), new { id = participant.Id },
            ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto { Id = participant.Id, FirstName = participant.FirstName, LastName = participant.LastName, FullName = participant.FullName, IsActive = true, IsDraft = participant.IsDraft, IntakeCompletedAt = participant.IntakeCompletedAt, CreatedAt = participant.CreatedAt, UpdatedAt = participant.UpdatedAt, PlanTypeComplianceWarning = createPlanTypeComplianceWarning }));
    }

    /// <summary>Update an existing participant.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> Update(Guid id, [FromBody] UpdateParticipantDto dto, CancellationToken ct)
    {
        var namesError = ValidateNames(dto);
        if (namesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(namesError));

        var invalidOptions = dto.MobilitySupportOptions.Where(o => !MobilitySupportOptions.IsValid(o)).ToList();
        if (invalidOptions.Count > 0)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(
                $"Invalid mobility support option(s): {string.Join(", ", invalidOptions)}"));

        var genderError = ValidateGender(dto);
        if (genderError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(genderError));

        var fundingError = ValidateFundingSource(dto);
        if (fundingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(fundingError));

        var livingError = ValidateLivingArrangement(dto);
        if (livingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(livingError));

        var postcodeError = ValidateAddressPostcode(dto);
        if (postcodeError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(postcodeError));

        var phoneError = ValidatePhone(dto);
        if (phoneError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(phoneError));

        var emailError = ValidateEmail(dto);
        if (emailError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(emailError));

        var weightError = ValidateWeight(dto);
        if (weightError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(weightError));

        var heightError = ValidateHeight(dto);
        if (heightError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(heightError));

        var diagnosesError = ValidateDiagnoses(dto);
        if (diagnosesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(diagnosesError));

        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        // INTAKE-08 fix round 1 (Finding 1b, controller ruling): un-finalising is not a product
        // capability. A participant that has already been finalised (p.IsDraft == false) can
        // never be sent back into draft state via this endpoint — only a genuinely new-or-still-
        // drafting record (p.IsDraft == true already) may keep saving with IsDraft=true. If this
        // ever becomes a real capability it ships as a deliberate, separate feature rather than a
        // side effect of the wizard's universal "Save as draft" button being clickable everywhere
        // (the frontend also removes that button for a finalised participant — see
        // ParticipantCreatePage.tsx — this is the server-side half of that same ruling).
        if (dto.IsDraft && !p.IsDraft)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("A finalised participant cannot be reverted to draft."));

        if (!await IsValidPreferredUserRefAsync(dto.PreferredStaffId, ct))
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Preferred staff member not found."));

        var previousPreferredStaffId = p.PreferredUserId;

        p.FirstName = dto.FirstName; p.LastName = dto.LastName; p.PreferredName = dto.PreferredName;
        p.MiddleName = dto.MiddleName;
        p.DateOfBirth = dto.DateOfBirth; p.Gender = dto.Gender; p.GenderSelfDescription = dto.GenderSelfDescription;
        p.PlaceOfBirth = dto.PlaceOfBirth; p.Country = dto.Country; p.Phone = dto.Phone; p.Email = dto.Email;
        p.NdisNumber = dto.NdisNumber; p.PlanStartDate = dto.PlanStartDate; p.PlanEndDate = dto.PlanEndDate;
        p.PlanType = dto.PlanType;
        p.Region = dto.Region;
        p.IsDsoa = dto.IsDsoa;
        // Key Identifiers (INTAKE sub-wave A).
        p.PensionCardNumber = dto.PensionCardNumber; p.PensionCardExpiry = dto.PensionCardExpiry;
        p.MedicareNumber = dto.MedicareNumber; p.MedicareExpiry = dto.MedicareExpiry;
        p.CompanionCardNumber = dto.CompanionCardNumber; p.CompanionCardExpiry = dto.CompanionCardExpiry;
        p.PrivateHealthFund = dto.PrivateHealthFund; p.PrivateHealthMembershipNumber = dto.PrivateHealthMembershipNumber;
        p.TaxiCardNumber = dto.TaxiCardNumber; p.HairColour = dto.HairColour; p.EyeColour = dto.EyeColour;
        p.WeightKg = dto.WeightKg; p.HeightCm = dto.HeightCm;
        p.FundingSource = dto.FundingSource;
        // Ndis ignores whatever the client sent for the reused "Other — specify" field — same
        // server-side clearing as Create, so flipping Other -> Ndis actually clears stale text
        // rather than leaving it dormant on the row.
        p.FundingOrganisation = dto.FundingSource == ParticipantFundingSource.Other ? dto.FundingOrganisation : null;
        ApplyLivingArrangementFields(p, dto);
        p.AddressStreet = dto.AddressStreet; p.AddressSuburb = dto.AddressSuburb;
        p.AddressState = dto.AddressState; p.AddressPostcode = dto.AddressPostcode;
        p.IsRepeatClient = dto.IsRepeatClient;
        p.IsActive = dto.IsActive; p.MobilityAidWheelchair = dto.MobilityAidWheelchair; p.MobilityAidWalker = dto.MobilityAidWalker;
        p.MobilitySupportOptions = dto.MobilitySupportOptions;
        p.PrimaryDiagnosis = dto.PrimaryDiagnosis?.Trim(); p.OtherDiagnoses = dto.OtherDiagnoses.Select(d => d.Trim()).ToList(); p.HidpaSupportCategories = dto.HidpaSupportCategories;
        p.IsHighSupport = dto.IsHighSupport; p.IsIntensiveSupport = dto.IsIntensiveSupport;
        p.OvernightSupport = dto.OvernightSupport; p.OvernightRatio = dto.OvernightRatio;
        p.RequiresHiLoBed = dto.RequiresHiLoBed; p.RequiresHoist = dto.RequiresHoist; p.RequiresShowerChair = dto.RequiresShowerChair;
        p.RequiresCommode = dto.RequiresCommode; p.RequiresStandingMachine = dto.RequiresStandingMachine;
        // p.HasRestrictivePracticeFlag is intentionally left untouched — derived on read only.
        p.SupportRatio = dto.SupportRatio; p.MobilityNotes = dto.MobilityNotes;
        p.EquipmentRequirements = dto.EquipmentRequirements; p.TransportRequirements = dto.TransportRequirements;
        p.MedicalSummary = dto.MedicalSummary; p.BehaviourRiskSummary = dto.BehaviourRiskSummary;
        p.Notes = dto.Notes; p.PreferredUserId = dto.PreferredStaffId; p.ServiceStreams = dto.ServiceStreams;
        // INTAKE sub-wave B — Cultural & Consent step.
        p.IsCald = dto.IsCald; p.IsLgbtqi = dto.IsLgbtqi; p.IsFamilyCommunity = dto.IsFamilyCommunity;
        p.IsAboriginalOrTorresStraitIslander = dto.IsAboriginalOrTorresStraitIslander;
        p.ReceivedRightsAndResponsibilitiesInfo = dto.ReceivedRightsAndResponsibilitiesInfo;
        p.ReceivedPrivacyAndConfidentialityInfo = dto.ReceivedPrivacyAndConfidentialityInfo;
        p.ReceivedFeedbackInfo = dto.ReceivedFeedbackInfo; p.ReceivedBeingSafeInfo = dto.ReceivedBeingSafeInfo;
        p.ReceivedAdvocacyInfo = dto.ReceivedAdvocacyInfo;
        p.PersonalInterests = dto.PersonalInterests; p.ChoiceControlNotes = dto.ChoiceControlNotes;
        // INTAKE sub-wave C1 — Allergies/Anaphylaxis.
        p.AllergiesDetail = dto.AllergiesDetail; p.IsAnaphylaxisRisk = dto.IsAnaphylaxisRisk;
        p.AllergyManagementNotes = dto.AllergyManagementNotes;
        // INTAKE sub-wave C1 — Mobility & Functional.
        p.AmbulantStatus = dto.AmbulantStatus; p.FallsRiskRating = dto.FallsRiskRating;
        p.UnevenGroundFlag = dto.UnevenGroundFlag; p.LevelOfPersonalCare = dto.LevelOfPersonalCare;
        p.Orthotics = dto.Orthotics; p.ContinenceSupportDetail = dto.ContinenceSupportDetail;
        p.BowelCareDetail = dto.BowelCareDetail; p.MenstruationSupport = dto.MenstruationSupport;
        p.SkinIntegrity = dto.SkinIntegrity;
        // INTAKE sub-wave C1 — Behaviour & Communication.
        p.Memory = dto.Memory; p.MemoryAids = dto.MemoryAids;
        p.ImpairedUnderstanding = dto.ImpairedUnderstanding; p.ImpairedJudgementReasoning = dto.ImpairedJudgementReasoning;
        p.BehavioursOfConcernCurrent = dto.BehavioursOfConcernCurrent;
        p.BehavioursOfConcernFiveYearHistory = dto.BehavioursOfConcernFiveYearHistory;
        p.BehaviourRiskRating = dto.BehaviourRiskRating;
        p.RidsLogged = dto.RidsLogged; p.BspPlanProvided = dto.BspPlanProvided; p.BocChartProvided = dto.BocChartProvided;
        p.ExpressiveSkills = dto.ExpressiveSkills; p.ReceptiveSkills = dto.ReceptiveSkills;
        p.ReadingAbility = dto.ReadingAbility; p.CommunicationAids = dto.CommunicationAids;
        // INTAKE sub-wave C2 — Meals & Diet.
        p.MealAssistanceDetail = dto.MealAssistanceDetail; p.ChokingRiskMealDetail = dto.ChokingRiskMealDetail;
        p.ModifiedDietDetail = dto.ModifiedDietDetail; p.PegRegimeMealDetail = dto.PegRegimeMealDetail;
        p.SpecialUtensilsDetail = dto.SpecialUtensilsDetail; p.SpecialDietaryNeedsDetail = dto.SpecialDietaryNeedsDetail;
        p.FavouriteBreakfast = dto.FavouriteBreakfast; p.FavouriteLunch = dto.FavouriteLunch; p.FavouriteDinner = dto.FavouriteDinner;
        p.MedicationTricks = dto.MedicationTricks; p.FoodsAlwaysEaten = dto.FoodsAlwaysEaten;
        // INTAKE sub-wave C2 — About Me.
        p.Goals = dto.Goals; p.SupportAreas = dto.SupportAreas; p.StrengthsFears = dto.StrengthsFears;
        p.ThingsToKnow = dto.ThingsToKnow; p.WhoIsImportant = dto.WhoIsImportant; p.LikesDislikes = dto.LikesDislikes;
        // DIAG-02/INTAKE-03 reconciliation.
        p.HidpaNotes = dto.HidpaNotes;
        // INTAKE-03 — Community Access Behaviour & Support Detail.
        p.SignsHappyAndSettled = dto.SignsHappyAndSettled; p.WhatHelpsMeCalmDown = dto.WhatHelpsMeCalmDown;
        p.BocTriggers = dto.BocTriggers; p.BocEarlyWarningSigns = dto.BocEarlyWarningSigns;
        p.BocDeEscalationStrategies = dto.BocDeEscalationStrategies; p.BocWhatNotToDo = dto.BocWhatNotToDo;
        p.SupportsLookLikeMorning = dto.SupportsLookLikeMorning; p.SupportsLookLikeDay = dto.SupportsLookLikeDay;
        p.SupportsLookLikeAfternoonEvening = dto.SupportsLookLikeAfternoonEvening; p.SupportsLookLikeOvernight = dto.SupportsLookLikeOvernight;
        p.OverallCommunityAccessRiskRating = dto.OverallCommunityAccessRiskRating;
        // INTAKE-08: the caller declares intent per-call — true keeps/re-marks the participant a
        // draft (another "Save as draft" click, from any wizard step), false is a full save,
        // including the final Review-step submission that's meant to clear a draft off for good.
        p.IsDraft = dto.IsDraft;
        p.UpdatedAt = DateTime.UtcNow;

        // Task 6d: a changed/cleared preferred-staff selection upserts/downgrades the matching
        // compatibility row, in the same transaction as the participant update.
        // INTAKE-08 fix round 1 (Finding 3): isDraft suppresses that upsert entirely for a draft.
        await _compatLink.SyncFromParticipantPreferredStaffAsync(p.Id, previousPreferredStaffId, dto.PreferredStaffId, ct, isDraft: dto.IsDraft);
        // INTAKE sub-wave B — see CreateParticipantDto.Consents' doc for why, unlike RiskEntries/
        // ContactRoles, this is read on Update too (not create-mode-only).
        await UpsertConsentsAsync(p.Id, dto.Consents, ct);
        // INTAKE sub-wave C1 — same read-on-both-paths convention as Consents above.
        await UpsertHealthConditionsAsync(p.Id, dto.HealthConditions, ct);
        // INTAKE sub-wave C2 — same read-on-both-paths convention as Consents/HealthConditions above.
        await UpsertAdlAssessmentsAsync(p.Id, dto.AdlAssessments, ct);
        // INTAKE-03/04 — same read-on-both-paths convention as Consents/HealthConditions/AdlAssessments above.
        await UpsertChecklistItemsAsync(p.Id, dto.ChecklistItems, ct);
        // PF-10.2 — same read-on-both-paths convention as Consents/HealthConditions/AdlAssessments/ChecklistItems above.
        await UpsertCommunityAccessRiskItemsAsync(p.Id, dto.CommunityAccessRiskItems, ct);
        // PD-5: syncs the safety-critical auto-notes in the same SaveChangesAsync as this update.
        await _safetyNoteSync.SyncFromParticipantAsync(p, ct);
        await _db.SaveChangesAsync(ct);
        // PF-2: Update's payload carries no contactRoles (unchanged, per Design's note) — the
        // warning is computed from the participant's live ContactRoles exactly as GetById does.
        var updatePlanTypeComplianceWarning = await ComputePlanTypeComplianceWarningAsync(p.Id, p.PlanType, ct);
        return Ok(ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FullName, IsActive = p.IsActive, IsDraft = p.IsDraft, UpdatedAt = p.UpdatedAt, PlanTypeComplianceWarning = updatePlanTypeComplianceWarning }));
    }

    /// <summary>
    /// CORE-02: partial save. Patches only the semantic field groups present in <paramref name="dto"/>
    /// (16 scalar + 4 collection groups — see PatchParticipantDto's doc for the full partition);
    /// every absent group's columns are left completely untouched. Presence is all-or-nothing at
    /// the GROUP level, not the field level: a present group's own null member DOES clear that
    /// field (mirrors a mini full-submit for just that group), matching every existing
    /// validator/assignment's self-contained-within-one-group behaviour. Concurrency is
    /// last-write-wins per group — no RowVersion/ETag, same policy as today's whole-payload PUT,
    /// just scoped to a smaller blast radius. This DTO structurally cannot express IsDraft or
    /// IsActive — those stay PUT's job exclusively; a partial save can neither finalise nor
    /// un-finalise a draft.
    /// </summary>
    [HttpPatch("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> Patch(Guid id, [FromBody] PatchParticipantDto dto, CancellationToken ct)
    {
        // Tenant scoping comes for free from OdipDbContext's ambient ITenantEntity query filter on
        // Participants (see GetById/Update above) — a wrong-tenant id simply isn't found.
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        // ── Validate — only for present groups, each checked purely from its own incoming values
        // (no merge with the existing entity needed: every validator below is already confirmed
        // self-contained within one group — see SPEC-00's field-by-field walk). Minimal transient
        // CreateParticipantDto instances let the existing validator methods be reused verbatim
        // without touching Create/Update's own call sites. Groups with no existing server-side
        // validator (ServiceProfile, CulturalBackground, BehaviourCommunication,
        // CommunityAccessBehaviour, MealsAndDiet, AboutMe, SupportsLookLike, RisksHazardsSummary)
        // have nothing to check here, matching today's full submit exactly.
        if (dto.PersonalDetails is { } pdValidate)
        {
            var transient = new CreateParticipantDto
            {
                FirstName = pdValidate.FirstName, LastName = pdValidate.LastName,
                Gender = pdValidate.Gender, GenderSelfDescription = pdValidate.GenderSelfDescription,
                Phone = pdValidate.Phone, Email = pdValidate.Email,
            };
            var namesError = ValidateNames(transient);
            if (namesError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(namesError));
            var genderError = ValidateGender(transient);
            if (genderError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(genderError));
            var phoneError = ValidatePhone(transient);
            if (phoneError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(phoneError));
            var emailError = ValidateEmail(transient);
            if (emailError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(emailError));
        }

        if (dto.PreferredStaff is { } psdValidate && !await IsValidPreferredUserRefAsync(psdValidate.PreferredStaffId, ct))
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Preferred staff member not found."));

        if (dto.Address is { } adValidate)
        {
            var postcodeError = ValidateAddressPostcode(new CreateParticipantDto { AddressPostcode = adValidate.AddressPostcode });
            if (postcodeError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(postcodeError));
        }

        if (dto.LivingArrangement is { } ladValidate)
        {
            var transient = new CreateParticipantDto
            {
                LivingArrangement = ladValidate.LivingArrangement, MainSupportPersonName = ladValidate.MainSupportPersonName,
                LivesWithOthers = ladValidate.LivesWithOthers, WhoLivesWith = ladValidate.WhoLivesWith,
                SilProviderName = ladValidate.SilProviderName,
            };
            var livingError = ValidateLivingArrangement(transient);
            if (livingError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(livingError));
        }

        if (dto.NdisPlan is { } npValidate)
        {
            var fundingError = ValidateFundingSource(new CreateParticipantDto { FundingSource = npValidate.FundingSource, FundingOrganisation = npValidate.FundingOrganisation });
            if (fundingError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(fundingError));
        }

        if (dto.KeyIdentifiers is { } kiValidate)
        {
            var weightError = ValidateWeight(new CreateParticipantDto { WeightKg = kiValidate.WeightKg });
            if (weightError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(weightError));
            var heightError = ValidateHeight(new CreateParticipantDto { HeightCm = kiValidate.HeightCm });
            if (heightError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(heightError));
        }

        if (dto.SupportNeedsMobility is { } snmValidate)
        {
            // Same inline check Create/Update run — the only server-side rule this group has
            // today. equipmentRefine (the frontend's "notes without a ticked item" cross-field
            // rule) has no backend twin anywhere in this codebase and Create/Update don't enforce
            // it either, so Patch doesn't invent one here — see this PR's report.
            var invalidOptions = snmValidate.MobilitySupportOptions.Where(o => !MobilitySupportOptions.IsValid(o)).ToList();
            if (invalidOptions.Count > 0)
                return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(
                    $"Invalid mobility support option(s): {string.Join(", ", invalidOptions)}"));
        }

        if (dto.Medical is { } medValidate)
        {
            var diagnosesError = ValidateDiagnoses(new CreateParticipantDto { PrimaryDiagnosis = medValidate.PrimaryDiagnosis, OtherDiagnoses = medValidate.OtherDiagnoses });
            if (diagnosesError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(diagnosesError));
        }

        // ── Apply — plain property assignment, scoped to present group(s) only. Literally the
        // same statements Update already has above, just gated on group presence.
        if (dto.PersonalDetails is { } pd)
        {
            p.FirstName = pd.FirstName; p.LastName = pd.LastName; p.PreferredName = pd.PreferredName;
            p.MiddleName = pd.MiddleName; p.DateOfBirth = pd.DateOfBirth; p.Gender = pd.Gender;
            p.GenderSelfDescription = pd.GenderSelfDescription; p.PlaceOfBirth = pd.PlaceOfBirth;
            p.Country = pd.Country; p.Phone = pd.Phone; p.Email = pd.Email;
        }

        // Task 6d, gated on group presence instead of always running (§5 of PreferredStaff's
        // controller-behaviour doc): only diff/sync when this call actually touches PreferredStaff.
        Guid? previousPreferredStaffId = null;
        var preferredStaffChanged = false;
        if (dto.PreferredStaff is { } psd)
        {
            previousPreferredStaffId = p.PreferredUserId;
            preferredStaffChanged = previousPreferredStaffId != psd.PreferredStaffId;
            p.PreferredUserId = psd.PreferredStaffId;
        }

        if (dto.Address is { } ad)
        {
            p.AddressStreet = ad.AddressStreet; p.AddressSuburb = ad.AddressSuburb;
            p.AddressState = ad.AddressState; p.AddressPostcode = ad.AddressPostcode;
        }

        if (dto.LivingArrangement is { } lad)
        {
            // Reuses ApplyLivingArrangementFields verbatim — same arrangement-type clearing rules
            // Create/Update already apply.
            var transient = new CreateParticipantDto
            {
                LivingArrangement = lad.LivingArrangement, MainSupportPersonName = lad.MainSupportPersonName,
                MainSupportPersonRelationship = lad.MainSupportPersonRelationship, OthersLivingInAccommodation = lad.OthersLivingInAccommodation,
                ResidentialInfo = lad.ResidentialInfo, LivesWithOthers = lad.LivesWithOthers, WhoLivesWith = lad.WhoLivesWith,
                SilProviderName = lad.SilProviderName, SilProviderContactPhone = lad.SilProviderContactPhone,
                AccommodationType = lad.AccommodationType, OnSiteSupportHours = lad.OnSiteSupportHours,
                LivingArrangementNotes = lad.LivingArrangementNotes,
            };
            ApplyLivingArrangementFields(p, transient);
        }

        if (dto.NdisPlan is { } np)
        {
            p.NdisNumber = np.NdisNumber; p.PlanStartDate = np.PlanStartDate; p.PlanEndDate = np.PlanEndDate;
            p.PlanType = np.PlanType; p.FundingSource = np.FundingSource;
            // Ndis ignores whatever the client sent for the reused "Other — specify" field — same
            // server-side clearing as Create/Update.
            p.FundingOrganisation = np.FundingSource == ParticipantFundingSource.Other ? np.FundingOrganisation : null;
            p.IsDsoa = np.IsDsoa; p.IsRepeatClient = np.IsRepeatClient;
        }

        if (dto.ServiceProfile is { } sp)
        {
            p.Region = sp.Region; p.ServiceStreams = sp.ServiceStreams;
        }

        if (dto.KeyIdentifiers is { } ki)
        {
            p.PensionCardNumber = ki.PensionCardNumber; p.PensionCardExpiry = ki.PensionCardExpiry;
            p.MedicareNumber = ki.MedicareNumber; p.MedicareExpiry = ki.MedicareExpiry;
            p.CompanionCardNumber = ki.CompanionCardNumber; p.CompanionCardExpiry = ki.CompanionCardExpiry;
            p.PrivateHealthFund = ki.PrivateHealthFund; p.PrivateHealthMembershipNumber = ki.PrivateHealthMembershipNumber;
            p.TaxiCardNumber = ki.TaxiCardNumber; p.HairColour = ki.HairColour; p.EyeColour = ki.EyeColour;
            p.WeightKg = ki.WeightKg; p.HeightCm = ki.HeightCm;
        }

        if (dto.CulturalBackground is { } cb)
        {
            p.IsCald = cb.IsCald; p.IsLgbtqi = cb.IsLgbtqi; p.IsFamilyCommunity = cb.IsFamilyCommunity;
            p.IsAboriginalOrTorresStraitIslander = cb.IsAboriginalOrTorresStraitIslander;
            p.ReceivedRightsAndResponsibilitiesInfo = cb.ReceivedRightsAndResponsibilitiesInfo;
            p.ReceivedPrivacyAndConfidentialityInfo = cb.ReceivedPrivacyAndConfidentialityInfo;
            p.ReceivedFeedbackInfo = cb.ReceivedFeedbackInfo; p.ReceivedBeingSafeInfo = cb.ReceivedBeingSafeInfo;
            p.ReceivedAdvocacyInfo = cb.ReceivedAdvocacyInfo;
            p.PersonalInterests = cb.PersonalInterests; p.ChoiceControlNotes = cb.ChoiceControlNotes;
        }

        if (dto.SupportNeedsMobility is { } snm)
        {
            p.IsHighSupport = snm.IsHighSupport; p.IsIntensiveSupport = snm.IsIntensiveSupport;
            p.SupportRatio = snm.SupportRatio; p.MobilityAidWheelchair = snm.MobilityAidWheelchair;
            p.MobilityAidWalker = snm.MobilityAidWalker; p.MobilitySupportOptions = snm.MobilitySupportOptions;
            p.OvernightSupport = snm.OvernightSupport; p.OvernightRatio = snm.OvernightRatio;
            p.RequiresHiLoBed = snm.RequiresHiLoBed; p.RequiresHoist = snm.RequiresHoist;
            p.RequiresShowerChair = snm.RequiresShowerChair; p.RequiresCommode = snm.RequiresCommode;
            p.RequiresStandingMachine = snm.RequiresStandingMachine; p.MobilityNotes = snm.MobilityNotes;
            p.EquipmentRequirements = snm.EquipmentRequirements; p.TransportRequirements = snm.TransportRequirements;
            p.AmbulantStatus = snm.AmbulantStatus; p.FallsRiskRating = snm.FallsRiskRating;
            p.UnevenGroundFlag = snm.UnevenGroundFlag; p.LevelOfPersonalCare = snm.LevelOfPersonalCare;
            p.Orthotics = snm.Orthotics; p.ContinenceSupportDetail = snm.ContinenceSupportDetail;
            p.BowelCareDetail = snm.BowelCareDetail; p.MenstruationSupport = snm.MenstruationSupport;
            p.SkinIntegrity = snm.SkinIntegrity;
        }

        if (dto.Medical is { } med)
        {
            p.PrimaryDiagnosis = med.PrimaryDiagnosis?.Trim();
            p.OtherDiagnoses = med.OtherDiagnoses.Select(d => d.Trim()).ToList();
            p.HidpaSupportCategories = med.HidpaSupportCategories; p.HidpaNotes = med.HidpaNotes;
            p.MedicalSummary = med.MedicalSummary; p.AllergiesDetail = med.AllergiesDetail;
            p.IsAnaphylaxisRisk = med.IsAnaphylaxisRisk; p.AllergyManagementNotes = med.AllergyManagementNotes;
        }

        if (dto.BehaviourCommunication is { } bc)
        {
            p.Memory = bc.Memory; p.MemoryAids = bc.MemoryAids; p.ImpairedUnderstanding = bc.ImpairedUnderstanding;
            p.ImpairedJudgementReasoning = bc.ImpairedJudgementReasoning; p.BehavioursOfConcernCurrent = bc.BehavioursOfConcernCurrent;
            p.BehavioursOfConcernFiveYearHistory = bc.BehavioursOfConcernFiveYearHistory; p.BehaviourRiskRating = bc.BehaviourRiskRating;
            p.RidsLogged = bc.RidsLogged; p.BspPlanProvided = bc.BspPlanProvided; p.BocChartProvided = bc.BocChartProvided;
            p.ExpressiveSkills = bc.ExpressiveSkills; p.ReceptiveSkills = bc.ReceptiveSkills;
            p.ReadingAbility = bc.ReadingAbility; p.CommunicationAids = bc.CommunicationAids;
        }

        if (dto.CommunityAccessBehaviour is { } cab)
        {
            p.SignsHappyAndSettled = cab.SignsHappyAndSettled; p.WhatHelpsMeCalmDown = cab.WhatHelpsMeCalmDown;
            p.BocTriggers = cab.BocTriggers; p.BocEarlyWarningSigns = cab.BocEarlyWarningSigns;
            p.BocDeEscalationStrategies = cab.BocDeEscalationStrategies; p.BocWhatNotToDo = cab.BocWhatNotToDo;
        }

        if (dto.MealsAndDiet is { } mad)
        {
            p.MealAssistanceDetail = mad.MealAssistanceDetail; p.ChokingRiskMealDetail = mad.ChokingRiskMealDetail;
            p.ModifiedDietDetail = mad.ModifiedDietDetail; p.PegRegimeMealDetail = mad.PegRegimeMealDetail;
            p.SpecialUtensilsDetail = mad.SpecialUtensilsDetail; p.SpecialDietaryNeedsDetail = mad.SpecialDietaryNeedsDetail;
            p.FavouriteBreakfast = mad.FavouriteBreakfast; p.FavouriteLunch = mad.FavouriteLunch; p.FavouriteDinner = mad.FavouriteDinner;
            p.MedicationTricks = mad.MedicationTricks; p.FoodsAlwaysEaten = mad.FoodsAlwaysEaten;
        }

        if (dto.AboutMe is { } am)
        {
            p.Goals = am.Goals; p.SupportAreas = am.SupportAreas; p.StrengthsFears = am.StrengthsFears;
            p.ThingsToKnow = am.ThingsToKnow; p.WhoIsImportant = am.WhoIsImportant; p.LikesDislikes = am.LikesDislikes;
        }

        if (dto.SupportsLookLike is { } sll)
        {
            p.SupportsLookLikeMorning = sll.SupportsLookLikeMorning; p.SupportsLookLikeDay = sll.SupportsLookLikeDay;
            p.SupportsLookLikeAfternoonEvening = sll.SupportsLookLikeAfternoonEvening; p.SupportsLookLikeOvernight = sll.SupportsLookLikeOvernight;
        }

        if (dto.RisksHazardsSummary is { } rhs)
        {
            p.BehaviourRiskSummary = rhs.BehaviourRiskSummary; p.Notes = rhs.Notes;
        }

        p.UpdatedAt = DateTime.UtcNow;

        // Task 6d: only sync the compatibility matrix when PreferredStaff was actually touched AND
        // actually changed — see PatchPreferredStaffDto's doc for why this group is isolated.
        if (preferredStaffChanged)
            await _compatLink.SyncFromParticipantPreferredStaffAsync(p.Id, previousPreferredStaffId, dto.PreferredStaff!.PreferredStaffId, ct);

        // ── Collections — upserted via the existing helpers verbatim, only when present. See
        // PatchParticipantDto's per-member doc for the upsert-by-key/leave-alone-on-omission
        // contract these share with Create/Update.
        if (dto.Consents != null) await UpsertConsentsAsync(p.Id, dto.Consents, ct);
        if (dto.HealthConditions != null) await UpsertHealthConditionsAsync(p.Id, dto.HealthConditions, ct);
        if (dto.AdlAssessments != null) await UpsertAdlAssessmentsAsync(p.Id, dto.AdlAssessments, ct);
        if (dto.ChecklistItems != null) await UpsertChecklistItemsAsync(p.Id, dto.ChecklistItems, ct);

        // PD-5, item 5c: any of the 4 partial-save groups above (medical, behaviourCommunication,
        // risksHazardsSummary, supportNeedsMobility) can touch a safety-critical field — closes
        // the "core02 partial-save endpoint" holes in SPEC-03's Trigger coverage table. Gated on
        // group presence so an unrelated group's PATCH (e.g. just PersonalDetails) doesn't run a
        // needless sync pass.
        if (dto.Medical != null || dto.BehaviourCommunication != null || dto.RisksHazardsSummary != null || dto.SupportNeedsMobility != null)
            await _safetyNoteSync.SyncFromParticipantAsync(p, ct);

        await _db.SaveChangesAsync(ct);
        // PF-2: Patch's DTO never carries contactRoles either — computed from live ContactRoles,
        // using p.PlanType as it stands after any ndisPlan group patch applied above.
        var patchPlanTypeComplianceWarning = await ComputePlanTypeComplianceWarningAsync(p.Id, p.PlanType, ct);
        return Ok(ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FullName, IsActive = p.IsActive, IsDraft = p.IsDraft, UpdatedAt = p.UpdatedAt, PlanTypeComplianceWarning = patchPlanTypeComplianceWarning }));
    }

    /// <summary>Get bookings for a participant.</summary>
    [HttpGet("{id:guid}/bookings")]
    public async Task<ActionResult<ApiResponse<List<BookingListDto>>>> GetBookings(Guid id, CancellationToken ct)
    {
        var bookings = await _db.ParticipantBookings.Include(b => b.TripInstance)
            .Where(b => b.ParticipantId == id)
            .Select(b => new BookingListDto
            {
                Id = b.Id, TripInstanceId = b.TripInstanceId, TripName = b.TripInstance.TripName,
                ParticipantId = b.ParticipantId, BookingStatus = b.BookingStatus, BookingDate = b.BookingDate,
                WheelchairRequired = b.WheelchairRequired, HighSupportRequired = b.HighSupportRequired,
                NightSupportRequired = b.NightSupportRequired, HasRestrictivePracticeFlag = b.HasRestrictivePracticeFlag,
                SupportRatioOverride = b.SupportRatioOverride, ActionRequired = b.ActionRequired
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<BookingListDto>>.Ok(bookings));
    }

    /// <summary>Get support profile for a participant (restricted).</summary>
    [HttpGet("{id:guid}/support-profile")]
    public async Task<ActionResult<ApiResponse<SupportProfileDto>>> GetSupportProfile(Guid id, CancellationToken ct)
    {
        var sp = await _db.SupportProfiles.FirstOrDefaultAsync(s => s.ParticipantId == id, ct);
        if (sp == null) return NotFound(ApiResponse<SupportProfileDto>.Fail("Support profile not found"));

        return Ok(ApiResponse<SupportProfileDto>.Ok(new SupportProfileDto
        {
            Id = sp.Id, ParticipantId = sp.ParticipantId, CommunicationNotes = sp.CommunicationNotes,
            BehaviourSupportNotes = sp.BehaviourSupportNotes, RestrictivePracticeDetails = sp.RestrictivePracticeDetails,
            ManualHandlingNotes = sp.ManualHandlingNotes, MedicationHealthSummary = sp.MedicationHealthSummary,
            EmergencyConsiderations = sp.EmergencyConsiderations, TravelSpecificNotes = sp.TravelSpecificNotes,
            ReviewDate = sp.ReviewDate
        }));
    }

    /// <summary>Create or update support profile for a participant.</summary>
    [HttpPut("{id:guid}/support-profile")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<SupportProfileDto>>> UpdateSupportProfile(Guid id, [FromBody] UpdateSupportProfileDto dto, CancellationToken ct)
    {
        var sp = await _db.SupportProfiles.FirstOrDefaultAsync(s => s.ParticipantId == id, ct);
        if (sp == null)
        {
            sp = new SupportProfile { Id = Guid.NewGuid(), ParticipantId = id };
            _db.SupportProfiles.Add(sp);
        }
        sp.CommunicationNotes = dto.CommunicationNotes; sp.BehaviourSupportNotes = dto.BehaviourSupportNotes;
        // sp.RestrictivePracticeDetails is intentionally left untouched — the register replaces
        // it as the write path; existing legacy text stays readable via SupportProfileDto.
        sp.ManualHandlingNotes = dto.ManualHandlingNotes;
        sp.MedicationHealthSummary = dto.MedicationHealthSummary; sp.EmergencyConsiderations = dto.EmergencyConsiderations;
        sp.TravelSpecificNotes = dto.TravelSpecificNotes; sp.ReviewDate = dto.ReviewDate;
        sp.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<SupportProfileDto>.Ok(new SupportProfileDto { Id = sp.Id, ParticipantId = sp.ParticipantId }));
    }

    /// <summary>DOC-01: download the Intake Form PDF for a participant.</summary>
    [HttpGet("{id:guid}/documents/intake")]
    public async Task<IActionResult> DownloadIntakeFormPdf(Guid id, CancellationToken ct)
    {
        var result = await _documentService.GenerateIntakeFormAsync(id, ct);
        if (result == null) return NotFound(ApiResponse<bool>.Fail("Participant not found"));
        return File(result.Value.Content, "application/pdf", result.Value.FileName);
    }

    /// <summary>DOC-01: download the Participant Profile PDF for a participant.</summary>
    [HttpGet("{id:guid}/documents/profile")]
    public async Task<IActionResult> DownloadParticipantProfilePdf(Guid id, CancellationToken ct)
    {
        var result = await _documentService.GenerateParticipantProfileAsync(id, ct);
        if (result == null) return NotFound(ApiResponse<bool>.Fail("Participant not found"));
        return File(result.Value.Content, "application/pdf", result.Value.FileName);
    }

    /// <summary>
    /// PF-10.6: download the Client Overview ("Client Support Needs Summary") PDF for a
    /// participant — a condensed per-trip staff cheat-sheet. <paramref name="tripId"/> is optional:
    /// when supplied (primary Trip-detail surface), the header's TRIP/DATE/GROUP fields are
    /// populated from that trip; when omitted (secondary Participant-detail surface), the same
    /// document renders with a blank header, same 404 contract as the other two document endpoints.
    /// </summary>
    [HttpGet("{id:guid}/documents/client-overview")]
    public async Task<IActionResult> DownloadClientOverviewPdf(Guid id, [FromQuery] Guid? tripId, CancellationToken ct)
    {
        var result = await _documentService.GenerateClientOverviewAsync(id, tripId, ct);
        if (result == null) return NotFound(ApiResponse<bool>.Fail("Participant not found"));
        return File(result.Value.Content, "application/pdf", result.Value.FileName);
    }

    /// <summary>Archive (soft-delete) a participant.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<bool>.Fail("Participant not found"));
        p.IsActive = false; p.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Participant archived"));
    }
}
