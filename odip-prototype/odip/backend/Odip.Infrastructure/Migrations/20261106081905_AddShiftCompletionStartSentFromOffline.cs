using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261106081905_AddShiftCompletionStartSentFromOffline")]
    public partial class AddShiftCompletionStartSentFromOffline : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "StartSentFromOffline",
                table: "ShiftCompletions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Every existing lock stays: before this column SentFromOffline was the lock.
            migrationBuilder.Sql(@"UPDATE ""ShiftCompletions"" SET ""StartSentFromOffline"" = ""SentFromOffline"" WHERE ""SentFromOffline"";");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "StartSentFromOffline",
                table: "ShiftCompletions");
        }
    }
}
