using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/inquiries")]
public class ParticipantInquiriesController : ControllerBase
{
    private static readonly HashSet<string> Sources = new(StringComparer.Ordinal) { "Web", "Email", "Phone" };
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly TimeProvider _clock;
    public ParticipantInquiriesController(OdipDbContext db, ICurrentTenant tenant, TimeProvider? clock = null) { _db = db; _tenant = tenant; _clock = clock ?? TimeProvider.System; }
    private string Actor() => User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? User?.FindFirstValue("sub") ?? "unknown";

    /// <summary>
    /// The Enquiries tab's feed: every enquiry, plus every intake in progress that no enquiry started (see
    /// <see cref="ParticipantInquiryDto.IsDirectIntake"/>). The tab itself shows only the open ones.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ParticipantInquiryDto>>>> GetAll(CancellationToken ct)
    {
        var inquiries = await _db.ParticipantInquiries.Where(x => _tenant.TenantId == null || x.TenantId == _tenant.TenantId).OrderByDescending(x => x.CreatedAt).ToListAsync(ct);
        // Where each converted enquiry has got to, so the Enquiries tab can say "Draft intake" or "Intake complete" instead of offering
        // "Resume intake" for ever. One query for the page; the participants' own tenant filter applies.
        var participantIds = inquiries.Where(x => x.ParticipantId != null).Select(x => x.ParticipantId!.Value).Distinct().ToList();
        var states = participantIds.Count == 0
            ? new Dictionary<Guid, (bool IsDraft, bool IsActive, DateTime? IntakeCompletedAt)>()
            : (await _db.Participants.Where(p => participantIds.Contains(p.Id)).Select(p => new { p.Id, p.IsDraft, p.IsActive, p.IntakeCompletedAt }).ToListAsync(ct))
                .ToDictionary(p => p.Id, p => (p.IsDraft, p.IsActive, p.IntakeCompletedAt));
        // The booked staff members' names, and the provider's zone the visit times are shown in. One query each for the page.
        var staffIds = inquiries.Where(x => x.IntakeStaffUserId != null).Select(x => x.IntakeStaffUserId!.Value).Distinct().ToList();
        var staffById = staffIds.Count == 0 ? new Dictionary<Guid, User>() : await _db.Users.Where(u => staffIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var zoneId = (_tenant.TenantId is Guid tenantId ? await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct) : await ProviderTimeZoneResolver.ResolveAsync(_db, ct)).Id;
        User? StaffOf(ParticipantInquiry x) => x.IntakeStaffUserId is Guid id ? staffById.GetValueOrDefault(id) : null;
        var rows = inquiries.Select(x =>
            x.ParticipantId is Guid participantId && states.TryGetValue(participantId, out var state)
                ? ToDto(x, StaffOf(x), zoneId) with { ParticipantIsDraft = state.IsDraft, ParticipantIsActive = state.IsActive, ParticipantIntakeCompletedAt = state.IntakeCompletedAt }
                : ToDto(x, StaffOf(x), zoneId)).ToList();
        // A visit's address (often a home), its internal notes and the staff member's full name are for the lifecycle roles, as on /intake-visits.
        // Everyone else who can open the Enquiries tab still sees when it is, the staff member's first name and what the invite did.
        var seesVisitDetails = User?.IsInRole("Admin") == true || User?.IsInRole("Coordinator") == true || User?.IsInRole("SuperAdmin") == true;
        if (!seesVisitDetails) rows = rows.Select(r => r with { IntakeLocation = null, IntakeNotes = null, IntakeStaffName = null }).ToList();

        // A draft intake started in the Intake wizard (/participants/new) has no enquiry. It used to be reachable only through the register's
        // Drafts view; with that view gone it rides here so it is not lost. A draft an enquiry already links is that enquiry's row, never a second one.
        var direct = await ParticipantStages.DirectIntakes(_db, _db.Participants.Where(p => _tenant.TenantId == null || p.TenantId == _tenant.TenantId))
            .Select(p => new { p.Id, p.FirstName, p.LastName, p.Phone, p.Email, p.IsActive, p.CreatedAt })
            .ToListAsync(ct);
        rows.AddRange(direct.Select(p => new ParticipantInquiryDto
        {
            Id = p.Id, ParticipantId = p.Id, FirstName = p.FirstName, LastName = p.LastName, Phone = p.Phone, Email = p.Email, CreatedAt = p.CreatedAt,
            ParticipantIsDraft = true, ParticipantIsActive = p.IsActive, ParticipantIntakeCompletedAt = null, IsDirectIntake = true, TimeZoneId = zoneId,
        }));
        return Ok(ApiResponse<List<ParticipantInquiryDto>>.Ok(rows.OrderByDescending(x => x.CreatedAt).ToList()));
    }

