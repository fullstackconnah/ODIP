namespace Odip.Application.Common;

/// <summary>
/// Shared paging clamp used by list endpoints across controllers. Extracted from the
/// copy-pasted `page = Math.Max(page, 1); pageSize = Math.Clamp(pageSize, 1, N);` pair that
/// previously lived inline in each controller action.
/// </summary>
public static class PagingParams
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;

    /// <summary>
    /// House convention: page defaults to/floors at 1; pageSize clamps into [1, maxPageSize].
    /// Deliberately NOT called from PagedResult&lt;T&gt;.CreateAsync — Rostering's
    /// GetCompletions builds a PagedResult manually from an in-memory-sorted list (derived sort
    /// key, not SQL-translatable) without ever calling CreateAsync, so baking the clamp into
    /// CreateAsync would leave that call site unprotected while looking covered. Every action
    /// calls this explicitly, for both idioms, same as today's copy-pasted lines.
    /// </summary>
    public static (int Page, int PageSize) Clamp(int page, int pageSize, int maxPageSize = MaxPageSize) =>
        (Math.Max(page, 1), Math.Clamp(pageSize, 1, maxPageSize));
}
