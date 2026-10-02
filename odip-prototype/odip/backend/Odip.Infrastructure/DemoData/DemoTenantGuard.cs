using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Metadata;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData;

/// <summary>Thrown by <see cref="DemoTenantGuard"/> when a save would write something the demo top-up must never write.</summary>
public sealed class DemoGuardViolationException : InvalidOperationException
{
    public IReadOnlyList<string> Violations { get; }

    public DemoGuardViolationException(IReadOnlyList<string> violations)
        : base("The demo-data guard refused a write: " + string.Join("; ", violations.Take(8))
               + (violations.Count > 8 ? $"; and {violations.Count - 8} more" : string.Empty))
    {
        Violations = violations;
    }
}

/// <summary>Which rows the demo tenant owns outside the change tracker: the parents a non-tenant child row may hang off.</summary>
public sealed class DemoOwnedIds
{
    public HashSet<Guid> Users { get; } = new();
    public HashSet<Guid> Participants { get; } = new();

    internal bool Contains(Guid id) => Users.Contains(id) || Participants.Contains(id);
}

/// <summary>
/// The pre-save check every demo write goes through (plan 4.1): the top-up may only add rows of the types it was written for, to the Demo
/// tenant, and may only change the few columns the plan lists (4.3). A violation aborts the save, and with it the pack that produced it,
/// so a bug in a pack costs a demo a missing story and never another tenant's data.
///
/// The rules, each one a refusal:
///  - a tenant row (<see cref="ITenantEntity"/>) must carry the Demo tenant, and an added one must be of a type on <see cref="AdditionTypes"/>;
///  - a row of a table with no tenant column must be one of <see cref="NonTenantParents"/> and hang off a parent the Demo tenant owns
///    (a row already known to be Demo's, or one added in the same save), so the global tables (Tenants, the support catalogue, public
///    holidays, early-access requests) can never be written and a stray child row can never point at another tenant's parent;
///  - an existing row may change only the columns on <see cref="ModifiableProperties"/>: credential dates on a user (never identity,
///    email, role or flags), a status on a shift or leave request, the review stamp on a completion;
///  - a row being added may only point at users and participants the Demo tenant owns (review finding L4): its own TenantId is stamped by
///    the context and proves nothing about the row it points at, so a pack that copied a person's id from another tenant's data would
///    otherwise write a Demo row pointing at somebody else's person;
///  - nothing is ever deleted;
///  - audit rows (which the audit interceptor writes by itself) may only describe entities of this save or ones the Demo tenant owns.
///
/// A later pack that writes a new table adds it here, which is the point: the allow-list is the one place that says what the demo
/// top-up is permitted to touch.
/// </summary>
public sealed class DemoTenantGuard
{
    /// <summary>Tenant tables the top-up may add rows to.</summary>
    public static readonly IReadOnlySet<Type> AdditionTypes = new HashSet<Type>
    {
        typeof(ProviderSettings),
        typeof(StaffParticipantCompatibility),
        typeof(ShiftPattern),
        typeof(Shift),
        typeof(ShiftCompletion),
        typeof(LeaveRequest),
        typeof(RecurringUnavailability),
        typeof(BookingTask),
        typeof(Person),
        typeof(ParticipantContactRole),
        typeof(ParticipantMedication),
    };

    /// <summary>Non-tenant tables the top-up may add rows to, and which parent each row must hang off.</summary>
    public static readonly IReadOnlyDictionary<Type, Func<object, (DemoParentKind Kind, Guid Id)>> NonTenantParents =
        new Dictionary<Type, Func<object, (DemoParentKind, Guid)>>
        {
            [typeof(StaffAvailability)] = row => (DemoParentKind.User, ((StaffAvailability)row).UserId),
        };

