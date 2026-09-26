using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace Odip.Infrastructure.Migrations;

[Migration("20260926003000_AddElectronicSigningEvidence")]
public partial class AddElectronicSigningEvidence : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(name: "ElectronicSigningSnapshots", columns: table => new
        {
            Id = table.Column<Guid>(type: "uuid", nullable: false), TenantId = table.Column<Guid>(type: "uuid", nullable: false), ParticipantId = table.Column<Guid>(type: "uuid", nullable: false), DraftId = table.Column<Guid>(type: "uuid", nullable: false), DraftVersion = table.Column<int>(type: "integer", nullable: false), DocumentJson = table.Column<string>(type: "text", nullable: false), DocumentHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false), CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
        }, constraints: table => table.PrimaryKey("PK_ElectronicSigningSnapshots", x => x.Id));
        migrationBuilder.CreateTable(name: "ElectronicSigningEvidence", columns: table => new
        {
            Id = table.Column<Guid>(type: "uuid", nullable: false), TenantId = table.Column<Guid>(type: "uuid", nullable: false), SnapshotId = table.Column<Guid>(type: "uuid", nullable: false), IdempotencyKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false), SignerName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false), SignerCapacity = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false), IsAuthorisedRepresentative = table.Column<bool>(type: "boolean", nullable: false), ConsentToElectronicMethod = table.Column<bool>(type: "boolean", nullable: false), IntendsToSign = table.Column<bool>(type: "boolean", nullable: false), DocumentWasDisplayed = table.Column<bool>(type: "boolean", nullable: false), EvidenceHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false), PreviousEvidenceHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false), CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false), Status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
        }, constraints: table => { table.PrimaryKey("PK_ElectronicSigningEvidence", x => x.Id); table.ForeignKey("FK_ElectronicSigningEvidence_ElectronicSigningSnapshots_SnapshotId", x => x.SnapshotId, "ElectronicSigningSnapshots", "Id", onDelete: ReferentialAction.Restrict); });
        migrationBuilder.CreateIndex(name: "IX_ElectronicSigningSnapshots_TenantId_DraftId_DraftVersion", table: "ElectronicSigningSnapshots", columns: new[] { "TenantId", "DraftId", "DraftVersion" }, unique: true);
        migrationBuilder.CreateIndex(name: "IX_ElectronicSigningEvidence_SnapshotId_IdempotencyKey", table: "ElectronicSigningEvidence", columns: new[] { "SnapshotId", "IdempotencyKey" }, unique: true);
    }
    protected override void Down(MigrationBuilder migrationBuilder) { migrationBuilder.DropTable(name: "ElectronicSigningEvidence"); migrationBuilder.DropTable(name: "ElectronicSigningSnapshots"); }
}
