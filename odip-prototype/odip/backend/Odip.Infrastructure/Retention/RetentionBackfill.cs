namespace Odip.Infrastructure.Retention;

/// <summary>
/// The one-off statement that gives every participant archived before the retention clock existed a start date. The migration runs it, and a PostgreSQL fact runs it directly.
/// The start is the date of the latest audit row that turned IsActive off (the interceptor writes <c>[{"Field":"IsActive","Old":"True","New":"False"}]</c>), else the last edit.
/// Either way the date is an estimate, so <c>RetentionStartEstimated</c> is set and the Admin sees it. Drafts are left alone (an archived draft is not a record yet).
/// </summary>
public static class RetentionBackfill
{
    public const string Sql = """
        UPDATE "Participants" p
        SET "RetentionStartsOn" = COALESCE(
                (SELECT MAX(a."ChangedAt")::date FROM "AuditLogs" a
                  WHERE a."EntityType" = 'Participant' AND a."EntityId" = p."Id"
                    AND a."Changes"::jsonb @> '[{"Field":"IsActive","New":"False"}]'::jsonb),
                p."UpdatedAt"::date),
            "RetentionStartEstimated" = TRUE
        WHERE p."IsActive" = FALSE AND p."IsDraft" = FALSE AND p."RetentionStartsOn" IS NULL;
        """;
}
