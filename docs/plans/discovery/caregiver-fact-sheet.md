# Caregiver Profile Form — Discovery Fact Sheet

All paths relative to `odip-prototype/odip/` unless noted. Repo root is `F:\Projects\personal\ODIP`.
Design doc: `docs/specs/2026-09-03-caregiver-profile-form-design.md` (repo-root-relative).

---

## A. Backend

### A1. Program.cs middleware and rate limiting

`backend/Odip.Api/Program.cs:207-269` — `AddRateLimiter` block (verbatim, both existing policies):

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Strict rate limit for login endpoint to prevent brute force
    options.AddPolicy("login", context =>
    {
        if (IsDevAuthEnabled() && IsDevAuthRateLimitExemptPath(context.Request.Path))
        {
            return RateLimitPartition.GetNoLimiter(
                RecordLimiterPartitionKey(context, "exempt:" + RateLimitPartitionKey(context)));
        }

        return RateLimitPartition.GetSlidingWindowLimiter(
            partitionKey: RecordLimiterPartitionKey(context, "login:" + RateLimitPartitionKey(context)),
            factory: _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(5),
                SegmentsPerWindow = 5,
                QueueLimit = 0
            });
    });

    // General API rate limit
    options.AddPolicy("api", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: "api:" + RateLimitPartitionKey(context),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 100,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));
});
```

A `"public"` policy is added the same way, as a third `options.AddPolicy("public", context => ...)` call inside this same block, before `});` closes it. `RateLimitPartitionKey(context)` (`Program.cs:277-278`) and `RecordLimiterPartitionKey` (`Program.cs:286-290`) are file-local `static` functions available to reuse verbatim.

Middleware ordering, `Program.cs:456-490` (verbatim, from `UseForwardedHeaders` through `MapControllers`):

```csharp
app.UseForwardedHeaders();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "Odip API v1"));
}

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

// Security headers middleware
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["X-XSS-Protection"] = "0";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), payment=()";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; script-src 'self' 'wasm-unsafe-eval'; frame-ancestors 'none'";
    context.Response.Headers["Cache-Control"] = "no-store";
    context.Response.Headers["Pragma"] = "no-cache";
    await next();
});

app.UseMiddleware<Odip.Api.Middleware.ExceptionHandlingMiddleware>();
app.UseRateLimiter();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<Odip.Api.Middleware.ReadOnlyMiddleware>();
app.MapControllers();

app.Run();
```

**Insertion point for the new public endpoints:** they are ordinary `[AllowAnonymous]` `MapControllers()`-routed actions, so no new middleware slot is needed — they pass through `UseRateLimiter()` → `UseCors()` → `UseAuthentication()`/`UseAuthorization()` (both no-ops for an anonymous request with no bearer token — `[AllowAnonymous]` short-circuits `UseAuthorization()`'s check) → `ReadOnlyMiddleware` (need to verify it doesn't block anonymous POST/PUT — see note below) → controller action, exactly like every other route.

**`[AllowAnonymous]` precedent** — there is no existing anonymous *controller action* found in `ParticipantsController`/`PortalController` (both are `[Authorize]`-gated). The codebase's actual anonymous-auth precedent is `AuthController`'s login/exchange endpoints, which are outside the `[Authorize]` default because `AuthController` itself carries no class-level `[Authorize]`. Grep for `[AllowAnonymous]` found no hits outside `docs/superpowers` (legacy/historical, excluded). **Correction to the design doc's assumption**: there is no existing `[AllowAnonymous]` action on an otherwise-`[Authorize]` controller to copy verbatim — a new `CaregiverController` (no class-level `[Authorize]`, matching `AuthController`'s pattern) is the right shape, not an `[AllowAnonymous]` override inside an `[Authorize]` controller.

**ReadOnlyMiddleware caution**: not read in full during this pass, but it runs after `UseAuthorization()` and before `MapControllers()`, and 403s writes for the "ReadOnly" role (per `CLAUDE.md`). Since the public caregiver endpoints run with no authenticated user (no role claim at all), confirm in the plan whether `ReadOnlyMiddleware` treats "no user" as "not ReadOnly, pass through" (likely, since it checks `User.IsInRole("ReadOnly")` which is false for an anonymous principal) — flag this as a one-line check needed, not verified here.

### A2. Tenant resolution

`backend/Odip.Domain/Interfaces/ICurrentTenant.cs` (full file):

```csharp
namespace Odip.Domain.Interfaces;

/// <summary>
/// Provides the tenant context for the current HTTP request.
/// Resolved from the JWT "tenant_id" claim.
/// SuperAdmin users have TenantId = null and IsSuperAdmin = true.
/// </summary>
public interface ICurrentTenant
{
    /// <summary>The current tenant's Guid, or null for SuperAdmin users.</summary>
    Guid? TenantId { get; }

    /// <summary>True when the authenticated user has the SuperAdmin role.</summary>
    bool IsSuperAdmin { get; }

    /// <summary>
    /// Set when a SuperAdmin is viewing as a specific user via X-View-As-User header.
    /// Null when not impersonating.
    /// </summary>
    Guid? ViewAsUserId { get; }
}
```

`backend/Odip.Infrastructure/Services/CurrentTenant.cs` (full file — constructor reads headers directly in the ctor body, all properties are `private set`):

```csharp
using Microsoft.AspNetCore.Http;
using Odip.Domain.Interfaces;

namespace Odip.Infrastructure.Services;

public sealed class CurrentTenant : ICurrentTenant
{
    public Guid? TenantId { get; private set; }
    public bool IsSuperAdmin { get; private set; }
    public Guid? ViewAsUserId { get; private set; }

