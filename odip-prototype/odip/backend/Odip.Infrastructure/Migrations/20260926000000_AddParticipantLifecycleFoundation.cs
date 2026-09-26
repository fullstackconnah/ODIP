using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations;

public partial class AddParticipantLifecycleFoundation : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "ParticipantInquiries",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                ParticipantId = table.Column<Guid>(type: "uuid", nullable: true),
                FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                Phone = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                Source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                Provenance = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ParticipantInquiries", x => x.Id);
                table.ForeignKey("FK_ParticipantInquiries_Participants_ParticipantId", x => x.ParticipantId, "Participants", "Id", onDelete: ReferentialAction.Restrict);
            });
        migrationBuilder.CreateTable(
            name: "ParticipantOnboardings",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false), TenantId = table.Column<Guid>(type: "uuid", nullable: false), ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                ProfileComplete = table.Column<bool>(type: "boolean", nullable: false), ProfileCompletedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true), ProfileCompletedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                ServiceTypeConfirmed = table.Column<bool>(type: "boolean", nullable: false), ServiceTypeConfirmedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true), ServiceTypeConfirmedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                ServiceAgreementSigned = table.Column<bool>(type: "boolean", nullable: false), ServiceAgreementSignedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true), ServiceAgreementSignedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false), UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
            }, constraints: table => { table.PrimaryKey("PK_ParticipantOnboardings", x => x.Id); table.ForeignKey("FK_ParticipantOnboardings_Participants_ParticipantId", x => x.ParticipantId, "Participants", "Id", onDelete: ReferentialAction.Restrict); });
        migrationBuilder.CreateIndex(name: "IX_ParticipantInquiries_TenantId_CreatedAt", table: "ParticipantInquiries", columns: new[] { "TenantId", "CreatedAt" });
        migrationBuilder.CreateIndex(name: "IX_ParticipantInquiries_TenantId_ParticipantId", table: "ParticipantInquiries", columns: new[] { "TenantId", "ParticipantId" });
        migrationBuilder.CreateIndex(name: "IX_ParticipantOnboardings_ParticipantId", table: "ParticipantOnboardings", column: "ParticipantId", unique: true);
        migrationBuilder.CreateIndex(name: "IX_ParticipantOnboardings_TenantId_ParticipantId", table: "ParticipantOnboardings", columns: new[] { "TenantId", "ParticipantId" }, unique: true);
    }
    protected override void Down(MigrationBuilder migrationBuilder) { migrationBuilder.DropTable(name: "ParticipantInquiries"); migrationBuilder.DropTable(name: "ParticipantOnboardings"); }
}