    /// <summary>The only columns the top-up may change on an existing row (plan 4.3: all compare-and-set, forward-only).</summary>
    public static readonly IReadOnlyDictionary<Type, IReadOnlySet<string>> ModifiableProperties =
        new Dictionary<Type, IReadOnlySet<string>>
        {
            [typeof(User)] = new HashSet<string>
            {
                nameof(User.WorkerScreeningNumber), nameof(User.WorkerScreeningExpiryDate), nameof(User.FirstAidExpiryDate),
                nameof(User.DriverLicenceExpiryDate), nameof(User.ManualHandlingExpiryDate), nameof(User.MedicationCompetencyExpiryDate),
                nameof(User.UpdatedAt),
            },
            [typeof(Shift)] = new HashSet<string> { nameof(Shift.Status), nameof(Shift.UpdatedAt) },
            [typeof(ShiftCompletion)] = new HashSet<string>
            {
                nameof(ShiftCompletion.ReviewedByUserId), nameof(ShiftCompletion.ReviewedAt), nameof(ShiftCompletion.ReviewOutcome),
                nameof(ShiftCompletion.UpdatedAt),
            },
            [typeof(LeaveRequest)] = new HashSet<string>
            {
                nameof(LeaveRequest.Status), nameof(LeaveRequest.DecidedAt), nameof(LeaveRequest.DecisionNote), nameof(LeaveRequest.UpdatedAt),
            },
            [typeof(RecurringUnavailability)] = new HashSet<string>
            {
                nameof(RecurringUnavailability.Status), nameof(RecurringUnavailability.DecidedAt),
                nameof(RecurringUnavailability.DecisionNote), nameof(RecurringUnavailability.UpdatedAt),
            },
            [typeof(BookingTask)] = new HashSet<string>
            {
                nameof(BookingTask.Status), nameof(BookingTask.CompletedDate), nameof(BookingTask.AutoCompletedAt), nameof(BookingTask.UpdatedAt),
            },
        };

    private readonly Guid _demoTenantId;
    private readonly DemoOwnedIds _owned;

    public DemoTenantGuard(Guid demoTenantId, DemoOwnedIds owned)
    {
        _demoTenantId = demoTenantId;
        _owned = owned;
    }

    /// <summary>Throws <see cref="DemoGuardViolationException"/> listing every problem when the pending changes break a rule.</summary>
    public void Verify(ChangeTracker tracker)
    {
        var violations = new List<string>();

        // Ids the Demo tenant owns in this save, by CLR type: a tenant row that passes the tenant rule can be a parent or an audit subject.
        var inSave = new Dictionary<Type, HashSet<Guid>>();
        foreach (var entry in tracker.Entries())
        {
            if (entry.Entity is ITenantEntity tenantRow && tenantRow.TenantId == _demoTenantId && TryGetId(entry, out var id))
            {
                var type = entry.Entity.GetType();
                if (!inSave.TryGetValue(type, out var set)) inSave[type] = set = new HashSet<Guid>();
                set.Add(id);
            }
        }

        // Rows of this save that audit history may describe: the tenant rows above, and the listed non-tenant children whose parent is owned.
        var touched = new HashSet<Guid>(inSave.Values.SelectMany(ids => ids));
        foreach (var entry in tracker.Entries())
        {
            if (entry.Entity is not ITenantEntity && NonTenantParents.TryGetValue(entry.Entity.GetType(), out var parentOf) && TryGetId(entry, out var childId))
            {
                var (kind, parentId) = parentOf(entry.Entity);
                if (ParentIsOwned(kind, parentId, inSave)) touched.Add(childId);
            }
        }

        foreach (var entry in tracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;

            var type = entry.Entity.GetType();
            var label = Describe(entry);

            if (entry.State == EntityState.Deleted)
            {
                violations.Add($"{label}: the demo top-up never deletes anything.");
                continue;
            }

            if (entry.Entity is AuditLog audit)
            {
                if (entry.State != EntityState.Added)
                    violations.Add($"{label}: audit history is append-only.");
                else if (!_owned.Contains(audit.EntityId) && !touched.Contains(audit.EntityId))
                    violations.Add($"{label}: it describes {audit.EntityType} {audit.EntityId}, which is not a Demo entity.");
                continue;
            }

            if (entry.State == EntityState.Added) VerifyReferences(entry, label, inSave, violations);

            if (entry.Entity is ITenantEntity tenantEntity)
            {
                if (tenantEntity.TenantId != _demoTenantId)
                    violations.Add($"{label}: belongs to another tenant ({tenantEntity.TenantId}), not the Demo tenant.");

                if (entry.State == EntityState.Added)
                {
                    if (!AdditionTypes.Contains(type))
                        violations.Add($"{label}: the demo top-up may not add rows to this table.");
                }
                else
                {
                    VerifyModification(entry, type, label, violations);
                }
                continue;
            }

            // A table with no tenant column: only a listed child table, and only under a parent the Demo tenant owns.
            if (entry.State == EntityState.Added && NonTenantParents.TryGetValue(type, out var childOf))
            {
                var (kind, parentId) = childOf(entry.Entity);
                if (!ParentIsOwned(kind, parentId, inSave))
                    violations.Add($"{label}: it hangs off {kind} {parentId}, which the Demo tenant does not own.");
            }
            else
            {
                violations.Add($"{label}: this table has no tenant column and is not one the demo top-up may {(entry.State == EntityState.Added ? "add to" : "change")}.");
            }
        }

        if (violations.Count > 0) throw new DemoGuardViolationException(violations);
    }

