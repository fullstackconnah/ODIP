using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Plan builder phase D, the data it needs: where a pattern remembers the agreement revision and block it came from (so approving the next revision can end the old
/// patterns and the same approval is never made twice), what a pattern and a shift ask of a worker, and the record of who approved a revision and what it did. All of it
/// is additive. The shapes below are what the model says; that Postgres holds them (the unique index, the jsonb) is PlanApprovalPostgresTests.
/// </summary>
public class PlanApprovalSchemaTests
{
    private static OdipDbContext Db()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    // The column type the model asks for (the relational mapping is not there under the in-memory provider, the annotation is).
    private static string? ColumnTypeOf(IReadOnlyProperty property) => property.FindAnnotation(RelationalAnnotationNames.ColumnType)?.Value as string;

    [Fact]
    public void A_pattern_made_by_an_approval_is_unique_by_revision_block_weekday_and_worker_slot_and_a_hand_made_pattern_is_outside_the_index()
    {
        using var db = Db();
        var pattern = db.Model.FindEntityType(typeof(ShiftPattern))!;

        var index = Assert.Single(pattern.GetIndexes().Where(i => i.IsUnique));

        Assert.Equal(new[] { "SourceDraftId", "SourceBlockKey", "DayOfWeek", "WorkerSlot" }, index.Properties.Select(p => p.Name));
        // Postgres reads a null as "not equal to any other", so the filter is about intent: a pattern with no source is not held to the key at all, which is what lets the demo pack and PatternsPage add patterns as they always did.
        Assert.Equal("\"SourceDraftId\" IS NOT NULL", index.GetFilter());
        Assert.NotNull(pattern.GetIndexes().SingleOrDefault(i => !i.IsUnique && i.Properties.Select(p => p.Name).SequenceEqual(new[] { "SourceDraftId" })));
    }

    [Fact]
    public void The_new_pattern_columns_are_all_nullable_so_every_existing_pattern_is_a_hand_made_one()
    {
        using var db = Db();
        var pattern = db.Model.FindEntityType(typeof(ShiftPattern))!;

        Assert.All(new[] { "SourceDraftId", "SourceBlockKey", "WorkerSlot", "RequirementsJson", "GeneratedThrough" }, name => Assert.True(pattern.FindProperty(name)!.IsNullable, name));
        Assert.Equal(64, pattern.FindProperty("SourceBlockKey")!.GetMaxLength());
        Assert.Equal("jsonb", ColumnTypeOf(pattern.FindProperty("RequirementsJson")!));
    }

    [Fact]
    public void A_pattern_keeps_its_revision_a_revision_with_patterns_cannot_be_deleted_from_under_them()
    {
        using var db = Db();
        var foreignKey = Assert.Single(db.Model.FindEntityType(typeof(ShiftPattern))!.GetForeignKeys().Where(f => f.Properties.Single().Name == "SourceDraftId"));

        Assert.Equal(typeof(ServiceAgreementDraft), foreignKey.PrincipalEntityType.ClrType);
        Assert.Equal(DeleteBehavior.Restrict, foreignKey.DeleteBehavior);
    }

    [Fact]
    public void A_shift_carries_what_its_pattern_asked_of_a_worker_and_a_shift_with_none_is_a_shift_as_it_always_was()
    {
        using var db = Db();
        var requirements = db.Model.FindEntityType(typeof(Shift))!.FindProperty("RequirementsJson")!;

        Assert.True(requirements.IsNullable);
        Assert.Equal("jsonb", ColumnTypeOf(requirements));
        // No unique index on shifts: the demo pack places its shifts by a deterministic id, and a natural key there would wedge it. Generation is made safe by a lock, not by a key.
        Assert.DoesNotContain(db.Model.FindEntityType(typeof(Shift))!.GetIndexes(), i => i.IsUnique);
    }

    [Fact]
    public void An_approval_is_one_row_for_each_revision_audited_and_tied_to_its_revision_and_participant()
    {
        using var db = Db();
        var approval = db.Model.FindEntityType(typeof(ServiceAgreementDraftApproval))!;

        Assert.Contains(approval.GetIndexes(), i => i.IsUnique && i.Properties.Select(p => p.Name).SequenceEqual(new[] { "DraftId" }));
        Assert.All(approval.GetForeignKeys(), f => Assert.Equal(DeleteBehavior.Restrict, f.DeleteBehavior));
        Assert.Equal(new[] { "DraftId", "ParticipantId" }, approval.GetForeignKeys().Select(f => f.Properties.Single().Name).OrderBy(n => n));
        Assert.Contains(typeof(ServiceAgreementDraftApproval), AuditedEntities.Types);
        Assert.True(typeof(ITenantEntity).IsAssignableFrom(typeof(ServiceAgreementDraftApproval)));
    }

    [Fact]
    public async Task An_approval_belongs_to_one_organisation_and_another_organisation_does_not_see_it()
    {
        var name = Guid.NewGuid().ToString();
        var (mine, theirs) = (Guid.NewGuid(), Guid.NewGuid());
        OdipDbContext Open(Guid? tenantId, bool superAdmin)
        {
            var tenant = new Mock<ICurrentTenant>();
            tenant.Setup(t => t.TenantId).Returns(tenantId);
            tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
            return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
        }

        await using (var seed = Open(null, true))
        {
            seed.ServiceAgreementDraftApprovals.Add(new ServiceAgreementDraftApproval { Id = Guid.NewGuid(), TenantId = mine, DraftId = Guid.NewGuid(), ParticipantId = Guid.NewGuid(), DraftVersion = 1, ApprovedByName = "Alex Admin" });
            await seed.SaveChangesAsync();
        }

        await using var mineDb = Open(mine, false);
        await using var theirsDb = Open(theirs, false);
        Assert.Single(await mineDb.ServiceAgreementDraftApprovals.ToListAsync());
        Assert.Empty(await theirsDb.ServiceAgreementDraftApprovals.ToListAsync());
    }

    [Fact]
    public void The_migration_is_additive_one_new_table_and_nullable_columns_so_nothing_that_exists_changes()
    {
        var type = typeof(OdipDbContext).Assembly.GetTypes().Single(t => t.Name == "AddServiceAgreementApprovalAndPatternSource" && typeof(Migration).IsAssignableFrom(t));
        var migration = (Migration)Activator.CreateInstance(type)!;

        Assert.All(migration.UpOperations, op => Assert.True(op is CreateTableOperation or CreateIndexOperation or AddColumnOperation or AddForeignKeyOperation, $"{op.GetType().Name} could change existing data"));
        Assert.Equal("ServiceAgreementDraftApprovals", Assert.Single(migration.UpOperations.OfType<CreateTableOperation>()).Name);
        var added = migration.UpOperations.OfType<AddColumnOperation>().ToList();
        Assert.Equal(new[] { "ShiftPatterns.GeneratedThrough", "ShiftPatterns.RequirementsJson", "ShiftPatterns.SourceBlockKey", "ShiftPatterns.SourceDraftId", "ShiftPatterns.WorkerSlot", "Shifts.RequirementsJson" },
            added.Select(c => $"{c.Table}.{c.Name}").OrderBy(n => n, StringComparer.Ordinal));
        Assert.All(added, c => Assert.True(c.IsNullable, $"{c.Table}.{c.Name} would refuse an existing row"));
        var unique = Assert.Single(migration.UpOperations.OfType<CreateIndexOperation>().Where(i => i.Table == "ShiftPatterns" && i.IsUnique));
        Assert.Equal("\"SourceDraftId\" IS NOT NULL", unique.Filter);
        Assert.Equal(new[] { "ServiceAgreementDraftApprovals" }, migration.DownOperations.OfType<DropTableOperation>().Select(o => o.Name));
    }
}
