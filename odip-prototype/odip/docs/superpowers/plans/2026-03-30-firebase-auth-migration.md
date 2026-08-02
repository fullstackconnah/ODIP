# Firebase Authentication Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-house BCrypt/JWT login system with Firebase Authentication as the identity provider while keeping all tenant/role logic in the .NET backend.

**Architecture:** Frontend signs in via Firebase SDK → Firebase returns a short-lived idToken → Frontend POSTs idToken to `POST /api/v1/auth/exchange` → Backend verifies with Firebase Admin SDK, resolves tenant/role from its own DB, and issues a 30-minute backend JWT → All subsequent API calls use the backend JWT unchanged via existing middleware.

**Tech Stack:** .NET 9 + `FirebaseAdmin` NuGet, React 19 + `firebase` npm package (v10+), TanStack Query v5, existing PostgreSQL/EF Core infrastructure.

---

## File Map

### Backend — modified
| File | Change |
|------|--------|
| `backend/Odip.Api/Program.cs` | Add Firebase Admin SDK init |
| `backend/Odip.Api/Controllers/AuthController.cs` | Replace entirely — new `exchange` endpoint |
| `backend/Odip.Api/Odip.Api.csproj` | Add `FirebaseAdmin`, remove `BCrypt.Net-Next` |
| `backend/Odip.Domain/Entities/User.cs` | Remove `PasswordHash` property |
| `backend/Odip.Infrastructure/Data/DbSeeder.cs` | Remove all `PasswordHash`/BCrypt calls |
| `backend/Odip.Infrastructure/Odip.Infrastructure.csproj` | Remove `BCrypt.Net-Next` |

### Backend — created
| File | Purpose |
|------|---------|
| `backend/Odip.Application/DTOs/ExchangeTokenDto.cs` | Request body for the exchange endpoint |
| `backend/Odip.Infrastructure/Migrations/<timestamp>_RemovePasswordHash.cs` | EF migration (auto-generated) |

### Backend — deleted
| File | Reason |
|------|--------|
| `LoginDto` (wherever it lives) | Login endpoint removed |

### Frontend — modified
| File | Change |
|------|--------|
| `frontend/src/api/hooks/auth.ts` | `useLogin` uses Firebase SDK + exchange endpoint |
| `frontend/src/api/types/auth.ts` | Remove `LoginDto`, keep `AuthResponseDto` |
| `frontend/src/pages/LoginPage.tsx` | Remove username field, add forgot password |
| `frontend/src/api/client.ts` | 401 handler re-exchanges Firebase token instead of redirecting |

### Frontend — created
| File | Purpose |
|------|---------|
| `frontend/src/lib/firebase.ts` | Firebase app + auth instance |
| `frontend/.env.example` | Documents required Firebase env vars |

---

## Task 1: Firebase Console Setup (manual prerequisites — do before any code)

**Files:** None — Firebase console only.

- [ ] **Step 1: Create Firebase project**
  Go to https://console.firebase.google.com → Add project → Name it `Odip` → Disable Google Analytics → Create project.

- [ ] **Step 2: Enable Email/Password sign-in**
  Build → Authentication → Get started → Sign-in method tab → Email/Password → Enable (first toggle only) → Save.

- [ ] **Step 3: Create all user accounts**
  Build → Authentication → Users → Add user. Create one entry for each:
  - `admin@odip.com.au` (SuperAdmin)
  - `sarah.mitchell@demo.odip.com.au`
  - `james.obrien@demo.odip.com.au`
  - `rachel.thompson@demo.odip.com.au`
  - `emily.nguyen@demo.odip.com.au`
  - `daniel.williams@demo.odip.com.au`
  - `readonly@demo.odip.com.au`

  Set a strong password for each. Record them — you will need them to test in Task 9.

- [ ] **Step 4: Generate service account key**
  Project Settings (gear icon top-left) → Service accounts tab → Generate new private key → Download JSON.
  **Do not commit this file.** Store it somewhere safe (e.g. a password manager).