    public CurrentTenant(IHttpContextAccessor accessor)
    {
        var user = accessor.HttpContext?.User;
        var claim = user?.FindFirst("tenant_id")?.Value;
        TenantId = Guid.TryParse(claim, out var parsed) ? parsed : null;
        IsSuperAdmin = user?.IsInRole("SuperAdmin") ?? false;

        var wasSuperAdmin = IsSuperAdmin;

        if (IsSuperAdmin)
        {
            var header = accessor.HttpContext?.Request.Headers["X-View-As-Tenant"].FirstOrDefault();
            if (Guid.TryParse(header, out var overrideTenant))
            {
                TenantId = overrideTenant;
                IsSuperAdmin = false;
            }
        }

        if (wasSuperAdmin && TenantId.HasValue)
        {
            var userHeader = accessor.HttpContext?.Request.Headers["X-View-As-User"].FirstOrDefault();
            if (Guid.TryParse(userHeader, out var viewUserId))
                ViewAsUserId = viewUserId;
        }
    }
}
```

**No programmatic tenant setter exists.** All three properties are `{ get; private set; }`, populated only in the constructor from `IHttpContextAccessor`/claims/headers. There is no scoped-override mechanism anywhere else in the codebase (grepped for a setter or override — none found).

**Consequence for the design**: `ICurrentTenant` **cannot** be "set from the token row" as the design doc's §2 asserts (*"Tenant and participant resolve from the token row. `ICurrentTenant` is set from the row"*). Since `CurrentTenant` is `sealed` and reads only from the JWT claim / headers at construction time, the public caregiver endpoints cannot repopulate it after DI construction. **This is a real contradiction the plan must resolve** — options: (a) don't depend on `ICurrentTenant` at all on the public routes; instead resolve `TenantId`/`ParticipantId` directly from the `CaregiverProfileSubmission` row inside the controller action and pass `TenantId` explicitly into any query that would otherwise rely on the ambient tenant filter (e.g. `.IgnoreQueryFilters().Where(x => x.TenantId == submission.TenantId)`), or (b) introduce a new mutable/settable tenant abstraction (e.g. an internal setter or a second `ICurrentTenant` implementation registered only for this controller). Given `ICurrentTenant` is `AddScoped<ICurrentTenant, CurrentTenant>()` (`Program.cs:361`) and every tenant-scoped entity's global query filter reads `_tenant.TenantId`/`_tenant.IsSuperAdmin` (see `OdipDbContext`), option (a) is simpler and lower-risk: the public controller queries `CaregiverProfileSubmission` and `Participant` directly (bypassing `ICurrentTenant`, using `IgnoreQueryFilters()` plus an explicit `TenantId` match from the resolved submission row) rather than trying to make `ICurrentTenant` mutable mid-request.

### A3. The 404 anti-enumeration pattern

The design doc's target ("the portal medication witness approve action") is `PortalController.ApproveWitnessRequest`, which is a one-line delegator; the actual logic — and the pattern to copy — is `RespondToWitnessRequestAsync`, `backend/Odip.Api/Controllers/PortalController.cs:316-347` (verbatim, full method plus its two public entry points):

```csharp
    /// <summary>
    /// Approves or declines one of the caller's own pending MEDICATION witness requests. Only the
    /// named witness (matched on their own resolved StaffId, exactly like <see cref="GetShiftDetail"/>
    /// scopes shifts) may act on it — not linked, request not found, and request belongs to
    /// someone else all 404 identically for the same reason documented on the class. Unchanged by
    /// IN-7 — incident witness requests use the separate endpoints below.
    /// </summary>
    [HttpPost("witness-requests/{id:guid}/approve")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> ApproveWitnessRequest(Guid id, CancellationToken ct) =>
        RespondToWitnessRequestAsync(id, WitnessStatus.Approved, ct);

    [HttpPost("witness-requests/{id:guid}/decline")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> DeclineWitnessRequest(Guid id, CancellationToken ct) =>
        RespondToWitnessRequestAsync(id, WitnessStatus.Declined, ct);

    private async Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> RespondToWitnessRequestAsync(
        Guid id, WitnessStatus response, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        var admin = await _db.MedicationAdministrations
            .Include(a => a.Participant)
            .Include(a => a.ParticipantMedication)
            .FirstOrDefaultAsync(a => a.Id == id && a.WitnessUserId == staffId.Value, ct);
        if (admin == null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        if (admin.WitnessStatus != WitnessStatus.Pending)
            return BadRequest(ApiResponse<PortalWitnessRequestDto>.Fail("This witness request has already been responded to."));

        admin.WitnessStatus = response;
        admin.WitnessRespondedAt = DateTime.UtcNow;
        admin.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<PortalWitnessRequestDto>.Ok(ToWitnessRequestDto(admin)));
    }
```

Shape to copy for the public caregiver endpoints: **every failure path returns `NotFound(...)` with the same generic message shape**, and the *lookup itself* is a single filtered query (`FirstOrDefaultAsync(x => x.TokenHash == hash, ct)` for the caregiver case) that combines existence + ownership/status in one `Where` clause, so "doesn't exist" and "exists but wrong state" are indistinguishable in code, not just in the response body — this is what the design doc's drift-guard/404 test (§7, "unknown hash, expired, revoked, accepted...") is asserting against.

### A4. The PATCH code path

`backend/Odip.Api/Controllers/ParticipantsController.cs:1072-1074` (signature + doc comment):

```csharp
    [HttpPatch("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> Patch(Guid id, [FromBody] PatchParticipantDto dto, CancellationToken ct)
```

First ~30 lines of the body, `ParticipantsController.cs:1075-1105`:

```csharp
    {
        // Tenant scoping comes for free from OdipDbContext's ambient ITenantEntity query filter on
        // Participants (see GetById/Update above) — a wrong-tenant id simply isn't found.
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        if (dto.PersonalDetails is { } pdValidate)
        {
            var transient = new CreateParticipantDto
            {
                FirstName = pdValidate.FirstName, LastName = pdValidate.LastName,
                Gender = pdValidate.Gender, GenderSelfDescription = pdValidate.GenderSelfDescription,
                Phone = pdValidate.Phone, Email = pdValidate.Email,
            };
            var namesError = ValidateNames(transient);
            if (namesError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(namesError));
            var genderError = ValidateGender(transient);
            if (genderError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(genderError));
            var phoneError = ValidatePhone(transient);
            if (phoneError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(phoneError));
            var emailError = ValidateEmail(transient);
            if (emailError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(emailError));
        }
```

**Is the PATCH mapping callable in-process without going through HTTP? No — it is not extracted into any service.** The entire mapping/validation/assignment logic lives inline in this one `Patch` controller action (the method runs well past line 1105; grepping the whole file for any `Apply`/`Map`-named private helper touching `PatchParticipantDto` found none — the only related private static helper, `ApplyLivingArrangementFields` at `ParticipantsController.cs:441`, operates on `CreateParticipantDto`, not the Patch DTO). To reuse this "in-process" per the design's §3 accept flow, the plan has two real options:
1. **Instantiate `ParticipantsController` directly** in the admin accept endpoint (it's a plain class — `new ParticipantsController(_db, _compatLink, _documentService, _safetyNoteSync)` — constructor at `ParticipantsController.cs:25-31`) and call `.Patch(participantId, mappedDto, ct)` on it. This works but is unusual (controllers aren't normally instantiated by hand) and its `Guid` return type / `ActionResult<T>` wrapping is awkward to unwrap from another controller.
2. **Extract a shared method** (e.g. `internal static Task<...> ApplyPatchAsync(OdipDbContext db, Participant p, PatchParticipantDto dto, ...)`) out of `Patch`'s body into a class both controllers can call — this is the cleaner approach but means touching `ParticipantsController.Patch` itself, which the design's branch table (§6) doesn't currently list as in scope for `cg01`/`cg02`. **Flag to the plan**: either scope a small refactor of `Patch` into `cg02`, or accept option 1's awkwardness — this needs an explicit decision, it isn't free.

`PatchParticipantDto` full declaration, `backend/Odip.Application/DTOs/ParticipantPatchDTOs.cs:32-62` (all 20 members, names + types only):

```csharp
public record PatchParticipantDto
{
    public PatchPersonalDetailsDto? PersonalDetails { get; init; }
    public PatchPreferredStaffDto? PreferredStaff { get; init; }
    public PatchAddressDto? Address { get; init; }
    public PatchLivingArrangementDto? LivingArrangement { get; init; }
    public PatchNdisPlanDto? NdisPlan { get; init; }
    public PatchServiceProfileDto? ServiceProfile { get; init; }
    public PatchKeyIdentifiersDto? KeyIdentifiers { get; init; }
    public PatchCulturalBackgroundDto? CulturalBackground { get; init; }
    public PatchSupportNeedsMobilityDto? SupportNeedsMobility { get; init; }
    public PatchMedicalDto? Medical { get; init; }
    public PatchBehaviourCommunicationDto? BehaviourCommunication { get; init; }
    public PatchCommunityAccessBehaviourDto? CommunityAccessBehaviour { get; init; }
    public PatchMealsAndDietDto? MealsAndDiet { get; init; }
    public PatchAboutMeDto? AboutMe { get; init; }
    public PatchSupportsLookLikeDto? SupportsLookLike { get; init; }
    public PatchRisksHazardsSummaryDto? RisksHazardsSummary { get; init; }

    public List<CreateParticipantConsentDto>? Consents { get; init; }
    public List<CreateParticipantHealthConditionDto>? HealthConditions { get; init; }
    public List<CreateParticipantAdlAssessmentDto>? AdlAssessments { get; init; }
    public List<CreateParticipantChecklistItemDto>? ChecklistItems { get; init; }
}
```

(16 scalar-group members + 4 collection members = 20, matching the design doc's count.)

### A5. Audit logging

**Correction to the design doc's assumption.** There is **no per-controller audit call site** anywhere in `ParticipantsController` or `PortalController` (grepped both for `AuditLog`/`AuditService`/`_audit.` — zero hits). Audit logging is fully automatic, driven by an EF Core `SaveChangesInterceptor`:

`backend/Odip.Infrastructure/Audit/AuditInterceptor.cs:11-33` (registration + trigger point):

```csharp
public sealed class AuditInterceptor : SaveChangesInterceptor
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public AuditInterceptor(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is not null)
        {
            var auditEntries = BuildAuditEntries(eventData.Context);
            if (auditEntries.Count > 0)
                eventData.Context.Set<AuditLog>().AddRange(auditEntries);
        }

        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }
```

Registered in `Program.cs:27-31`:

```csharp
builder.Services.AddScoped<Odip.Infrastructure.Audit.AuditInterceptor>();

builder.Services.AddDbContext<OdipDbContext>((sp, options) =>
    options.UseNpgsql(connectionString)
        .AddInterceptors(sp.GetRequiredService<Odip.Infrastructure.Audit.AuditInterceptor>()));
```

Which entity types get audited is a fixed allowlist, `backend/Odip.Infrastructure/Audit/AuditedEntities.cs:8-48` — `Types` is a `HashSet<Type>` (currently `TripInstance, Participant, ParticipantBooking, IncidentReport, User, StaffAssignment, VehicleAssignment, Shift, ShiftPattern, StaffParticipantCompatibility, ParticipantMedication, MedicationAdministration, ParticipantNote`). **`CaregiverProfileSubmission` must be added to this `HashSet` for any of its Added/Modified/Deleted state transitions to produce an `AuditLog` row at all** — there is no separate "write an audit entry" call to make; adding the type to this set is both necessary and sufficient for automatic create/update/delete auditing.

**Second contradiction to flag**: the interceptor attributes every audit row to the *authenticated* user only —

```csharp
var user = _httpContextAccessor.HttpContext?.User;
Guid? changedById = null;
string? changedByName = null;
if (user?.Identity?.IsAuthenticated == true) { ... }
```

(`AuditInterceptor.cs:37-49`). On the public caregiver routes there is no authenticated principal (no `[Authorize]`, no bearer token), so `changedById`/`changedByName` will both be `null` automatically for a caregiver's draft/submit `SaveChangesAsync` call — the interceptor has **no mechanism to substitute "caregiver" plus the caregiver's typed name**, which is what the design doc's §2 explicitly asks for ("or 'caregiver' plus the caregiver name for submit"). Getting that requires either: (a) a small addition to `AuditInterceptor` (e.g. reading a well-known `HttpContext.Items` key the public controller sets before calling `SaveChangesAsync`, falling back to that when there's no authenticated user), or (b) writing a manual, non-interceptor `AuditLog` row explicitly for the submit action only, bypassing the interceptor's own attribution logic for that one case. This needs an explicit decision in the plan; it is not a drop-in "reuse the existing pattern" the way create/revoke/accept/reject are (those are all admin-authenticated, so the interceptor's default behaviour already covers them correctly once `CaregiverProfileSubmission` is in `AuditedEntities.Types`).

### A6. Entity + migration conventions

`backend/Odip.Domain/Entities/IncidentWitness.cs` (full file):

```csharp
using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

public class IncidentWitness
{
    public Guid Id { get; set; }

    public Guid IncidentReportId { get; set; }
    public IncidentReport IncidentReport { get; set; } = null!;

    public Guid? WitnessUserId { get; set; }
    public User? WitnessUser { get; set; }

    public string WitnessName { get; set; } = string.Empty;

    public WitnessStatus WitnessStatus { get; set; } = WitnessStatus.NotRequired;
    public DateTime? WitnessRequestedAt { get; set; }
    public DateTime? WitnessRespondedAt { get; set; }

    public string? StatementText { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```

(Doc comments omitted above for brevity — see `IncidentWitness.cs:1-29` for the full XML doc, which explains the no-`TenantId`/no-`ITenantEntity` convention: tenant scoping comes transitively through the parent FK when the parent itself has no tenant column. **`CaregiverProfileSubmission` does NOT follow this precedent** — the design doc correctly specifies `ITenantEntity` directly on it, since (unlike `IncidentWitness`→`IncidentReport`) there's no natural non-tenant-scoped parent to inherit through.)

`OdipDbContext` EF configuration block for `IncidentWitness`, `backend/Odip.Infrastructure/Data/OdipDbContext.cs:595-617`:

```csharp
        // ── IncidentWitness (IN-7) ───────────────────────────────
        modelBuilder.Entity<IncidentWitness>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.WitnessName).HasMaxLength(300).IsRequired();
            e.Property(x => x.StatementText).HasMaxLength(4000);

            e.HasOne(x => x.IncidentReport)
                .WithMany(i => i.Witnesses)
                .HasForeignKey(x => x.IncidentReportId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(x => x.WitnessUser)
                .WithMany()
                .HasForeignKey(x => x.WitnessUserId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(x => x.IncidentReportId);
            e.HasIndex(x => x.WitnessUserId);
        });
```

Also register the new `DbSet` the same way as `OdipDbContext.cs:70-71`:

```csharp
        /// <summary>IN-7: see <see cref="Entities.IncidentWitness"/>'s type doc.</summary>
        public DbSet<IncidentWitness> IncidentWitnesses => Set<IncidentWitness>();
```

Migration `Up()`, `backend/Odip.Infrastructure/Migrations/20260903034637_AddIncidentWitnesses.cs:12-54` (full method):

```csharp
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "IncidentWitnesses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentReportId = table.Column<Guid>(type: "uuid", nullable: false),
                    WitnessUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    WitnessName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    WitnessStatus = table.Column<int>(type: "integer", nullable: false),
                    WitnessRequestedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    WitnessRespondedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    StatementText = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncidentWitnesses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IncidentWitnesses_IncidentReports_IncidentReportId",
                        column: x => x.IncidentReportId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_IncidentWitnesses_Users_WitnessUserId",
                        column: x => x.WitnessUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_IncidentWitnesses_IncidentReportId",
                table: "IncidentWitnesses",
                column: "IncidentReportId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentWitnesses_WitnessUserId",
                table: "IncidentWitnesses",
                column: "WitnessUserId");
        }
```

The design's **partial unique index** (`(ParticipantId) WHERE "Status" IN ('Draft','Submitted')`) has no precedent in this migration — EF Core's fluent API doesn't express a filtered unique index directly on a plain `HasIndex`, so the plan should generate the migration normally via `dotnet ef migrations add` and then hand-edit the generated `Up()` to add `migrationBuilder.Sql(...)` (a raw `CREATE UNIQUE INDEX ... WHERE ...`) or use `.HasFilter("...")` on the `HasIndex(...).IsUnique()` call in `OdipDbContext` (EF Core does support `HasFilter` for exactly this Postgres partial-index case) — confirm no existing filtered index exists elsewhere in `OdipDbContext.cs` to copy from (a targeted grep for `HasFilter` found none in this codebase, so this is new territory, not a pattern to copy).

**`dotnet ef migrations add` invocation**: no working example exists inside `odip-prototype/odip` itself (checked `PROTOTYPE_NOTES.md` and all `.md` files under the app root — none). The only examples are historical, in `docs/superpowers/plans/*.md` (excluded/legacy, pre-fork), all of the shape:
```
dotnet ef migrations add <Name> --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```
Since `CLAUDE.md` states backend commands run from `odip-prototype/odip/backend`, and the solution/projects live directly under that folder (confirmed: `backend/Odip.sln`, `backend/Odip.Infrastructure/`, `backend/Odip.Api/` are siblings), **the working invocation from `odip-prototype/odip/backend` is**:
```
dotnet ef migrations add AddCaregiverProfileSubmissions --project Odip.Infrastructure --startup-project Odip.Api
```
(relative project paths, no `backend/` prefix, since the command already runs from inside `backend/`). No special env var appears necessary — `Odip.Api`'s `Program.cs` top-level statements run at migration-design-time too (EF tooling invokes `Program`'s `WebApplicationBuilder` for design-time DbContext creation), so the same `Jwt:Secret`/Firebase env-var guards that make the app "refuse to start" (per `CLAUDE.md`) likely also gate `dotnet ef migrations add` unless a design-time factory bypasses them — **not verified in this pass**; if migration generation fails locally with a startup exception, check for an `IDesignTimeDbContextFactory` implementation (none found in a name-based search, so `Program.cs`'s full startup path, including its Jwt/Firebase guards, is likely what design-time tooling actually runs).

### A7. DTO file conventions

DTOs for participant patch operations live in one dedicated per-feature file: `backend/Odip.Application/DTOs/ParticipantPatchDTOs.cs` (not `DTOs.cs` — that generic name was not found; participant DTOs are split across feature-named files like this one). Top of the file, `ParticipantPatchDTOs.cs:1-31`:

```csharp
using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT PATCH DTOs — CORE-02 (see SPEC-00-foundations.md)
// ══════════════════════════════════════════════════════════════
//
// The canonical unit for a partial participant save is a semantic FIELD GROUP, not a wizard step
// or a detail-tab section — both of those compose from these 20 groups (16 scalar + 4
// collections), neither defines them. See SPEC-00's CORE-02 section for the full field-group
// partition table and the reasoning behind every grouping decision...
```

Convention: `namespace Odip.Application.DTOs;` (file-scoped namespace), `public record` (not `class`) for every DTO, `{ get; init; }` properties, `[StringLength(N)]` data-annotation validation attributes directly on scalar string members (see `PatchPersonalDetailsDto`, `ParticipantPatchDTOs.cs:117-136`), and one giant top-of-file banner comment block (`══...══` box-drawing rule) documenting the whole file's design rationale before the first type declaration. A new `CaregiverParticipantDto`/`CaregiverPayload`-family of DTOs should follow this exact convention: own feature file (e.g. `CaregiverProfileDTOs.cs`), `Odip.Application.DTOs` namespace, `record` types, `init`-only properties.

### A8. Test conventions

`backend/Odip.Tests/Incidents/IncidentsControllerTests.cs:1-33` (imports + `CreateDb` helper):

```csharp
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Incidents;

public class IncidentsControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static OdipDbContext CreateTenantScopedDb(string dbName, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        ...
```

Pattern: `Moq`'s `Mock<ICurrentTenant>` is passed straight into `OdipDbContext`'s constructor (confirming `ICurrentTenant` is a constructor dependency of the `DbContext` itself, used for its global query filters) — this is also the seam a caregiver-controller test would use, constructing the controller directly with `new CaregiverController(db, ...)` and a mocked/real `OdipDbContext`, no HTTP pipeline involved. A controller under test is constructed directly (`new IncidentsController(db, ...)` pattern implied, not shown in the first 45 lines but consistent with `ParticipantsController`'s own multi-arg constructor).

Witness 404 test example, `backend/Odip.Tests/Portal/PortalControllerTests.cs:820-836` (`ApproveIncidentWitnessRequest_NotTheNamedWitness_Returns404` — the design's target anti-enumeration test to mirror):

```csharp
    [Fact]
    public async Task ApproveIncidentWitnessRequest_NotTheNamedWitness_Returns404()
    {
        var (db, tenant) = CreateDb();
        var namedWitness = SeedUser(db, "Priya", "Nair");
        var impersonator = SeedUser(db, "Cara", "Lee");
        var reporter = SeedUser(db, "Other", "Reporter");
        var incident = SeedIncident(db, reporter.Id);
        var witness = SeedIncidentWitness(db, incident.Id, namedWitness.Id);
        var controller = MakeController(db, tenant.Object, impersonator.Id);

        var result = await controller.ApproveIncidentWitnessRequest(witness.Id, null, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var reloaded = await db.IncidentWitnesses.SingleAsync(w => w.Id == witness.Id);
        Assert.Equal(WitnessStatus.Pending, reloaded.WitnessStatus);
    }
```

Assertion shape to reuse: `Assert.IsType<NotFoundObjectResult>(result.Result)` plus a follow-up read confirming the underlying row was **not** mutated by the rejected call — the same two-part assertion (right status code + no side effect) should back every one of the design's §7 backend 404 test cases.

---

## B. Frontend

### B9. `useWizard`

`frontend/src/components/wizard/types.ts` (full file):

```ts
export type WizardStepDef<V> = {
  key: string
  label: string
  fields: readonly (keyof V)[]
}

export type WizardFieldError = { path: string; message: string; code?: string }

export type WizardValidate<V> = (
  step: WizardStepDef<V>,
  values: V,
) => WizardFieldError[] | null | Promise<WizardFieldError[] | null>

export type WizardSecondaryAction = {
  key: string
  label: string
  onClick: () => void | Promise<void>
  disabled?: boolean
}

export type ReviewRow = { label: string; value: string }
export type ReviewGroup = { stepKey: string; rows: ReviewRow[] }
export type ReviewBuilder<V> = (values: V, steps: WizardStepDef<V>[]) => ReviewGroup[]

export type UseWizardOptions<V> = {
  steps: WizardStepDef<V>[]
  initialVisited: 'all' | 'linear'
  validate: WizardValidate<V>
  getValues: () => V
  setError: (path: string, err: { type?: string; message: string }) => void
  clearErrors: (paths: readonly string[]) => void
  onValidationFailed?: (firstPath: string) => void
}

export type UseWizardResult<V> = {
  stepIndex: number
  currentStep: WizardStepDef<V>
  isReviewStep: boolean
  visitedSteps: Set<string>
  isAdvancing: boolean
  goToStep: (key: string) => void
  handleBack: () => void
  handleNext: () => Promise<void>
  handleInvalidSubmit: (formErrors: Record<string, unknown>) => void
}
```

`useWizard` signature, `frontend/src/components/wizard/useWizard.ts:24-25`:

```ts
export function useWizard<V>(options: UseWizardOptions<V>): UseWizardResult<V> {
  const { steps, initialVisited, validate, getValues, setError, clearErrors, onValidationFailed } = options
```

### B10. Profile wizard as the template

`frontend/src/pages/profile/ProfileWizardPage.tsx` imports, lines 29-57:

```ts
import { useNavigate, useParams, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useParticipant, usePatchParticipant, useUpdateParticipant, useStaff, useUpsertCommunityAccessRiskItem } from '@/api/hooks'
import { /* wizard shell + WizardStepDef etc. — see lines 35-38 */ }
import { /* PROFILE_STEP_*_FIELDS + schemas — see lines 39-44 */ }
import { buildProfileStepPatch, buildParticipantWirePayload } from '@/lib/participantPatchGroups'
import { parseServiceStreams, parseHidpaCategories, DIAGNOSIS_OPTIONS, DIAGNOSIS_OTHER_SENTINEL } from '@/api/types/participants'
import { CONSENT_TYPES, HEALTH_CONDITION_TYPES, ADL_TYPES, CHECKLIST_ITEM_TYPES, COMMUNITY_ACCESS_RISK_ITEM_TYPES } from '@/api/types/enums'
import { useDeriveFieldValues, type FieldDerivationDef } from '@/lib/conditionalFields'
import type { UpdateParticipantDto } from '@/api/types/participants'
import { boolToTriState, focusField, extractErrorMessage } from '../intake/intakeFormat'
import { KeyIdentifiersStep } from './steps/KeyIdentifiersStep'
import { CulturalDepthConsentsStep } from './steps/CulturalDepthConsentsStep'
import { MedicalDetailStep } from './steps/MedicalDetailStep'
import { MobilityFunctionalStep } from './steps/MobilityFunctionalStep'
import { BehaviourCognitionStep } from './steps/BehaviourCognitionStep'
import { DailyLivingStep } from './steps/DailyLivingStep'
import { CommunityAccessStep } from './steps/CommunityAccessStep'
```

`WIZARD_STEPS` `useMemo`, `ProfileWizardPage.tsx:269-282`:

```ts
  const WIZARD_STEPS: WizardStepDef<ParticipantFormData>[] = useMemo(() => {
    const steps: WizardStepDef<ParticipantFormData>[] = [
      { key: 'keyIdentifiers', label: 'Key Identifiers', fields: PROFILE_STEP_KEY_IDENTIFIERS_FIELDS },
      { key: 'culturalDepth', label: 'Cultural Depth & Consents', fields: PROFILE_STEP_CULTURAL_DEPTH_FIELDS },
      { key: 'medical', label: 'Medical Detail', fields: PROFILE_STEP_MEDICAL_FIELDS },
      { key: 'mobility', label: 'Mobility & Functional', fields: PROFILE_STEP_MOBILITY_FIELDS },
      { key: 'behaviourCognition', label: 'Behaviour & Cognition', fields: PROFILE_STEP_BEHAVIOUR_FIELDS },
      { key: 'dailyLiving', label: 'Daily Living', fields: PROFILE_STEP_DAILY_LIVING_FIELDS },
    ]
    if (caVisible) steps.push({ key: 'communityAccess', label: 'Community Access', fields: PROFILE_STEP_COMMUNITY_ACCESS_FIELDS })
    return steps
  }, [caVisible])
  const WIZARD_STEPS_FOR_RAIL = useMemo(() => [...WIZARD_STEPS, { key: REVIEW_STEP_KEY, label: 'Review', fields: [] }], [WIZARD_STEPS])
```

`validate` wiring to per-step Zod schema (`PROFILE_STEP_SCHEMAS_BY_KEY` from `participantSchema.ts`) plus per-step PATCH-on-Next, `ProfileWizardPage.tsx:310-326`:

```ts
  const validateStep: WizardValidate<ParticipantFormData> = async (step, values) => {
    const schema = PROFILE_STEP_SCHEMAS_BY_KEY[step.key]
    if (schema) {
      const result = schema.safeParse(values)
      if (!result.success) {
        return result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message, code: issue.code }))
      }
    }
    setSaveError(null)
    try {
      await saveStep(step.key)
      return null
    } catch (err) {
      setSaveError(extractErrorMessage(err, 'Failed to save this section. Please try again.'))
      return [{ path: step.fields[0] as string, message: 'Save failed — see the banner above.', code: 'server' }]
    }
  }

  const wizard = useWizard<ParticipantFormData>({
    steps: WIZARD_STEPS,
    initialVisited: 'linear',
    validate: validateStep,
    getValues,
    setError: (path, err) => setError(path as keyof ParticipantFormData, err),
    clearErrors: (paths) => clearErrors(paths as (keyof ParticipantFormData)[]),
    onValidationFailed: (firstPath) => setFocusRequest({ field: firstPath }),
  })
