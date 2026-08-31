using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// CONTACT-01/03: CRUD for <see cref="Person"/> — the tenant-scoped identity half of the
/// contacts model, independent of any particular participant/role. Backs the "existing person"
/// SearchableSelect picker on the Contacts tab/wizard step (GetAll's <c>search</c> query) and the
/// "new person" inline-create path used both here and, transactionally, by
/// <see cref="ParticipantsController.Create"/> / <see cref="ParticipantContactRolesController.Create"/>.
///
/// Deliberately no DELETE endpoint for CONTACT-01's MVP: a Person referenced by any
/// ParticipantContactRole row is protected by a Restrict FK (see OdipDbContext), and there is no
/// product requirement yet for retiring a person with zero roles — Delete can be added once that
/// need actually arises.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/persons")]
public class PersonsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public PersonsController(OdipDbContext db) => _db = db;

    /// <summary>List/search people for this tenant — the SearchableSelect person picker's data
    /// source. Unpaged (mirrors StaffController's list shape): tenant contact-book sizes don't
    /// warrant paging for a typeahead.</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<PersonDto>>>> GetAll([FromQuery] string? search, CancellationToken ct)
    {
        var query = _db.People.AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(p => (p.FirstName + " " + p.LastName).Contains(search)
                || (p.Organisation != null && p.Organisation.Contains(search))
                || (p.Email != null && p.Email.Contains(search)));

        var people = await query
            .OrderBy(p => p.LastName).ThenBy(p => p.FirstName)
            .Select(p => new PersonDto
            {
                Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FirstName + " " + p.LastName,
                Phone = p.Phone, Mobile = p.Mobile, Email = p.Email,
                AddressLine = p.AddressLine, Suburb = p.Suburb, State = p.State, Postcode = p.Postcode,
                Organisation = p.Organisation, DateOfBirth = p.DateOfBirth, Notes = p.Notes,
                ActiveRoleCount = p.ContactRoles.Count(r => r.Status == ContactRoleStatus.Active),
            })
            .ToListAsync(ct);

        return Ok(ApiResponse<List<PersonDto>>.Ok(people));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<PersonDto>>> GetById(Guid id, CancellationToken ct)
    {
        var p = await _db.People.Include(x => x.ContactRoles).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<PersonDto>.Fail("Person not found"));

        return Ok(ApiResponse<PersonDto>.Ok(ToDto(p)));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<PersonDto>>> Create([FromBody] CreatePersonDto dto, CancellationToken ct)
    {
        var nameError = ValidateName(dto.FirstName, dto.LastName);
        if (nameError != null) return BadRequest(ApiResponse<PersonDto>.Fail(nameError));

        var person = new Person
        {
            Id = Guid.NewGuid(),
            FirstName = dto.FirstName.Trim(), LastName = dto.LastName.Trim(),
            Phone = dto.Phone, Mobile = dto.Mobile, Email = dto.Email,
            AddressLine = dto.AddressLine, Suburb = dto.Suburb, State = dto.State, Postcode = dto.Postcode,
            Organisation = dto.Organisation, DateOfBirth = dto.DateOfBirth, Notes = dto.Notes,
        };
        _db.People.Add(person);
        await _db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetById), new { id = person.Id }, ApiResponse<PersonDto>.Ok(ToDto(person)));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<PersonDto>>> Update(Guid id, [FromBody] UpdatePersonDto dto, CancellationToken ct)
    {
        var nameError = ValidateName(dto.FirstName, dto.LastName);
        if (nameError != null) return BadRequest(ApiResponse<PersonDto>.Fail(nameError));

        var p = await _db.People.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<PersonDto>.Fail("Person not found"));

        p.FirstName = dto.FirstName.Trim(); p.LastName = dto.LastName.Trim();
        p.Phone = dto.Phone; p.Mobile = dto.Mobile; p.Email = dto.Email;
        p.AddressLine = dto.AddressLine; p.Suburb = dto.Suburb; p.State = dto.State; p.Postcode = dto.Postcode;
        p.Organisation = dto.Organisation; p.DateOfBirth = dto.DateOfBirth; p.Notes = dto.Notes;
        p.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<PersonDto>.Ok(ToDto(p)));
    }

    // ── Helpers ────────────────────────────────────────────────────

    internal static string? ValidateName(string firstName, string lastName) =>
        string.IsNullOrWhiteSpace(firstName) && string.IsNullOrWhiteSpace(lastName)
            ? "Provide at least a first or last name."
            : null;

    private static PersonDto ToDto(Person p) => new()
    {
        Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FullName,
        Phone = p.Phone, Mobile = p.Mobile, Email = p.Email,
        AddressLine = p.AddressLine, Suburb = p.Suburb, State = p.State, Postcode = p.Postcode,
        Organisation = p.Organisation, DateOfBirth = p.DateOfBirth, Notes = p.Notes,
        ActiveRoleCount = p.ContactRoles?.Count(r => r.Status == ContactRoleStatus.Active) ?? 0,
    };
}
