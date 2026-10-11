using System.Net;
using System.Text;
using System.Threading.RateLimiting;
using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Odip.Api.RateLimiting;
using Odip.Api.Services;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.Services;

AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

var builder = WebApplication.CreateBuilder(args);

// ── Database ─────────────────────────────────────────────────
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? Environment.GetEnvironmentVariable("POSTGRES_CONNECTION_STRING")
    ?? "Host=localhost;Port=5432;Database=odip;Username=postgres;Password=postgres";

// AuditInterceptor writes AuditLog rows (for the entity types listed in
// Odip.Infrastructure.Audit.AuditedEntities) on every SaveChanges call. It must be registered
// in DI and wired into AddDbContext via AddInterceptors — previously it existed but was never
// referenced from Program.cs, so no audit rows were ever written.
builder.Services.AddScoped<Odip.Infrastructure.Audit.AuditInterceptor>();

builder.Services.AddDbContext<OdipDbContext>((sp, options) =>
    options.UseNpgsql(connectionString)
        .AddInterceptors(sp.GetRequiredService<Odip.Infrastructure.Audit.AuditInterceptor>()));

// ── JWT Authentication ───────────────────────────────────────
var jwtSecret = builder.Configuration["Jwt:Secret"];
if (string.IsNullOrEmpty(jwtSecret))
    jwtSecret = Environment.GetEnvironmentVariable("JWT_SECRET");

if (string.IsNullOrEmpty(jwtSecret) || jwtSecret == "Odip-Dev-Only-Secret-Min32Characters!!")
    throw new InvalidOperationException(
        "Jwt:Secret must be set to a strong secret in configuration or JWT_SECRET environment variable.");

if (jwtSecret.Length < 32)
    throw new InvalidOperationException("JWT secret must be at least 32 characters long.");

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = "Odip",
        ValidateAudience = true,
        ValidAudience = "Odip",
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromMinutes(2)
    };
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            if (string.IsNullOrEmpty(context.Token) && context.Request.Cookies.TryGetValue("odip_jwt", out var cookieToken))
            {
                context.Token = cookieToken;
            }
            return Task.CompletedTask;
        }
    };
});

builder.Services.AddAuthorization();

// ── Firebase Admin SDK ───────────────────────────────────────
// Priority: 1) full JSON from config/env  2) file path  3) individual env vars
var firebaseServiceAccount = builder.Configuration["Firebase:ServiceAccountJson"];
if (string.IsNullOrEmpty(firebaseServiceAccount))
    firebaseServiceAccount = Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON");

// If value points to a .json file on disk, read its contents
if (!string.IsNullOrEmpty(firebaseServiceAccount)
    && firebaseServiceAccount.EndsWith(".json", StringComparison.OrdinalIgnoreCase)
    && File.Exists(firebaseServiceAccount))
{
    firebaseServiceAccount = File.ReadAllText(firebaseServiceAccount);
}

// Fallback: build the JSON from individual env vars (avoids Compose interpolation issues)
if (string.IsNullOrEmpty(firebaseServiceAccount))
{
    var projectId = Environment.GetEnvironmentVariable("FIREBASE_PROJECT_ID");
    var privateKey = Environment.GetEnvironmentVariable("FIREBASE_PRIVATE_KEY");
    var clientEmail = Environment.GetEnvironmentVariable("FIREBASE_CLIENT_EMAIL");

    if (!string.IsNullOrEmpty(projectId) && !string.IsNullOrEmpty(privateKey) && !string.IsNullOrEmpty(clientEmail))
    {
        var privateKeyId = Environment.GetEnvironmentVariable("FIREBASE_PRIVATE_KEY_ID") ?? "";
        var clientId = Environment.GetEnvironmentVariable("FIREBASE_CLIENT_ID") ?? "";
        var tokenUri = Environment.GetEnvironmentVariable("FIREBASE_TOKEN_URI") ?? "https://oauth2.googleapis.com/token";

        firebaseServiceAccount = System.Text.Json.JsonSerializer.Serialize(new
        {
            type = "service_account",
            project_id = projectId,
            private_key_id = privateKeyId,
            private_key = privateKey.Replace("\\n", "\n"),
            client_email = clientEmail,
            client_id = clientId,
            auth_uri = "https://accounts.google.com/o/oauth2/auth",
            token_uri = tokenUri,
            auth_provider_x509_cert_url = "https://www.googleapis.com/oauth2/v1/certs",
            client_x509_cert_url = $"https://www.googleapis.com/robot/v1/metadata/x509/{Uri.EscapeDataString(clientEmail)}"
        });
    }
}

