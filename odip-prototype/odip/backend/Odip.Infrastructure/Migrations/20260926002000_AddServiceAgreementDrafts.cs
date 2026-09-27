using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations;

[DbContext(typeof(OdipDbContext))]
[Migration("20260926002000_AddServiceAgreementDrafts")]
public partial class AddServiceAgreementDrafts : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(name: "ServiceAgreementDrafts", columns: table => new
        {
            Id = table.Column<Guid>(type: "uuid", nullable: false), TenantId = table.Column<Guid>(type: "uuid", nullable: false), ParticipantId = table.Column<Guid>(type: "uuid", nullable: false), Version = table.Column<int>(type: "integer", nullable: false),
            PlanStartDate = table.Column<DateOnly>(type: "date", nullable: false), PlanEndDate = table.Column<DateOnly>(type: "date", nullable: false), AgreementStartDate = table.Column<DateOnly>(type: "date", nullable: false), AgreementEndDate = table.Column<DateOnly>(type: "date", nullable: false), State = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false), ServiceTypesJson = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false), Representative = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true), ParticipantNameSnapshot = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false), NdisNumberSnapshot = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true), DateOfBirthSnapshot = table.Column<DateOnly>(type: "date", nullable: true), CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false), CreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
        }, constraints: table => { table.PrimaryKey("PK_ServiceAgreementDrafts", x => x.Id); table.ForeignKey("FK_ServiceAgreementDrafts_Participants_ParticipantId", x => x.ParticipantId, "Participants", "Id", onDelete: ReferentialAction.Restrict); });
        migrationBuilder.CreateTable(name: "ServiceAgreementDraftLines", columns: table => new
        {
            Id = table.Column<Guid>(type: "uuid", nullable: false), DraftId = table.Column<Guid>(type: "uuid", nullable: false), ServiceType = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false), Hours = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false), ItemCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false), CatalogueVersion = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false), CatalogueEffectiveFrom = table.Column<DateOnly>(type: "date", nullable: false), CatalogueEffectiveTo = table.Column<DateOnly>(type: "date", nullable: true), UnitPrice = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false)
        }, constraints: table => { table.PrimaryKey("PK_ServiceAgreementDraftLines", x => x.Id); table.ForeignKey("FK_ServiceAgreementDraftLines_ServiceAgreementDrafts_DraftId", x => x.DraftId, "ServiceAgreementDrafts", "Id", onDelete: ReferentialAction.Cascade); });
        migrationBuilder.CreateIndex(name: "IX_ServiceAgreementDrafts_ParticipantId", table: "ServiceAgreementDrafts", column: "ParticipantId");
        migrationBuilder.CreateIndex(name: "IX_ServiceAgreementDrafts_TenantId_ParticipantId_Version", table: "ServiceAgreementDrafts", columns: new[] { "TenantId", "ParticipantId", "Version" }, unique: true);
        migrationBuilder.CreateIndex(name: "IX_ServiceAgreementDraftLines_DraftId", table: "ServiceAgreementDraftLines", column: "DraftId");
    }
    protected override void Down(MigrationBuilder migrationBuilder) { migrationBuilder.DropTable(name: "ServiceAgreementDraftLines"); migrationBuilder.DropTable(name: "ServiceAgreementDrafts"); }
}
