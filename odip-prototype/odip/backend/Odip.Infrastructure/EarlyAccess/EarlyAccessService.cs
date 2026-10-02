using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using Odip.Application.EarlyAccess;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.EarlyAccess;

public enum EarlyAccessOutcome
{
    /// <summary>First time this address has asked: a new row was inserted.</summary>
    Created,

    /// <summary>The address is already on file: only LastRequestedAtUtc and RequestCount changed.</summary>
    Repeated,
}

public sealed record EarlyAccessRecordResult(EarlyAccessOutcome Outcome, int RequestCount, DateTime RequestedAtUtc);

/// <summary>
/// Stores one early-access request: inserts the address the first time, and on any later request from
/// the same (already normalised) address bumps <see cref="EarlyAccessRequest.LastRequestedAtUtc"/> and
/// <see cref="EarlyAccessRequest.RequestCount"/> — the stored name and organisation stay as first given,
/// so nobody can overwrite someone else's entry by submitting their address again.
///
/// Two simultaneous requests for the same address are the interesting case, and EF InMemory cannot show
/// either failure mode (it enforces neither the unique index nor row versions): both may see "no row" and
/// insert (the loser hits the unique index — Postgres 23505), or both may read count N and write N+1
/// (the loser's UPDATE matches nothing because RequestCount is a concurrency token). Either way the loser
/// discards its pending change and starts again against the row that now exists, so the final count is
/// exact and the request still succeeds.
/// </summary>
public sealed class EarlyAccessService
{
    private const int MaxAttempts = 10;

    private readonly OdipDbContext _db;
    private readonly ILogger<EarlyAccessService> _logger;

    public EarlyAccessService(OdipDbContext db, ILogger<EarlyAccessService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <param name="email">Already trimmed and lower-cased (see <see cref="EarlyAccessRequestValidator"/>).</param>
    public async Task<EarlyAccessRecordResult> RecordAsync(
        string name, string organisation, string email, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            var now = DateTime.UtcNow;

            // The DbSet has no query filter, so this sees every row whatever tenant context the request carries.
            var existing = await _db.EarlyAccessRequests.SingleOrDefaultAsync(e => e.Email == email, ct);

            if (existing is null)
            {
                _db.EarlyAccessRequests.Add(new EarlyAccessRequest
                {
                    Id = Guid.NewGuid(),
                    Name = name,
                    Organisation = organisation,
                    Email = email,
                    CreatedAtUtc = now,
                    LastRequestedAtUtc = now,
                    RequestCount = 1,
                });
            }
            else
            {
                existing.LastRequestedAtUtc = now;
                existing.RequestCount += 1;
            }

            try
            {
                // Deliberately NOT ct: the write is short and bounded, and once started it must not be abandoned
                // by a visitor closing the tab. A cancelled call can still commit on the server; the row would then
                // exist with no notification sent, and the visitor's retry would be counted as a silent repeat.
                await _db.SaveChangesAsync(CancellationToken.None);
            }
            catch (Exception ex) when (attempt < MaxAttempts && IsLostRace(ex))
            {
                _logger.LogDebug(ex, "Early-access request for {Email} raced another request (attempt {Attempt}); retrying",
                    EmailMasking.Mask(email), attempt);
                _db.ChangeTracker.Clear();
                continue;
            }

            if (existing is null)
                return new EarlyAccessRecordResult(EarlyAccessOutcome.Created, 1, now);

            _logger.LogInformation(
                "Early-access request from {Email} repeated (request {RequestCount}); no notification re-sent",
                EmailMasking.Mask(email), existing.RequestCount);
            return new EarlyAccessRecordResult(EarlyAccessOutcome.Repeated, existing.RequestCount, now);
        }
    }

    private static bool IsLostRace(Exception ex) =>
        ex is DbUpdateConcurrencyException
        || ex is DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } };
}
