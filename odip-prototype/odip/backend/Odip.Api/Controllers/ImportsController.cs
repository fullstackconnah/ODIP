using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Settings → Import data. An organisation's Admin, or a SuperAdmin viewing as the organisation (the service refuses an unscoped one), previews
/// and imports a .csv or .xlsx export, undoes a batch, reads the history and downloads the template. The upload is read into memory and never
/// written to disk.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin,SuperAdmin")]
[Route("api/v1/imports")]
public class ImportsController : ControllerBase
{
    /// <summary>The 5 MB file plus the form around it. The 5 MB rule itself, with its message, is ImportFileReader's.</summary>
    private const int MaxRequestBytes = 6 * 1024 * 1024;
    private const int MaxInvitesPerRequest = 100;
    private const string Mismatch = "The column matches don't fit this file. Upload it again.";

    private readonly OnboardingImportService _imports;
    private readonly IFirebaseUserService _firebase;
    private readonly IConfiguration? _config;
    private readonly ILogger<ImportsController>? _logger;

    // IFirebaseUserService is deliberately not registered in DI (see StaffController): ActivatorUtilities falls back to the default, a test injects a mock.
    public ImportsController(OnboardingImportService imports, IFirebaseUserService? firebaseUserService = null, IConfiguration? config = null,
        ILogger<ImportsController>? logger = null)
    {
        _imports = imports;
        _firebase = firebaseUserService ?? new FirebaseUserService();
        _config = config;
        _logger = logger;
    }

    private static ImportShiftShape? ParseShape(string? shape) =>
        Enum.TryParse<ImportShiftShape>(shape, ignoreCase: true, out var parsed) && Enum.IsDefined(parsed) ? parsed : null;

    private static ImportShiftOptions? ShiftOptions(string? shape, string? from, int? weeks) =>
        ParseShape(shape) is { } s ? new ImportShiftOptions(s, DateOnly.TryParseExact(from, "yyyy-MM-dd", out var day) ? day : null, weeks) : null;

    private static ImportKind? Kind(string kind) => kind switch
    {
        "participants" => ImportKind.Participants,
        "staff" => ImportKind.Staff,
        "funding-plans" => ImportKind.FundingPlans,
        "upcoming-shifts" => ImportKind.UpcomingShifts,
        _ => null,
    };

    [HttpGet]
    public Task<ActionResult<ApiResponse<List<ImportBatchDto>>>> History(CancellationToken ct) => Run(() => _imports.HistoryAsync(ct));

    [HttpGet("{kind}/template")]
    public IActionResult Template(string kind, [FromQuery] string? shape) =>
        Kind(kind) is { } k
            ? File(ImportTemplate.Build(k, ParseShape(shape) ?? ImportShiftShape.Pattern), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ImportTemplate.FileName(k, ParseShape(shape) ?? ImportShiftShape.Pattern))
            : NotFound(ApiResponse<bool>.Fail("Unknown import type."));

    [HttpPost("{kind}/preview")]
    [RequestSizeLimit(MaxRequestBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxRequestBytes, MemoryBufferThreshold = MaxRequestBytes)]
    public async Task<ActionResult<ApiResponse<ImportPreviewDto>>> Preview(string kind, IFormFile? file, [FromForm] string? mapping, [FromForm] string? shape, [FromForm] string? from, [FromForm] int? weeks, CancellationToken ct)
    {
        if (Kind(kind) is not { } k) return NotFound(ApiResponse<ImportPreviewDto>.Fail("Unknown import type."));
        return await Run(async () => await _imports.PreviewAsync(k, await ReadAsync(file, ct), file!.FileName, ParseMapping(mapping), ct, User, ShiftOptions(shape, from, weeks)));
    }

    [HttpPost("{kind}/commit")]
    [RequestSizeLimit(MaxRequestBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxRequestBytes, MemoryBufferThreshold = MaxRequestBytes)]
    public async Task<ActionResult<ApiResponse<ImportResultDto>>> Commit(string kind, IFormFile? file, [FromForm] string? mapping,
        [FromForm] string? landing, [FromForm] string? idempotencyKey, [FromForm] string? shape, [FromForm] string? from, [FromForm] int? weeks, CancellationToken ct)
    {
        if (Kind(kind) is not { } k) return NotFound(ApiResponse<ImportResultDto>.Fail("Unknown import type."));
        ImportLanding? where = Enum.TryParse<ImportLanding>(landing, ignoreCase: true, out var parsed) && Enum.IsDefined(parsed) ? parsed : null;
        return await Run(async () => await _imports.CommitAsync(k, await ReadAsync(file, ct), file!.FileName, ParseMapping(mapping), where, idempotencyKey ?? "", User, ct, ShiftOptions(shape, from, weeks)));
    }