    /// <summary>
    /// The Onboarding tab: every participant of the tenant who is in onboarding, whether or not an enquiry started them and whether or not
    /// a <see cref="ParticipantOnboarding"/> row exists. It used to list the rows (an inner join), so a participant whose intake was
    /// completed before completion created one never appeared, while active and archived participants and intakes still open, which
    /// all have rows, did. A participant with no row is listed with a blank checklist.
    /// </summary>
    [HttpGet("onboarding-worklist")]
    public async Task<ActionResult<ApiResponse<List<ParticipantOnboardingWorklistDto>>>> GetOnboardingWorklist(CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<List<ParticipantOnboardingWorklistDto>>.Fail("A tenant context is required."));
        var participants = await ParticipantStages.InOnboarding(_db.Participants.Where(p => p.TenantId == tenantId)).OrderByDescending(p => p.UpdatedAt).ToListAsync(ct);
        var ids = participants.Select(p => p.Id).ToList();
        var stored = ids.Count == 0
            ? new List<ParticipantOnboarding>()
            : await _db.ParticipantOnboardings.Where(o => o.TenantId == tenantId && ids.Contains(o.ParticipantId)).ToListAsync(ct);
        var rowsByParticipant = stored.GroupBy(o => o.ParticipantId).ToDictionary(g => g.Key, g => g.First());
        var result = new List<ParticipantOnboardingWorklistDto>();
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        foreach (var p in participants)
        {
            // Everyone in onboarding stays listed, every item done or not: only "Make active" moves them on. The page counts the same "n of N".
            var detail = await BuildDetail(p, rowsByParticipant.GetValueOrDefault(p.Id) ?? BlankOnboarding(p), ct, today);
            result.Add(new ParticipantOnboardingWorklistDto
            {
                ParticipantId = p.Id, FullName = p.FullName, ServicesStartedAt = p.ServicesStartedAt,
                CompletedSteps = detail.Items.Count(i => i.Done), TotalSteps = detail.Items.Count, FirstMissing = detail.Items.FirstOrDefault(i => !i.Done)?.Label,
            });
        }
        return Ok(ApiResponse<List<ParticipantOnboardingWorklistDto>>.Ok(result));
    }

    /// <summary>
    /// One enquiry with its pending contacts, for the enquiry form (new and edit). The contacts are third parties' details held before any relationship, so only
    /// the roles that edit enquiries read them; GET /inquiries, open to every role, never carries them (spec 2026-10-16, D3).
    /// </summary>
    [HttpGet("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDetailDto>>> Get(Guid id, CancellationToken ct)
    {
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && (_tenant.TenantId == null || x.TenantId == _tenant.TenantId), ct);
        if (inquiry == null) return NotFound(ApiResponse<ParticipantInquiryDetailDto>.Fail("Inquiry not found"));
        var contacts = await _db.InquiryContacts.Where(c => c.InquiryId == inquiry.Id && c.TenantId == inquiry.TenantId).OrderBy(c => c.SortOrder)
            .Select(c => new InquiryContactDto { Role = c.Role, FirstName = c.FirstName, LastName = c.LastName, Phone = c.Phone, Email = c.Email, Relationship = c.Relationship, Notes = c.Notes })
            .ToListAsync(ct);
        return Ok(ApiResponse<ParticipantInquiryDetailDto>.Ok(new ParticipantInquiryDetailDto(await FullDtoAsync(inquiry, ct)) { Contacts = contacts }));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Create(CreateParticipantInquiryDto dto, CancellationToken ct)
    {
        if (!Sources.Contains(dto.Source)) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("Source must be Web, Email, or Phone."));
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var errors = ContactErrors(dto.Contacts);
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = dto.FirstName.Trim(), LastName = dto.LastName.Trim(), Phone = Blank(dto.Phone), Email = Blank(dto.Email), Source = dto.Source, Provenance = Blank(dto.Provenance) };
        _db.ParticipantInquiries.Add(inquiry);
        if (dto.Contacts is { } contacts) AddContacts(inquiry, contacts);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(await FullDtoAsync(inquiry, ct)));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Update(Guid id, UpdateParticipantInquiryDto dto, CancellationToken ct)
    {
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && (_tenant.TenantId == null || x.TenantId == _tenant.TenantId), ct);
        if (inquiry == null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry not found"));
        if (!Sources.Contains(dto.Source)) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("Source must be Web, Email, or Phone."));
        var errors = ContactErrors(dto.Contacts);
        // Once intake has started the contacts are the participant's (Convert moved them): adding pending ones now would strand them.
        if (dto.Contacts is { Count: > 0 } && inquiry.ParticipantId is not null) errors["contacts"] = ["Intake has started, so add contacts on the participant's record."];
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));
        inquiry.FirstName = dto.FirstName.Trim(); inquiry.LastName = dto.LastName.Trim(); inquiry.Phone = Blank(dto.Phone); inquiry.Email = Blank(dto.Email); inquiry.Source = dto.Source; inquiry.Provenance = Blank(dto.Provenance); inquiry.UpdatedAt = DateTime.UtcNow;
        if (dto.Contacts is { } contacts)
        {
            // A full replace: what the form shows is what is stored, and a retry can never add a second copy. Null leaves them alone, so a caller that never
            // loaded them (an older open tab) can't wipe them.
            _db.InquiryContacts.RemoveRange(await _db.InquiryContacts.Where(c => c.InquiryId == inquiry.Id && c.TenantId == inquiry.TenantId).ToListAsync(ct));
            AddContacts(inquiry, contacts);
        }
        if (!await SavedAsync(ct)) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(ChangedByOther));
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(await FullDtoAsync(inquiry, ct)));
    }

    [HttpPost("{id:guid}/convert")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Convert(Guid id, ConvertParticipantInquiryDto dto, CancellationToken ct)
    {
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && (_tenant.TenantId == null || x.TenantId == _tenant.TenantId), ct);
        if (inquiry == null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry not found"));
        if (inquiry.ParticipantId is null)
        {
            Participant? participant = null;
            if (dto.ParticipantId is Guid participantId) { participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct); if (participant == null || participant.TenantId != inquiry.TenantId) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Participant not found")); }
            else { participant = new Participant { Id = Guid.NewGuid(), TenantId = inquiry.TenantId, FirstName = inquiry.FirstName, LastName = inquiry.LastName, Phone = inquiry.Phone, Email = inquiry.Email, IsActive = false, IsDraft = true }; _db.Participants.Add(participant); }
            inquiry.ParticipantId = participant.Id; inquiry.UpdatedAt = DateTime.UtcNow;
            if (!await _db.ParticipantOnboardings.AnyAsync(x => x.ParticipantId == participant.Id, ct)) _db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = inquiry.TenantId, ParticipantId = participant.Id });
            if (!await SavedAsync(ct)) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(ChangedByOther));
        }
        else if (dto.ParticipantId is Guid requested && requested != inquiry.ParticipantId) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry has already been converted."));
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ToDto(inquiry)));
    }

    [HttpGet("{id:guid}/onboarding")]
    public async Task<ActionResult<ApiResponse<ParticipantOnboardingDto>>> GetOnboarding(Guid id, CancellationToken ct)
    {
        var (participant, onboarding) = await FindOwnedAsync(id, storeMissingRow: false, ct);
        if (onboarding == null || participant == null) return NotFound(ApiResponse<ParticipantOnboardingDto>.Fail("Onboarding not found"));
        return Ok(ApiResponse<ParticipantOnboardingDto>.Ok(await BuildDetail(participant, onboarding, ct)));
    }

    /// <summary>
    /// The checklist's "Signed agreement" item, the one item recorded by hand: the date the written agreement was signed, OR why there is no
    /// written agreement. Exactly one; a date may not be after the provider's today, and a reason is at most 500 characters. A new record replaces
    /// the last. Field errors come back as a ValidationProblemDetails keyed by the field. The e-sign evidence is untouched (signing stays closed).
    /// </summary>
    [HttpPost("{id:guid}/onboarding/agreement-record")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantOnboardingDto>>> RecordAgreement(Guid id, RecordOnboardingAgreementDto dto, CancellationToken ct)
    {
        var (participant, onboarding) = await FindOwnedAsync(id, storeMissingRow: true, ct);
        if (participant == null || onboarding == null) return NotFound(ApiResponse<ParticipantOnboardingDto>.Fail("Onboarding not found"));
        var reason = Blank(dto.NoAgreementReason);
        var errors = new Dictionary<string, string[]>();
        if (dto.SignedOn is null && reason is null) errors["signedOn"] = ["Enter the date it was signed, or why there is no written agreement."];
        else if (dto.SignedOn is not null && reason is not null) errors["noAgreementReason"] = ["Give a signed date or a reason, not both."];
        else if (dto.SignedOn > await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct)) errors["signedOn"] = ["The signed date cannot be in the future."];
        // NDIS agreements start in 2013; anything before 1990 is a typo, not a date.
        else if (dto.SignedOn < new DateOnly(1990, 1, 1)) errors["signedOn"] = ["Check the signed date: it is before 1990."];
        else if (reason?.Length > 500) errors["noAgreementReason"] = ["Keep the reason to 500 characters or fewer."];
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));
        var saved = await RecordAndSaveAsync(participant, onboarding, row => row.RecordAgreement(dto.SignedOn, reason, Actor(), DateTime.UtcNow), ct);
        return Ok(ApiResponse<ParticipantOnboardingDto>.Ok(await BuildDetail(participant, saved, ct)));
    }

    /// <summary>
    /// Records a checklist step and saves it. A participant in onboarding who has no stored row gets one added by <see cref="FindOwnedAsync"/>, and two requests
    /// can both find none: the unique index on the participant rejects the second insert. That is no error for the caller, because the row exists by then, so the
    /// request that lost drops its insert, reloads the winner's row, records the step on it and saves once more (its step is not lost). Returns the row that was saved.
    /// </summary>
    private async Task<ParticipantOnboarding> RecordAndSaveAsync(Participant participant, ParticipantOnboarding onboarding, Action<ParticipantOnboarding> record, CancellationToken ct)
    {
        var inserting = _db.Entry(onboarding).State == EntityState.Added;
        record(onboarding);
        try
        {
            await _db.SaveChangesAsync(ct);
            return onboarding;
        }
        // The only insert in this save is the onboarding row, so a unique violation here is that row losing the race, not any other database failure.
        catch (DbUpdateException ex) when (inserting && ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            _db.Entry(onboarding).State = EntityState.Detached;
            var winner = await _db.ParticipantOnboardings.FirstAsync(x => x.ParticipantId == participant.Id && x.TenantId == participant.TenantId, ct);
            record(winner);
            await _db.SaveChangesAsync(ct);
            return winner;
        }
    }

    /// <summary>
    /// The participant and their onboarding record, in the caller's tenant. A participant who is in onboarding (see
    /// <see cref="ParticipantStages.IsInOnboarding"/>) always has a checklist: when no row was ever stored (the worklist lists them anyway) a blank one is
    /// returned, and <paramref name="storeMissingRow"/> adds it to the context so the caller's own save persists it. Any other participant
    /// without a row (a legacy participant who never onboarded here) has no onboarding record: null.
    /// </summary>
    private async Task<(Participant? participant, ParticipantOnboarding? onboarding)> FindOwnedAsync(Guid id, bool storeMissingRow, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return (null, null);
        var participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (participant == null) return (null, null);
        var onboarding = await _db.ParticipantOnboardings.FirstOrDefaultAsync(x => x.ParticipantId == id && x.TenantId == tenantId, ct);
        if (onboarding == null && ParticipantStages.IsInOnboarding(participant))
        {
            onboarding = BlankOnboarding(participant);
            if (storeMissingRow) _db.ParticipantOnboardings.Add(onboarding);
        }
        return (participant, onboarding);
    }

    /// <summary>A blank checklist for <paramref name="participant"/>, in the participant's own tenant. Not tracked until a caller adds it.</summary>
    private static ParticipantOnboarding BlankOnboarding(Participant participant) =>
        new() { Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id };

    /// <summary>
    /// The checklist (owner decision 2026-10-13): four items derived from data, in order, the funding one for an NDIS-funded participant only.
    /// The derived checks are <see cref="ParticipantReadinessGate.ProfileDetailsRule"/> and <see cref="ParticipantReadinessGate.ServiceNeedsParticipants"/>,
    /// the same ones the roster issues and the strict gate read.
    /// </summary>
    private async Task<ParticipantOnboardingDto> BuildDetail(Participant participant, ParticipantOnboarding onboarding, CancellationToken ct, DateOnly? today = null)
    {
        var profileMissing = ProfileMissing(participant);
        var serviceNeedsDone = await ParticipantReadinessGate.ServiceNeedsParticipants(_db).AnyAsync(p => p.Id == participant.Id, ct);
        var agreementDone = onboarding.AgreementSignedOn != null || onboarding.NoAgreementReason != null;
        var items = new List<OnboardingChecklistItemDto>
        {
            Item("profile", "Profile details", profileMissing.Count == 0, $"Missing: {string.Join(", ", profileMissing)}."),
            Item("serviceNeeds", "Service needs", serviceNeedsDone, "No current agreement draft with dated, priced support lines."),
            Item("agreement", "Signed agreement", agreementDone, "Record the date it was signed, or why there is no written agreement."),
        };
        if (participant.FundingSource == ParticipantFundingSource.Ndis)
        {
            var fundingDone = await ParticipantReadinessGate.HasFundingRecordedAsync(_db, participant.Id, today ?? await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct), ct);
            // Say which it is: nothing was ever recorded, or the plans there are have all ended (the Funding tab shows that plan as Ended).
            var missing = !fundingDone && await _db.FundingPlans.AnyAsync(f => f.ParticipantId == participant.Id && f.TenantId == participant.TenantId, ct)
                ? "The plan budget has ended: record the new plan."
                : "No plan budget recorded.";
            items.Add(Item("funding", "Funding", fundingDone, missing));
        }
        return new ParticipantOnboardingDto
        {
            ParticipantId = participant.Id, Items = items, IsReady = items.All(i => i.Done), ServicesStartedAt = participant.ServicesStartedAt,
            AgreementSignedOn = onboarding.AgreementSignedOn, NoAgreementReason = onboarding.NoAgreementReason,
        };
    }

    private static OnboardingChecklistItemDto Item(string key, string label, bool done, string missing) =>
        new() { Key = key, Label = label, Done = done, Missing = done ? null : missing };

    /// <summary>What "Profile details" still needs, in words. KEEP IN STEP with <see cref="ParticipantReadinessGate.ProfileDetailsRule"/> (a test holds them together).</summary>
    internal static List<string> ProfileMissing(Participant p)
    {
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(p.FirstName)) missing.Add("first name");
        if (string.IsNullOrWhiteSpace(p.LastName)) missing.Add("last name");
        if (p.DateOfBirth == null) missing.Add("date of birth");
        if (p.FundingSource == ParticipantFundingSource.Ndis && string.IsNullOrWhiteSpace(p.NdisNumber)) missing.Add("NDIS number");
        return missing;
    }

    private const int MaxContacts = 20;
    // ParticipantPatchApplier.ValidatePhone's pattern: the participant's own phone is held to it, and a contact's now is too.
    private static readonly Regex PhonePattern = new(@"^\+?[\d\s\-()]{6,20}$", RegexOptions.CultureInvariant);

    /// <summary>
    /// The pending contacts' refusals, keyed as the form's rows are. Any role but PlanManager (it needs a plan type an enquiry hasn't got); both names, as a Person
    /// has; a phone and an email that are one, which no contact endpoint checks today (D3). The email check is the invite's own (IntakeBookingsController.IsSendable).
    /// </summary>
    private static Dictionary<string, string[]> ContactErrors(List<InquiryContactDto>? contacts)
    {
        var errors = new Dictionary<string, string[]>();
        if (contacts is null) return errors;
        if (contacts.Count > MaxContacts) errors["contacts"] = [$"Add at most {MaxContacts} contacts."];
        for (var i = 0; i < contacts.Count; i++)
        {
            var (c, key) = (contacts[i], $"contacts[{i}].");
            if (c.Role is not { } role || !Enum.IsDefined(role)) errors[key + "role"] = ["Choose a role."];
            else if (role == ContactRoleType.PlanManager) errors[key + "role"] = ["Add a plan manager on the participant's Contacts tab once intake starts."];
            if (Blank(c.FirstName) is null) errors[key + "firstName"] = ["Add their first name."];
            if (Blank(c.LastName) is null) errors[key + "lastName"] = ["Add their last name."];
            if (Blank(c.Phone) is { } phone && !PhonePattern.IsMatch(phone)) errors[key + "phone"] = ["Enter a phone number, like 0412 345 678."];
            if (Blank(c.Email) is { } email && !IntakeBookingsController.IsSendable(email)) errors[key + "email"] = ["Enter a full email address, like name@example.com."];
        }
        return errors;
    }

    /// <summary>One pending row per contact, in the form's order, in the enquiry's organisation. Only called after <see cref="ContactErrors"/> found none.</summary>
    private void AddContacts(ParticipantInquiry inquiry, List<InquiryContactDto> contacts) =>
        _db.InquiryContacts.AddRange(contacts.Select((c, i) => new InquiryContact
        {
            Id = Guid.NewGuid(), TenantId = inquiry.TenantId, InquiryId = inquiry.Id, SortOrder = i, Role = c.Role!.Value,
            FirstName = c.FirstName!.Trim(), LastName = c.LastName!.Trim(), Phone = Blank(c.Phone), Email = Blank(c.Email), Relationship = Blank(c.Relationship), Notes = Blank(c.Notes),
        }));

    /// <summary>The enquiry as the form needs it after a save or a load: the booked staff member's names, and the provider's zone a visit is entered in.</summary>
    private async Task<ParticipantInquiryDto> FullDtoAsync(ParticipantInquiry x, CancellationToken ct)
    {
        // Keyed on the enquiry's organisation: a SuperAdmin's context has no query filter.
        var staff = x.IntakeStaffUserId is Guid staffId ? await _db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Id == staffId && u.TenantId == x.TenantId, ct) : null;
        return ToDto(x, staff, (await ProviderTimeZoneResolver.ResolveAsync(_db, x.TenantId, ct)).Id);
    }

    /// <summary>A form's "left blank" arrives as "" or spaces: store nothing, trimmed otherwise, never an empty string.</summary>
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>The enquiry as the API sends it. <paramref name="staff"/> is the booked staff member (for their names); <paramref name="timeZoneId"/> is the provider's zone.</summary>
    private const string ChangedByOther = "Someone else just changed this enquiry. Reload and try again.";

    // The enquiry's intake booking columns IntakeIcsSequence and IntakeUid are concurrency tokens: an edit racing a booking write matches no row.
    private async Task<bool> SavedAsync(CancellationToken ct)
    {
        try
        {
            await _db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            return false;
        }
    }

    internal static ParticipantInquiryDto ToDto(ParticipantInquiry x, User? staff = null, string? timeZoneId = null) => new()
    {
        Id = x.Id, ParticipantId = x.ParticipantId, FirstName = x.FirstName, LastName = x.LastName, Phone = x.Phone, Email = x.Email, Source = x.Source,
        Provenance = x.Provenance, CreatedAt = x.CreatedAt,
        IntakeStartsAt = x.IntakeStartsAt, IntakeDurationMinutes = x.IntakeDurationMinutes, IntakeLocation = x.IntakeLocation,
        IntakeStaffUserId = x.IntakeStaffUserId, IntakeStaffFirstName = staff?.FirstName, IntakeStaffName = staff?.FullName, IntakeNotes = x.IntakeNotes,
        IntakeInviteSentAt = x.IntakeInviteSentAt, IntakeInviteError = x.IntakeInviteError, IntakeConfirmedAt = x.IntakeConfirmedAt, TimeZoneId = timeZoneId,
    };
}