- [ ] **Step 5: Note the web app config**
  Project Settings → General → Your apps → Add app → Web (</>) → Register app (any nickname) → Copy the `firebaseConfig` object. You will need: `apiKey`, `authDomain`, `projectId`, `appId`.

---

## Task 2: Backend — Install FirebaseAdmin and initialize

**Files:**
- Modify: `backend/Odip.Api/Odip.Api.csproj`
- Modify: `backend/Odip.Api/Program.cs`

- [ ] **Step 1: Add FirebaseAdmin package**

```bash
cd "backend/Odip.Api"
dotnet add package FirebaseAdmin
```

Expected output: `info : PackageReference for package 'FirebaseAdmin' version '...` added.

- [ ] **Step 2: Add usings to Program.cs**

At the top of `backend/Odip.Api/Program.cs`, add alongside the existing usings:

```csharp
using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
```

- [ ] **Step 3: Add Firebase initialization block to Program.cs**

After the JWT section (after the `builder.Services.AddAuthorization();` line), insert:

```csharp
// ── Firebase Admin SDK ───────────────────────────────────────
var firebaseServiceAccount = builder.Configuration["Firebase:ServiceAccountJson"]
    ?? Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON");

if (string.IsNullOrEmpty(firebaseServiceAccount))
    throw new InvalidOperationException(
        "Firebase:ServiceAccountJson or FIREBASE_SERVICE_ACCOUNT_JSON env var must be set.");

FirebaseApp.Create(new AppOptions
{
    Credential = GoogleCredential.FromJson(firebaseServiceAccount)
});
```

- [ ] **Step 4: Add service account to local dev config**

Open `backend/Odip.Api/appsettings.Development.json`. Add:

```json
{
  "Firebase": {
    "ServiceAccountJson": "<paste the entire downloaded service account JSON as a single escaped string>"
  }
}
```

To convert the JSON file to a single escaped string, run:
```bash
cat path/to/service-account.json | jq -c .
```
Paste the single-line output as the value.

**Do not commit `appsettings.Development.json` if it contains secrets.** Add it to `.gitignore` if not already there:
```bash
echo "backend/Odip.Api/appsettings.Development.json" >> .gitignore
```

- [ ] **Step 5: Build to verify**

```bash
cd backend
dotnet build Odip.Api/Odip.Api.csproj
```

Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 6: Commit**

```bash
git add backend/Odip.Api/Odip.Api.csproj backend/Odip.Api/Program.cs .gitignore
git commit -m "feat: initialize Firebase Admin SDK in backend"
```

---

## Task 3: Backend — Create ExchangeTokenDto and rewrite AuthController

**Files:**
- Create: `backend/Odip.Application/DTOs/ExchangeTokenDto.cs`
- Modify: `backend/Odip.Api/Controllers/AuthController.cs`
- Modify: `backend/Odip.Api/Odip.Api.csproj` (remove BCrypt)

- [ ] **Step 1: Create ExchangeTokenDto.cs**

Create `backend/Odip.Application/DTOs/ExchangeTokenDto.cs`:

```csharp
namespace Odip.Application.DTOs;

public class ExchangeTokenDto
{
    public string IdToken { get; set; } = string.Empty;
}
```

- [ ] **Step 2: Replace AuthController.cs entirely**

Replace the full content of `backend/Odip.Api/Controllers/AuthController.cs` with:

```csharp
using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Microsoft.AspNetCore.RateLimiting;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Route("api/v1/auth")]
public class AuthController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<AuthController> _logger;

    public AuthController(OdipDbContext db, IConfiguration config, ILogger<AuthController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    /// <summary>
    /// Exchange a Firebase ID token for a Odip backend JWT with tenant and role claims.
    /// </summary>
    [HttpPost("exchange")]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<ApiResponse<AuthResponseDto>>> Exchange(
        [FromBody] ExchangeTokenDto dto, CancellationToken ct)
    {
        // 1. Verify Firebase ID token
        FirebaseToken decodedToken;
        try
        {
            decodedToken = await FirebaseAuth.DefaultInstance.VerifyIdTokenAsync(dto.IdToken, ct);
        }
        catch (FirebaseAuthException ex)
        {
            _logger.LogWarning("Firebase token verification failed: {Message}", ex.Message);
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));
        }

        var email = decodedToken.Claims.TryGetValue("email", out var emailClaim)
            ? emailClaim?.ToString()
            : null;

        if (string.IsNullOrEmpty(email))
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));

        var domain = email.Split('@').Last().ToLower();

        // 2. SuperAdmin path — @odip.com.au bypasses tenant resolution
        if (domain == "odip.com.au")
        {
            var superAdmin = await _db.Users
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(u => u.Email == email && u.IsActive, ct);

            if (superAdmin is null)
            {
                _logger.LogWarning("SuperAdmin exchange — email not in DB: {Email}", email);
                return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));
            }

            superAdmin.LastLoginAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            return Ok(ApiResponse<AuthResponseDto>.Ok(new AuthResponseDto
            {
                Token = GenerateSuperAdminJwtToken(superAdmin),
                ExpiresAt = DateTime.UtcNow.AddMinutes(30),
                Username = superAdmin.Username,
                FullName = superAdmin.FullName,
                Role = "SuperAdmin",
                TenantName = null,
                TenantId = null
            }));
        }

        // 3. Standard tenant path
        var tenant = await _db.Tenants
            .FirstOrDefaultAsync(t => t.EmailDomain == domain && t.IsActive, ct);

        if (tenant is null)
        {
            _logger.LogWarning("Exchange failed — unknown email domain: {Domain}", domain);
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));
        }

        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Email == email && u.TenantId == tenant.Id && u.IsActive, ct);

        if (user is null)
        {
            _logger.LogWarning("Exchange failed — user not found in tenant: {Email}", email);
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<AuthResponseDto>.Ok(new AuthResponseDto
        {
            Token = GenerateJwtToken(user, tenant.Id),
            ExpiresAt = DateTime.UtcNow.AddMinutes(30),
            Username = user.Username,
            FullName = user.FullName,
            Role = user.Role.ToString(),
            TenantName = tenant.Name,
            TenantId = tenant.Id
        }));
    }

    private string GenerateJwtToken(Domain.Entities.User user, Guid tenantId)
    {
        var key = GetSigningKey();
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
            new Claim("fullName", user.FullName),
            new Claim("tenant_id", tenantId.ToString())
        };

        var token = new JwtSecurityToken(
            issuer: "Odip",
            audience: "Odip",
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(30),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private string GenerateSuperAdminJwtToken(Domain.Entities.User user)
    {
        var key = GetSigningKey();
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, "SuperAdmin"),
            new Claim("fullName", user.FullName)
        };

        var token = new JwtSecurityToken(
            issuer: "Odip",
            audience: "Odip",
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(30),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private SymmetricSecurityKey GetSigningKey()
    {
        var secret = _config["Jwt:Secret"] ?? Environment.GetEnvironmentVariable("JWT_SECRET")
            ?? throw new InvalidOperationException("JWT secret not configured.");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
    }
}
```

- [ ] **Step 3: Find and delete LoginDto**

Search for the file:
```bash
grep -rl "class LoginDto" backend/ --include="*.cs"
```

Delete whichever file is returned:
```bash
git rm <path-returned-above>
```

If nothing is returned, skip this step.

- [ ] **Step 4: Remove BCrypt.Net-Next from Odip.Api**

```bash
cd backend/Odip.Api
dotnet remove package BCrypt.Net-Next
```

Expected: Package removed from `Odip.Api.csproj`.

- [ ] **Step 5: Build to verify**

```bash
cd backend
dotnet build
```

Expected: `Build succeeded. 0 Error(s)`. If there are remaining `BCrypt` references, find them with `grep -r "BCrypt" backend/ --include="*.cs"` and remove them.

- [ ] **Step 6: Commit**

