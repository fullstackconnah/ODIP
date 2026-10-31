using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Application.Common;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>The NDIA claim files: the hub of lines ready to send, building a file, confirming it was uploaded, importing the NDIA's results, marking lines paid.</summary>
[ApiController]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
[Route("api/v1")]
public class ClaimBatchesController(ClaimBatchService batches, ICurrentTenant tenant) : ControllerBase
{
    private const int MaxResultsBytes = 6 * 1024 * 1024;

    /// <summary>A person with no organisation chosen (a SuperAdmin not viewing as one) has no claims to send.</summary>
    private IActionResult? NoTenant() => tenant.TenantId is null ? BadRequest(ApiResponse<bool>.Fail("Choose an organisation first.")) : null;

    /// <summary>A result as the API's envelope. A refusal carries its problems in data, whatever the success type is.</summary>
    private IActionResult Reply<T>(BatchResult<T> result)
    {
        if (result.Ok) return Ok(ApiResponse<T>.Ok(result.Value!));
        var body = new ApiResponse<object> { Success = false, Errors = result.Errors ?? [], Data = result.Data };
        return result.Status == 404 ? NotFound(body) : StatusCode(result.Status, body);
    }

    private IActionResult FileReply(BatchResult<BuiltFile> result)
    {
        if (!result.Ok) return Reply(result);
        Response.Headers["X-Claim-Batch-Id"] = result.Value!.BatchId.ToString();
        return File(result.Value.Content, "text/csv", result.Value.FileName);
    }

    // GET /api/v1/claim-batches
    [HttpGet("claim-batches")]
    public async Task<IActionResult> List(CancellationToken ct) =>
        NoTenant() ?? Ok(ApiResponse<List<BatchDto>>.Ok(await batches.BatchesAsync(tenant.TenantId!.Value, null, ClaimBatchService.ListCap, ct)));

    // GET /api/v1/claim-batches/{id}
    [HttpGet("claim-batches/{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct) =>
        NoTenant() ?? Reply(await batches.DetailAsync(tenant.TenantId!.Value, id, ct));

    // GET /api/v1/claim-batches/{id}/file
    [HttpGet("claim-batches/{id:guid}/file")]
    public async Task<IActionResult> GetFile(Guid id, CancellationToken ct) =>
        NoTenant() ?? FileReply(await batches.FileAsync(tenant.TenantId!.Value, id, ct));

    // POST /api/v1/claim-batches
    [HttpPost("claim-batches")]
    public async Task<IActionResult> Build([FromBody] BuildBatchDto? dto, CancellationToken ct) =>
        NoTenant() ?? Reply(await batches.BuildAsync(tenant.TenantId!.Value, User,
            new BuildRequest(dto?.LineIds ?? [], dto?.ClaimIds ?? [], dto?.ConfirmedLineIds ?? []), ct));

    // POST /api/v1/claim-batches/{id}/discard
    [HttpPost("claim-batches/{id:guid}/discard")]
    public async Task<IActionResult> Discard(Guid id, CancellationToken ct) =>
        NoTenant() ?? Reply(await batches.DiscardAsync(tenant.TenantId!.Value, User, id, ct));

    // POST /api/v1/claim-batches/{id}/uploaded
    [HttpPost("claim-batches/{id:guid}/uploaded")]
    public async Task<IActionResult> Uploaded(Guid id, CancellationToken ct) =>
        NoTenant() ?? Reply(await batches.ConfirmUploadedAsync(tenant.TenantId!.Value, User, id, ct));

    // POST /api/v1/claim-batches/{id}/results (multipart, field "file")
    [HttpPost("claim-batches/{id:guid}/results")]
    [RequestSizeLimit(MaxResultsBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxResultsBytes, MemoryBufferThreshold = MaxResultsBytes)]
    public async Task<IActionResult> Results(Guid id, IFormFile? file, CancellationToken ct)
    {
        if (NoTenant() is { } none) return none;
        if (file is null || file.Length == 0) return BadRequest(ApiResponse<bool>.Fail("Choose the results file to upload."));
        using var memory = new MemoryStream();
        await file.CopyToAsync(memory, ct);
        return Reply(await batches.ImportResultsAsync(tenant.TenantId!.Value, User, id, memory.ToArray(), ct));
    }

    // POST /api/v1/claim-batches/{id}/paid
    [HttpPost("claim-batches/{id:guid}/paid")]
    public async Task<IActionResult> Paid(Guid id, [FromBody] MarkPaidDto? dto, CancellationToken ct) =>
        NoTenant() ?? Reply(await batches.MarkPaidAsync(tenant.TenantId!.Value, User, id, dto?.Lines ?? [], ct));

    // POST /api/v1/claim-batch-lines/{batchLineId}/dismiss
    [HttpPost("claim-batch-lines/{batchLineId:guid}/dismiss")]
    public async Task<IActionResult> Dismiss(Guid batchLineId, CancellationToken ct) =>
        NoTenant() ?? Reply(await batches.DismissAsync(tenant.TenantId!.Value, User, batchLineId, ct));

    // GET /api/v1/claim-hub/lines
    [HttpGet("claim-hub/lines")]
    public async Task<IActionResult> Hub(CancellationToken ct) =>
        NoTenant() ?? Ok(ApiResponse<HubLinesDto>.Ok(await batches.HubAsync(tenant.TenantId!.Value, ct)));
}

public sealed record BuildBatchDto(List<Guid>? LineIds, List<Guid>? ClaimIds, List<Guid>? ConfirmedLineIds);

public sealed record MarkPaidDto(List<PaidLineRequest>? Lines);
