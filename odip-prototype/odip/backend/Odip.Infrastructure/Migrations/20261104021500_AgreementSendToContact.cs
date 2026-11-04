using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AgreementSendToContact : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Expand-only: a new table and three nullable approval columns (who agreed and how), so a rollback to the previous image just ignores them.
            migrationBuilder.AddColumn<string>(
                name: "AgreedByName",
                table: "ServiceAgreementDraftApprovals",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AgreedByPersonId",
                table: "ServiceAgreementDraftApprovals",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AgreedHow",
                table: "ServiceAgreementDraftApprovals",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ServiceAgreementShares",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    DraftId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    RecipientPersonId = table.Column<Guid>(type: "uuid", nullable: true),
                    RecipientName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    RecipientEmail = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    SentByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    SentByName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    SentAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    OpenedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    SendError = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceAgreementShares", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceAgreementShares_ServiceAgreementDrafts_DraftId",
                        column: x => x.DraftId,
                        principalTable: "ServiceAgreementDrafts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceAgreementShares_DraftId",
                table: "ServiceAgreementShares",
                column: "DraftId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceAgreementShares_TenantId_DraftId_SentAt",
                table: "ServiceAgreementShares",
                columns: new[] { "TenantId", "DraftId", "SentAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceAgreementShares_TokenHash",
                table: "ServiceAgreementShares",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ServiceAgreementShares");

            migrationBuilder.DropColumn(
                name: "AgreedByName",
                table: "ServiceAgreementDraftApprovals");

            migrationBuilder.DropColumn(
                name: "AgreedByPersonId",
                table: "ServiceAgreementDraftApprovals");

            migrationBuilder.DropColumn(
                name: "AgreedHow",
                table: "ServiceAgreementDraftApprovals");
        }
    }
}
