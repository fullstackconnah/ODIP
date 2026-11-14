using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261102152731_AddServiceAgreementDraftIsOngoing")]
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
