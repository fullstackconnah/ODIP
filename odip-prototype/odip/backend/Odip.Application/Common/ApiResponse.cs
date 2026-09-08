namespace Odip.Application.Common;

/// <summary>
/// Standard API response envelope wrapping all API responses.
/// </summary>
public class ApiResponse<T>
{
    public bool Success { get; set; }
    public T? Data { get; set; }
    public string? Message { get; set; }
    public List<string>? Errors { get; set; }
    public string? Code { get; set; }

    public static ApiResponse<T> Ok(T data, string? message = null) =>
        new() { Success = true, Data = data, Message = message };

    public static ApiResponse<T> Fail(string error) =>
        new() { Success = false, Errors = new List<string> { error } };

    /// <summary>Machine-readable code for clients that branch on the failure kind — e.g. state-machine 409s. Human text stays in Errors.</summary>
    public static ApiResponse<T> Fail(string error, string code) =>
        new() { Success = false, Errors = new List<string> { error }, Code = code };

    public static ApiResponse<T> Fail(List<string> errors) =>
        new() { Success = false, Errors = errors };

    /// <summary>
    /// A failure that still carries a payload in <see cref="Data"/> — e.g. a rejected roster
    /// write returning its findings. Callers that read a successful response's data off the
    /// same <c>data</c> field (rather than a separate errors/findings field) need this on the
    /// 422/400 path too, so the envelope shape never changes between success and failure.
    /// </summary>
    public static ApiResponse<T> Fail(T data, List<string> errors, string? message = null) =>
        new() { Success = false, Data = data, Errors = errors, Message = message };
}

/// <summary>
/// Paged result for list endpoints.
/// </summary>
public class PagedResult<T>
{
    public List<T> Items { get; set; } = new();
    public int TotalCount { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalPages => (int)Math.Ceiling((double)TotalCount / PageSize);
    public bool HasNext => Page < TotalPages;
    public bool HasPrevious => Page > 1;

    public static async Task<PagedResult<T>> CreateAsync(
        IQueryable<T> query, int page, int pageSize, CancellationToken ct = default)
    {
        var totalCount = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.CountAsync(query, ct);
        var items = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToListAsync(
            query.Skip((page - 1) * pageSize).Take(pageSize), ct);
        return new PagedResult<T> { Items = items, TotalCount = totalCount, Page = page, PageSize = pageSize };
    }
}