```

`saveStep` (how `usePatchParticipant` is actually called per step), `ProfileWizardPage.tsx:285-309`:

```ts
  const saveStep = async (stepKey: string) => {
    if (!id) return
    const values = getValues()
    if (stepKey === 'communityAccess') {
      const dto = buildProfileStepPatch(stepKey, values, staVisible)
      if (dto) await patchParticipant.mutateAsync({ id, data: dto })
      await Promise.all(
        (values.communityAccessRiskItems ?? []).map((row) =>
          upsertRiskItem.mutateAsync({
            participantId: id,
            itemType: row.itemType as never,
            data: { rating: (row.rating || null) as never, strategyNotes: row.rating ? (row.strategyNotes || null) : null },
          }),
        ),
      )
      return
    }
    const dto = buildProfileStepPatch(stepKey, values, staVisible)
    if (!dto) return
    await patchParticipant.mutateAsync({ id, data: dto })
  }
```

Review builder, `ProfileWizardPage.tsx:371-390`:

```ts
  const reviewBuilder = (values: ParticipantFormData, steps: WizardStepDef<ParticipantFormData>[]): ReviewGroup[] =>
    steps.map((step): ReviewGroup => {
      const rows: ReviewRow[] = []
      if (step.key === 'keyIdentifiers') {
        rows.push({ label: 'Medicare Number', value: values.medicareNumber || '—' }, { label: 'Weight (kg)', value: String(values.weightKg ?? '—') })
      } else if (step.key === 'culturalDepth') {
        rows.push({ label: 'Personal Interests', value: values.personalInterests || '—' }, { label: 'Consents recorded', value: String((values.consents ?? []).filter((c) => c.granted).length) })
      }
      // ... one else-if branch per step key, building 1-2 summary ReviewRows each
      return { stepKey: step.key, rows }
    })
