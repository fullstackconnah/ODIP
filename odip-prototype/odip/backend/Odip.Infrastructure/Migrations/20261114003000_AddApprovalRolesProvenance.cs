using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddApprovalRolesProvenance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApprovedByRoles",
                table: "ServiceAgreementDraftApprovals",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ApproverRolesInForce",
                table: "ServiceAgreementDraftApprovals",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ApprovedByRoles",
                table: "ServiceAgreementDraftApprovals");

            migrationBuilder.DropColumn(
                name: "ApproverRolesInForce",
                table: "ServiceAgreementDraftApprovals");
        }
    }
}
