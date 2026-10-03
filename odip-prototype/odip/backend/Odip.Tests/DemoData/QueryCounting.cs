#pragma warning disable EF1001 // the query provider's own contract (IAsyncQueryProvider) and its internal base are the only way to see every query of an InMemory run
using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore.Query;
using Microsoft.EntityFrameworkCore.Query.Internal;

namespace Odip.Tests.DemoData;

/// <summary>
/// Counts the queries an EF context runs, which is what a database command count is made of for a read (EF InMemory sends no commands, so this is the
/// closest the local suite gets to the Postgres-backed T8 idle-tick budget). It decorates the real provider: every Execute and ExecuteAsync is one query.
/// Installed per test environment with <c>ReplaceService&lt;IAsyncQueryProvider, CountingQueryProvider&gt;()</c> (<c>new DemoTestEnv(..., countQueries: true)</c>);
/// the count is process-wide, so every test that reads it lives in one class (<see cref="DemoIdleTickTests"/>), whose tests xUnit runs one at a time.
/// </summary>
public sealed class CountingQueryProvider : IAsyncQueryProvider
{
    private static int _count;
    public static int Count => Volatile.Read(ref _count);
    public static void Reset() => Interlocked.Exchange(ref _count, 0);

    private readonly EntityQueryProvider _inner;

    public CountingQueryProvider(IQueryCompiler compiler) => _inner = new EntityQueryProvider(compiler);

    public IQueryable CreateQuery(Expression expression) => new EntityQueryable<object>(this, expression).AsUntyped(expression);

    public IQueryable<TElement> CreateQuery<TElement>(Expression expression) => new EntityQueryable<TElement>(this, expression);

    public object? Execute(Expression expression)
    {
        Interlocked.Increment(ref _count);
        return _inner.Execute(expression);
    }

    public TResult Execute<TResult>(Expression expression)
    {
        Interlocked.Increment(ref _count);
        return _inner.Execute<TResult>(expression);
    }

    public TResult ExecuteAsync<TResult>(Expression expression, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _count);
        return _inner.ExecuteAsync<TResult>(expression, cancellationToken);
    }
}

internal static class UntypedQueryable
{
    /// <summary>The non-generic CreateQuery is never used by the demo packs; it forwards to the generic one for the expression's own element type.</summary>
    public static IQueryable AsUntyped(this IQueryable<object> _, Expression expression)
    {
        var elementType = expression.Type.GetGenericArguments().FirstOrDefault() ?? typeof(object);
        return (IQueryable)Activator.CreateInstance(typeof(EntityQueryable<>).MakeGenericType(elementType), new object[] { _.Provider, expression })!;
    }
}
