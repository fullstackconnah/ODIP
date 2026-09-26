using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable
namespace Odip.Infrastructure.Migrations;
[DbContext(typeof(OdipDbContext))]
[Migration("20260926001000_AddParticipantIntakeSnapshots")]
public partial class AddParticipantIntakeSnapshots : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(name: "ParticipantIntakeSnapshots", columns: table => new
        {
            Id = table.Column<Guid>(type: "uuid", nullable: false), TenantId = table.Column<Guid>(type: "uuid", nullable: false), ParticipantId = table.Column<Guid>(type: "uuid", nullable: false), Revision = table.Column<int>(type: "integer", nullable: false), CompletedAtUtc = table.Column<DateTime>(type: "timestamp without time zone", nullable: false), CompletedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false), RequestId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false), SnapshotJson = table.Column<string>(type: "text", nullable: false), ContentHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false), PdfContent = table.Column<byte[]>(type: "bytea", nullable: false)
        }, constraints: table => { table.PrimaryKey("PK_ParticipantIntakeSnapshots", x => x.Id); table.ForeignKey("FK_ParticipantIntakeSnapshots_Participants_ParticipantId", x => x.ParticipantId, "Participants", "Id", onDelete: ReferentialAction.Restrict); });
        migrationBuilder.CreateIndex(name: "IX_ParticipantIntakeSnapshots_TenantId_ParticipantId_Revision", table: "ParticipantIntakeSnapshots", columns: new[] { "TenantId", "ParticipantId", "Revision" }, unique: true);
        migrationBuilder.CreateIndex(name: "IX_ParticipantIntakeSnapshots_ParticipantId_RequestId", table: "ParticipantIntakeSnapshots", columns: new[] { "ParticipantId", "RequestId" }, unique: true);
    }
    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.DropTable(name: "ParticipantIntakeSnapshots");
}
