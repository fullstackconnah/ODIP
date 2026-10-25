namespace Odip.Infrastructure.Data;

/// <summary>The name of the tenant query filter: <c>HasQueryFilter(TenantFilter.Name, ...)</c> declares it and <c>IgnoreQueryFilters([TenantFilter.Name])</c> bypasses only it.</summary>
public static class TenantFilter
{
    public const string Name = "Tenant";
}