var devAuthEnabled = string.Equals(
    Environment.GetEnvironmentVariable("DEV_AUTH_ENABLED"), "true", StringComparison.OrdinalIgnoreCase);

if (devAuthEnabled)
{
    Console.WriteLine("***********************************************************************");
    Console.WriteLine("*** DEV AUTH ENABLED — /api/v1/auth/dev-login and /api/v1/auth/dev-users  ***");
    Console.WriteLine("*** will issue tokens without a password. Do NOT expose this instance   ***");
    Console.WriteLine("*** to the internet.                                                     ***");
    Console.WriteLine("***********************************************************************");
}

if (string.IsNullOrEmpty(firebaseServiceAccount) && !devAuthEnabled)
    throw new InvalidOperationException(
        "Firebase credentials not configured. Provide one of: " +
        "Firebase:ServiceAccountJson (config/env with full JSON), " +
        "FIREBASE_SERVICE_ACCOUNT_JSON (file path), " +
        "or FIREBASE_PROJECT_ID + FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL (individual env vars).");

if (string.IsNullOrEmpty(firebaseServiceAccount) && devAuthEnabled)
{
    Console.WriteLine("***********************************************************************");
    Console.WriteLine("*** DEV AUTH ENABLED — Firebase disabled, /api/v1/auth/dev-login will   ***");
    Console.WriteLine("*** issue tokens without a password. Do NOT expose this instance to     ***");
    Console.WriteLine("*** the internet.                                                        ***");
    Console.WriteLine("***********************************************************************");
}
else
{
    // Firebase credentials are present (or dev auth is off, in which case the throw above
    // already fired) — initialise Firebase normally so the real login keeps working even
    // when dev auth is also enabled.
    FirebaseApp.Create(new AppOptions
    {
        Credential = GoogleCredential.FromJson(firebaseServiceAccount)
    });
}

// ── NDIS Claiming Services ────────────────────────────────────
builder.Services.AddScoped<Odip.Infrastructure.Services.ClaimGenerationService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ShiftClaimGenerationService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.BprCsvService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.InvoiceService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.CatalogueImportService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.PlanPricingService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.FundingPlanService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.BudgetLedgerService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.BudgetListService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.AgreementCheckService>();
// Budget phase 3: the roster's budget check, with the one seam to the shift estimator (the ledger's own pricing).
builder.Services.AddScoped<Odip.Infrastructure.Services.IShiftCostSource, Odip.Infrastructure.Services.LedgerShiftCostSource>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ShiftBudgetCheck>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ShiftBudgetEffect>();
// The plan quote is the one heavy request: about two in flight per organisation (a resource filter, because the rate limiter runs before authentication).
builder.Services.AddSingleton<Odip.Api.RateLimiting.PlanQuoteConcurrencyLimiter>();
builder.Services.AddScoped<Odip.Api.RateLimiting.PlanQuoteConcurrencyFilter>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ServiceAgreementDraftService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ElectronicSigningEvidenceService>();
// Plan builder phase D: "Mark approved" makes roster patterns and open shifts. The one generator is shared with the Generate button and the daily top-up; the gate is the readiness check the
// roster writes use (the API owns it, so the infrastructure services reach it through this seam); the top-up job itself is registered below with the other hosted services.
builder.Services.AddSingleton<Odip.Infrastructure.Rostering.IRosterPlacementGate, Odip.Api.Services.RosterPlacementGate>();
builder.Services.AddSingleton<Odip.Infrastructure.Rostering.RosterShiftGenerator>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ServiceAgreementApprovalService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.DemoJourneySimulationService>();
// DOC-01 — Intake Form / Participant Profile PDF exports.
builder.Services.AddScoped<Odip.Infrastructure.Services.ParticipantDocumentService>();

// ── Participant Risk Alerts (task 6c) — computed, not persisted ──
builder.Services.AddScoped<Odip.Infrastructure.Services.NdiaRejectionReader>();
builder.Services.AddScoped<Odip.Infrastructure.Services.BudgetAlertSource>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ParticipantAlertsService>();

