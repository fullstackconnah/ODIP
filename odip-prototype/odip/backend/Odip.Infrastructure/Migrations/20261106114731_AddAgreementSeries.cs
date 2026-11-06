using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAgreementSeries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ServiceAgreementDrafts_TenantId_ParticipantId_Version",
                table: "ServiceAgreementDrafts");

            // Added empty, filled, then made required: every participant's revisions so far are ONE agreement, whose id is the participant's own.
            migrationBuilder.AddColumn<Guid>(name: "AgreementId", table: "ServiceAgreementDrafts", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<int>(name: "AgreementKind", table: "ServiceAgreementDrafts", type: "integer", nullable: false, defaultValue: 0);
            migrationBuilder.AddColumn<string>(name: "AgreementName", table: "ServiceAgreementDrafts", type: "character varying(80)", maxLength: 80, nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "AgreementId", table: "ServiceAgreementDraftApprovals", type: "uuid", nullable: true);

            migrationBuilder.Sql(@"UPDATE ""ServiceAgreementDrafts"" SET ""AgreementId"" = ""ParticipantId"";");
            migrationBuilder.Sql(@"UPDATE ""ServiceAgreementDraftApprovals"" a SET ""AgreementId"" = d.""AgreementId"" FROM ""ServiceAgreementDrafts"" d WHERE d.""Id"" = a.""DraftId"";");
            migrationBuilder.Sql(@"UPDATE ""ServiceAgreementDraftApprovals"" SET ""AgreementId"" = ""ParticipantId"" WHERE ""AgreementId"" IS NULL;");

            migrationBuilder.AlterColumn<Guid>(name: "AgreementId", table: "ServiceAgreementDrafts", type: "uuid", nullable: false, oldClrType: typeof(Guid), oldType: "uuid", oldNullable: true);
            migrationBuilder.AlterColumn<Guid>(name: "AgreementId", table: "ServiceAgreementDraftApprovals", type: "uuid", nullable: false, oldClrType: typeof(Guid), oldType: "uuid", oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ServiceAgreementDrafts_Tenant_Participant_Agreement_Version",
                table: "ServiceAgreementDrafts",
                columns: new[] { "TenantId", "ParticipantId", "AgreementId", "Version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Fails once a participant has two agreements at the same version number: the old index allows one revision per number for a participant.
            migrationBuilder.DropIndex(
                name: "IX_ServiceAgreementDrafts_Tenant_Participant_Agreement_Version",
                table: "ServiceAgreementDrafts");

            migrationBuilder.DropColumn(name: "AgreementId", table: "ServiceAgreementDrafts");
            migrationBuilder.DropColumn(name: "AgreementKind", table: "ServiceAgreementDrafts");
            migrationBuilder.DropColumn(name: "AgreementName", table: "ServiceAgreementDrafts");
            migrationBuilder.DropColumn(name: "AgreementId", table: "ServiceAgreementDraftApprovals");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceAgreementDrafts_TenantId_ParticipantId_Version",
                table: "ServiceAgreementDrafts",
                columns: new[] { "TenantId", "ParticipantId", "Version" },
                unique: true);
        }
    }
}
