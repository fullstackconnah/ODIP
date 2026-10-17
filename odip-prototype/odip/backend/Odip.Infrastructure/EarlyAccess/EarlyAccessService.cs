using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using Odip.Application.EarlyAccess;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.EarlyAccess;

public enum EarlyAccessOutcome
{
    /// <summary>First time this address has asked: a new row was inserted.</summary>
    Created,

    /// <summary>The address is already on file: only LastRequestedAtUtc and RequestCount changed (a later submission may have been added).</summary>
    Repeated,
}

/// <param name="Notice">What the operator should be told, or null for an identical repeat (nothing to tell).</param>
public sealed record EarlyAccessRecordResult(
    EarlyAccessOutcome Outcome, int RequestCount, DateTime RequestedAtUtc, EarlyAccessNoticeKind? Notice = null);

/// <summary>
/// Stores one early-access request: inserts the address the first time, and on any later request from
/// the same (already normalised) address bumps <see cref="EarlyAccessRequest.LastRequestedAtUtc"/> and
/// <see cref="EarlyAccessRequest.RequestCount"/>. The stored answers stay as first given, for good: anyone who knows an address can
/// post to it, so a repeat must not overwrite or erase them (a removal request in the message, say). A repeat whose answers differ is
/// stored as an <see cref="EarlyAccessLaterSubmission"/> (the first <see cref="MaxLaterSubmissions"/> per sign-up, then one over-limit row holding the first after that, which later repeats only count) for a person to read, which is how
/// the landing page's "send the form again and say so" promise to see, change or remove details is kept.
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

    // shortcut: the first 10 only, plus one over-limit row holding the first after that, so a flood cannot push out an early removal request or grow a sign-up without bound; raise it if a real person needs more.
    private const int MaxLaterSubmissions = 10;

    private readonly OdipDbContext _db;
    private readonly ILogger<EarlyAccessService> _logger;

    public EarlyAccessService(OdipDbContext db, ILogger<EarlyAccessService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <param name="request">A valid result of <see cref="EarlyAccessRequestValidator.Validate"/>: trimmed, the email lower-cased.</param>
    public async Task<EarlyAccessRecordResult> RecordAsync(EarlyAccessValidationResult request, CancellationToken ct)
    {
        if (!request.IsValid) throw new ArgumentException("Only a validated request can be stored.", nameof(request));
        var email = request.Email;

        for (var attempt = 1; ; attempt++)
        {
            var now = DateTime.UtcNow;

            // The DbSet has no query filter, so this sees every row whatever tenant context the request carries.
            var existing = await _db.EarlyAccessRequests.SingleOrDefaultAsync(e => e.Email == email, ct);
            EarlyAccessNoticeKind? notice = null;

            if (existing is null)
            {
                _db.EarlyAccessRequests.Add(new EarlyAccessRequest
                {
                    Id = Guid.NewGuid(),
                    Name = request.Name,
                    Organisation = request.Organisation,
                    Email = email,
                    Role = request.Role,
                    Phone = request.Phone,
                    OrganisationSize = request.OrganisationSize,
                    Message = request.Message,
                    CreatedAtUtc = now,
                    LastRequestedAtUtc = now,
                    RequestCount = 1,
                });
                notice = EarlyAccessNoticeKind.NewRequest;
            }
            else
            {
                existing.LastRequestedAtUtc = now;
                existing.RequestCount += 1;
                // The stored answers never change. A repeat that says something different is kept beside them, up to the cap. RequestCount
                // is a concurrency token and every repeat bumps it, so two simultaneous repeats cannot both pass the cap check.
                // An answer already on file, the original or any stored one, stores and tells no one, so duplicates cannot fill the cap.
                var stored = await _db.EarlyAccessLaterSubmissions
                    .Where(l => l.EarlyAccessRequestId == existing.Id).ToListAsync(ct);
                if (!SameAnswers(existing, request) && !stored.Any(l => SameAnswers(l, request)))
                {
                    var keptCount = stored.Count(l => !l.IsOverLimit);
                    var overLimit = keptCount >= MaxLaterSubmissions;
                    if (overLimit)
                    {
                        existing.OverLimitCount += 1;
                        existing.LastOverLimitAtUtc = now;
                    }
                    // Past the cap the FIRST repeat is stored, in the one over-limit row, so it survives a lost email notice and no later
                    // anonymous repeat can replace it (a removal request in it would be lost); further ones only count.
                    if (!overLimit || !stored.Any(l => l.IsOverLimit))
                        _db.EarlyAccessLaterSubmissions.Add(new EarlyAccessLaterSubmission
                        {
                            Id = Guid.NewGuid(), EarlyAccessRequestId = existing.Id, IsOverLimit = overLimit, ReceivedAtUtc = now,
                            Name = request.Name, Organisation = request.Organisation, Role = request.Role, Phone = request.Phone,
                            OrganisationSize = request.OrganisationSize, Message = request.Message,
                        });
                    notice = overLimit ? EarlyAccessNoticeKind.SentAgainOverLimit
                        : keptCount + 1 == MaxLaterSubmissions ? EarlyAccessNoticeKind.SentAgainLastKept : EarlyAccessNoticeKind.SentAgain;
                }
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
                return new EarlyAccessRecordResult(EarlyAccessOutcome.Created, 1, now, notice);

            _logger.LogInformation(
                "Early-access request from {Email} repeated (request {RequestCount}); {Outcome}",
                EmailMasking.Mask(email), existing.RequestCount,
                notice is null ? "same answers as one on file, no notice" : $"different answers, notice: {notice}");
            return new EarlyAccessRecordResult(EarlyAccessOutcome.Repeated, existing.RequestCount, now, notice);
        }
    }

    private static bool SameAnswers(EarlyAccessRequest stored, EarlyAccessValidationResult request) =>
        SameAnswers(stored.Name, stored.Organisation, stored.Role, stored.Phone, stored.OrganisationSize, stored.Message, request);

    private static bool SameAnswers(EarlyAccessLaterSubmission stored, EarlyAccessValidationResult request) =>
        SameAnswers(stored.Name, stored.Organisation, stored.Role, stored.Phone, stored.OrganisationSize, stored.Message, request);

    private static bool SameAnswers(
        string name, string organisation, string? role, string? phone, string? size, string? message, EarlyAccessValidationResult request) =>
        name == request.Name && organisation == request.Organisation && role == request.Role
        && phone == request.Phone && size == request.OrganisationSize && message == request.Message;

    private static bool IsLostRace(Exception ex) =>
        ex is DbUpdateConcurrencyException
        || ex is DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation or PostgresErrorCodes.ForeignKeyViolation } };
}