// ── Participant preferred-staff <-> rostering compatibility matrix link (task 6d) ──
builder.Services.AddScoped<Odip.Infrastructure.Services.StaffCompatibilityLinkService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.SafetyNoteSyncService>();
builder.Services.AddScoped<Odip.Infrastructure.Rostering.IStaffUnavailabilityQuery, Odip.Infrastructure.Rostering.StaffUnavailabilityQuery>();
builder.Services.AddScoped<Odip.Infrastructure.Rostering.IStaffAvailabilityItemsQuery, Odip.Infrastructure.Rostering.StaffAvailabilityItemsQuery>();

// ── Shift package: MAR slot computation with a window form (shared by the MAR and the portal) ──
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<Odip.Infrastructure.Services.MedicationSlotService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.MedicationAdministrationRecorder>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ShiftBreakService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ShiftHandoverService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ShiftRoutineCheckService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.ShiftPackageService>();

// ── Public Holiday Sync ───────────────────────────────────────
builder.Services.AddHttpClient<Odip.Infrastructure.Services.NagerHolidayProvider>();
builder.Services.AddScoped<Odip.Infrastructure.Services.IHolidayProvider, Odip.Infrastructure.Services.NagerHolidayProvider>();
builder.Services.AddScoped<Odip.Application.Interfaces.IPublicHolidaySyncService, Odip.Infrastructure.Services.PublicHolidaySyncService>();
// Singleton: the failure counts are in-process state and must outlive a request. See
// LoginAttemptTracker's note about scaling out — a second replica gets its own counts.
builder.Services.AddSingleton<Odip.Application.Interfaces.ILoginAttemptTracker, Odip.Infrastructure.Services.LoginAttemptTracker>();
builder.Services.AddHostedService<Odip.Infrastructure.BackgroundServices.HolidaySyncBackgroundService>();

// ── Notifications (transactional outbox + dispatcher) ──────────
// docs/specs/2026-09-08-notifications-design.md.
builder.Services.AddScoped<Odip.Application.Interfaces.INotificationRaiser, Odip.Infrastructure.Notifications.NotificationRaiser>();
builder.Services.AddScoped<Odip.Application.Interfaces.INotificationChannel, Odip.Infrastructure.Notifications.SmtpEmailChannel>();
builder.Services.AddScoped<Odip.Application.Interfaces.INotificationChannel, Odip.Infrastructure.Notifications.SmsChannel>();
builder.Services.AddHostedService<Odip.Infrastructure.BackgroundServices.NotificationDispatchBackgroundService>();

// ── Roster top-up (plan builder phase D) ──────────────────────────
// Keeps RosterTopUp:HorizonDays (56) days of open shifts generated for the patterns an approved agreement made, once for each organisation's provider day. RosterTopUp:Enabled (default true)
// switches it off; hand-made and demo patterns are never touched. Reads the clock the rest of the API reads (TimeProvider.System, registered above).
builder.Services.AddHostedService<Odip.Infrastructure.BackgroundServices.RosterTopUpBackgroundService>();

// ── Public early-access form (landing page) ──────────────────────
// EarlyAccessService stores the request; EarlyAccessNotifier is the opt-in operator email (needs BOTH
// EarlyAccess:NotifyEmail and Notifications:Smtp:Host — by default nothing is sent). One singleton instance
// serves as both the IEarlyAccessNotifier the controller calls and the hosted service that drains its queue.
builder.Services.AddEarlyAccess();

// ── Demo-data top-up (DemoData:Scenarios, Off by default: with it Off this registers nothing) ──
builder.Services.AddDemoData(builder.Configuration);

// ── Obligation tasks (item 9 of the connection map — generic task engine) ──
builder.Services.AddScoped<Odip.Application.Interfaces.IObligationTaskService, Odip.Infrastructure.Tasks.ObligationTaskService>();