    /// <summary>
    /// The users and participants a new row points at must be ones the Demo tenant owns: loaded from its own tenant-filtered directory, or
    /// added in this save. A reference is any foreign key to a user or a participant, and any plain Guid column that is a person by its
    /// name (<c>...UserId</c>, <c>...StaffId</c>, <c>...ParticipantId</c>): the model keeps many of those without a constraint (who requested,
    /// recorded or decided), and a constraint would not know about tenants anyway. An empty reference (an unfilled shift) points at nobody.
    /// Other kinds of row are not checked here: they come out of queries that only see Demo rows, and are Demo rows themselves.
    /// </summary>
    private void VerifyReferences(EntityEntry entry, string label, Dictionary<Type, HashSet<Guid>> inSave, List<string> violations)
    {
        foreach (var property in entry.Properties)
        {
            var kind = ReferenceKind(property.Metadata);
            if (kind is null) continue;
            if (property.CurrentValue is not Guid value || value == Guid.Empty) continue;
            if (!ParentIsOwned(kind.Value, value, inSave))
                violations.Add($"{label}: {property.Metadata.Name} points at {kind} {value}, which the Demo tenant does not own.");
        }
    }

    private static DemoParentKind? ReferenceKind(IReadOnlyProperty property)
    {
        if (property.ClrType != typeof(Guid) && property.ClrType != typeof(Guid?)) return null;

        foreach (var foreignKey in property.GetContainingForeignKeys())
        {
            var principal = foreignKey.PrincipalEntityType.ClrType;
            if (principal == typeof(User)) return DemoParentKind.User;
            if (principal == typeof(Participant)) return DemoParentKind.Participant;
        }

        var name = property.Name;
        if (name.EndsWith("UserId", StringComparison.Ordinal) || name.EndsWith("StaffId", StringComparison.Ordinal)) return DemoParentKind.User;
        if (name.EndsWith("ParticipantId", StringComparison.Ordinal)) return DemoParentKind.Participant;
        return null;
    }

    private static void VerifyModification(EntityEntry entry, Type type, string label, List<string> violations)
    {
        if (!ModifiableProperties.TryGetValue(type, out var allowed))
        {
            violations.Add($"{label}: the demo top-up may not change rows of this table.");
            return;
        }

        foreach (var property in entry.Properties.Where(p => p.IsModified))
        {
            if (!allowed.Contains(property.Metadata.Name))
                violations.Add($"{label}: the demo top-up may not change {property.Metadata.Name}.");
        }
    }

    private bool ParentIsOwned(DemoParentKind kind, Guid parentId, Dictionary<Type, HashSet<Guid>> inSave)
    {
        var owned = kind switch
        {
            DemoParentKind.User => _owned.Users,
            DemoParentKind.Participant => _owned.Participants,
            _ => new HashSet<Guid>(),
        };
        if (owned.Contains(parentId)) return true;

        var parentType = kind switch
        {
            DemoParentKind.User => typeof(User),
            DemoParentKind.Participant => typeof(Participant),
            _ => null,
        };
        return parentType is not null && inSave.TryGetValue(parentType, out var ids) && ids.Contains(parentId);
    }

    private static bool TryGetId(EntityEntry entry, out Guid id)
    {
        var property = entry.Properties.FirstOrDefault(p => p.Metadata.Name == "Id");
        if (property?.CurrentValue is Guid current) { id = current; return true; }
        if (property?.OriginalValue is Guid original) { id = original; return true; }
        id = Guid.Empty;
        return false;
    }

    private static string Describe(EntityEntry entry)
    {
        var action = entry.State switch
        {
            EntityState.Added => "add",
            EntityState.Deleted => "delete",
            _ => "change",
        };
        return TryGetId(entry, out var id) && id != Guid.Empty
            ? $"{entry.Entity.GetType().Name} {id} ({action})"
            : $"{entry.Entity.GetType().Name} ({action})";
    }
}

/// <summary>The kinds of parent row a non-tenant child may hang off (see <see cref="DemoTenantGuard.NonTenantParents"/>).</summary>
public enum DemoParentKind
{
    User,
    Participant,
}

/// <summary>
/// Runs <see cref="DemoTenantGuard.Verify"/> inside <c>SaveChanges</c>, after the audit interceptor has added its rows (it is attached
/// after it), so the guard sees everything that is about to be written, audit history included. The throw happens before the first
/// statement is sent: nothing is written.
/// </summary>
public sealed class DemoGuardInterceptor : SaveChangesInterceptor
{
    private readonly DemoTenantGuard _guard;

    public DemoGuardInterceptor(DemoTenantGuard guard) => _guard = guard;

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is not null) _guard.Verify(eventData.Context.ChangeTracker);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is not null) _guard.Verify(eventData.Context.ChangeTracker);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