```
(Called directly at render time: `reviewBuilder(watchedValues as unknown as ParticipantFormData, WIZARD_STEPS)`, `ProfileWizardPage.tsx:440` — it is a plain function, not wired through `useWizard`'s options; `ReviewBuilder<V>` the type exists in `types.ts` but this page doesn't pass it into `useWizard` — it's consumed directly by a `WizardReviewStep` component.)

**Profile step field files** (`frontend/src/pages/profile/steps/`), exported component + prop-destructure line + backing field-list constant (from `frontend/src/lib/participantSchema.ts:507-551`):

| File | Exported component | Props destructured | Fields rendered (from `participantSchema.ts`) |
|---|---|---|---|
| `KeyIdentifiersStep.tsx:18` | `KeyIdentifiersStep` | `{ control, register, errors, participant, activeStaff }` | `middleName, gender, genderSelfDescription, placeOfBirth, country, preferredStaffId, isDsoa, pensionCardNumber, pensionCardExpiry, medicareNumber, medicareExpiry, companionCardNumber, companionCardExpiry, privateHealthFund, privateHealthMembershipNumber` (+ more, `PROFILE_STEP_KEY_IDENTIFIERS_FIELDS`, `participantSchema.ts:507-517`) |
| `CulturalDepthConsentsStep.tsx:31` | `CulturalDepthConsentsStep` | `{ control, register, participant, consentsFieldArray, staVisible }` | `personalInterests, choiceControlNotes, consents` (`participantSchema.ts:518-520`) |
| `MedicalDetailStep.tsx:27` | `MedicalDetailStep` | `{ control, register, errors, participant, healthConditionFieldArray, watchedValues }` | `primaryDiagnosis, primaryDiagnosisOther, otherDiagnoses, hidpaSupportCategories, allergiesDetail, isAnaphylaxisRisk, allergyManagementNotes, healthConditions` (`participantSchema.ts:522-525`) |
| `MobilityFunctionalStep.tsx:25` | `MobilityFunctionalStep` | `{ control, register, participant }` | `mobilitySupportOptions, mobilityNotes, equipmentRequirements, transportRequirements, ambulantStatus, fallsRiskRating, unevenGroundFlag, levelOfPersonalCare, orthotics, continenceSupportDetail, bowelCareDetail, menstruationSupport, skinIntegrity` (+ more, `participantSchema.ts:527-531`) |
| `BehaviourCognitionStep.tsx:23` | `BehaviourCognitionStep` | `{ control, register, participant }` | `memory, memoryAids, impairedUnderstanding, impairedJudgementReasoning, behaviourRiskRating, ridsLogged, bspPlanProvided, bocChartProvided, receptiveSkills, readingAbility, communicationAids` (+ more, `participantSchema.ts:533-537`) |
| `DailyLivingStep.tsx:17` | `DailyLivingStep` | `{ control, register, adlFieldArray, watchedValues, caVisible }` | `adlAssessments, mealAssistanceDetail, chokingRiskMealDetail, modifiedDietDetail, pegRegimeMealDetail, specialUtensilsDetail, specialDietaryNeedsDetail` (+ more, `participantSchema.ts:539-546`) |
| `CommunityAccessStep.tsx:22` | `CommunityAccessStep` | `{ control, register, checklistFieldArray, riskItemsFieldArray, watchedValues }` | `signsHappyAndSettled, whatHelpsMeCalmDown, bocTriggers, bocEarlyWarningSigns, bocDeEscalationStrategies, bocWhatNotToDo, checklistItems, communityAccessRiskItems, overallCommunityAccessRiskRating` (`participantSchema.ts:548-552`) |

Note: `behaviourRiskRating` (row in `MobilityFunctionalStep`'s neighbour, `BehaviourCognitionStep`'s field list) is one of the design doc's own `INTERNAL_FIELDS` (§2) — confirms it's a real Profile field today, so the exclusion list has a real field to exclude, not a hypothetical one.

### B11. Allocation contract API

`frontend/src/lib/documentMapping.ts` exported functions/types related to entry allocation:

```ts
export type SourceDocument = 'intake' | 'profile' | 'shared'          // documentMapping.ts:51

