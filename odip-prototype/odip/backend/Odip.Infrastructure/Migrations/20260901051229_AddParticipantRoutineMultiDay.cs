using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantRoutineMultiDay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add the new column first, defaulting new/un-migrated rows to "every day" (127 = all
            // 7 bits) — the same meaning the old DayOfWeek == null represented. The UPDATE below
            // then overwrites this default for every existing row based on its old DayOfWeek
            // value, so the default only matters for the brief window before that runs (and as
            // documentation of "every day" as the sane default for this NOT NULL column).
            migrationBuilder.AddColumn<int>(
                name: "Days",
                table: "ParticipantRoutines",
                type: "integer",
                nullable: false,
                defaultValue: 127);

            // Data migration (PD-4): must run while the old DayOfWeek column still exists.
            // Bit positions are Monday-first (bit0=Monday ... bit6=Sunday) to match the
            // frontend's existing Monday-first WEEKDAYS order — NOT .NET's DayOfWeek wire order
            // (Sunday=0), hence the explicit CASE rather than a formula. NULL (every day)
            // maps to 127 (All, every bit set). See ParticipantRoutineDayMapper.ConvertLegacyDayOfWeek,
            // which is the unit-tested source of truth this SQL mirrors.
            migrationBuilder.Sql(
                """
                UPDATE "ParticipantRoutines"
                SET "Days" = CASE "DayOfWeek"
                    WHEN 1 THEN 1    -- Monday    -> bit0
                    WHEN 2 THEN 2    -- Tuesday   -> bit1
                    WHEN 3 THEN 4    -- Wednesday -> bit2
                    WHEN 4 THEN 8    -- Thursday  -> bit3
                    WHEN 5 THEN 16   -- Friday    -> bit4
                    WHEN 6 THEN 32   -- Saturday  -> bit5
                    WHEN 0 THEN 64   -- Sunday    -> bit6
                    ELSE 127         -- NULL -> every day
                END;
                """);

            migrationBuilder.DropColumn(
                name: "DayOfWeek",
                table: "ParticipantRoutines");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DayOfWeek",
                table: "ParticipantRoutines",
                type: "integer",
                nullable: true);

            // Reverse of the Up() data migration, for the single-day/every-day cases that map
            // back losslessly. A genuine multi-day-but-not-every-day set (e.g. Mon/Wed/Fri) has
            // no equivalent in the old single-DayOfWeek-or-null schema; on rollback it falls back
            // to NULL ("every day") — the closest available representation, and the same
            // direction the original schema's "every day" sentinel already pointed in.
            migrationBuilder.Sql(
                """
                UPDATE "ParticipantRoutines"
                SET "DayOfWeek" = CASE "Days"
                    WHEN 1 THEN 1    -- bit0 Monday    -> Monday
                    WHEN 2 THEN 2    -- bit1 Tuesday   -> Tuesday
                    WHEN 4 THEN 3    -- bit2 Wednesday -> Wednesday
                    WHEN 8 THEN 4    -- bit3 Thursday  -> Thursday
                    WHEN 16 THEN 5   -- bit4 Friday    -> Friday
                    WHEN 32 THEN 6   -- bit5 Saturday  -> Saturday
                    WHEN 64 THEN 0   -- bit6 Sunday    -> Sunday
                    WHEN 127 THEN NULL -- All -> every day
                    ELSE NULL        -- any other multi-day set -> every day (lossy, best available)
                END;
                """);

            migrationBuilder.DropColumn(
                name: "Days",
                table: "ParticipantRoutines");
        }
    }
}