```bash
git add backend/Odip.Application/DTOs/ExchangeTokenDto.cs \
        backend/Odip.Api/Controllers/AuthController.cs \
        backend/Odip.Api/Odip.Api.csproj
git commit -m "feat: replace /auth/login with Firebase token exchange endpoint"
```

---

## Task 4: Backend — Drop PasswordHash, update DbSeeder, remove BCrypt from Infrastructure

**Files:**
- Modify: `backend/Odip.Domain/Entities/User.cs`
- Modify: `backend/Odip.Infrastructure/Data/DbSeeder.cs`
- Modify: `backend/Odip.Infrastructure/Odip.Infrastructure.csproj`
- Create: EF migration (auto-generated)

- [ ] **Step 1: Remove PasswordHash from User.cs**

In `backend/Odip.Domain/Entities/User.cs`, remove the `PasswordHash` property line:

```csharp
// DELETE this line:
public string PasswordHash { get; set; } = string.Empty;
```

The file after removal:

```csharp
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

public class User : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName => $"{FirstName} {LastName}";
    public UserRole Role { get; set; }
    public Guid? StaffId { get; set; }
    public Staff? Staff { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
}
```

- [ ] **Step 2: Update DbSeeder.cs — remove all PasswordHash and BCrypt references**

Search for every `PasswordHash` assignment in the seeder:
```bash
grep -n "PasswordHash\|BCryptHash\|BCrypt" backend/Odip.Infrastructure/Data/DbSeeder.cs
```

For each `User { ... PasswordHash = BCryptHash("..."), ... }` block, remove the `PasswordHash = BCryptHash("..."),` line.

Replace the main `seedUsers` array with (no PasswordHash fields):

```csharp
var seedUsers = new[]
{
    (Id: Guid.Parse("b1000000-0000-0000-0000-000000000001"), User: new User {
        Id = Guid.Parse("b1000000-0000-0000-0000-000000000001"),
        TenantId = tenantId,
        Username = "admin",
        Email = "admin@odip.com.au",
        FirstName = "System",
        LastName = "Admin",
        Role = UserRole.SuperAdmin
    }),
    (Id: Guid.Parse("b1000000-0000-0000-0000-000000000002"), User: new User {
        Id = Guid.Parse("b1000000-0000-0000-0000-000000000002"),
        TenantId = demoTenantId,
        Username = "sarah.mitchell",
        Email = "sarah.mitchell@demo.odip.com.au",
        FirstName = "Sarah",
        LastName = "Mitchell",
        Role = UserRole.Coordinator,
        StaffId = existingStaff.Count > 0 ? existingStaff[0].Id : (Guid?)null
    }),
    (Id: Guid.Parse("b1000000-0000-0000-0000-000000000003"), User: new User {
        Id = Guid.Parse("b1000000-0000-0000-0000-000000000003"),
        TenantId = demoTenantId,
        Username = "james.obrien",
        Email = "james.obrien@demo.odip.com.au",
        FirstName = "James",
        LastName = "O'Brien",
        Role = UserRole.SupportWorker,
        StaffId = existingStaff.Count > 1 ? existingStaff[1].Id : (Guid?)null
    }),
    (Id: Guid.Parse("b2000000-0000-0000-0000-000000000001"), User: new User {
        Id = Guid.Parse("b2000000-0000-0000-0000-000000000001"),
        TenantId = demoTenantId,
        Username = "rachel.thompson",
        Email = "rachel.thompson@demo.odip.com.au",
        FirstName = "Rachel",
        LastName = "Thompson",
        Role = UserRole.Coordinator,
        StaffId = existingStaff.Count > 4 ? existingStaff[4].Id : (Guid?)null
    }),
    (Id: Guid.Parse("b2000000-0000-0000-0000-000000000002"), User: new User {
        Id = Guid.Parse("b2000000-0000-0000-0000-000000000002"),
        TenantId = demoTenantId,
        Username = "emily.nguyen",
        Email = "emily.nguyen@demo.odip.com.au",
        FirstName = "Emily",
        LastName = "Nguyen",
        Role = UserRole.SupportWorker,
        StaffId = existingStaff.Count > 2 ? existingStaff[2].Id : (Guid?)null
    }),
    (Id: Guid.Parse("b2000000-0000-0000-0000-000000000003"), User: new User {
        Id = Guid.Parse("b2000000-0000-0000-0000-000000000003"),
        TenantId = demoTenantId,
        Username = "daniel.williams",
        Email = "daniel.williams@demo.odip.com.au",
        FirstName = "Daniel",
        LastName = "Williams",
        Role = UserRole.SupportWorker,
        StaffId = existingStaff.Count > 3 ? existingStaff[3].Id : (Guid?)null
    }),
    (Id: Guid.Parse("b2000000-0000-0000-0000-000000000004"), User: new User {
        Id = Guid.Parse("b2000000-0000-0000-0000-000000000004"),
        TenantId = demoTenantId,
        Username = "coordinator.read",
        Email = "readonly@demo.odip.com.au",
        FirstName = "Read",
        LastName = "Only",
        Role = UserRole.ReadOnly
    }),
};
```