export type EntryPhase = 'intake' | 'profile'                          // documentMapping.ts:62

export interface DocumentMappingEntry {                                // documentMapping.ts:73-95
  entryPhase: EntryPhase
  field: string
  label: string
  sources: SourceDocument[]
  dictionaryId?: string
  notes?: string
  serviceStreams?: ServiceStream[] | 'all'
}

export const DOCUMENT_MAPPING: DocumentMappingEntry[] = [ /* 144 entries as of this branch */ ]  // documentMapping.ts:98

export function fieldsForDocument(doc: 'intake' | 'profile'): DocumentMappingEntry[] {
  return DOCUMENT_MAPPING.filter((entry) => entry.sources.includes(doc) || entry.sources.includes('shared'))
}  // documentMapping.ts:469-471

export function fieldsForEntry(phase: EntryPhase): DocumentMappingEntry[] {
  return DOCUMENT_MAPPING.filter((entry) => entry.entryPhase === phase)
}  // documentMapping.ts:481-483

export function getFieldMapping(field: string): DocumentMappingEntry | undefined {
  return DOCUMENT_MAPPING.find((entry) => entry.field === field)
}  // documentMapping.ts:486-488

export function sharedFieldsDisplayedOnProfile(): DocumentMappingEntry[] {
  return fieldsForDocument('profile').filter((entry) => entry.entryPhase === 'intake')
}  // documentMapping.ts:500-502
```

**Correction to the design doc's wording**: there is **no `DocumentPhase` type** — only `EntryPhase` (`'intake' | 'profile'`, which wizard captures a field) and `SourceDocument` (`'intake' | 'profile' | 'shared'`, which PDF renders it). The caregiver projection's field-scope logic (design §2, "Profile fields minus `INTERNAL_FIELDS`") should be built from `fieldsForEntry('profile')`, **not** `fieldsForDocument('profile')` — the latter also pulls in `entryPhase: 'intake'` shared fields (read-only display), which the design does separately want (as "Shared (intake-captured) fields... included read-only for validation") via `sharedFieldsDisplayedOnProfile()`, which already exists and does exactly that split. So the caregiver DTO builder's two field sets map directly onto two already-existing functions: editable = `fieldsForEntry('profile')`, read-only = `sharedFieldsDisplayedOnProfile()` — no new frontend allocation logic needs to be written, just consumed.

Backend twin public surface (method signatures only):

`backend/Odip.Infrastructure/Services/ParticipantFieldEntryMap.cs:4-38`:
```csharp
public enum ParticipantFieldEntryPhase { Intake, Profile }
public sealed record ParticipantFieldEntryMapEntry(string FieldId, ParticipantFieldEntryPhase Phase);
public static class ParticipantFieldEntryMap
{
    public static readonly IReadOnlyList<ParticipantFieldEntryMapEntry> Entries = new List<ParticipantFieldEntryMapEntry> { /* ... */ };
}
```

`backend/Odip.Infrastructure/Services/ParticipantDocumentFieldMap.cs:4-66`:
```csharp
public enum ParticipantDocumentTag { Intake, Profile, Shared }
public sealed record ParticipantDocumentFieldMapEntry(
    string FieldId, string SectionHeading, string Label, ParticipantDocumentTag Tag,
    string? ParticipantPropertyName, bool IsTable, bool IsCommunityAccessGated);
