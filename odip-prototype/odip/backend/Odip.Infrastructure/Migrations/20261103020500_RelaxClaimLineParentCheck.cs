using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261103020500_RelaxClaimLineParentCheck")]
    public partial class RelaxClaimLineParentCheck : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A manual (one-off) claim's line hangs on neither a shift nor a booking: its participant is the claim's own. "Exactly one" becomes "at most one"; the two writers keep a trip line on a booking and a shift line on a shift.
            migrationBuilder.DropCheckConstraint(
                name: "CK_ClaimLineItem_ExactlyOneParent",
                table: "ClaimLineItems");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClaimLineItem_AtMostOneParent",
                table: "ClaimLineItems",
                sql: "((\"ParticipantBookingId\" IS NOT NULL)::int + (\"ShiftId\" IS NOT NULL)::int) <= 1");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Fails while a manual line exists: it refuses to delete data silently, so delete or move those lines first.
            migrationBuilder.DropCheckConstraint(
                name: "CK_ClaimLineItem_AtMostOneParent",
                table: "ClaimLineItems");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClaimLineItem_ExactlyOneParent",
                table: "ClaimLineItems",
                sql: "((\"ParticipantBookingId\" IS NOT NULL)::int + (\"ShiftId\" IS NOT NULL)::int) = 1");
        }
    }
}