// ── Forwarded Headers ────────────────────────────────────────
// The app sits behind nginx (see nginx/default.conf), which proxies /api/ to this
// container and sets X-Real-IP / X-Forwarded-For. Without this, every request's
// Connection.RemoteIpAddress is the nginx container's address, so the rate limiter
// below (partitioned by IP) collapses into a single global bucket shared by every
// client — five failed logins from any one person locks out the whole platform.
//
// We deliberately do NOT clear KnownProxies/KnownNetworks (the common "just make it
// work" fix): an empty trust list makes ForwardedHeadersMiddleware accept
// X-Forwarded-For from ANY upstream, so a direct client could set that header itself
// and spoof an arbitrary IP to dodge the rate limiter entirely. Instead we trust only
// the Docker default bridge network range (172.16.0.0/12, which covers the
// 172.17.0.0/16-172.31.0.0/16 subnets Docker Compose assigns bridge networks from) —
// i.e. only a proxy hop originating from inside our own Docker network is trusted to
// set these headers; anything else is treated as an untrusted end client.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
    options.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(IPAddress.Parse("172.16.0.0"), 12));
});

// ── Rate Limiting ────────────────────────────────────────────
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Strict rate limit for login endpoint to prevent brute force
    options.AddPolicy("login", context =>
    {
        // The dev-login / dev-users / dev-whoami endpoints are only reachable at all when
        // DEV_AUTH_ENABLED=true (AuthController.IsDevAuthEnabled() 404s them
        // otherwise) — that flag is already an explicit, operator-controlled opt-in
        // that "do not expose this instance to the internet" applies to. Once an
        // operator has made that choice, the 5-per-5-minutes login limiter only adds
        // friction to local/dev testing without buying any extra security, so we
        // exempt exactly those paths from it, gated on the SAME env var the
        // controller checks (no second flag to drift out of sync). The real
        // credential-exchange endpoint (/api/v1/auth/exchange) is deliberately
        // excluded from this exemption and keeps the fixed-window limiter
        // unconditionally — even with dev auth on — since it is the endpoint an
        // attacker would actually target.
        if (IsDevAuthEnabled() && IsDevAuthRateLimitExemptPath(context.Request.Path))
        {
            // MUST NOT share a partition key with the limited branch below. A
            // PartitionedRateLimiter caches one limiter instance per key, so if the
            // exempt branch created the partition for an IP first, every later request
            // from that IP reused the no-op limiter — including /auth/exchange. Hitting
            // dev-login once disabled brute-force protection entirely for that client.
            // The "exempt:" prefix keeps the two branches in separate partitions.
            return RateLimitPartition.GetNoLimiter(
                RecordLimiterPartitionKey(context, "exempt:" + RateLimitPartitionKey(context)));
        }

        // Deliberately generous, and no longer the brute-force defence. This is a flood
        // guard only; repeated FAILED sign-ins are handled by ILoginAttemptTracker, which
        // can tell a failure from a success where this middleware cannot — it runs before
        // the endpoint and spends a permit either way.
        //
        // The old 5-per-5-minutes budget was the brute-force defence, and it counted
        // successful logins too. Behind shared egress (several devices leaving one NAT
        // address) that locked real users out during ordinary use: five sign-ins from the
        // office and the sixth person cannot log in for five minutes. Sliding segments
        // also mean recovery is gradual instead of everything unblocking at once.
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

    // Public, token-authenticated caregiver form. Tighter than "api": these routes carry no
    // bearer token, so the only brake on a leaked or guessed link is this limiter.
    options.AddPolicy("public", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: "public:" + RateLimitPartitionKey(context),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // Public landing-page form (POST /api/public/early-access): 5 per client IP per 10 minutes plus a
    // global cap, chained per-client-first so one noisy address cannot spend the shared budget. It is a
    // GlobalLimiter that returns "no limit" for every request not routed to an [EarlyAccessRateLimit]
    // action, so all the named policies above are unaffected. See EarlyAccessRateLimiting.
    options.GlobalLimiter = EarlyAccessRateLimiting.CreateLimiter(EarlyAccessRateLimiting.ClientKey, EarlyAccessRateLimits.Default);

    // One rejection handler for the whole app: 429 plus Retry-After when the limiter can say when to retry.
    // (Setting OnRejected supersedes RejectionStatusCode above; the handler sets the 429 itself.)
    options.OnRejected = RateLimitRejection.WriteAsync;
});

// Partition key for the rate limiter. Resolved AFTER UseForwardedHeaders() has run, so
// under normal (proxied) operation this is the real client IP. If the IP genuinely
// cannot be resolved, fall back to the per-request TraceIdentifier rather than a
// constant literal like "unknown" — a constant string would still bucket every such
// request into one shared partition, defeating the per-client isolation this fix is
// for.
static string RateLimitPartitionKey(HttpContext context) =>
    context.Connection.RemoteIpAddress?.ToString() ?? context.TraceIdentifier;

// Stashes the key the limiter ACTUALLY partitioned on so /auth/dev-whoami can report
// it. Reading Connection.RemoteIpAddress from a controller is not the same measurement:
// the controller runs later in the pipeline, so the two can disagree, and when they do,
// a diagnostic that reports the controller's view describes something other than the
// limiter's behaviour. This records the real value at the real moment.
const string LimiterPartitionKeyItem = "__odip.limiterPartitionKey";
static string RecordLimiterPartitionKey(HttpContext context, string key)
{
    context.Items[LimiterPartitionKeyItem] = key;
    return key;
}

// Mirrors AuthController.IsDevAuthEnabled() exactly — same env var, same comparison —
// so the rate-limit exemption can never drift out of sync with whether the dev
// endpoints are actually reachable.
static bool IsDevAuthEnabled() =>
    string.Equals(Environment.GetEnvironmentVariable("DEV_AUTH_ENABLED"), "true", StringComparison.OrdinalIgnoreCase);

// Exact (not substring/prefix) match against the dev-auth paths, case-insensitive,
// tolerant of a trailing slash. Exact-equality is deliberate: a Contains/StartsWith
// check could be tricked by a path like "/api/v1/auth/dev-login-evil" or
// "/api/v1/auth/dev-loginX/exchange" into exempting something it shouldn't.
// AuthController routes these at [Route("api/v1/auth")] + [HttpPost("dev-login")] /
// [HttpGet("dev-users")] / [HttpGet("dev-whoami")], and nginx proxies /api/ straight
// through with no path rewriting (see nginx/default.conf), so this is exactly the
// path ASP.NET Core sees.
static bool IsDevAuthRateLimitExemptPath(PathString path)
{
    var value = path.Value?.TrimEnd('/');
    return string.Equals(value, "/api/v1/auth/dev-login", StringComparison.OrdinalIgnoreCase)
        || string.Equals(value, "/api/v1/auth/dev-users", StringComparison.OrdinalIgnoreCase)
        || string.Equals(value, "/api/v1/auth/dev-whoami", StringComparison.OrdinalIgnoreCase);
}

// ── Swagger ──────────────────────────────────────────────────
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "Odip API", Version = "v1", Description = "NDIS Trip Management Platform API" });
    c.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        Description = "JWT Bearer token. Enter: Bearer {token}",
        Name = "Authorization",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });
    c.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        {
            new Microsoft.OpenApi.Models.OpenApiSecurityScheme
            {
                Reference = new Microsoft.OpenApi.Models.OpenApiReference { Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
});

// ── CORS ─────────────────────────────────────────────────────
var allowedOrigins = Environment.GetEnvironmentVariable("ALLOWED_ORIGINS")?.Split(',') ?? new[] { "http://localhost:5173", "http://localhost:3000" };
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => Odip.Api.Middleware.ApiCorsPolicy.Configure(policy, allowedOrigins));
});

