using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;

namespace Odip.Infrastructure.Data;

/// <summary>Builds a <see cref="PagedResult{T}"/> from a query; lives here so Odip.Application needs no EF Core reference.</summary>
public static class PagedResults
{
    public static async Task<PagedResult<T>> CreateAsync<T>(
        IQueryable<T> query, int page, int pageSize, CancellationToken ct = default)
    {
        var totalCount = await query.CountAsync(ct);
        var items = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return new PagedResult<T> { Items = items, TotalCount = totalCount, Page = page, PageSize = pageSize };
    }
}