    [HttpPost("{batchId:guid}/undo")]
    public async Task<ActionResult<ApiResponse<ImportBatchDto>>> Undo(Guid batchId, CancellationToken ct)
    {
        ImportUndoOutcome outcome;
        try { outcome = await _imports.UndoAsync(batchId, User, ct); }
        catch (ImportException ex) { return StatusCode(ex.StatusCode, ApiResponse<ImportBatchDto>.Fail(ex.Message)); }

        if (outcome.NotFound) return NotFound(ApiResponse<ImportBatchDto>.Fail("Import not found."));
        if (outcome.Blockers.Count > 0)
        {
            var n = outcome.Blockers.Count;
            return Conflict(ApiResponse<List<ImportUndoBlockerDto>>.Fail(outcome.Blockers,
                [$"Nothing was undone: {n} {(n == 1 ? "record has" : "records have")} changed since the import."]));
        }
        return Ok(ApiResponse<ImportBatchDto>.Ok(outcome.Batch!));
    }

    /// <summary>
    /// Makes sure each never-signed-in staff member of a staff import has a sign-in account, one by one through the staff route's own step, and
    /// says per person what happened. The browser then sends each set-password email, as the Staff page does.
    /// </summary>
    [HttpPost("{batchId:guid}/invites")]
    public async Task<ActionResult<ApiResponse<ImportInvitesDto>>> Invites(Guid batchId, [FromQuery] Guid? after, CancellationToken ct)
    {
        List<User>? staff;
        try { staff = await _imports.StaffToInviteAsync(batchId, ct); }
        catch (ImportException ex) { return StatusCode(ex.StatusCode, ApiResponse<ImportInvitesDto>.Fail(ex.Message)); }
        if (staff is null) return NotFound(ApiResponse<ImportInvitesDto>.Fail("Staff import not found."));

        // At most 100 per request, so one press stays well inside the proxy's 180 s. The browser sends again with the last id done: a keyset
        // cursor over the id order, so someone signing in between presses neither shifts nor hides anyone still to invite.
        var rest = after is { } last ? staff.Where(s => s.Id.CompareTo(last) > 0).ToList() : staff;
        var page = rest.Take(MaxInvitesPerRequest).ToList();
        var invites = new List<ImportInviteDto>(page.Count);
        foreach (var s in page)
        {
            // A dropped request (nginx's timeout, a closed tab) stops here rather than failing every remaining person.
            ct.ThrowIfCancellationRequested();
            var outcome = await SignInAccounts.EnsureAsync(s, User, _config, _firebase, _logger, ct);
            invites.Add(new ImportInviteDto(s.Id, s.FullName, s.Email, outcome.Account?.FirebaseAccount, outcome.Error));
        }
        return Ok(ApiResponse<ImportInvitesDto>.Ok(new ImportInvitesDto(invites, rest.Count - page.Count, page.Count > 0 ? page[^1].Id : after)));
    }

    /// <summary>Runs an import call; a refusal the Admin can act on answers with its own status and message.</summary>
    private async Task<ActionResult<ApiResponse<T>>> Run<T>(Func<Task<T>> call)
    {
        try { return Ok(ApiResponse<T>.Ok(await call())); }
        catch (ImportException ex) { return StatusCode(ex.StatusCode, ApiResponse<T>.Fail(ex.Message)); }
    }

    private static async Task<byte[]> ReadAsync(IFormFile? file, CancellationToken ct)
    {
        if (file is null) throw new ImportException("Choose a .csv or .xlsx file to upload.");
        using var memory = new MemoryStream();
        await file.CopyToAsync(memory, ct);
        return memory.ToArray();
    }

    private static List<string?>? ParseMapping(string? mapping)
    {
        if (string.IsNullOrWhiteSpace(mapping)) return null;
        try { return JsonSerializer.Deserialize<List<string?>>(mapping) ?? throw new ImportException(Mismatch); }
        catch (JsonException) { throw new ImportException(Mismatch); }
    }
}
