using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceAgreementDraftIsOngoing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Existing revisions stay as they are (false): an Ongoing revision is one the save made with its end on the NDIS plan end.
            migrationBuilder.AddColumn<bool>(
                name: "IsOngoing",
                table: "ServiceAgreementDrafts",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsOngoing",
                table: "ServiceAgreementDrafts");
        }
    }
}