// ── Controllers ──────────────────────────────────────────────
builder.Services.AddControllers()
    .AddJsonOptions(options => Odip.Api.Serialization.ApiJsonOptions.Configure(options.JsonSerializerOptions));

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();

// ── Health checks ────────────────────────────────────────────
// Only the database check is registered, tagged "ready" so liveness can exclude it.
builder.Services.AddHealthChecks()
    .AddCheck<Odip.Api.Health.DatabaseHealthCheck>("database", tags: new[] { "ready" });

var app = builder.Build();

// No tz database in the runtime (an alpine image, a stripped container): the provider's zone falls back to a fixed +10:00, so "today" and local
// times are right for AEST and an hour out in AEDT. Say so once at startup, so nobody finds out from a wrong due date.
if (!Odip.Domain.Rostering.ProviderLocalTime.TzDataAvailable)
    app.Logger.LogWarning("No tz database in this runtime: provider-local dates and times use a fixed +10:00 (an hour out in daylight saving). Install tzdata.");

// ── Migrate + Seed (with retry for transient DB connectivity) ─
const int maxRetries = 5;
for (var attempt = 1; attempt <= maxRetries; attempt++)
{
    try
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();

        // Verify connectivity before running migrations
        await db.Database.CanConnectAsync();

        // Bootstrap: create the EF migrations history table if it doesn't exist yet.
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
                "MigrationId" character varying(150) NOT NULL,
                "ProductVersion" character varying(32) NOT NULL,
                CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
            );
            """);

        // Pre-populate migration history for databases that were created before EF
        // migration tracking was introduced.
        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
            SELECT m."MigrationId", '8.0.11'
            FROM (VALUES
                ('20260320104626_AddIncidentReports'),
                ('20260320133223_AddScheduledActivityTrackingFields'),
                ('20260321093551_AddInsuranceTracking'),
                ('20260327084507_AddPaymentStatusToBooking')
            ) AS m("MigrationId")
            WHERE EXISTS (
                SELECT 1 FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = 'AccommodationProperties'
            )
            ON CONFLICT DO NOTHING;
            """);

        // Repair: if AddNdisClaiming was falsely marked as applied by the
        // pre-population block but the tables don't actually exist, remove the
        // false history entry so MigrateAsync re-runs the migration properly.
        await db.Database.ExecuteSqlRawAsync(
            """
            DELETE FROM "__EFMigrationsHistory"
            WHERE "MigrationId" = '20260327121732_AddNdisClaiming'
            AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = 'SupportActivityGroups'
            );
            """);

        // Apply pending EF Core migrations
        await db.Database.MigrateAsync();

        await DbSeeder.SeedAsync(db);
        await DbSeeder.SeedNdisDataAsync(db);
        await DbSeeder.SeedMedicationsAsync(db);
        await DbSeeder.SeedParticipantNotesAsync(db);
        await DbSeeder.SeedParticipantRoutinesAsync(db);
        await DbSeeder.SeedRestrictivePracticesAsync(db);
        await DbSeeder.SeedParticipantRiskEntriesAsync(db);
        await DbSeeder.SeedParticipantConsentsAsync(db);
        await DbSeeder.SeedParticipantHealthConditionsAsync(db);
        await DbSeeder.SeedParticipantClinicalEnrichmentAsync(db);
        await DbSeeder.SeedParticipantAdlAssessmentsAsync(db);
        await DbSeeder.SeedParticipantDailyLivingAsync(db);
        await DbSeeder.SeedCommunityAccessDailyLivingAsync(db);
        await DbSeeder.SeedShiftNotesAsync(db);

        break; // Success — exit retry loop
    }
    catch (Exception ex) when (attempt < maxRetries &&
        (ex is Npgsql.NpgsqlException || ex is System.Net.Sockets.SocketException || ex is TimeoutException))
    {
        var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt)); // 2s, 4s, 8s, 16s
        Console.WriteLine($"[Startup] DB connection attempt {attempt}/{maxRetries} failed: {ex.Message}. Retrying in {delay.TotalSeconds}s...");
        await Task.Delay(delay);
    }
}

