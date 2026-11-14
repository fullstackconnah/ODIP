using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261102160127_AddServiceAgreementOriginalEnd")]
    public partial class AddServiceAgreementOriginalEnd : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The signed end of an agreement that was ended early. Null for every existing revision: none has been ended early.
            migrationBuilder.AddColumn<DateOnly>(
                name: "OriginalAgreementEndDate",
                table: "ServiceAgreementDrafts",
                type: "date",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OriginalAgreementEndDate",
                table: "ServiceAgreementDrafts");
        }
    }
}