Also remove the `BCryptHash` static helper method (search for `private static string BCryptHash` and delete that method).

For any other `User` constructed elsewhere in DbSeeder with a `PasswordHash` property, remove that property assignment too (run the grep from above to find them all).

- [ ] **Step 3: Remove BCrypt.Net-Next from Odip.Infrastructure**

```bash
cd backend/Odip.Infrastructure
dotnet remove package BCrypt.Net-Next
```

- [ ] **Step 4: Build to verify**

```bash
cd backend
dotnet build
```

Expected: `Build succeeded. 0 Error(s)`. If any `BCrypt` reference remains, the grep from Step 2 will help locate it.

- [ ] **Step 5: Create EF migration**

```bash
dotnet ef migrations add RemovePasswordHash \
  --project backend/Odip.Infrastructure \
  --startup-project backend/Odip.Api
```

Expected: New file created at `backend/Odip.Infrastructure/Migrations/<timestamp>_RemovePasswordHash.cs`.

- [ ] **Step 6: Inspect the migration**

Open the generated migration file and verify it contains exactly:
```csharp
migrationBuilder.DropColumn(
    name: "PasswordHash",
    table: "Users");
```

If it contains anything else unexpected (e.g. trying to alter other columns), investigate before proceeding.

- [ ] **Step 7: Apply the migration**

```bash
dotnet ef database update \
  --project backend/Odip.Infrastructure \
  --startup-project backend/Odip.Api
```

Expected: `Done.`

- [ ] **Step 8: Commit**

```bash
git add backend/Odip.Domain/Entities/User.cs \
        backend/Odip.Infrastructure/Data/DbSeeder.cs \
        backend/Odip.Infrastructure/Odip.Infrastructure.csproj \
        backend/Odip.Infrastructure/Migrations/
git commit -m "feat: drop PasswordHash column and remove BCrypt dependency"
```

---

## Task 5: Frontend — Install Firebase SDK and create firebase.ts

**Files:**
- Create: `frontend/src/lib/firebase.ts`
- Create/Modify: `frontend/.env.example`

- [ ] **Step 1: Install firebase**

```bash
cd frontend && npm install firebase
```

Expected: `firebase` added to `package.json` dependencies.

- [ ] **Step 2: Create src/lib/firebase.ts**

Create `frontend/src/lib/firebase.ts`:

```typescript
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
```

- [ ] **Step 3: Add Firebase vars to .env.example**

Create or update `frontend/.env.example`:

```
VITE_API_BASE_URL=http://localhost:5000/api/v1

# Firebase (values from Firebase Console → Project Settings → Your apps)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

- [ ] **Step 4: Fill in .env.local with real values**

Create `frontend/.env.local` (not committed) with the actual values from Task 1, Step 5.

Ensure `.env.local` is in `.gitignore` (Vite projects include this by default — verify with `cat frontend/.gitignore | grep env.local`).

- [ ] **Step 5: Build to verify**

```bash
cd frontend && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/firebase.ts frontend/.env.example frontend/package.json frontend/package-lock.json
git commit -m "feat: add Firebase SDK and initialize auth client"
```

---

## Task 6: Frontend — Update useLogin hook and remove LoginDto

**Files:**
- Modify: `frontend/src/api/hooks/auth.ts`
- Modify: `frontend/src/api/types/auth.ts`

- [ ] **Step 1: Replace hooks/auth.ts entirely**

Replace the full content of `frontend/src/api/hooks/auth.ts` with:

```typescript
import { useMutation } from '@tanstack/react-query'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { apiPostRaw } from '../client'
import type { AuthResponseDto } from '../types'

export function useLogin() {
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const credential = await signInWithEmailAndPassword(auth, email, password)
      const idToken = await credential.user.getIdToken()
      return apiPostRaw<AuthResponseDto>('/auth/exchange', { idToken })
    },
  })
}
```

- [ ] **Step 2: Remove LoginDto from types/auth.ts**

In `frontend/src/api/types/auth.ts`, delete the `LoginDto` interface. The file should contain only:

```typescript
export interface AuthResponseDto {
  token: string
  expiresAt: string
  username: string
  fullName: string
  role: string
  tenantName: string | null
  tenantId: string | null
}
```

- [ ] **Step 3: Verify LoginDto is not imported anywhere else**

```bash
cd frontend && grep -r "LoginDto" src/ --include="*.ts" --include="*.tsx"
```

Expected: No output. If any file imports `LoginDto`, remove that import.

- [ ] **Step 4: Build to verify**

```bash
cd frontend && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/hooks/auth.ts frontend/src/api/types/auth.ts
git commit -m "feat: useLogin now uses Firebase SDK + /auth/exchange endpoint"
```

---

## Task 7: Frontend — Rewrite LoginPage

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`

- [ ] **Step 1: Replace LoginPage.tsx**

