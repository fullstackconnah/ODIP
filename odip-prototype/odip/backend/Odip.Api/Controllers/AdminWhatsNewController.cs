using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>A SuperAdmin writes the release notes every organisation reads (Settings › What's new). Edits never move PublishedAtUtc, so they never make an entry unread again.</summary>
[ApiController]
[Authorize(Roles = "SuperAdmin")]
[Route("api/v1/admin/whats-new")]
public class AdminWhatsNewController : ControllerBase
{
    private const int TitleMax = 80;
    private const int BodyMax = 600;
    private readonly OdipDbContext _db;

    public AdminWhatsNewController(OdipDbContext db) => _db = db;

    [HttpGet]
    [Authorize(Roles = "SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<AdminWhatsNewEntryDto>>>> GetAll(CancellationToken ct)
    {
        var rows = await _db.WhatsNewEntries.AsNoTracking()
            .OrderByDescending(e => e.PublishedAtUtc).ThenByDescending(e => e.Id).ToListAsync(ct);
        return Ok(ApiResponse<List<AdminWhatsNewEntryDto>>.Ok(rows.Select(ToDto).ToList()));
    }

    [HttpPost]
    [Authorize(Roles = "SuperAdmin")]
    public async Task<ActionResult<ApiResponse<AdminWhatsNewEntryDto>>> Create([FromBody] SaveWhatsNewEntryDto dto, CancellationToken ct)
    {
        if (!Validate(dto, out var title, out var body, out var roles, out var errors))
            return BadRequest(ApiResponse<AdminWhatsNewEntryDto>.Fail(errors));

        var now = DateTime.UtcNow;
        var entry = new WhatsNewEntry
        {
            Id = Guid.NewGuid(), Key = "admin-" + Guid.NewGuid().ToString("N")[..8], Title = title, Body = body, Roles = roles,
            Important = dto.Important, PublishedAtUtc = now, CreatedAt = now, UpdatedAt = now,
        };
        _db.WhatsNewEntries.Add(entry);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<AdminWhatsNewEntryDto>.Ok(ToDto(entry)));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "SuperAdmin")]
    public async Task<ActionResult<ApiResponse<AdminWhatsNewEntryDto>>> Update(Guid id, [FromBody] SaveWhatsNewEntryDto dto, CancellationToken ct)
    {
        var entry = await _db.WhatsNewEntries.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (entry is null) return NotFound(ApiResponse<AdminWhatsNewEntryDto>.Fail("Entry not found"));
        if (!Validate(dto, out var title, out var body, out var roles, out var errors))
            return BadRequest(ApiResponse<AdminWhatsNewEntryDto>.Fail(errors));

        entry.Title = title;
        entry.Body = body;
        entry.Roles = roles;
        entry.Important = dto.Important;
        entry.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<AdminWhatsNewEntryDto>.Ok(ToDto(entry)));
    }

    [HttpPost("{id:guid}/archive")]
    [Authorize(Roles = "SuperAdmin")]
    public Task<ActionResult<ApiResponse<AdminWhatsNewEntryDto>>> Archive(Guid id, CancellationToken ct) =>
        SetArchived(id, e => e.ArchivedAtUtc ??= DateTime.UtcNow, ct);

    [HttpPost("{id:guid}/restore")]
    [Authorize(Roles = "SuperAdmin")]
    public Task<ActionResult<ApiResponse<AdminWhatsNewEntryDto>>> Restore(Guid id, CancellationToken ct) =>
        SetArchived(id, e => e.ArchivedAtUtc = null, ct);

    private async Task<ActionResult<ApiResponse<AdminWhatsNewEntryDto>>> SetArchived(Guid id, Action<WhatsNewEntry> change, CancellationToken ct)
    {
        var entry = await _db.WhatsNewEntries.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (entry is null) return NotFound(ApiResponse<AdminWhatsNewEntryDto>.Fail("Entry not found"));
        change(entry);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<AdminWhatsNewEntryDto>.Ok(ToDto(entry)));
    }

    /// <summary>Line ends become \n, then both texts are trimmed, then their lengths are checked: whitespace-only counts as empty.</summary>
    private static bool Validate(SaveWhatsNewEntryDto dto, out string title, out string body, out WhatsNewAudience roles, out List<string> errors)
    {
        title = Clean(dto.Title);
        body = Clean(dto.Body);
        roles = WhatsNewAudienceNames.ToFlags(dto.Roles);
        errors = new List<string>();
        if (title.Length == 0) errors.Add("Enter a title.");
        else if (title.Length > TitleMax) errors.Add("The title can be up to 80 characters.");
        if (body.Length == 0) errors.Add("Enter the text people will read.");
        else if (body.Length > BodyMax) errors.Add("The text can be up to 600 characters.");
        if (roles == WhatsNewAudience.None) errors.Add("Choose at least one role.");
        errors.AddRange(WhatsNewAudienceNames.Unknown(dto.Roles).Select(n => $"Unknown role: {n}."));
        return errors.Count == 0;
    }

    private static string Clean(string? s) => (s ?? string.Empty).Replace("\r\n", "\n").Trim();

    private static AdminWhatsNewEntryDto ToDto(WhatsNewEntry e) => new()
    {
        Id = e.Id, Key = e.Key, Title = e.Title, Body = e.Body, Important = e.Important, PublishedAtUtc = e.PublishedAtUtc,
        Roles = WhatsNewAudienceNames.ToNames(e.Roles), ArchivedAtUtc = e.ArchivedAtUtc, UpdatedAt = e.UpdatedAt,
    };
}

/// <summary>The wire names of the audience flags, in the order the screens list them.</summary>
internal static class WhatsNewAudienceNames
{
    private static readonly (string Name, WhatsNewAudience Flag)[] Map =
    {
        ("Admin", WhatsNewAudience.Admin), ("Coordinator", WhatsNewAudience.Coordinator),
        ("SupportWorker", WhatsNewAudience.SupportWorker), ("ReadOnly", WhatsNewAudience.ReadOnly),
    };

    /// <summary>Unknown names add no flag; the admin writes reject them with <see cref="Unknown"/>.</summary>
    public static WhatsNewAudience ToFlags(IEnumerable<string>? names) =>
        Map.Where(m => names?.Contains(m.Name) == true).Aggregate(WhatsNewAudience.None, (acc, m) => acc | m.Flag);

    public static IEnumerable<string> Unknown(IEnumerable<string>? names) => (names ?? Enumerable.Empty<string>()).Where(n => Map.All(m => m.Name != n)).Distinct();

    public static List<string> ToNames(WhatsNewAudience flags) => Map.Where(m => (flags & m.Flag) != 0).Select(m => m.Name).ToList();

    /// <summary>SuperAdmin sees every entry; anyone else sees the one flag for their JWT role; any other role sees none.</summary>
    public static WhatsNewAudience Of(ClaimsPrincipal user) =>
        user.IsInRole("SuperAdmin") ? WhatsNewAudience.All : Map.FirstOrDefault(m => user.IsInRole(m.Name)).Flag;
}
