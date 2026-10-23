using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations;

/// <summary>The email domain becomes optional (a sole trader's staff use personal addresses). The unique index stays: PostgreSQL treats NULLs as distinct.</summary>
[DbContext(typeof(OdipDbContext))]
[Migration("20261022020000_TenantEmailDomainOptional")]
public class TenantEmailDomainOptional : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.AlterColumn<string>(name: "EmailDomain", table: "Tenants", type: "text", nullable: true, oldClrType: typeof(string), oldType: "text");

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // A tenant with no domain gets a placeholder unique to it, so the column can be required again.
        migrationBuilder.Sql("UPDATE \"Tenants\" SET \"EmailDomain\" = 'no-domain-' || \"Id\"::text WHERE \"EmailDomain\" IS NULL;");
        migrationBuilder.AlterColumn<string>(name: "EmailDomain", table: "Tenants", type: "text", nullable: false, defaultValue: "", oldClrType: typeof(string), oldType: "text", oldNullable: true);
    }
}