Replace the full content of `frontend/src/pages/LoginPage.tsx` with:

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useLogin } from '@/api/hooks'
import { Map, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const navigate = useNavigate()
  const login = useLogin()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setResetSent(false)
    try {
      const res = await login.mutateAsync({ email, password })
      if (res.success && res.data) {
        localStorage.setItem('odip_token', res.data.token)
        localStorage.setItem('odip_user', JSON.stringify(res.data))
        if (res.data.tenantId) {
          localStorage.setItem('odip_viewing_tenant', res.data.tenantId)
        }
        navigate('/')
      } else {
        setError(res.errors?.[0] || 'Login failed')
      }
    } catch {
      setError('Invalid email or password')
    }
  }

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email address first, then click Forgot password')
      return
    }
    try {
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
      setError('')
    } catch {
      setError('Could not send reset email. Check the address and try again.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fbf9f5] p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#396200] to-[#4d7c0f] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#396200]/20">
            <Map className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[#1b1c1a]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Odip</h1>
          <p className="text-[#43493a] mt-2">NDIS Trip Management Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 shadow-[0_24px_32px_-12px_rgba(27,28,26,0.08)]">
          <h2 className="text-xl font-semibold mb-6 text-[#1b1c1a]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Sign in to your account</h2>

          {error && (
            <div className="mb-4 p-3 rounded-2xl bg-[#ffdad6] text-[#93000a] text-sm">
              {error}
            </div>
          )}

          {resetSent && (
            <div className="mb-4 p-3 rounded-2xl bg-[#e8f5e9] text-[#2e7d32] text-sm">
              Password reset email sent. Check your inbox.
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium mb-1.5 text-[#43493a]">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-2xl bg-[#f5f3ef] text-[#1b1c1a] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all"
                placeholder="Enter your email"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5 text-[#43493a]">Password</label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl bg-[#f5f3ef] text-[#1b1c1a] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 pr-12 transition-all"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#43493a] hover:text-[#1b1c1a] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              id="login-submit"
              type="submit"
              disabled={login.isPending}
              className="w-full py-2.5 rounded-full bg-gradient-to-br from-[#396200] to-[#4d7c0f] text-white font-bold hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-[#396200]/20"
            >
              {login.isPending ? 'Signing in...' : 'Sign In'}
            </button>
          </div>

          <div className="flex justify-between items-center mt-6">
            <button
              type="button"
              onClick={handleForgotPassword}
              className="text-xs text-[#396200] hover:underline"
            >
              Forgot password?
            </button>
            <p className="text-xs text-[#43493a]">
              Contact your administrator for access.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build to verify**

```bash
cd frontend && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx
git commit -m "feat: login page — email+password only, add forgot password via Firebase"
```

---

## Task 8: Frontend — Update 401 handler with re-exchange logic

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Replace the response interceptor in client.ts**

Find this block in `frontend/src/api/client.ts`:

```typescript
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('odip_token')
      localStorage.removeItem('odip_user')
      localStorage.removeItem('odip_viewing_tenant')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
```

Replace it with:

```typescript
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as typeof error.config & { _retried?: boolean }
    if (error.response?.status === 401 && !config._retried) {
      try {
        const { auth } = await import('../lib/firebase')
        const currentUser = auth.currentUser
        if (currentUser) {
          const idToken = await currentUser.getIdToken(true)
          const exchangeRes = await apiClient.post<ApiResponse<{ token: string }>>(
            '/auth/exchange',
            { idToken }
          )
          const newToken = exchangeRes.data.data?.token
          if (newToken) {
            localStorage.setItem('odip_token', newToken)
            config._retried = true
            config.headers.Authorization = `Bearer ${newToken}`
            return apiClient(config)
          }
        }
      } catch {
        // Firebase refresh failed — fall through to logout
      }
      localStorage.removeItem('odip_token')
      localStorage.removeItem('odip_user')
      localStorage.removeItem('odip_viewing_tenant')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
```

The `_retried` flag prevents an infinite loop if the exchange endpoint itself returns 401 (e.g. user deleted from Firebase or DB).

- [ ] **Step 2: Build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: Both pass with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: re-exchange Firebase token on 401 before redirecting to login"
```

---

## Task 9: End-to-End Smoke Test

- [ ] **Step 1: Start the backend**

```bash
dotnet run --project backend/Odip.Api
```

Expected: API starts. No startup exceptions. Look specifically for:
- `Firebase app initialized` (or no Firebase errors in console)
- `Now listening on: http://localhost:5000`

- [ ] **Step 2: Start the frontend**

```bash
cd frontend && npm run dev
```

Expected: `Local: http://localhost:5173/`

- [ ] **Step 3: Test standard user login**

Open http://localhost:5173/login.
Enter email `sarah.mitchell@demo.odip.com.au` and the password set in Task 1, Step 3.
Click Sign In.

Expected: Redirected to `/` with the dashboard loaded. Open DevTools → Application → Local Storage and confirm:
- `odip_token` is set (a JWT)
- `odip_user` is set with `role: "Coordinator"`, `tenantId` is not null

- [ ] **Step 4: Test SuperAdmin login**

Log out (or clear localStorage), then log in with `admin@odip.com.au`.

Expected: Redirected to dashboard with `role: "SuperAdmin"`, `tenantId: null` in stored user.

- [ ] **Step 5: Test wrong password**

Try logging in with a wrong password.

Expected: Error message "Invalid email or password" shown. No redirect.

- [ ] **Step 6: Test forgot password**

Enter a valid email in the email field, then click "Forgot password?".

Expected: Green confirmation "Password reset email sent. Check your inbox." appears. Email arrives from Firebase.

- [ ] **Step 7: Verify 30-minute JWT expiry**

Decode the stored `odip_token` at https://jwt.io (paste the token). Check the `exp` claim.

Expected: `exp` is approximately 30 minutes from now (not 8 hours).

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "chore: Firebase auth migration complete"
```
