using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantMobilityOvernightEquipment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── New columns ──────────────────────────────────────────
            migrationBuilder.AddColumn<bool>(
                name: "MobilityAidWheelchair",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "MobilityAidWalker",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<List<string>>(
                name: "MobilitySupportOptions",
                table: "Participants",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'");

            migrationBuilder.AddColumn<int>(
                name: "OvernightSupport",
                table: "Participants",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "OvernightRatio",
                table: "Participants",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "RequiresHiLoBed",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "RequiresHoist",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "RequiresShowerChair",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "RequiresCommode",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "RequiresStandingMachine",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // ── Data preservation ────────────────────────────────────
            // Carry the old WheelchairRequired flag straight across to the new
            // MobilityAidWheelchair flag — same meaning, just renamed as part of the
            // multi-select mobility-aid model.
            migrationBuilder.Sql(
                """UPDATE "Participants" SET "MobilityAidWheelchair" = "WheelchairRequired";""");

            // The old RequiresOvernightSupport boolean carried no detail about what kind
            // of overnight support was needed. We cannot recover that detail, so as a
            // documented best-guess default we map "true" to OvernightSupportType.Sleepover
            // (3) — the most common overnight support type in this domain. This should be
            // reviewed/corrected per-participant after migration.
            migrationBuilder.Sql(
                """UPDATE "Participants" SET "OvernightSupport" = 3 WHERE "RequiresOvernightSupport" = true;""");

            // OvernightRatio defaults to 0 (SupportRatio.OneToOne) for all existing rows —
            // already guaranteed by the defaultValue: 0 on the AddColumn call above.

            // ── Drop old columns ─────────────────────────────────────
            migrationBuilder.DropColumn(
                name: "WheelchairRequired",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "RequiresOvernightSupport",
                table: "Participants");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "WheelchairRequired",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "RequiresOvernightSupport",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql(
                """UPDATE "Participants" SET "WheelchairRequired" = "MobilityAidWheelchair";""");

            migrationBuilder.Sql(
                """UPDATE "Participants" SET "RequiresOvernightSupport" = ("OvernightSupport" <> 0);""");

            migrationBuilder.DropColumn(
                name: "MobilityAidWheelchair",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MobilityAidWalker",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MobilitySupportOptions",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "OvernightSupport",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "OvernightRatio",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "RequiresHiLoBed",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "RequiresHoist",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "RequiresShowerChair",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "RequiresCommode",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "RequiresStandingMachine",
                table: "Participants");
        }
    }
}
