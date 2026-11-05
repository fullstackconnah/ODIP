using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Odip.Domain.Entities;
using Odip.Infrastructure.Retention;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Retention;

/// <summary>
/// F7: the purge order is a hand-kept list, so the MODEL is walked to prove nothing that holds a participant's data was left out and the order still satisfies the foreign keys.
/// A new table that points at a participant (by a foreign key of any depth, by a bare <c>*ParticipantId</c> column, or by a polymorphic <c>EntityId</c>) fails here until it is
/// added to <see cref="PurgePlan.Steps"/> or listed below with the reason it stays. No database: the model is built, not queried.
/// </summary>
public class PurgePlanModelTests
{
    /// <summary>Participant-linked tables whose rows stay, with why. Every entry is a decision, not a convenience.</summary>
    private static readonly Dictionary<Type, string> Stays = new()
    {
        [typeof(PurgeRecord)] = "The tombstone itself: it records no personal detail and is written by the purge.",
    };

    /// <summary>Tables whose rows are tied to a participant by a bare EntityId. All are either in the steps or handled by name in ParticipantPurger.</summary>
    private static readonly Dictionary<Type, string> Polymorphic = new()
    {
        [typeof(AuditLog)] = "ParticipantPurger deletes the audit rows of the participant and of every purged id (L7).",
    };

    private static readonly Lazy<Microsoft.EntityFrameworkCore.Metadata.IModel> Model = new(() => TestDb.Create().Model);

    private static IEnumerable<IEntityType> Entities => Model.Value.GetEntityTypes().Where(e => !e.IsOwned() && e.ClrType != typeof(Dictionary<string, object>));
    private static HashSet<Type> StepTypes => PurgePlan.Steps.Select(s => s.Entity).ToHashSet();

    [Fact]
    public void Every_entity_with_a_foreign_key_path_to_Participant_is_a_step_or_stays_for_a_stated_reason()
    {
        var closure = new HashSet<IEntityType> { Model.Value.FindEntityType(typeof(Participant))! };
        for (var grew = true; grew;)
        {
            grew = false;
            foreach (var e in Entities.Where(e => !closure.Contains(e)))
                if (e.GetForeignKeys().Any(fk => closure.Contains(fk.PrincipalEntityType))) { closure.Add(e); grew = true; }
        }

        var missing = closure.Select(e => e.ClrType).Where(t => t != typeof(Participant) && !StepTypes.Contains(t) && !Stays.ContainsKey(t)).Select(t => t.Name).OrderBy(n => n).ToList();
        Assert.True(missing.Count == 0, "Not in PurgePlan.Steps and not listed as staying: " + string.Join(", ", missing));
    }

    [Fact]
    public void Every_entity_with_a_ParticipantId_column_and_no_foreign_key_is_a_step()
    {
        var bare = Entities
            .Where(e => e.ClrType.GetProperties().Any(p => p.Name.EndsWith("ParticipantId", StringComparison.Ordinal) || p.Name.EndsWith("ParticipantBookingId", StringComparison.Ordinal)))
            .Select(e => e.ClrType)
            .Where(t => !StepTypes.Contains(t) && !Stays.ContainsKey(t) && t != typeof(Participant))
            .Select(t => t.Name).OrderBy(n => n).ToList();
        Assert.True(bare.Count == 0, "Holds a participant id but is not in PurgePlan.Steps and not listed as staying: " + string.Join(", ", bare));
    }

    [Fact]
    public void Every_polymorphic_EntityId_table_is_a_step_or_handled_by_name()
    {
        var loose = Entities.Select(e => e.ClrType)
            .Where(t => t.GetProperty("EntityId") != null && !StepTypes.Contains(t) && !Polymorphic.ContainsKey(t) && !Stays.ContainsKey(t))
            .Select(t => t.Name).OrderBy(n => n).ToList();
        Assert.True(loose.Count == 0, "Has an EntityId but is neither a step nor handled: " + string.Join(", ", loose));
    }

    [Fact]
    public void A_dependent_is_always_deleted_before_the_row_it_restricts()
    {
        var order = PurgePlan.Steps.Select((s, i) => (s.Entity, i)).GroupBy(x => x.Entity).ToDictionary(g => g.Key, g => g.Min(x => x.i));
        Assert.Equal(PurgePlan.Steps.Count, PurgePlan.Steps.Select(s => s.Entity).Distinct().Count()); // one step per table

        var wrong = new List<string>();
        foreach (var e in Entities.Where(e => order.ContainsKey(e.ClrType)))
            foreach (var fk in e.GetForeignKeys().Where(fk => fk.DeleteBehavior is DeleteBehavior.Restrict or DeleteBehavior.NoAction or DeleteBehavior.ClientSetNull or DeleteBehavior.ClientNoAction or DeleteBehavior.ClientCascade))
                if (order.TryGetValue(fk.PrincipalEntityType.ClrType, out var principal) && fk.PrincipalEntityType != e && order[e.ClrType] >= principal)
                    wrong.Add($"{e.ClrType.Name} ({order[e.ClrType]}) must come before {fk.PrincipalEntityType.ClrType.Name} ({principal})");
        Assert.True(wrong.Count == 0, string.Join("; ", wrong));
    }

    [Fact]
    public void Participant_is_the_last_step()
    {
        Assert.Equal(typeof(Participant), PurgePlan.Steps[^1].Entity);
    }
}