// ── Middleware pipeline ──────────────────────────────────────
// UseForwardedHeaders() MUST be the very first middleware — everything after this
// point (security headers, exception handling, the rate limiter, CORS, auth,
// ReadOnlyMiddleware, controllers/logging) may read Connection.RemoteIpAddress or
// Request.Scheme, and needs the real client values, not the nginx hop's.
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
    context.Response.Headers["Permissions-Policy"] = "geolocation=(self), microphone=(), camera=(), payment=()";
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

// ── Health endpoints ─────────────────────────────────────────
// The "/api/" prefix is mandatory: nginx (nginx/default.conf) proxies only `location /api/` to the API
// — anything else falls through to the SPA's
// `try_files … /index.html`, so a probe at bare "/health" would get index.html with a 200.
// No .RequireRateLimiting(...): probes fire on a fixed interval and would eat the
// "api" 100/min budget. The default plain-text writer is kept deliberately — these are
// unauthenticated endpoints, so no JSON body and no exception detail leaves the process.

// Liveness: process is up and serving. No dependency checks — a liveness probe that
// fails on a database outage tells an orchestrator to restart a process that is fine.
app.MapHealthChecks("/api/health/live", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    Predicate = _ => false
}).AllowAnonymous();

// Readiness: liveness plus Postgres reachability.
app.MapHealthChecks("/api/health/ready", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
}).AllowAnonymous();

app.MapControllers();

app.Run();