public static class ParticipantDocumentFieldMap
{
    public static readonly IReadOnlyList<ParticipantDocumentFieldMapEntry> Entries = new List<ParticipantDocumentFieldMapEntry> { /* ... */ };
}
```

Both expose only a public static readonly `Entries` list — no query methods (`fieldsForEntry` etc. exist only on the TypeScript side; the C# mirrors are read-only data tables, filtered ad hoc by whatever test/consumer needs them, e.g. `Odip.Tests/Services/ParticipantFieldEntryMapTests.cs` reads `documentMapping.ts`'s source text at test time to diff against `ParticipantFieldEntryMap.Entries`). A backend `INTERNAL_FIELDS` drift guard (per design §2) should follow the same shape: filter `ParticipantFieldEntryMap.Entries.Where(e => e.Phase == ParticipantFieldEntryPhase.Profile)` and assert every `FieldId` is in the caregiver DTO's known-field set or in `INTERNAL_FIELDS`.

### B12. Axios client

`frontend/src/api/client.ts` — instance creation (lines 1-10):

```ts
import axios from 'axios'
import type { ApiResponse } from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})
```

Request interceptor (adds `Authorization` + `X-View-As-*`), lines 30-45:

```ts
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('odip_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const viewingTenantId = localStorage.getItem('odip_viewing_tenant')
  if (viewingTenantId) {
    config.headers['X-View-As-Tenant'] = viewingTenantId
  }
  const viewingUserId = localStorage.getItem('odip_viewing_user')
  if (viewingUserId) {
    config.headers['X-View-As-User'] = viewingUserId
  }
  return config
})
```

401 interceptor, lines 47-91 (full — refresh-token dance + logout):

```ts
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as typeof error.config & { _retried?: boolean }
    if (error.response?.status === 401 && config?.url?.endsWith('/auth/logout')) {
      return Promise.reject(error)
    }
    if (error.response?.status === 401 && !config._retried) {
      config._retried = true
      try {
        if (!refreshPromise) {
          refreshPromise = (async () => {
            try {
              const { auth } = await import('../lib/firebase')
              const currentUser = auth?.currentUser
              if (!currentUser) return null
              const idToken = await currentUser.getIdToken(true)
              const exchangeRes = await apiClient.post<ApiResponse<{ token: string }>>('/auth/exchange', { idToken })
              const newToken = exchangeRes.data.data?.token ?? null
              if (newToken) localStorage.setItem('odip_token', newToken)
              return newToken
            } finally {
              refreshPromise = null
            }
          })()
        }
        const newToken = await refreshPromise
        if (newToken) {
          config.headers.Authorization = `Bearer ${newToken}`
          return apiClient(config)
        }
      } catch { /* Firebase refresh failed — fall through to logout */ }
      try { await apiClient.post('/auth/logout') } catch { /* ignore */ }
      logout()
    }
    return Promise.reject(error)
  }
)
```

**For a header-free public instance**: build a sibling `export const caregiverApiClient = axios.create({ baseURL: API_BASE, headers: { 'Content-Type': 'application/json' }, withCredentials: false })` in a new file (e.g. `src/api/caregiverClient.ts`) with **no** request/response interceptors at all — the simplest way to guarantee no `Authorization`/`X-View-As-*` header is ever attached, satisfying the design's §7 frontend test ("makes no request carrying an `Authorization` or `X-View-As-*` header"). `withCredentials: false` also matters: the existing `apiClient` sends cookies (`odip_jwt` fallback, per `Program.cs`'s JWT bearer cookie fallback) — the public instance should not, since a signed-in admin's browser hitting a `/caregiver/:token` tab must not leak their session cookie to the public endpoint.

`usePatchParticipant`, `frontend/src/api/hooks/participants.ts:98-108` (full):

```ts
export function usePatchParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PatchParticipantDto }) =>
      apiPatchRaw<ParticipantDetailDto>(`/participants/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['participant', vars.id] })
    },
  })
}
```

Pattern for `usePublicCaregiver`/draft-save/submit mutations: same `useMutation` + typed `mutationFn` shape, but calling through the new header-free client's own `apiPatchRaw`/`apiPutRaw`/`apiPostRaw`-equivalent helpers (or a small parallel set of typed helpers bound to `caregiverApiClient` instead of `apiClient`) — `invalidateQueries` isn't meaningful here since there's no TanStack Query cache shared with the authenticated app (the public route renders outside the app shell entirely, per design §4).

### B13. Routing

`frontend/src/App.tsx` router block, lines 79-83 (opening) showing where `/login` sits outside the shell and where the shell wraps every other route:

```tsx
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Suspense fallback={<div className="flex items-center justify-center h-screen text-[#43493a]">Loading...</div>}><Outlet /></Suspense>}>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<UiPreferencesProvider><ErrorBoundary><PrivateRoute><AppLayout /></PrivateRoute></ErrorBoundary></UiPreferencesProvider>}>
        <Route path="/" element={<PrivateRoute page="dashboard"><DashboardPage /></PrivateRoute>} />
        <Route path="/participants/:id/profile" element={<PrivateRoute page="participants" requiresWrite><ProfileWizardPage /></PrivateRoute>} />
        {/* ...all other authenticated routes... */}
```

**Placement for `/caregiver/:token`**: as a sibling of `/login` at line 82, inside the outer `Suspense`-wrapping `<Route>` but **before** (or after — order among siblings doesn't matter for non-overlapping paths) the `<Route element={<UiPreferencesProvider>...<AppLayout /></PrivateRoute>}>` wrapper element that starts the authenticated shell at line 83:

```tsx
      <Route path="/login" element={<LoginPage />} />
      <Route path="/caregiver/:token" element={<CaregiverWizardPage />} />
      <Route element={<UiPreferencesProvider><ErrorBoundary><PrivateRoute><AppLayout /></PrivateRoute></ErrorBoundary></UiPreferencesProvider>}>
```
This gets it the shared `Suspense`/lazy-loading wrapper (harmless — `/login` already relies on the same outer wrapper) with zero exposure to `PrivateRoute`, `AppLayout`, `UiPreferencesProvider`, or any `usePermissions()` call, matching the design's "no nav, no tenant switcher, no `odip_user` read, no `usePermissions`" requirement exactly.

### B14. Permissions

`canWriteParticipantDetails`, `frontend/src/lib/permissions.ts:178`:
```ts
canWriteParticipantDetails: isSuperAdmin || isAdmin || isCoordinator,
```

`usePermissions` return shape (full, `permissions.ts:41-` through the object literal's closing — every key returned): `role, id, fullName, isSuperAdmin, isAdmin, isCoordinator, isSupportWorker, isReadOnly, canAccessPage(page), canWrite, canCreateIncidents, canManageMedications, canRecordAdministrations, canViewAdministrationReport, canWriteNotes, canWriteRoutines, canWriteRisks, canWriteRestrictivePractices, canWriteContacts, canWriteConsents, canWriteHealthConditions, canWriteAdlAssessments, canWriteParticipantDetails, canWriteSupportProfile, canViewAlerts` (list continues past what this pass read in full — truncated at `canViewAlerts`, `permissions.ts:195`; there are more boolean flags after this point in the file, not enumerated here). The three role booleans (`isSuperAdmin`, `isAdmin`, `isCoordinator`) are computed once (`permissions.ts:58-62`) from `role = (user.role ?? null) as UserRole | null`, itself from `getCurrentUser()` reading `odip_user` out of localStorage — **this whole hook is exactly what the caregiver wizard must never call**, per design §4.

### B15. Header control precedent

DOC-01 "Documents" header buttons on `ParticipantDetailPage.tsx`. Imports, line 2:
```ts
import { useParticipant, useParticipantBookings, useParticipantAlerts, useDownloadIntakeFormPdf, useDownloadParticipantProfilePdf, useDownloadClientOverviewPdf } from '@/api/hooks'
```

One full button block (the other two follow the identical shape), `ParticipantDetailPage.tsx:108-122`:
```tsx
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => downloadParticipantProfile.mutate({ id: id!, fileName: `${p.fullName} - Participant Profile.pdf` })}
              disabled={downloadParticipantProfile.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-all disabled:opacity-50"
            >
              {downloadParticipantProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {downloadParticipantProfile.isPending ? 'Preparing…' : 'Participant Profile PDF'}
            </button>
            {downloadParticipantProfile.isError && (
              <p role="alert" className="text-xs text-[var(--color-destructive)]">
                Couldn't download the file. Try again, or contact support if this keeps happening.
              </p>
            )}
          </div>
```
The new "Caregiver form" control (design §5) should follow this exact `<button>` + `isPending`/`isError` mutation-state shape, but is gated `canWriteParticipantDetails` (per design), unlike these ungated download buttons (comment at `ParticipantDetailPage.tsx:89-93` explains why downloads are ungated — "a read action" — which does **not** apply to generate/revoke, which are writes).

### B16. DataTable + Dropdown

`Column<T>`, `frontend/src/components/DataTable.tsx:37-40`:
```ts
export type Column<T> =
  | (ColumnBase<T> & { key: keyof T & string; render?: (row: T, rowIndex: number) => ReactNode })
  | (ColumnBase<T> & { key: string; render?: (row: T, rowIndex: number) => ReactNode })
```
`ColumnBase<T>`, `DataTable.tsx:12-35`:
```ts
type ColumnBase<T> = {
  header: string | ReactNode
  type?: ColumnType
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  hidden?: boolean
  editable?: { render: (row: T, onChange: (value: unknown) => void, ctx: { errorId?: string }) => ReactNode }
  bulkEditable?: { items: DropdownItem[]; onBulkChange: (selectedIds: string[], value: string) => void }
  sortFn?: (a: T, b: T) => number
  className?: string
}
```
`DataTableProps<T>`, `DataTable.tsx:46-88`:
```ts
export type DataTableProps<T> = {
  data: T[]
  columns: Column<T>[]
  keyField: keyof T & string
  sortable?: boolean
  defaultSort?: SortState
  sort?: SortState
  onSortChange?: (sort: SortState | null) => void
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  emptyMessage?: string
  footer?: ReactNode
  loading?: boolean
  editingRow?: string | number | null
  editingRows?: Set<string>
  onEditChange?: (row: T, key: string, value: unknown) => void
  rowError?: (row: T) => string | undefined
  className?: string
  compact?: boolean
  selectable?: boolean
  selectedRows?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  verticalDividers?: boolean
}
```

`DropdownProps`, `frontend/src/components/Dropdown.tsx:14-45` (full):
```ts
type DropdownProps = {
  variant: 'pill' | 'form' | 'menu' | 'icon'
  items: DropdownItem[]
  value?: string
  onChange?: (value: string) => void
  onSelect?: (value: string) => void
  onBlur?: () => void
  label?: string
  icon?: ReactNode
  colorClass?: string
  disabled?: boolean
  loading?: boolean
  align?: 'left' | 'right'
  searchable?: boolean
  id?: string
  'aria-labelledby'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: 'true'
  'aria-describedby'?: string
}
```
`DropdownItem` (used by both `Column.bulkEditable` and `DropdownProps.items`), `Dropdown.tsx:6-12`:
```ts
export type DropdownItem = {
  value: string
  label: string
  icon?: ReactNode
  description?: string
  disabled?: boolean
}
```

The "Caregiver submissions" page (design §5) should use `DataTable<CaregiverSubmissionListItemDto>` with `columns` built the same way any existing tenant-scoped list page does (not inspected here — out of this pass's scope, but `Column<T>`'s `key: keyof T & string` variant is the one to reach for since the submission DTO will be a plain flat object, not needing the string-key escape hatch).
