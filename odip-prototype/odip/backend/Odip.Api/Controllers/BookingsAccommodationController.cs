using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Npgsql;
using Odip.Api.Services;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/bookings")]
public class BookingsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public BookingsController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<BookingListDto>>>> GetAll(
        [FromQuery] Guid? tripId, [FromQuery] BookingStatus? status,
        [FromQuery] int page = 1, [FromQuery] int pageSize = PagingParams.DefaultPageSize, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);

        var query = _db.ParticipantBookings.Include(b => b.Participant).Include(b => b.TripInstance).AsQueryable();
        if (tripId.HasValue) query = query.Where(b => b.TripInstanceId == tripId.Value);
        if (status.HasValue) query = query.Where(b => b.BookingStatus == status.Value);

        // Correctness fix: BookingDate is a plain date (not a timestamp) and many bookings are
        // created on the same day, so ties on the sole OrderByDescending key are common. With no
        // tiebreaker, SQL makes no ordering guarantee among tied rows, so two independent
        // Skip/Take executions (page 1, page 2) can each resolve the tied group differently — a
        // row can land on both pages (duplicate) or neither (vanishes). .Id is a unique Guid
        // primary key, so ThenBy(b => b.Id) makes the total order deterministic and safe to
        // paginate. Mirrors IncidentsController.GetAll's identical fix.
        var projectedQuery = query.OrderByDescending(b => b.BookingDate).ThenBy(b => b.Id)
            .Select(b => new BookingListDto
            {
                Id = b.Id, TripInstanceId = b.TripInstanceId, TripName = b.TripInstance.TripName,
                ParticipantId = b.ParticipantId, ParticipantName = b.Participant.FirstName + " " + b.Participant.LastName,
                BookingStatus = b.BookingStatus, BookingDate = b.BookingDate,
                WheelchairRequired = b.WheelchairRequired, HighSupportRequired = b.HighSupportRequired,
                NightSupportRequired = b.NightSupportRequired, HasRestrictivePracticeFlag = b.HasRestrictivePracticeFlag,
                SupportRatioOverride = b.SupportRatioOverride, ActionRequired = b.ActionRequired,
                InsuranceStatus = b.InsuranceStatus, PaymentStatus = b.PaymentStatus
            });

        var result = await PagedResult<BookingListDto>.CreateAsync(projectedQuery, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<BookingListDto>>.Ok(result));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<BookingDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var b = await _db.ParticipantBookings.Include(x => x.Participant).Include(x => x.TripInstance)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (b == null) return NotFound(ApiResponse<BookingDetailDto>.Fail("Booking not found"));

        return Ok(ApiResponse<BookingDetailDto>.Ok(new BookingDetailDto
        {
            Id = b.Id, TripInstanceId = b.TripInstanceId, TripName = b.TripInstance.TripName,
            ParticipantId = b.ParticipantId, ParticipantName = b.Participant.FirstName + " " + b.Participant.LastName,
            BookingStatus = b.BookingStatus, BookingDate = b.BookingDate,
            WheelchairRequired = b.WheelchairRequired, HighSupportRequired = b.HighSupportRequired,
            NightSupportRequired = b.NightSupportRequired, HasRestrictivePracticeFlag = b.HasRestrictivePracticeFlag,
            SupportRatioOverride = b.SupportRatioOverride, ActionRequired = b.ActionRequired,
            PlanTypeOverride = b.PlanTypeOverride, FundingNotes = b.FundingNotes,
            RoomPreference = b.RoomPreference, TransportNotes = b.TransportNotes,
            EquipmentNotes = b.EquipmentNotes, RiskSupportNotes = b.RiskSupportNotes,
            PaymentStatus = b.PaymentStatus, BookingNotes = b.BookingNotes,
            CancellationReason = b.CancellationReason,
            InsuranceProvider = b.InsuranceProvider, InsurancePolicyNumber = b.InsurancePolicyNumber,
            InsuranceCoverageStart = b.InsuranceCoverageStart, InsuranceCoverageEnd = b.InsuranceCoverageEnd,
            InsuranceStatus = b.InsuranceStatus,
            IsInsuranceValid = b.InsuranceStatus == InsuranceStatus.Confirmed,
            CreatedAt = b.CreatedAt, UpdatedAt = b.UpdatedAt
        }));
    }

    private static readonly Dictionary<SupportRatio, decimal> RatioToStaff = new()
    {
        { SupportRatio.OneToOne, 1m }, { SupportRatio.OneToTwo, 0.5m }, { SupportRatio.OneToThree, 1m / 3m },
        { SupportRatio.OneToFour, 0.25m }, { SupportRatio.OneToFive, 0.2m }, { SupportRatio.TwoToOne, 2m },
        { SupportRatio.SharedSupport, 0.25m }, { SupportRatio.Other, 1m }
    };

    private async Task RecalculateStaffRequired(Guid tripId, CancellationToken ct)
    {
        var trip = await _db.TripInstances
            .Include(t => t.Bookings)
            .ThenInclude(b => b.Participant)
            .FirstOrDefaultAsync(t => t.Id == tripId, ct);
        if (trip == null) return;

        var activeBookings = trip.Bookings.Where(b =>
            b.BookingStatus != BookingStatus.Cancelled && b.BookingStatus != BookingStatus.NoLongerAttending);

        var rawTotal = activeBookings.Sum(b =>
        {
            var ratio = b.SupportRatioOverride ?? b.Participant?.SupportRatio ?? SupportRatio.OneToOne;
            return RatioToStaff.TryGetValue(ratio, out var v) ? v : 1m;
        });

        trip.CalculatedStaffRequired = rawTotal;
        trip.MinStaffRequired = (int)Math.Ceiling(rawTotal);
        trip.UpdatedAt = DateTime.UtcNow;
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<BookingDetailDto>>> Create([FromBody] CreateBookingDto dto, CancellationToken ct)
    {
        // A booking is operational work and goes through the readiness check; client-supplied
        // booking fields can never assert readiness. A participant who does not exist, is a draft
        // or is inactive is refused in either mode. Warn lets the booking proceed and reports what
        // is missing on the response; Enforce refuses it unless the strict gate accepts the participant.
        var readiness = await ParticipantReadiness.CheckAsync(_db, dto.ParticipantId, ct);
        if (!readiness.Allowed)
            return BadRequest(ApiResponse<BookingDetailDto>.Fail(ParticipantReadinessGate.NotReadyMessage));

        var booking = new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = dto.TripInstanceId, ParticipantId = dto.ParticipantId,
            BookingStatus = dto.BookingStatus, BookingDate = dto.BookingDate ?? DateOnly.FromDateTime(DateTime.UtcNow),
            SupportRatioOverride = dto.SupportRatioOverride, NightSupportRequired = dto.NightSupportRequired,
            WheelchairRequired = dto.WheelchairRequired, HighSupportRequired = dto.HighSupportRequired,
            HasRestrictivePracticeFlag = dto.HasRestrictivePracticeFlag, PlanTypeOverride = dto.PlanTypeOverride,
            FundingNotes = dto.FundingNotes, RoomPreference = dto.RoomPreference,
            TransportNotes = dto.TransportNotes, EquipmentNotes = dto.EquipmentNotes,
            RiskSupportNotes = dto.RiskSupportNotes, BookingNotes = dto.BookingNotes,
            InsuranceProvider = dto.InsuranceProvider, InsurancePolicyNumber = dto.InsurancePolicyNumber,
            InsuranceCoverageStart = dto.InsuranceCoverageStart, InsuranceCoverageEnd = dto.InsuranceCoverageEnd,
            InsuranceStatus = dto.InsuranceStatus,
        };
        _db.ParticipantBookings.Add(booking);

        // Auto-create insurance confirmation task
        var participant = await _db.Participants.FindAsync(new object[] { dto.ParticipantId }, ct);
        var trip = await _db.TripInstances.FindAsync(new object[] { dto.TripInstanceId }, ct);
        if (participant != null && trip != null)
        {
            _db.BookingTasks.Add(new BookingTask
            {
                Id = Guid.NewGuid(),
                TripInstanceId = dto.TripInstanceId,
                ParticipantBookingId = booking.Id,
                TaskType = TaskType.InsuranceConfirmation,
                Title = $"Confirm travel insurance for {participant.FirstName} {participant.LastName}",
                Priority = TaskPriority.Medium,
                Status = dto.InsuranceStatus == InsuranceStatus.Confirmed
                    ? TaskItemStatus.Completed : TaskItemStatus.NotStarted,
                DueDate = trip.StartDate.AddDays(-14),
                CompletedDate = dto.InsuranceStatus == InsuranceStatus.Confirmed
                    ? DateOnly.FromDateTime(DateTime.UtcNow) : null,
            });
        }

        try
        {
            await RecalculateStaffRequired(dto.TripInstanceId, ct);
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: "23505" })
        {
            return Conflict(ApiResponse<BookingDetailDto>.Fail("This participant is already booked on this trip."));
        }
        return CreatedAtAction(nameof(GetById), new { id = booking.Id },
            ApiResponse<BookingDetailDto>.Ok(new BookingDetailDto
            {
                Id = booking.Id, TripInstanceId = booking.TripInstanceId, TripName = trip?.TripName,
                ParticipantId = booking.ParticipantId,
                ParticipantName = participant != null ? participant.FirstName + " " + participant.LastName : null,
                BookingStatus = booking.BookingStatus, BookingDate = booking.BookingDate,
                WheelchairRequired = booking.WheelchairRequired, HighSupportRequired = booking.HighSupportRequired,
                NightSupportRequired = booking.NightSupportRequired, HasRestrictivePracticeFlag = booking.HasRestrictivePracticeFlag,
                SupportRatioOverride = booking.SupportRatioOverride, ActionRequired = booking.ActionRequired,
                InsuranceStatus = booking.InsuranceStatus, PaymentStatus = booking.PaymentStatus,
                PlanTypeOverride = booking.PlanTypeOverride, FundingNotes = booking.FundingNotes,
                RoomPreference = booking.RoomPreference, TransportNotes = booking.TransportNotes,
                EquipmentNotes = booking.EquipmentNotes, RiskSupportNotes = booking.RiskSupportNotes,
                BookingNotes = booking.BookingNotes, CancellationReason = booking.CancellationReason,
                InsuranceProvider = booking.InsuranceProvider, InsurancePolicyNumber = booking.InsurancePolicyNumber,
                InsuranceCoverageStart = booking.InsuranceCoverageStart, InsuranceCoverageEnd = booking.InsuranceCoverageEnd,
                IsInsuranceValid = booking.InsuranceStatus == InsuranceStatus.Confirmed,
                CreatedAt = booking.CreatedAt, UpdatedAt = booking.UpdatedAt,
                ReadinessIssues = readiness.IssuesOrNull
            }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<BookingDetailDto>>> Update(Guid id, [FromBody] UpdateBookingDto dto, CancellationToken ct)
    {
        var b = await _db.ParticipantBookings.Include(x => x.Participant).Include(x => x.TripInstance)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (b == null) return NotFound(ApiResponse<BookingDetailDto>.Fail("Booking not found"));

        b.BookingStatus = dto.BookingStatus; b.SupportRatioOverride = dto.SupportRatioOverride;
        b.NightSupportRequired = dto.NightSupportRequired; b.WheelchairRequired = dto.WheelchairRequired;
        b.HighSupportRequired = dto.HighSupportRequired; b.HasRestrictivePracticeFlag = dto.HasRestrictivePracticeFlag;
        b.PlanTypeOverride = dto.PlanTypeOverride; b.FundingNotes = dto.FundingNotes;
        b.RoomPreference = dto.RoomPreference; b.TransportNotes = dto.TransportNotes;
        b.EquipmentNotes = dto.EquipmentNotes; b.RiskSupportNotes = dto.RiskSupportNotes;
        b.PaymentStatus = dto.PaymentStatus; b.ActionRequired = dto.ActionRequired;
        b.BookingNotes = dto.BookingNotes; b.CancellationReason = dto.CancellationReason;
        b.InsuranceProvider = dto.InsuranceProvider; b.InsurancePolicyNumber = dto.InsurancePolicyNumber;
        b.InsuranceCoverageStart = dto.InsuranceCoverageStart; b.InsuranceCoverageEnd = dto.InsuranceCoverageEnd;
        b.InsuranceStatus = dto.InsuranceStatus;
        b.UpdatedAt = DateTime.UtcNow;

        // Auto-complete insurance task when status changes to Confirmed
        if (dto.InsuranceStatus == InsuranceStatus.Confirmed)
        {
            var insuranceTask = await _db.BookingTasks
                .FirstOrDefaultAsync(t => t.ParticipantBookingId == id
                    && t.TaskType == TaskType.InsuranceConfirmation
                    && t.Status != TaskItemStatus.Completed
                    && t.Status != TaskItemStatus.Cancelled, ct);
            if (insuranceTask != null)
            {
                insuranceTask.Status = TaskItemStatus.Completed;
                insuranceTask.CompletedDate = DateOnly.FromDateTime(DateTime.UtcNow);
            }
        }

        await RecalculateStaffRequired(b.TripInstanceId, ct);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<BookingDetailDto>.Ok(new BookingDetailDto
        {
            Id = b.Id, TripInstanceId = b.TripInstanceId, TripName = b.TripInstance.TripName,
            ParticipantId = b.ParticipantId, ParticipantName = b.Participant.FirstName + " " + b.Participant.LastName,
            BookingStatus = b.BookingStatus, BookingDate = b.BookingDate,
            WheelchairRequired = b.WheelchairRequired, HighSupportRequired = b.HighSupportRequired,
            NightSupportRequired = b.NightSupportRequired, HasRestrictivePracticeFlag = b.HasRestrictivePracticeFlag,
            SupportRatioOverride = b.SupportRatioOverride, ActionRequired = b.ActionRequired,
            InsuranceStatus = b.InsuranceStatus, PaymentStatus = b.PaymentStatus,
            PlanTypeOverride = b.PlanTypeOverride, FundingNotes = b.FundingNotes,
            RoomPreference = b.RoomPreference, TransportNotes = b.TransportNotes,
            EquipmentNotes = b.EquipmentNotes, RiskSupportNotes = b.RiskSupportNotes,
            BookingNotes = b.BookingNotes, CancellationReason = b.CancellationReason,
            InsuranceProvider = b.InsuranceProvider, InsurancePolicyNumber = b.InsurancePolicyNumber,
            InsuranceCoverageStart = b.InsuranceCoverageStart, InsuranceCoverageEnd = b.InsuranceCoverageEnd,
            IsInsuranceValid = b.InsuranceStatus == InsuranceStatus.Confirmed,
            CreatedAt = b.CreatedAt, UpdatedAt = b.UpdatedAt
        }));
    }

    [HttpPatch("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Patch(Guid id, [FromBody] PatchBookingDto dto, CancellationToken ct)
    {
        var b = await _db.ParticipantBookings.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (b == null) return NotFound(ApiResponse<bool>.Fail("Booking not found"));

        if (dto.BookingStatus.HasValue) b.BookingStatus = dto.BookingStatus.Value;
        if (dto.InsuranceStatus.HasValue) b.InsuranceStatus = dto.InsuranceStatus.Value;
        if (dto.PaymentStatus.HasValue) b.PaymentStatus = dto.PaymentStatus.Value;

        b.UpdatedAt = DateTime.UtcNow;
        await RecalculateStaffRequired(b.TripInstanceId, ct);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var b = await _db.ParticipantBookings.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (b == null) return NotFound(ApiResponse<bool>.Fail("Booking not found"));
        var tripId = b.TripInstanceId;
        _db.ParticipantBookings.Remove(b);
        await _db.SaveChangesAsync(ct);           // save deletion first
        await RecalculateStaffRequired(tripId, ct); // now recalculate from clean DB
        await _db.SaveChangesAsync(ct);           // save updated staff count
        return Ok(ApiResponse<bool>.Ok(true, "Booking deleted"));
    }
}

[ApiController]
[Authorize]
[Route("api/v1/accommodation")]
public class AccommodationController : ControllerBase
{
    private readonly OdipDbContext _db;
    public AccommodationController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<AccommodationListDto>>>> GetAll(
        [FromQuery] string? region, [FromQuery] bool? wheelchair, [FromQuery] int? minCapacity,
        [FromQuery] bool? isActive, CancellationToken ct)
    {
        var query = _db.AccommodationProperties.AsQueryable();
        if (!string.IsNullOrWhiteSpace(region)) query = query.Where(a => a.Region == region);
        if (wheelchair.HasValue) query = query.Where(a => a.IsWheelchairAccessible == wheelchair.Value);
        if (minCapacity.HasValue) query = query.Where(a => a.MaxCapacity >= minCapacity.Value);
        if (isActive.HasValue) query = query.Where(a => a.IsActive == isActive.Value);

        var items = await query.OrderBy(a => a.PropertyName)
            .Select(a => new AccommodationListDto
            {
                Id = a.Id, PropertyName = a.PropertyName, Location = a.Location, Region = a.Region,
                Address = a.Address, Suburb = a.Suburb, State = a.State, Postcode = a.Postcode,
                IsFullyModified = a.IsFullyModified, IsSemiModified = a.IsSemiModified,
                IsWheelchairAccessible = a.IsWheelchairAccessible, BedroomCount = a.BedroomCount,
                BedCount = a.BedCount, MaxCapacity = a.MaxCapacity, IsActive = a.IsActive
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<AccommodationListDto>>.Ok(items));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<AccommodationDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var a = await _db.AccommodationProperties.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<AccommodationDetailDto>.Fail("Accommodation not found"));

        return Ok(ApiResponse<AccommodationDetailDto>.Ok(new AccommodationDetailDto
        {
            Id = a.Id, PropertyName = a.PropertyName, ProviderOwner = a.ProviderOwner,
            Location = a.Location, Region = a.Region, Address = a.Address, Suburb = a.Suburb,
            State = a.State, Postcode = a.Postcode, ContactPerson = a.ContactPerson,
            Email = a.Email, Phone = a.Phone, Mobile = a.Mobile, Website = a.Website,
            IsFullyModified = a.IsFullyModified, IsSemiModified = a.IsSemiModified,
            IsWheelchairAccessible = a.IsWheelchairAccessible, AccessibilityNotes = a.AccessibilityNotes,
            BedroomCount = a.BedroomCount, BedCount = a.BedCount, MaxCapacity = a.MaxCapacity,
            BeddingConfiguration = a.BeddingConfiguration, HoistBathroomNotes = a.HoistBathroomNotes,
            GeneralNotes = a.GeneralNotes, IsActive = a.IsActive
        }));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<AccommodationDetailDto>>> Create([FromBody] CreateAccommodationDto dto, CancellationToken ct)
    {
        var prop = new AccommodationProperty
        {
            Id = Guid.NewGuid(), PropertyName = dto.PropertyName, ProviderOwner = dto.ProviderOwner,
            Location = dto.Location, Region = dto.Region, Address = dto.Address, Suburb = dto.Suburb,
            State = dto.State, Postcode = dto.Postcode, ContactPerson = dto.ContactPerson,
            Email = dto.Email, Phone = dto.Phone, Mobile = dto.Mobile, Website = dto.Website,
            IsFullyModified = dto.IsFullyModified, IsSemiModified = dto.IsSemiModified,
            IsWheelchairAccessible = dto.IsWheelchairAccessible, AccessibilityNotes = dto.AccessibilityNotes,
            BedroomCount = dto.BedroomCount, BedCount = dto.BedCount, MaxCapacity = dto.MaxCapacity,
            BeddingConfiguration = dto.BeddingConfiguration, HoistBathroomNotes = dto.HoistBathroomNotes,
            GeneralNotes = dto.GeneralNotes, IsActive = dto.IsActive
        };
        _db.AccommodationProperties.Add(prop);
        await _db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(GetById), new { id = prop.Id },
            ApiResponse<AccommodationDetailDto>.Ok(new AccommodationDetailDto
            {
                Id = prop.Id, PropertyName = prop.PropertyName, ProviderOwner = prop.ProviderOwner,
                Location = prop.Location, Region = prop.Region, Address = prop.Address, Suburb = prop.Suburb,
                State = prop.State, Postcode = prop.Postcode, ContactPerson = prop.ContactPerson,
                Email = prop.Email, Phone = prop.Phone, Mobile = prop.Mobile, Website = prop.Website,
                IsFullyModified = prop.IsFullyModified, IsSemiModified = prop.IsSemiModified,
                IsWheelchairAccessible = prop.IsWheelchairAccessible, AccessibilityNotes = prop.AccessibilityNotes,
                BedroomCount = prop.BedroomCount, BedCount = prop.BedCount, MaxCapacity = prop.MaxCapacity,
                BeddingConfiguration = prop.BeddingConfiguration, HoistBathroomNotes = prop.HoistBathroomNotes,
                GeneralNotes = prop.GeneralNotes, IsActive = prop.IsActive
            }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<AccommodationDetailDto>>> Update(Guid id, [FromBody] UpdateAccommodationDto dto, CancellationToken ct)
    {
        var a = await _db.AccommodationProperties.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<AccommodationDetailDto>.Fail("Accommodation not found"));

        a.PropertyName = dto.PropertyName; a.ProviderOwner = dto.ProviderOwner; a.Location = dto.Location;
        a.Region = dto.Region; a.Address = dto.Address; a.Suburb = dto.Suburb; a.State = dto.State;
        a.Postcode = dto.Postcode; a.ContactPerson = dto.ContactPerson; a.Email = dto.Email;
        a.Phone = dto.Phone; a.Mobile = dto.Mobile; a.Website = dto.Website;
        a.IsFullyModified = dto.IsFullyModified; a.IsSemiModified = dto.IsSemiModified;
        a.IsWheelchairAccessible = dto.IsWheelchairAccessible; a.AccessibilityNotes = dto.AccessibilityNotes;
        a.BedroomCount = dto.BedroomCount; a.BedCount = dto.BedCount; a.MaxCapacity = dto.MaxCapacity;
        a.BeddingConfiguration = dto.BeddingConfiguration; a.HoistBathroomNotes = dto.HoistBathroomNotes;
        a.GeneralNotes = dto.GeneralNotes; a.IsActive = dto.IsActive; a.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<AccommodationDetailDto>.Ok(new AccommodationDetailDto
        {
            Id = a.Id, PropertyName = a.PropertyName, ProviderOwner = a.ProviderOwner,
            Location = a.Location, Region = a.Region, Address = a.Address, Suburb = a.Suburb,
            State = a.State, Postcode = a.Postcode, ContactPerson = a.ContactPerson,
            Email = a.Email, Phone = a.Phone, Mobile = a.Mobile, Website = a.Website,
            IsFullyModified = a.IsFullyModified, IsSemiModified = a.IsSemiModified,
            IsWheelchairAccessible = a.IsWheelchairAccessible, AccessibilityNotes = a.AccessibilityNotes,
            BedroomCount = a.BedroomCount, BedCount = a.BedCount, MaxCapacity = a.MaxCapacity,
            BeddingConfiguration = a.BeddingConfiguration, HoistBathroomNotes = a.HoistBathroomNotes,
            GeneralNotes = a.GeneralNotes, IsActive = a.IsActive
        }));
    }

    /// <summary>Archive (soft-delete) an accommodation property.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var a = await _db.AccommodationProperties.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<bool>.Fail("Accommodation not found"));
        a.IsActive = false; a.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Accommodation archived"));
    }

    [HttpGet("{id:guid}/reservations")]
    public async Task<ActionResult<ApiResponse<List<ReservationDto>>>> GetReservations(Guid id, CancellationToken ct)
    {
        var items = await _db.AccommodationReservations.Include(r => r.TripInstance)
            .Where(r => r.AccommodationPropertyId == id)
            .Select(r => new ReservationDto
            {
                Id = r.Id, TripInstanceId = r.TripInstanceId, TripName = r.TripInstance.TripName,
                AccommodationPropertyId = r.AccommodationPropertyId, CheckInDate = r.CheckInDate,
                CheckOutDate = r.CheckOutDate, ReservationStatus = r.ReservationStatus,
                ConfirmationReference = r.ConfirmationReference, Cost = r.Cost,
                HasOverlapConflict = r.HasOverlapConflict
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<ReservationDto>>.Ok(items));
    }
}

[ApiController]
[Authorize]
[Route("api/v1/reservations")]
public class ReservationsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ReservationsController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ReservationDto>>>> GetAll(CancellationToken ct)
    {
        var items = await _db.AccommodationReservations
            .Include(r => r.TripInstance).Include(r => r.AccommodationProperty)
            .Select(r => new ReservationDto
            {
                Id = r.Id, TripInstanceId = r.TripInstanceId, TripName = r.TripInstance.TripName,
                AccommodationPropertyId = r.AccommodationPropertyId, PropertyName = r.AccommodationProperty.PropertyName,
                CheckInDate = r.CheckInDate, CheckOutDate = r.CheckOutDate, ReservationStatus = r.ReservationStatus,
                ConfirmationReference = r.ConfirmationReference, BedroomsReserved = r.BedroomsReserved,
                BedsReserved = r.BedsReserved, Cost = r.Cost, HasOverlapConflict = r.HasOverlapConflict,
                RequestSentDate = r.RequestSentDate, DateBooked = r.DateBooked, DateConfirmed = r.DateConfirmed,
                Comments = r.Comments
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<ReservationDto>>.Ok(items));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ReservationDto>>> Create([FromBody] CreateReservationDto dto, CancellationToken ct)
    {
        var reservation = new AccommodationReservation
        {
            Id = Guid.NewGuid(), TripInstanceId = dto.TripInstanceId,
            AccommodationPropertyId = dto.AccommodationPropertyId, RequestSentDate = dto.RequestSentDate,
            CheckInDate = dto.CheckInDate, CheckOutDate = dto.CheckOutDate,
            BedroomsReserved = dto.BedroomsReserved, BedsReserved = dto.BedsReserved,
            Cost = dto.Cost, ReservationStatus = dto.ReservationStatus, Comments = dto.Comments
        };

        // Check overlap conflict
        var hasConflict = await _db.AccommodationReservations
            .AnyAsync(r => r.AccommodationPropertyId == dto.AccommodationPropertyId && r.Id != reservation.Id
                && r.ReservationStatus != ReservationStatus.Cancelled && r.ReservationStatus != ReservationStatus.Unavailable
                && r.CheckInDate < dto.CheckOutDate && r.CheckOutDate > dto.CheckInDate, ct);
        reservation.HasOverlapConflict = hasConflict;

        _db.AccommodationReservations.Add(reservation);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(reservation).Reference(r => r.TripInstance).LoadAsync(ct);
        await _db.Entry(reservation).Reference(r => r.AccommodationProperty).LoadAsync(ct);
        return Ok(ApiResponse<ReservationDto>.Ok(new ReservationDto
        {
            Id = reservation.Id, TripInstanceId = reservation.TripInstanceId, TripName = reservation.TripInstance?.TripName,
            AccommodationPropertyId = reservation.AccommodationPropertyId, PropertyName = reservation.AccommodationProperty?.PropertyName,
            RequestSentDate = reservation.RequestSentDate, DateBooked = reservation.DateBooked, DateConfirmed = reservation.DateConfirmed,
            CheckInDate = reservation.CheckInDate, CheckOutDate = reservation.CheckOutDate,
            BedroomsReserved = reservation.BedroomsReserved, BedsReserved = reservation.BedsReserved,
            Cost = reservation.Cost, ConfirmationReference = reservation.ConfirmationReference,
            ReservationStatus = reservation.ReservationStatus, Comments = reservation.Comments,
            CancellationReason = reservation.CancellationReason, HasOverlapConflict = hasConflict
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ReservationDto>>> Update(Guid id, [FromBody] UpdateReservationDto dto, CancellationToken ct)
    {
        var r = await _db.AccommodationReservations.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r == null) return NotFound(ApiResponse<ReservationDto>.Fail("Reservation not found"));

        r.AccommodationPropertyId = dto.AccommodationPropertyId; r.RequestSentDate = dto.RequestSentDate;
        r.CheckInDate = dto.CheckInDate; r.CheckOutDate = dto.CheckOutDate;
        r.BedroomsReserved = dto.BedroomsReserved; r.BedsReserved = dto.BedsReserved;
        r.Cost = dto.Cost; r.ReservationStatus = dto.ReservationStatus; r.Comments = dto.Comments;
        r.DateBooked = dto.DateBooked; r.DateConfirmed = dto.DateConfirmed;
        r.ConfirmationReference = dto.ConfirmationReference; r.CancellationReason = dto.CancellationReason;
        r.UpdatedAt = DateTime.UtcNow;

        var hasConflict = await _db.AccommodationReservations
            .AnyAsync(x => x.AccommodationPropertyId == dto.AccommodationPropertyId && x.Id != id
                && x.ReservationStatus != ReservationStatus.Cancelled && x.ReservationStatus != ReservationStatus.Unavailable
                && x.CheckInDate < dto.CheckOutDate && x.CheckOutDate > dto.CheckInDate, ct);
        r.HasOverlapConflict = hasConflict;

        await _db.SaveChangesAsync(ct);
        await _db.Entry(r).Reference(x => x.TripInstance).LoadAsync(ct);
        await _db.Entry(r).Reference(x => x.AccommodationProperty).LoadAsync(ct);
        return Ok(ApiResponse<ReservationDto>.Ok(new ReservationDto
        {
            Id = r.Id, TripInstanceId = r.TripInstanceId, TripName = r.TripInstance?.TripName,
            AccommodationPropertyId = r.AccommodationPropertyId, PropertyName = r.AccommodationProperty?.PropertyName,
            RequestSentDate = r.RequestSentDate, DateBooked = r.DateBooked, DateConfirmed = r.DateConfirmed,
            CheckInDate = r.CheckInDate, CheckOutDate = r.CheckOutDate,
            BedroomsReserved = r.BedroomsReserved, BedsReserved = r.BedsReserved,
            Cost = r.Cost, ConfirmationReference = r.ConfirmationReference,
            ReservationStatus = r.ReservationStatus, Comments = r.Comments,
            CancellationReason = r.CancellationReason, HasOverlapConflict = hasConflict
        }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var r = await _db.AccommodationReservations.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r == null) return NotFound(ApiResponse<bool>.Fail("Reservation not found"));
        _db.AccommodationReservations.Remove(r);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Reservation deleted"));
    }
}
