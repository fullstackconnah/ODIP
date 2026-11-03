using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCompatibilityRank : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Rank",
                table: "StaffParticipantCompatibilities",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Preferred rows only (explicit Allowed rows stay unlisted, Excluded is untouched): the participant's own pick first, then the oldest edit, then Id,
            // so the order is deterministic and per participant. Backup and Emergency start empty.
            migrationBuilder.Sql("""
                UPDATE "StaffParticipantCompatibilities" AS c
                SET "Rank" = r.rn
                FROM (
                    SELECT c2."Id" AS id,
                           ROW_NUMBER() OVER (
                               PARTITION BY c2."TenantId", c2."ParticipantId"
                               ORDER BY (c2."UserId" = p."PreferredUserId") DESC NULLS LAST, c2."UpdatedAt", c2."Id") AS rn
                    FROM "StaffParticipantCompatibilities" c2
                    JOIN "Participants" p ON p."Id" = c2."ParticipantId"
                    WHERE c2."Level" = 0
                ) AS r
                WHERE c."Id" = r.id;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Level 3 (Backup) and 4 (Emergency) do not exist in the older model: back to Allowed (1), the sparse default.
            migrationBuilder.Sql("""UPDATE "StaffParticipantCompatibilities" SET "Level" = 1 WHERE "Level" IN (3, 4);""");

            migrationBuilder.DropColumn(
                name: "Rank",
                table: "StaffParticipantCompatibilities");
        }
    }
}
