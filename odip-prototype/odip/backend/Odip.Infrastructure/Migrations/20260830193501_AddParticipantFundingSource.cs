using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20260830193501_AddParticipantFundingSource")]
    public partial class AddParticipantFundingSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "FundingSource",
                table: "Participants",
                type: "integer",
                nullable: false,
                defaultValue: 0); // 0 = Ndis (ParticipantFundingSource) — matches the empty/null backfill case below

            // FUND-02 backfill: existing rows carrying free-text FundingOrganisation predate the
            // NDIS/Other distinction and were, by construction, "other than plain NDIS" funding
            // detail — flip those to Other (1). Rows already defaulted to Ndis (0) above are left
            // alone; this only needs to touch the non-empty case.
            migrationBuilder.Sql("""
                UPDATE "Participants"
                SET "FundingSource" = 1
                WHERE "FundingOrganisation" IS NOT NULL AND btrim("FundingOrganisation") <> '';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FundingSource",
                table: "Participants");
        }
    }
}
