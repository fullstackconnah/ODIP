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
    public async Task<ActionResult<ApiResponse<List<ParticipantInquiryDto>>>> GetAll(CancellationToken ct, [FromQuery] string? view = null)
    {
        // view=closed lists the closed enquiries only; anything else is the open ones plus the direct intakes (spec addendum E4).
        var closed = view == "closed";
        var inquiries = await _db.ParticipantInquiries.Where(x => _tenant.TenantId == null || x.TenantId == _tenant.TenantId)
            .Where(x => closed ? x.ClosedAt != null : x.ClosedAt == null).OrderByDescending(x => x.CreatedAt).ToListAsync(ct);
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
        // Everyone else who can open the Enquiries tab still sees when it is, the staff member's first name and what the invite did. The main contact's
        // name and relationship are a third party's details, so they are withheld the same way (L2); the phone and email stay, as before the redesign.
        var seesVisitDetails = User?.IsInRole("Admin") == true || User?.IsInRole("Coordinator") == true || User?.IsInRole("SuperAdmin") == true;
        if (!seesVisitDetails) rows = rows.Select(r => r with
        {
            IntakeLocation = null, IntakeNotes = null, IntakeStaffName = null, CloseNote = null, ContactFirstName = null, ContactLastName = null, ContactRelationship = null,
        }).ToList();
        if (closed) return Ok(ApiResponse<List<ParticipantInquiryDto>>.Ok(rows));

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
        return Ok(ApiResponse<ParticipantInquiryDetailDto>.Ok(new ParticipantInquiryDetailDto(await FullDtoAsync(inquiry, ct))
        {
            Contacts = contacts, ContactRole = inquiry.ContactRole, DateOfBirth = inquiry.DateOfBirth, NdisNumber = inquiry.NdisNumber,
            AddressStreet = inquiry.AddressStreet, AddressSuburb = inquiry.AddressSuburb, AddressState = inquiry.AddressState, AddressPostcode = inquiry.AddressPostcode,
            PlanType = inquiry.PlanType, PlanStartDate = inquiry.PlanStartDate, PlanEndDate = inquiry.PlanEndDate,
        }));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Create(CreateParticipantInquiryDto dto, CancellationToken ct)
    {
        if (!Sources.Contains(dto.Source)) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("Source must be Web, Email, or Phone."));
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var errors = await InquiryErrorsAsync(dto, null, tenantId, ct);
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId };
        Apply(inquiry, dto, converted: false);
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
        if (inquiry.ClosedAt is not null) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(IntakeBookingsController.ClosedRefusal, IntakeBookingsController.ClosedCode));
        if (!Sources.Contains(dto.Source)) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("Source must be Web, Email, or Phone."));
        var errors = await InquiryErrorsAsync(dto, inquiry, inquiry.TenantId, ct);
        // Once intake has started the contacts are the participant's (Convert moved them): adding pending ones now would strand them.
        if (dto.Contacts is { Count: > 0 } && inquiry.ParticipantId is not null) errors["contacts"] = ["Intake has started, so add contacts on the participant's record."];
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));
        // The version the form loaded goes into the UPDATE's WHERE (not a read-then-compare, which would race): another save since then is a 409.
        if (dto.ExpectedUpdatedAt is DateTime expected) _db.Entry(inquiry).Property(x => x.UpdatedAt).OriginalValue = expected;
        Apply(inquiry, dto, converted: inquiry.ParticipantId is not null);
        inquiry.UpdatedAt = DateTime.UtcNow;
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
        if (inquiry.ClosedAt is not null) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(IntakeBookingsController.ClosedRefusal, IntakeBookingsController.ClosedCode));
        if (inquiry.ParticipantId is null)
        {
            // Start intake's gates (owner decision 4, D1): the full address for a new participant (an existing one has its own, G4), and a name for a
            // main contact who will become a Person. Nothing is created until both pass.
            var errors = new Dictionary<string, string[]>();
            if (dto.ParticipantId is null)
                foreach (var (key, value, part) in new[] { ("addressStreet", inquiry.AddressStreet, "street"), ("addressSuburb", inquiry.AddressSuburb, "suburb"), ("addressState", inquiry.AddressState, "state"), ("addressPostcode", inquiry.AddressPostcode, "postcode") })
                    if (string.IsNullOrWhiteSpace(value)) errors[key] = [$"Add the {part} to start intake."];
            if (inquiry.ContactNeedsName)
            {
                if (string.IsNullOrWhiteSpace(inquiry.ContactFirstName)) errors["contactFirstName"] = ["Add the main contact's name to start intake."];
                if (string.IsNullOrWhiteSpace(inquiry.ContactLastName)) errors["contactLastName"] = ["Add the main contact's name to start intake."];
            }
            if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));
            Participant? participant = null;
            if (dto.ParticipantId is Guid participantId) { participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct); if (participant == null || participant.TenantId != inquiry.TenantId) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Participant not found")); }
            else
            {
                participant = new Participant
                {
                    Id = Guid.NewGuid(), TenantId = inquiry.TenantId, FirstName = inquiry.FirstName, LastName = inquiry.LastName ?? string.Empty,
                    DateOfBirth = inquiry.DateOfBirth, NdisNumber = inquiry.NdisNumber,
                    AddressStreet = inquiry.AddressStreet, AddressSuburb = inquiry.AddressSuburb, AddressState = inquiry.AddressState, AddressPostcode = inquiry.AddressPostcode,
                    PlanType = inquiry.PlanType ?? default, PlanStartDate = inquiry.PlanStartDate, PlanEndDate = inquiry.PlanEndDate,
                    // L5: the phone and email are the main contact's; the participant's own only when they are their own contact. A legacy value that isn't a phone stays on the enquiry (G3).
                    Phone = inquiry.ContactIsParticipant && IsPhone(inquiry.Phone) ? inquiry.Phone : null,
                    Email = inquiry.ContactIsParticipant ? inquiry.Email : null,
                    IsActive = false, IsDraft = true,
                };
                _db.Participants.Add(participant);
            }
            inquiry.ParticipantId = participant.Id; inquiry.UpdatedAt = DateTime.UtcNow;
            if (!await _db.ParticipantOnboardings.AnyAsync(x => x.ParticipantId == participant.Id, ct)) _db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = inquiry.TenantId, ParticipantId = participant.Id });
            if (await MovePendingContactsAsync(inquiry, participant, ct) is string refused) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(refused));
            if (!await SavedAsync(ct)) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(ChangedByOther));
        }
        else if (dto.ParticipantId is Guid requested && requested != inquiry.ParticipantId) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry has already been converted."));
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ToDto(inquiry)));
    }

    /// <summary>
    /// D3 and owner decision 5: the enquiry's main contact, then its pending contacts, become the participant's in Convert's one save (one transaction), each a
    /// Person and an Active contact role, and the pending rows stop being pending. The main contact is moved FIRST, with the role picked on the form (Next of
    /// Kin when none was, D2), and is primary unless the participant already has a primary of that kind (the uniqueness rule refuses it); pending rows are
    /// never primary. The participant's Contacts tab orders by role, so "first" holds on the enquiry and in this move, not there (G1). A legacy phone that isn't
    /// one goes into the role's notes, never into Person.Phone (G3). The participant's own contact rules apply (plan check S1): the copied date of birth and
    /// plan type, or an existing participant's, can refuse one, and then nothing is saved and the reason comes back. A contact the participant already has
    /// (same role and name, as the intake save's IsSameContact) is not added twice, so a pending row that repeats the main contact is the one skipped.
    /// The tenant is set explicitly: a context with no tenant (a SuperAdmin) stamps none. Returns the refusal, or null.
    /// </summary>
    private async Task<string?> MovePendingContactsAsync(ParticipantInquiry inquiry, Participant participant, CancellationToken ct)
    {
        var pending = await _db.InquiryContacts.Where(c => c.InquiryId == inquiry.Id && c.TenantId == inquiry.TenantId).OrderBy(c => c.SortOrder).ToListAsync(ct);
        var moving = new List<(ContactRoleType Role, string First, string Last, string? Phone, string? Email, string? Relationship, string? Notes, InquiryContact? Pending)>();
        if (inquiry.HasMainContact)
            moving.Add((inquiry.ContactRole ?? ContactRoleType.NextOfKin, inquiry.ContactFirstName!.Trim(), inquiry.ContactLastName!.Trim(), IsPhone(inquiry.Phone) ? inquiry.Phone : null,
                inquiry.Email, inquiry.ContactRelationship, inquiry.Phone is null || IsPhone(inquiry.Phone) ? null : $"Phone on the enquiry: {inquiry.Phone}", null));
        moving.AddRange(pending.Select(c => (c.Role, c.FirstName, c.LastName, c.Phone, c.Email, c.Relationship, c.Notes, (InquiryContact?)c)));
        if (moving.Count == 0) return null;
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, inquiry.TenantId, _clock, ct);
        var recorded = (await _db.ParticipantContactRoles.Where(r => r.ParticipantId == participant.Id && r.TenantId == inquiry.TenantId && r.Status == ContactRoleStatus.Active)
            .Select(r => new { r.RoleType, r.Person!.FirstName, r.Person.LastName, r.IsPrimary, r.Status }).ToListAsync(ct))
            .Select(r => (r.RoleType, r.FirstName, r.LastName, r.IsPrimary, r.Status)).ToList();
        static bool Same(string a, string b) => string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
        foreach (var c in moving)
        {
            if (ContactRoleRules.Validate(c.Role, participant.PlanType, participant.DateOfBirth, null, today) is string gate)
                return $"{ParticipantInquiry.JoinName(c.First, c.Last)} can't be added as this participant's contact: {gate}";
            if (c.Pending is not null) _db.InquiryContacts.Remove(c.Pending);
            // Already on the participant, or the same contact twice on the enquiry (plan check B-S1): one copy.
            if (recorded.Any(r => r.RoleType == c.Role && Same(r.FirstName, c.First) && Same(r.LastName, c.Last))) continue;
            var primary = c.Pending is null && ContactRoleRules.ValidateUniqueness(c.Role, true, ContactRoleStatus.Active, recorded.Select(r => (r.RoleType, r.IsPrimary, r.Status))) is null;
            recorded.Add((c.Role, c.First, c.Last, primary, ContactRoleStatus.Active));
            var person = new Person { Id = Guid.NewGuid(), TenantId = inquiry.TenantId, FirstName = c.First, LastName = c.Last, Phone = c.Phone, Email = c.Email };
            _db.People.Add(person);
            _db.ParticipantContactRoles.Add(new ParticipantContactRole
            {
                Id = Guid.NewGuid(), TenantId = inquiry.TenantId, ParticipantId = participant.Id, PersonId = person.Id,
                RoleType = c.Role, RelationshipToParticipant = c.Relationship, Notes = c.Notes, IsPrimary = primary,
            });
        }
        return null;
    }

    private static bool IsPhone(string? v) => v is not null && PhonePattern.IsMatch(v);

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

    private static readonly HashSet<string> AuStates = new(StringComparer.Ordinal) { "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT" };
    private static readonly Regex NineDigits = new(@"^\d{9}$", RegexOptions.CultureInvariant);
    private static string? NdisDigits(string? value) => Blank(value)?.Replace(" ", "", StringComparison.Ordinal);

    /// <summary>
    /// Every refusal of an enquiry save, keyed by the form's fields and worded as the form words them (spec 2026-10-16 redesign, L3/L4), so the client
    /// can mark the field. Only the first name is required. The main contact's phone and email are checked only when they change (D4): every enquiry
    /// saved before this rule may hold free text there ("after 3pm, ask for Mum"), and holding it to the pattern on an unrelated edit would block every
    /// save with no way out but retyping it. Ticking "their own contact" counts as a change, because it makes that phone the participant's own, which
    /// Start intake copies. A converted enquiry (D7) is checked for its first name only: its contact and details are the participant's record now.
    /// </summary>
    private async Task<Dictionary<string, string[]>> InquiryErrorsAsync(CreateParticipantInquiryDto dto, ParticipantInquiry? stored, Guid tenantId, CancellationToken ct)
    {
        var converted = stored?.ParticipantId is not null;
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        // Convert leaves a null plan at the Participant's default (L5's known limit), so the role rules read it the same way.
        var plan = dto.PlanType ?? PlanType.SelfManaged;
        var errors = converted ? new Dictionary<string, string[]>() : ContactErrors(dto.Contacts, plan, dto.DateOfBirth, today);
        if (Blank(dto.FirstName) is null) errors["firstName"] = ["Add the participant's first name."];
        if (converted) return errors;
        var recheck = stored is null || (dto.ContactIsParticipant && !stored.ContactIsParticipant);
        if (Blank(dto.Phone) is { } phone && (recheck || phone != stored!.Phone) && !PhonePattern.IsMatch(phone)) errors["phone"] = ["Enter a phone number, like 0412 345 678."];
        if (Blank(dto.Email) is { } email && (recheck || email != stored!.Email) && !IntakeBookingsController.IsSendable(email)) errors["email"] = ["Enter a full email address, like name@example.com."];
        if (NdisDigits(dto.NdisNumber) is { } ndis && !NineDigits.IsMatch(ndis)) errors["ndisNumber"] = ["Enter the 9-digit NDIS number, like 430 123 456."];
        if (dto.DateOfBirth > today) errors["dateOfBirth"] = ["The date of birth can't be in the future."];
        else if (dto.DateOfBirth < today.AddYears(-120)) errors["dateOfBirth"] = ["Check the year: that's more than 120 years ago."];
        if (Blank(dto.AddressState) is { } state && !AuStates.Contains(state)) errors["addressState"] = ["Choose a state from the list."];
        if (ParticipantPatchApplier.ValidateAddressPostcode(new CreateParticipantDto { AddressPostcode = Blank(dto.AddressPostcode) }) is { } postcode) errors["addressPostcode"] = [postcode];
        if (dto.PlanEndDate < dto.PlanStartDate) errors["planEndDate"] = ["The plan end can't be before the plan start."];
        if (dto.PlanType is { } type && !Enum.IsDefined(type)) errors["planType"] = ["Choose how the plan is managed."];
        if (!dto.ContactIsParticipant && RoleError(dto.ContactRole, plan, dto.DateOfBirth, today, required: false) is { } role) errors["contactRole"] = [role];
        return errors;
    }

    /// <summary>
    /// One role rule for the main contact and every pending row (L4): the participant's own contact rules, read against the enquiry's date of birth and
    /// plan type at save, so a refusal shows on the form and not at Start intake. No registered-provider flag exists on an enquiry, so an NDIA-managed
    /// Provider Contact is refused (D5). PlanManager is never pending: it is added on the participant's Contacts tab.
    /// </summary>
    private static string? RoleError(ContactRoleType? role, PlanType plan, DateOnly? dob, DateOnly today, bool required) => role switch
    {
        null => required ? "Choose a role." : null,
        { } r when !Enum.IsDefined(r) => "Choose a role.",
        ContactRoleType.PlanManager => "Add a plan manager on the participant's Contacts tab once intake starts.",
        { } r => ContactRoleRules.Validate(r, plan, dob, null, today),
    };

    /// <summary>Writes a validated save onto the enquiry. Blanks are stored as null; with "their own contact" ticked the contact's names, relationship and role are null whatever was sent (L4).</summary>
    private static void Apply(ParticipantInquiry x, CreateParticipantInquiryDto dto, bool converted)
    {
        x.FirstName = Blank(dto.FirstName)!; x.LastName = Blank(dto.LastName); x.Source = dto.Source; x.Provenance = Blank(dto.Provenance);
        // D7: the main contact and details are the participant's record now; omitted by the form, ignored if sent.
        if (converted) return;
        x.Phone = Blank(dto.Phone); x.Email = Blank(dto.Email); x.ContactIsParticipant = dto.ContactIsParticipant;
        var self = dto.ContactIsParticipant;
        x.ContactFirstName = self ? null : Blank(dto.ContactFirstName); x.ContactLastName = self ? null : Blank(dto.ContactLastName);
        x.ContactRelationship = self ? null : Blank(dto.ContactRelationship); x.ContactRole = self ? null : dto.ContactRole;
        x.DateOfBirth = dto.DateOfBirth; x.NdisNumber = NdisDigits(dto.NdisNumber);
        x.AddressStreet = Blank(dto.AddressStreet); x.AddressSuburb = Blank(dto.AddressSuburb); x.AddressState = Blank(dto.AddressState); x.AddressPostcode = Blank(dto.AddressPostcode);
        x.PlanType = dto.PlanType; x.PlanStartDate = dto.PlanStartDate; x.PlanEndDate = dto.PlanEndDate;
    }

    /// <summary>
    /// The pending contacts' refusals, keyed as the form's rows are. A role the participant's contact rules allow for the enquiry's age and plan (<see cref="RoleError"/>);
    /// both names, as a Person has; a phone and an email that are one, which no contact endpoint checks today (D3). The email check is the invite's own (IntakeBookingsController.IsSendable).
    /// </summary>
    private static Dictionary<string, string[]> ContactErrors(List<InquiryContactDto>? contacts, PlanType plan, DateOnly? dob, DateOnly today)
    {
        var errors = new Dictionary<string, string[]>();
        if (contacts is null) return errors;
        if (contacts.Count > MaxContacts) errors["contacts"] = [$"Add at most {MaxContacts} contacts."];
        for (var i = 0; i < contacts.Count; i++)
        {
            var (c, key) = (contacts[i], $"contacts[{i}].");
            if (RoleError(c.Role, plan, dob, today, required: true) is { } role) errors[key + "role"] = [role];
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
        Id = x.Id, ParticipantId = x.ParticipantId, FirstName = x.FirstName, LastName = x.LastName ?? string.Empty, Phone = x.Phone, Email = x.Email, Source = x.Source,
        ContactIsParticipant = x.ContactIsParticipant, HasAddress = x.HasFullAddress, ContactNeedsName = x.ContactNeedsName,
        ContactFirstName = x.ContactFirstName, ContactLastName = x.ContactLastName, ContactRelationship = x.ContactRelationship,
        Provenance = x.Provenance, CreatedAt = x.CreatedAt, UpdatedAt = x.UpdatedAt, ClosedAt = x.ClosedAt, CloseOutcome = x.CloseOutcome, CloseNote = x.CloseNote,
        IntakeStartsAt = x.IntakeStartsAt, IntakeDurationMinutes = x.IntakeDurationMinutes, IntakeLocation = x.IntakeLocation,
        IntakeStaffUserId = x.IntakeStaffUserId, IntakeStaffFirstName = staff?.FirstName, IntakeStaffName = staff?.FullName, IntakeNotes = x.IntakeNotes,
        IntakeInviteSentAt = x.IntakeInviteSentAt, IntakeInviteError = x.IntakeInviteError, IntakeConfirmedAt = x.IntakeConfirmedAt, TimeZoneId = timeZoneId,
    };
}
