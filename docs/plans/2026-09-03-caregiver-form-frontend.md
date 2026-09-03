# Caregiver Profile Form — Frontend Implementation Plan (cg03 + cg04)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, session-free caregiver wizard at `/caregiver/:token` that gates on the caregiver's name, drafts to the public API, submits once, and renders read-only/rejected/invalid states; plus the admin surfaces — a caregiver-link control on the participant header, a submissions list, and a side-by-side diff review with accept/reject.

**Architecture:** The caregiver page renders outside the authenticated shell through a header-free Axios instance and reuses the Profile wizard's step components with a `hiddenFields` prop for the two internal fields they render. The field set is derived from the allocation contract (`fieldsForEntry('profile')` minus `CAREGIVER_INTERNAL_FIELDS`) with a drift-guard test. Admin pages use the authenticated client, `DataTable`, and `canWriteParticipantDetails`.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, react-router 7, react-hook-form + zod, TanStack Query, vitest + Testing Library, Tailwind 4.

**Spec:** `docs/specs/2026-09-03-caregiver-profile-form-design.md`. Backend contract: `docs/plans/2026-09-03-caregiver-form-backend.md` Task 6 (DTOs) and Tasks 7–8 (routes).

## Global Constraints

- Run frontend commands from `odip-prototype/odip/frontend`. Repo root for `git` is `F:\Projects\personal\ODIP`.
- Never touch `bin/`, `obj/`, `node_modules/`, `_to_delete/`, `odip-prototype.zip`, `docs/superpowers/`.
- **Worktree setup before any gate:** `npm ci`, then `cp "F:/Projects/personal/ODIP/odip-prototype/odip/frontend/.env.local" ./.env.local`. Without the env file `AppLayout.test.tsx` fails on a missing `VITE_FIREBASE_API_KEY` — environmental, not a defect.
- Gates before every commit: `npm run build` (this is `tsc -b && vite build` — **vitest does not typecheck**), `npm test`, `npm run lint`. **Lint must be exactly 77 problems (75 errors, 2 warnings).** Any increase is a new error you introduced; find it per-file against `origin/main`.
- Every control uses `Dropdown` / `SearchableSelect` / `CompactGridRow` from `src/components/`. **No native `<select>`.**
- `useWizard`'s `steps` array must be `useMemo`'d.
- **The caregiver page must never call `usePermissions`, read `odip_user`, or import from `AppLayout`.**
- **Before every push:** `git diff HEAD` must be empty.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV
  ```

---

## File Structure

**Branch `feat/cg03-caregiver-wizard`** (Tasks 1–7), based on `origin/main` **after cg01+cg02 merge**

| File | Responsibility |
|---|---|
| Create `src/api/caregiverClient.ts` | Axios instance with **no** interceptors, `withCredentials: false` |
| Create `src/api/types/caregiver.ts` | TS mirrors of the backend DTOs |
| Create `src/api/hooks/caregiver.ts` | Public hooks (via `caregiverClient`) and admin hooks (via `apiClient`) |
| Create `src/lib/caregiverFields.ts` | `CAREGIVER_INTERNAL_FIELDS`, `caregiverEditableFields()`, `caregiverReadOnlyFields()` |
| Create `src/lib/caregiverFields.test.ts` | Drift guards |
| Modify `src/pages/profile/steps/KeyIdentifiersStep.tsx` | `hiddenFields?: ReadonlySet<string>` prop (hides `preferredStaffId`) |
| Modify `src/pages/profile/steps/BehaviourCognitionStep.tsx` | `hiddenFields?: ReadonlySet<string>` prop (hides `behaviourRiskRating`) |
| Create `src/pages/caregiver/CaregiverWizardPage.tsx` | The page: states, name gate, wizard, draft/submit |
| Create `src/pages/caregiver/steps/AboutYouStep.tsx` | Step 0 |
| Create `src/pages/caregiver/CaregiverWizardPage.test.tsx` | |
| Modify `src/App.tsx` | Route outside the shell |

**Branch `feat/cg04-admin-review`** (Tasks 8–12), based on `origin/main` after cg03 merges (disjoint files from cg03 except `App.tsx` and the hooks file — coordinate by landing cg03 first)

| File | Responsibility |
|---|---|
| Create `src/lib/caregiverDiff.ts` | Flatten payload vs projection into changed rows with labels |
| Create `src/lib/caregiverDiff.test.ts` | |
| Modify `src/pages/ParticipantDetailPage.tsx` | Caregiver-link header control |
| Create `src/pages/caregiver-admin/CaregiverSubmissionsPage.tsx` | `DataTable` list |
| Create `src/pages/caregiver-admin/CaregiverSubmissionReviewPage.tsx` | Diff + accept/reject |
| Create tests for both pages | |
| Modify `src/App.tsx` | Two routes inside the shell |
| Modify the nav list in `src/components/layout/AppLayout.tsx` (or wherever the sidebar items live) | "Caregiver forms" entry |

---

## Task 1: Header-free client and types

**Files:**
- Create: `src/api/caregiverClient.ts`
- Create: `src/api/types/caregiver.ts`
- Test: `src/api/caregiverClient.test.ts`

**Interfaces:**
- Produces: `caregiverApiClient` (AxiosInstance), `caregiverGet<T>(url)`, `caregiverPut(url, body)`, `caregiverPost(url, body)` — thin typed helpers; the `CaregiverFormDto`, `CaregiverDraftDto`, `CaregiverLinkDto`, `CaregiverSubmissionListItemDto`, `CaregiverSubmissionDetailDto`, `CaregiverSubmissionStatus` types.

- [ ] **Step 1: Failing test — no auth headers, no cookies**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { caregiverApiClient } from './caregiverClient'

describe('caregiverApiClient', () => {
  beforeEach(() => {
    localStorage.setItem('odip_token', 'should-not-be-sent')
    localStorage.setItem('odip_viewing_tenant', 'tenant-should-not-be-sent')
    localStorage.setItem('odip_viewing_user', 'user-should-not-be-sent')
  })

  it('sends no Authorization or X-View-As-* headers and no credentials, even when a session exists', async () => {
    let captured: Record<string, unknown> = {}
    caregiverApiClient.defaults.adapter = async (config) => {
      captured = { ...config.headers }
      expect(config.withCredentials).toBe(false)
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
    }
    await caregiverApiClient.get('/public/caregiver/abc')
    expect(captured['Authorization']).toBeUndefined()
    expect(captured['X-View-As-Tenant']).toBeUndefined()
    expect(captured['X-View-As-User']).toBeUndefined()
  })

  it('has no interceptors registered', () => {
    // @ts-expect-error — handlers is internal but stable in axios 1.x
    expect(caregiverApiClient.interceptors.request.handlers.filter(Boolean)).toHaveLength(0)
    // @ts-expect-error
    expect(caregiverApiClient.interceptors.response.handlers.filter(Boolean)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to confirm failure** — `npx vitest run src/api/caregiverClient.test.ts` → module not found.

- [ ] **Step 3: Implement the client**

```ts
import axios from 'axios'
import type { ApiResponse } from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

/**
 * The caregiver form's HTTP client. Deliberately NOT `apiClient`:
 *  - no request interceptor, so no Authorization / X-View-As-* header can ever be attached
 *    (a signed-in admin opening a /caregiver/:token tab must not leak their session);
 *  - `withCredentials: false`, so the odip_jwt cookie fallback is not sent either;
 *  - no 401 interceptor, so a failure never triggers the Firebase refresh / logout dance.
 * Authentication on these routes is the link token in the URL and nothing else.
 */
export const caregiverApiClient = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: false,
})

export async function caregiverGet<T>(url: string): Promise<ApiResponse<T>> {
  const res = await caregiverApiClient.get<ApiResponse<T>>(url)
  return res.data
}

export async function caregiverPut(url: string, body: unknown): Promise<void> {
  await caregiverApiClient.put(url, body)
}

export async function caregiverPost(url: string, body: unknown): Promise<void> {
  await caregiverApiClient.post(url, body)
}
```

- [ ] **Step 4: Types**

```ts
import type { PatchParticipantDto } from './participant-patch'

export type CaregiverSubmissionStatus = 'Draft' | 'Submitted' | 'Accepted' | 'Rejected' | 'Revoked'

/** Mirrors backend CaregiverFormDto. `current` is a caregiver-visible subset of ParticipantDetailDto's JSON. */
export type CaregiverFormDto = {
  status: CaregiverSubmissionStatus
  caregiverName: string | null
  caregiverRelationship: string | null
  expiresAt: string
  rejectionNote: string | null
  current: Record<string, unknown>
  editable: string[]
  draft: PatchParticipantDto | null
}

export type CaregiverDraftDto = {
  caregiverName: string
  caregiverRelationship?: string | null
  payload: PatchParticipantDto
}

export type CaregiverLinkDto = { token: string; expiresAt: string }

export type CaregiverSubmissionListItemDto = {
  id: string
  participantId: string
  participantName: string
  status: CaregiverSubmissionStatus
  caregiverName: string | null
  createdAt: string
  expiresAt: string
  submittedAt: string | null
}

export type CaregiverSubmissionDetailDto = CaregiverSubmissionListItemDto & {
  caregiverRelationship: string | null
  reviewedAt: string | null
  rejectionNote: string | null
  current: Record<string, unknown>
  payload: PatchParticipantDto | null
}
```

Export these from `src/api/types/index.ts` following its existing barrel pattern.

- [ ] **Step 5: Run test → pass. Commit.**

```bash
git add src/api/caregiverClient.ts src/api/caregiverClient.test.ts src/api/types/caregiver.ts src/api/types/index.ts
git commit -m "feat(caregiver): header-free public API client and DTO types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 2: Hooks

**Files:**
- Create: `src/api/hooks/caregiver.ts`
- Test: `src/api/hooks/caregiver.test.tsx`

**Interfaces:**
- Produces (public, via `caregiverApiClient`): `usePublicCaregiverForm(token)`, `useSaveCaregiverDraft(token)`, `useSubmitCaregiverForm(token)`.
- Produces (admin, via `apiClient`): `useGenerateCaregiverLink()`, `useRevokeCaregiverLink()`, `useCaregiverSubmissions(status?)`, `useCaregiverSubmission(id)`, `useAcceptCaregiverSubmission()`, `useRejectCaregiverSubmission()`.

- [ ] **Step 1: Failing test — admin mutations invalidate the right keys; public hooks use the public client**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('../client', () => ({
  apiGetWithDefault: vi.fn(async () => []),
  apiPostRaw: vi.fn(async () => ({ success: true, data: { token: 't', expiresAt: '2026-09-17T00:00:00Z' } })),
  apiDeleteRaw: vi.fn(async () => undefined),
}))
vi.mock('../caregiverClient', () => ({
  caregiverGet: vi.fn(async () => ({ success: true, data: { status: 'Draft', current: {}, editable: [], draft: null } })),
  caregiverPut: vi.fn(async () => undefined),
  caregiverPost: vi.fn(async () => undefined),
}))

import { useGenerateCaregiverLink, usePublicCaregiverForm, useSaveCaregiverDraft } from './caregiver'
import { caregiverGet, caregiverPut } from '../caregiverClient'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('caregiver hooks', () => {
  it('useGenerateCaregiverLink invalidates the participant and the submissions list', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useGenerateCaregiverLink(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ participantId: 'p1' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['participant', 'p1'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['caregiver-submissions'] })
  })

  it('usePublicCaregiverForm reads through the public client', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => usePublicCaregiverForm('tok'), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.data?.status).toBe('Draft'))
    expect(caregiverGet).toHaveBeenCalledWith('/public/caregiver/tok')
  })

  it('useSaveCaregiverDraft writes through the public client', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useSaveCaregiverDraft('tok'), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ caregiverName: 'Jane', payload: {} })
    expect(caregiverPut).toHaveBeenCalledWith('/public/caregiver/tok/draft', { caregiverName: 'Jane', payload: {} })
  })
})
```

Check `src/api/client.ts` for the actual exported helper names (`apiGetWithDefault`, `apiPostRaw`, `apiDeleteRaw`, etc. — quote them from `src/api/hooks/participants.ts`'s imports) and adjust the mock.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGetWithDefault, apiPostRaw, apiDeleteRaw } from '../client'
import { caregiverGet, caregiverPut, caregiverPost } from '../caregiverClient'
import type {
  CaregiverFormDto, CaregiverDraftDto, CaregiverLinkDto,
  CaregiverSubmissionListItemDto, CaregiverSubmissionDetailDto, CaregiverSubmissionStatus,
} from '../types/caregiver'

// ── Public (token) — no session, no cache sharing with the app ──

export function usePublicCaregiverForm(token: string | undefined) {
  return useQuery({
    queryKey: ['public-caregiver', token],
    queryFn: async () => (await caregiverGet<CaregiverFormDto>(`/public/caregiver/${token}`)).data!,
    enabled: !!token,
    retry: false,          // a 404 is the answer, not a transient
    staleTime: Infinity,   // re-read only on explicit invalidation
  })
}

export function useSaveCaregiverDraft(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CaregiverDraftDto) => caregiverPut(`/public/caregiver/${token}/draft`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['public-caregiver', token] }),
  })
}

export function useSubmitCaregiverForm(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CaregiverDraftDto) => caregiverPost(`/public/caregiver/${token}/submit`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['public-caregiver', token] }),
  })
}

// ── Admin (JWT) ──

export function useGenerateCaregiverLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId }: { participantId: string }) =>
      apiPostRaw<CaregiverLinkDto>(`/participants/${participantId}/caregiver-link`, {}),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participant', vars.participantId] })
      qc.invalidateQueries({ queryKey: ['caregiver-submissions'] })
    },
  })
}

export function useRevokeCaregiverLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId }: { participantId: string }) =>
      apiDeleteRaw(`/participants/${participantId}/caregiver-link`),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participant', vars.participantId] })
      qc.invalidateQueries({ queryKey: ['caregiver-submissions'] })
    },
  })
}

export function useCaregiverSubmissions(status: CaregiverSubmissionStatus = 'Submitted') {
  return useQuery({
    queryKey: ['caregiver-submissions', status],
    queryFn: () => apiGetWithDefault<CaregiverSubmissionListItemDto[]>(`/caregiver-submissions?status=${status}`, []),
  })
}

export function useCaregiverSubmission(id: string | undefined) {
  return useQuery({
    queryKey: ['caregiver-submission', id],
    queryFn: () => apiGetWithDefault<CaregiverSubmissionDetailDto | null>(`/caregiver-submissions/${id}`, null),
    enabled: !!id,
  })
}

export function useAcceptCaregiverSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; participantId: string }) => apiPostRaw(`/caregiver-submissions/${id}/accept`, {}),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['caregiver-submissions'] })
      qc.invalidateQueries({ queryKey: ['caregiver-submission', vars.id] })
      qc.invalidateQueries({ queryKey: ['participant', vars.participantId] })
      qc.invalidateQueries({ queryKey: ['participants'] })
    },
  })
}

export function useRejectCaregiverSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => apiPostRaw(`/caregiver-submissions/${id}/reject`, { note }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['caregiver-submissions'] })
      qc.invalidateQueries({ queryKey: ['caregiver-submission', vars.id] })
    },
  })
}
```

Export from `src/api/hooks/index.ts` following its barrel pattern. If `apiDeleteRaw` does not exist in `client.ts`, add it beside `apiPostRaw` with the same shape.

- [ ] **Step 4: Test → pass. Commit.**

```bash
git add src/api/hooks/caregiver.ts src/api/hooks/caregiver.test.tsx src/api/hooks/index.ts src/api/client.ts
git commit -m "feat(caregiver): public and admin hooks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 3: `caregiverFields` — the frontend field policy with drift guards

**Files:**
- Create: `src/lib/caregiverFields.ts`
- Test: `src/lib/caregiverFields.test.ts`

**Interfaces:**
- Consumes: `fieldsForEntry('profile')`, `sharedFieldsDisplayedOnProfile()`, `getFieldMapping(field)` from `src/lib/documentMapping.ts`.
- Produces: `CAREGIVER_INTERNAL_FIELDS: ReadonlySet<string>` (allocation-contract **field ids**), `caregiverEditableFields(): DocumentMappingEntry[]`, `caregiverReadOnlyFields(): DocumentMappingEntry[]`.

The backend's `InternalFields` is keyed by DTO JSON property name; this side is keyed by allocation-contract field id. The two are reconciled by the backend's drift guard (field id → `ParticipantPropertyName` → JSON name). **Do not read the C# file from a test** — that fails in Docker.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { fieldsForEntry, sharedFieldsDisplayedOnProfile, DOCUMENT_MAPPING } from './documentMapping'
import { CAREGIVER_INTERNAL_FIELDS, caregiverEditableFields, caregiverReadOnlyFields } from './caregiverFields'

describe('caregiverFields', () => {
  it('every internal field id exists in the allocation contract (a renamed field cannot silently un-exclude)', () => {
    const known = new Set(DOCUMENT_MAPPING.map((e) => e.field))
    const missing = [...CAREGIVER_INTERNAL_FIELDS].filter((f) => !known.has(f))
    expect(missing).toEqual([])
  })

  it('every Profile-entry field is either editable-by-caregiver or internal — nothing unclassified', () => {
    const profile = fieldsForEntry('profile').map((e) => e.field)
    const editable = new Set(caregiverEditableFields().map((e) => e.field))
    const unclassified = profile.filter((f) => !editable.has(f) && !CAREGIVER_INTERNAL_FIELDS.has(f))
    expect(unclassified).toEqual([])
  })

  it('no editable field is internal', () => {
    for (const e of caregiverEditableFields()) expect(CAREGIVER_INTERNAL_FIELDS.has(e.field)).toBe(false)
  })

  it('read-only fields are exactly the shared intake fields shown on profile, minus internal', () => {
    const expected = sharedFieldsDisplayedOnProfile().filter((e) => !CAREGIVER_INTERNAL_FIELDS.has(e.field)).map((e) => e.field)
    expect(caregiverReadOnlyFields().map((e) => e.field)).toEqual(expected)
  })

  it('the known internal fields are excluded', () => {
    for (const f of ['behaviourRiskRating', 'preferredStaffId']) {
      expect(CAREGIVER_INTERNAL_FIELDS.has(f)).toBe(true)
      expect(caregiverEditableFields().some((e) => e.field === f)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

```ts
import { fieldsForEntry, sharedFieldsDisplayedOnProfile, type DocumentMappingEntry } from './documentMapping'

/**
 * Allocation-contract field ids a primary caregiver must never see or edit. Frontend twin of
 * the backend's CaregiverFieldPolicy.InternalFields (which is keyed by DTO JSON name and
 * reconciled to these ids by its own drift guard). The test file fails if any id here is not in
 * DOCUMENT_MAPPING, or if any Profile field is neither here nor editable.
 *
 * Populate from DOCUMENT_MAPPING's real field ids for: restrictive practices, behaviour risk
 * rating, risk entries / risks-hazards summary + notes, safety auto-notes, the ndisPlan and
 * serviceProfile groups (except serviceStreams), preferred staff.
 */
export const CAREGIVER_INTERNAL_FIELDS: ReadonlySet<string> = new Set<string>([
  'behaviourRiskRating',
  'behaviourRiskSummary',
  'preferredStaffId',
  'planType',
  'ndisNumber',
  'planStartDate',
  'planEndDate',
  'fundingSource',
  'region',
  // add the remaining ids the first test names
])

export function caregiverEditableFields(): DocumentMappingEntry[] {
  return fieldsForEntry('profile').filter((e) => !CAREGIVER_INTERNAL_FIELDS.has(e.field))
}

export function caregiverReadOnlyFields(): DocumentMappingEntry[] {
  return sharedFieldsDisplayedOnProfile().filter((e) => !CAREGIVER_INTERNAL_FIELDS.has(e.field))
}
```

Iterate on the set until all five tests pass. Do not weaken a test.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/caregiverFields.ts src/lib/caregiverFields.test.ts
git commit -m "feat(caregiver): frontend field policy with drift guards against the allocation contract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 4: `hiddenFields` prop on the two profile steps that render internal fields

**Files:**
- Modify: `src/pages/profile/steps/KeyIdentifiersStep.tsx` (renders `preferredStaffId`)
- Modify: `src/pages/profile/steps/BehaviourCognitionStep.tsx` (renders `behaviourRiskRating`)
- Test: add to `src/pages/profile/ProfileWizardPage.test.tsx`

**Interfaces:**
- Produces: each step accepts `hiddenFields?: ReadonlySet<string>` (default empty). When a field id is in the set, that control is not rendered. Existing callers pass nothing and are unchanged.

- [ ] **Step 1: Failing test**

```tsx
it('KeyIdentifiersStep and BehaviourCognitionStep omit fields listed in hiddenFields', () => {
  // render each step directly with a minimal react-hook-form harness (copy the harness the
  // file already uses for step-level tests) and hiddenFields={new Set(['preferredStaffId'])} /
  // new Set(['behaviourRiskRating']); assert the labelled control is absent, and present without the prop.
  expect(screen.queryByLabelText(/preferred staff/i)).not.toBeInTheDocument()
})
```

Write the full harness by copying the pattern already in `ProfileWizardPage.test.tsx` for rendering a single step; assert both steps, with and without the prop.

- [ ] **Step 2: Implement** — in each step, add the prop and wrap the one control:

```tsx
type Props = { /* existing props */; hiddenFields?: ReadonlySet<string> }
export function BehaviourCognitionStep({ control, register, participant, hiddenFields }: Props) {
  const hidden = hiddenFields ?? EMPTY
  // ...
  {!hidden.has('behaviourRiskRating') && (
    /* the existing behaviourRiskRating FormField/Dropdown block, unchanged */
  )}
```
with `const EMPTY: ReadonlySet<string> = new Set()` at module scope.

- [ ] **Step 3: Run `npm test` for `ProfileWizardPage.test.tsx` → all pass (existing tests unchanged). Commit.**

```bash
git add src/pages/profile/steps/KeyIdentifiersStep.tsx src/pages/profile/steps/BehaviourCognitionStep.tsx src/pages/profile/ProfileWizardPage.test.tsx
git commit -m "feat(profile): hiddenFields prop on steps that render caregiver-internal fields

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 5: The caregiver wizard page

**Files:**
- Create: `src/pages/caregiver/steps/AboutYouStep.tsx`
- Create: `src/pages/caregiver/CaregiverWizardPage.tsx`
- Test: `src/pages/caregiver/CaregiverWizardPage.test.tsx`

**Interfaces:**
- Consumes: `usePublicCaregiverForm`, `useSaveCaregiverDraft`, `useSubmitCaregiverForm`; `useWizard`, `WizardNavFooter`, `WizardStepRail`, `WizardReviewStep` from `src/components/wizard`; the Profile step components + `hiddenFields`; `buildProfileStepPatch` from `src/lib/participantPatchGroups`; `PROFILE_STEP_*_FIELDS`, `PROFILE_STEP_SCHEMAS_BY_KEY` from `src/lib/participantSchema`; `CAREGIVER_INTERNAL_FIELDS`.
- Produces: default export `CaregiverWizardPage`.

- [ ] **Step 1: Failing tests** (`CaregiverWizardPage.test.tsx`)

Mock `../../api/hooks/caregiver`. Cover:

```tsx
describe('CaregiverWizardPage', () => {
  it('renders the neutral invalid-link page on 404, with no hint about why', async () => { /* mock query error status 404 → expect "This link is no longer valid"; expect NOT "expired"/"revoked" */ })
  it('never touches odip_user or usePermissions', () => { /* localStorage has no odip_user; render; assert no throw and no getItem('odip_user') call via spy */ })
  it('blocks every step after About you until a name is entered', async () => { /* Next disabled/blocked; enter name; Next advances */ })
  it('saves a draft through the public client on step change', async () => { /* saveDraft mock called with caregiverName + payload */ })
  it('hydrates from the saved draft on load', async () => { /* mock draft with a value; expect the control shows it */ })
  it('renders Shared fields read-only and never renders an internal field', async () => { /* assert readonly attr on a shared field; queryByLabelText(/behaviour risk rating/i) absent; /preferred staff/i absent */ })
  it('submitted state is read-only with the awaiting-review banner', async () => { /* status Submitted → banner text; no Next/Submit buttons */ })
  it('rejected state shows the note and reopens for editing', async () => { /* status Draft + rejectionNote → note rendered; controls enabled */ })
  it('submit calls the public submit endpoint and shows the submitted state', async () => {})
})
```

Fill each body with real Testing Library code against the mocked hooks — the harness for a `useForm`-driven wizard page already exists in `IntakeWizardPage.test.tsx`; copy its `renderWithRouter` and mock-shape.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: `AboutYouStep`**

```tsx
import type { Control, FieldErrors, UseFormRegister } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import type { CaregiverFormData } from '../CaregiverWizardPage'

export function AboutYouStep({ register, errors }: { control: Control<CaregiverFormData>; register: UseFormRegister<CaregiverFormData>; errors: FieldErrors<CaregiverFormData> }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Please tell us who you are before reviewing the information. Your name is recorded against any changes you make.
      </p>
      <FormField label="Your name" required error={errors.caregiverName?.message}>
        <input type="text" autoComplete="name" {...register('caregiverName')} />
      </FormField>
      <FormField label="Relationship to the participant" hint="For example: mother, brother, guardian">
        <input type="text" {...register('caregiverRelationship')} />
      </FormField>
    </div>
  )
}
```

- [ ] **Step 4: The page**

```tsx
import { useParams } from 'react-router-dom'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { usePublicCaregiverForm, useSaveCaregiverDraft, useSubmitCaregiverForm } from '@/api/hooks/caregiver'
import { useWizard, WizardNavFooter, WizardStepRail, WizardReviewStep, REVIEW_STEP_KEY, type WizardStepDef, type WizardValidate, type ReviewGroup } from '@/components/wizard'
import { participantFormSchemaBase, PROFILE_STEP_SCHEMAS_BY_KEY, PROFILE_STEP_KEY_IDENTIFIERS_FIELDS, PROFILE_STEP_CULTURAL_DEPTH_FIELDS, PROFILE_STEP_MEDICAL_FIELDS, PROFILE_STEP_MOBILITY_FIELDS, PROFILE_STEP_BEHAVIOUR_FIELDS, PROFILE_STEP_DAILY_LIVING_FIELDS, type ParticipantFormData } from '@/lib/participantSchema'
import { buildProfileStepPatch } from '@/lib/participantPatchGroups'
import { CAREGIVER_INTERNAL_FIELDS } from '@/lib/caregiverFields'
import { KeyIdentifiersStep } from '../profile/steps/KeyIdentifiersStep'
import { CulturalDepthConsentsStep } from '../profile/steps/CulturalDepthConsentsStep'
import { MedicalDetailStep } from '../profile/steps/MedicalDetailStep'
import { MobilityFunctionalStep } from '../profile/steps/MobilityFunctionalStep'
import { BehaviourCognitionStep } from '../profile/steps/BehaviourCognitionStep'
import { DailyLivingStep } from '../profile/steps/DailyLivingStep'
import { AboutYouStep } from './steps/AboutYouStep'
import { hydrateFormFromProjection } from './hydrate'   // Task 5 Step 5

export type CaregiverFormData = ParticipantFormData & { caregiverName: string; caregiverRelationship?: string }

const ABOUT_YOU_FIELDS = ['caregiverName', 'caregiverRelationship'] as const
const aboutYouSchema = z.object({ caregiverName: z.string().trim().min(1, 'Please enter your name') })

export default function CaregiverWizardPage() {
  const { token } = useParams<{ token: string }>()
  const form = usePublicCaregiverForm(token)
  const saveDraft = useSaveCaregiverDraft(token)
  const submit = useSubmitCaregiverForm(token)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { control, register, getValues, setError, clearErrors, reset, formState: { errors } } = useForm<CaregiverFormData>({
    defaultValues: { caregiverName: '', caregiverRelationship: '', consents: [], healthConditions: [], adlAssessments: [], checklistItems: [], communityAccessRiskItems: [] } as unknown as CaregiverFormData,
  })
  const consentsFieldArray = useFieldArray({ control, name: 'consents' })
  const healthConditionFieldArray = useFieldArray({ control, name: 'healthConditions' })
  const adlFieldArray = useFieldArray({ control, name: 'adlAssessments' })
  const watchedValues = useWatch({ control })

  // Hydrate once from the projection + any saved draft. The draft (a PatchParticipantDto) wins
  // over the projection for the fields it carries.
  useEffect(() => {
    if (!form.data) return
    reset(hydrateFormFromProjection(form.data) as CaregiverFormData, { keepDefaultValues: false })
  }, [form.data, reset])

  const steps: WizardStepDef<CaregiverFormData>[] = useMemo(() => [
    { key: 'aboutYou', label: 'About you', fields: ABOUT_YOU_FIELDS },
    { key: 'keyIdentifiers', label: 'Key Identifiers', fields: PROFILE_STEP_KEY_IDENTIFIERS_FIELDS },
    { key: 'culturalDepth', label: 'Cultural & Consents', fields: PROFILE_STEP_CULTURAL_DEPTH_FIELDS },
    { key: 'medical', label: 'Medical', fields: PROFILE_STEP_MEDICAL_FIELDS },
    { key: 'mobility', label: 'Mobility & Functional', fields: PROFILE_STEP_MOBILITY_FIELDS },
    { key: 'behaviourCognition', label: 'Behaviour & Communication', fields: PROFILE_STEP_BEHAVIOUR_FIELDS },
    { key: 'dailyLiving', label: 'Daily Living', fields: PROFILE_STEP_DAILY_LIVING_FIELDS },
  ], [])

  const buildDraftBody = () => {
    const values = getValues()
    // One PatchParticipantDto for the whole form: merge every step's group patch. The backend
    // sanitiser drops internal groups/scalars; the frontend never renders them (hiddenFields).
    const payload = ['keyIdentifiers', 'culturalDepth', 'medical', 'mobility', 'behaviourCognition', 'dailyLiving']
      .map((k) => buildProfileStepPatch(k, values, /* staVisible */ false) ?? {})
      .reduce((acc, part) => ({ ...acc, ...part }), {})
    return { caregiverName: values.caregiverName.trim(), caregiverRelationship: values.caregiverRelationship?.trim() || null, payload }
  }

  const validateStep: WizardValidate<CaregiverFormData> = async (step, values) => {
    if (step.key === 'aboutYou') {
      const r = aboutYouSchema.safeParse(values)
      if (!r.success) return r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message, code: i.code }))
      return null
    }
    const schema = PROFILE_STEP_SCHEMAS_BY_KEY[step.key]
    if (schema) {
      const r = schema.safeParse(values)
      if (!r.success) return r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message, code: i.code }))
    }
    setSaveError(null)
    try {
      await saveDraft.mutateAsync(buildDraftBody())
      return null
    } catch {
      setSaveError("We couldn't save your progress. Please check your connection and try again.")
      return [{ path: step.fields[0] as string, message: 'Save failed — see the message above.', code: 'server' }]
    }
  }

  const wizard = useWizard<CaregiverFormData>({
    steps,
    initialVisited: 'linear',
    validate: validateStep,
    getValues,
    setError: (path, err) => setError(path as keyof CaregiverFormData, err),
    clearErrors: (paths) => clearErrors(paths as (keyof CaregiverFormData)[]),
  })

  // ── States ──
  if (form.isLoading) return <PublicShell><p>Loading…</p></PublicShell>
  if (form.isError || !form.data) return <InvalidLinkPage />
  if (form.data.status === 'Submitted') return <SubmittedPage caregiverName={form.data.caregiverName} />

  const hidden = CAREGIVER_INTERNAL_FIELDS
  const readOnlyParticipant = form.data.current as never   // shared fields render read-only from this

  const onSubmit = async () => {
    setSaveError(null)
    try { await submit.mutateAsync(buildDraftBody()) }
    catch { setSaveError("We couldn't submit the form. Please try again.") }
  }

  return (
    <PublicShell>
      {form.data.rejectionNote && (
        <div role="status" className="mb-4 p-3 rounded-lg bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] text-sm">
          <strong>Your previous submission was sent back with a note:</strong> {form.data.rejectionNote}
        </div>
      )}
      {saveError && <p role="alert" className="mb-4 text-sm text-[var(--color-destructive)]">{saveError}</p>}

      <WizardStepRail steps={[...steps, { key: REVIEW_STEP_KEY, label: 'Review', fields: [] }]} currentKey={wizard.currentStep.key} visited={wizard.visitedSteps} onSelect={wizard.goToStep} />

      {wizard.currentStep.key === 'aboutYou' && <AboutYouStep control={control} register={register} errors={errors} />}
      {wizard.currentStep.key === 'keyIdentifiers' && <KeyIdentifiersStep control={control} register={register} errors={errors} participant={readOnlyParticipant} activeStaff={[]} hiddenFields={hidden} />}
      {wizard.currentStep.key === 'culturalDepth' && <CulturalDepthConsentsStep control={control} register={register} participant={readOnlyParticipant} consentsFieldArray={consentsFieldArray} staVisible={false} />}
      {wizard.currentStep.key === 'medical' && <MedicalDetailStep control={control} register={register} errors={errors} participant={readOnlyParticipant} healthConditionFieldArray={healthConditionFieldArray} watchedValues={watchedValues} />}
      {wizard.currentStep.key === 'mobility' && <MobilityFunctionalStep control={control} register={register} participant={readOnlyParticipant} />}
      {wizard.currentStep.key === 'behaviourCognition' && <BehaviourCognitionStep control={control} register={register} participant={readOnlyParticipant} hiddenFields={hidden} />}
      {wizard.currentStep.key === 'dailyLiving' && <DailyLivingStep control={control} register={register} adlFieldArray={adlFieldArray} watchedValues={watchedValues} caVisible={false} />}
      {wizard.isReviewStep && <WizardReviewStep groups={reviewBuilder(getValues(), steps)} onEdit={wizard.goToStep} />}

      <WizardNavFooter
        isFirst={wizard.stepIndex === 0}
        isReview={wizard.isReviewStep}
        isAdvancing={wizard.isAdvancing || saveDraft.isPending}
        onBack={wizard.handleBack}
        onNext={wizard.handleNext}
        onSubmit={onSubmit}
        submitLabel="Submit for review"
        secondaryActions={[{ key: 'saveLater', label: 'Save and continue later', onClick: async () => { await saveDraft.mutateAsync(buildDraftBody()) } }]}
      />
    </PublicShell>
  )
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]">
      <div className="max-w-3xl mx-auto p-4 sm:p-8">
        <h1 className="text-2xl font-bold mb-1">Participant profile</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-6">Please check the information below and update anything that is missing or out of date.</p>
        {children}
      </div>
    </main>
  )
}

function InvalidLinkPage() {
  return (
    <PublicShell>
      <div role="status" className="p-4 rounded-lg border border-[var(--color-border)]">
        <p className="font-medium">This link is no longer valid.</p>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">If you were expecting to complete a form, please contact the person who sent it to you.</p>
      </div>
    </PublicShell>
  )
}

function SubmittedPage({ caregiverName }: { caregiverName: string | null }) {
  return (
    <PublicShell>
      <div role="status" className="p-4 rounded-lg bg-[var(--color-accent)]">
        <p className="font-medium">Thank you{caregiverName ? `, ${caregiverName}` : ''} — your form has been submitted.</p>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">It is now awaiting review. You'll be contacted if anything needs to be checked.</p>
      </div>
    </PublicShell>
  )
}

function reviewBuilder(values: CaregiverFormData, steps: WizardStepDef<CaregiverFormData>[]): ReviewGroup[] {
  return steps.map((step) => ({
    stepKey: step.key,
    rows: step.key === 'aboutYou'
      ? [{ label: 'Your name', value: values.caregiverName || '—' }, { label: 'Relationship', value: values.caregiverRelationship || '—' }]
      : step.fields.slice(0, 4).map((f) => ({ label: String(f), value: String((values as Record<string, unknown>)[f as string] ?? '—') })),
  }))
}
```

Match the real prop names of `WizardStepRail`, `WizardNavFooter` and `WizardReviewStep` — open `src/components/wizard/` and use exactly what they export. The `import` line for `participantFormSchemaBase` may be unnecessary; remove any unused import so lint stays at 77.

- [ ] **Step 5: `hydrate.ts`**

```ts
import type { CaregiverFormDto } from '@/api/types/caregiver'

/**
 * Form values = projection (current values, caregiver-visible) overlaid with the saved draft.
 * The projection uses ParticipantDetailDto's JSON names; ParticipantFormData uses the same names
 * for scalars (core-02's semantic groups were built from them), so a shallow copy is correct.
 * Collections come from the draft if present, else from the projection.
 */
export function hydrateFormFromProjection(dto: CaregiverFormDto): Record<string, unknown> {
  const base: Record<string, unknown> = { ...dto.current, caregiverName: dto.caregiverName ?? '', caregiverRelationship: dto.caregiverRelationship ?? '' }
  const draft = dto.draft
  if (!draft) return base
  const flat: Record<string, unknown> = { ...base }
  for (const [group, value] of Object.entries(draft)) {
    if (value == null) continue
    if (Array.isArray(value)) { flat[group] = value; continue }     // the 4 collections keep their group name
    Object.assign(flat, value as Record<string, unknown>)           // scalar groups flatten onto field names
  }
  return flat
}
```

Add `src/pages/caregiver/hydrate.test.ts` with two cases: draft absent → projection values; draft present → draft scalar overrides projection, collection replaced.

- [ ] **Step 6: Run the page tests → pass. Full gates. Commit.**

```bash
git add src/pages/caregiver/
git commit -m "feat(caregiver): public caregiver wizard page with name gate, draft, submit and all states

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 6: Route outside the shell

**Files:**
- Modify: `src/App.tsx` (~line 82)
- Test: add to `src/App.test.tsx` if one exists, else to `CaregiverWizardPage.test.tsx`

- [ ] **Step 1:** Add the lazy import beside the others:

```tsx
const CaregiverWizardPage = React.lazy(() => import('./pages/caregiver/CaregiverWizardPage'))
```

and the route as a sibling of `/login`, **before** the `<Route element={<UiPreferencesProvider>…<AppLayout />…}>` wrapper:

```tsx
      <Route path="/login" element={<LoginPage />} />
      {/* Caregiver profile form — public, token-authenticated, deliberately OUTSIDE the
          authenticated shell: no PrivateRoute, no AppLayout, no UiPreferencesProvider. */}
      <Route path="/caregiver/:token" element={<CaregiverWizardPage />} />
```

- [ ] **Step 2:** Test that rendering the router at `/caregiver/abc` does not render the app nav (e.g. `queryByRole('navigation')` absent) and does not redirect to `/login` when unauthenticated.

- [ ] **Step 3: Full gates, commit, push, PR**

```bash
npm run build && npm test && npm run lint    # lint: exactly 77
git add src/App.tsx src/App.test.tsx
git commit -m "feat(caregiver): register /caregiver/:token outside the authenticated shell

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
git diff HEAD --stat   # empty
git push -u origin feat/cg03-caregiver-wizard
gh pr create --base main --title "feat(caregiver): public caregiver wizard (cg03)" --body-file <body: header-free client + the test proving no auth headers; field policy drift guards; hiddenFields on two profile steps; the four page states; route placement>
```

---

## Task 7: cg03 verification hand-back

Report to the orchestrator: gate tails (build / test count vs main / lint = 77), `git diff HEAD` empty, the list of fields the drift guard forced you to classify, and confirmation that `grep -rn "usePermissions\|odip_user" src/pages/caregiver/` returns nothing.

---

## Task 8: `caregiverDiff` (cg04)

**Files:**
- Create: `src/lib/caregiverDiff.ts`
- Test: `src/lib/caregiverDiff.test.ts`

**Interfaces:**
- Produces: `computeCaregiverDiff(current: Record<string, unknown>, payload: PatchParticipantDto | null): DiffRow[]` where `DiffRow = { field: string; label: string; group: string; current: string; proposed: string }`, containing **only** changed fields; labels via `getFieldMapping(field)?.label ?? field`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { computeCaregiverDiff } from './caregiverDiff'

describe('computeCaregiverDiff', () => {
  it('returns only changed scalar fields, with labels', () => {
    const rows = computeCaregiverDiff(
      { firstName: 'Sophie', personalInterests: 'Reading', phone: '0400' },
      { aboutMe: { personalInterests: 'Gardening' }, personalDetails: { firstName: 'Sophie', phone: '0400' } },
    )
    expect(rows).toEqual([{ field: 'personalInterests', label: expect.any(String), group: 'aboutMe', current: 'Reading', proposed: 'Gardening' }])
  })
  it('treats null/undefined/empty-string as equal', () => {
    expect(computeCaregiverDiff({ phone: null }, { personalDetails: { phone: '' } })).toEqual([])
  })
  it('diffs collections by item type', () => {
    const rows = computeCaregiverDiff(
      { consents: [{ consentType: 'PhotoVideo', granted: false }] },
      { consents: [{ consentType: 'PhotoVideo', granted: true }] },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].field).toBe('consents.PhotoVideo')
  })
  it('returns [] for a null payload', () => {
    expect(computeCaregiverDiff({ a: 1 }, null)).toEqual([])
  })
})
```

- [ ] **Step 2: Implement**

```ts
import type { PatchParticipantDto } from '@/api/types/participant-patch'
import { getFieldMapping } from './documentMapping'

export type DiffRow = { field: string; label: string; group: string; current: string; proposed: string }

const COLLECTION_KEYS: Record<string, string> = {
  consents: 'consentType', healthConditions: 'conditionType', adlAssessments: 'adlType', checklistItems: 'itemType',
}
const norm = (v: unknown) => (v === null || v === undefined || v === '' ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const label = (field: string) => getFieldMapping(field)?.label ?? field

export function computeCaregiverDiff(current: Record<string, unknown>, payload: PatchParticipantDto | null): DiffRow[] {
  if (!payload) return []
  const rows: DiffRow[] = []
  for (const [group, value] of Object.entries(payload)) {
    if (value == null) continue
    const keyProp = COLLECTION_KEYS[group]
    if (keyProp && Array.isArray(value)) {
      const currentItems = (current[group] as Array<Record<string, unknown>> | undefined) ?? []
      for (const item of value as Array<Record<string, unknown>>) {
        const k = String(item[keyProp])
        const before = currentItems.find((c) => String(c[keyProp]) === k)
        const b = norm(before ? stripKey(before, keyProp) : null)
        const a = norm(stripKey(item, keyProp))
        if (a !== b) rows.push({ field: `${group}.${k}`, label: `${label(group)} — ${k}`, group, current: b || '—', proposed: a || '—' })
      }
      continue
    }
    for (const [field, proposed] of Object.entries(value as Record<string, unknown>)) {
      const a = norm(proposed), b = norm(current[field])
      if (a !== b) rows.push({ field, label: label(field), group, current: b || '—', proposed: a || '—' })
    }
  }
  return rows
}

function stripKey(o: Record<string, unknown>, k: string) { const { [k]: _omit, ...rest } = o; return rest }
```

Confirm the four collection key property names (`consentType`, `conditionType`, `adlType`, `itemType`) against `src/api/types/participants.ts`; fix any that differ.

- [ ] **Step 3: Tests → pass. Commit.**

```bash
git add src/lib/caregiverDiff.ts src/lib/caregiverDiff.test.ts
git commit -m "feat(caregiver): diff of a submission payload against the current projection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 9: Participant header — caregiver link control

**Files:**
- Modify: `src/pages/ParticipantDetailPage.tsx` (the header button cluster, ~lines 108–122 region)
- Test: add to `src/pages/ParticipantDetailPage.test.tsx`

**Interfaces:**
- Consumes: `useGenerateCaregiverLink`, `useRevokeCaregiverLink`, `canWriteParticipantDetails`. The participant DTO needs to expose the active submission status — check whether `ParticipantDetailDto` already carries it; if not, use `useCaregiverSubmissions('Draft')` + `'Submitted'` filtered by `participantId` (two small queries) rather than widening the participant DTO.

- [ ] **Step 1: Failing tests**

```tsx
it('shows Generate link for canWriteParticipantDetails and hides it otherwise', () => {})
it('after generating, shows the URL once with a Copy button and the expiry', async () => {
  // expect text containing `${window.location.origin}/caregiver/` + token
})
it('shows a status chip and Revoke when a link is active', () => {})
it('Revoke calls the mutation and the chip returns to None', async () => {})
```

- [ ] **Step 2: Implement** — a `CaregiverLinkControl` component in the same file (or `src/pages/participant-detail/CaregiverLinkControl.tsx`), following the DOC-01 button shape:

```tsx
function CaregiverLinkControl({ participantId }: { participantId: string }) {
  const { canWriteParticipantDetails } = usePermissions()
  const generate = useGenerateCaregiverLink()
  const revoke = useRevokeCaregiverLink()
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null)
  const drafts = useCaregiverSubmissions('Draft')
  const submitted = useCaregiverSubmissions('Submitted')
  const active = [...(submitted.data ?? []), ...(drafts.data ?? [])].find((s) => s.participantId === participantId)
  if (!canWriteParticipantDetails) return null

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <StatusBadge status={active?.status ?? 'None'} />
        <button type="button"
          onClick={async () => {
            const res = await generate.mutateAsync({ participantId })
            const token = res.data!.token
            setIssued({ url: `${window.location.origin}/caregiver/${token}`, expiresAt: res.data!.expiresAt })
          }}
          disabled={generate.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:bg-[var(--color-accent)] transition-all disabled:opacity-50">
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {active ? 'Regenerate caregiver link' : 'Generate caregiver link'}
        </button>
        {active && (
          <button type="button" onClick={() => revoke.mutate({ participantId })} disabled={revoke.isPending}
            className="px-3 py-2 rounded-lg text-sm text-[var(--color-destructive)] hover:bg-[var(--color-accent)]">Revoke</button>
        )}
      </div>
      {issued && (
        <div role="status" className="text-xs p-2 rounded bg-[var(--color-accent)] break-all">
          <span>Copy this link now — it won't be shown again. Expires {formatDateAu(issued.expiresAt)}.</span>
          <code className="block mt-1">{issued.url}</code>
          <button type="button" className="mt-1 underline" onClick={() => navigator.clipboard.writeText(issued.url)}>Copy</button>
        </div>
      )}
      {(generate.isError || revoke.isError) && <p role="alert" className="text-xs text-[var(--color-destructive)]">Something went wrong. Try again.</p>}
    </div>
  )
}
```

Use whichever icon `lucide-react` provides (`Link2` or `Link`). If `StatusBadge` does not accept `'None'`, render a plain span for that case.

- [ ] **Step 3: Tests → pass; existing `ParticipantDetailPage.test.tsx` assertions unchanged. Commit.**

---

## Task 10: Submissions list page

**Files:**
- Create: `src/pages/caregiver-admin/CaregiverSubmissionsPage.tsx`
- Test: `src/pages/caregiver-admin/CaregiverSubmissionsPage.test.tsx`

- [ ] **Step 1: Failing tests** — renders rows from `useCaregiverSubmissions`; default filter is Submitted; the `Dropdown` pill filter switches status; Review action navigates to `/caregiver-submissions/:id`.

- [ ] **Step 2: Implement**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { useCaregiverSubmissions } from '@/api/hooks/caregiver'
import type { CaregiverSubmissionListItemDto, CaregiverSubmissionStatus } from '@/api/types/caregiver'
import { formatDateAu } from '@/lib/utils'

const STATUS_ITEMS = (['Submitted', 'Draft', 'Accepted', 'Rejected', 'Revoked'] as CaregiverSubmissionStatus[]).map((s) => ({ value: s, label: s }))

export default function CaregiverSubmissionsPage() {
  const [status, setStatus] = useState<CaregiverSubmissionStatus>('Submitted')
  const { data = [], isLoading } = useCaregiverSubmissions(status)
  const navigate = useNavigate()
  const columns: Column<CaregiverSubmissionListItemDto>[] = [
    { key: 'participantName', header: 'Participant', sortable: true },
    { key: 'caregiverName', header: 'Caregiver', render: (r) => r.caregiverName ?? '—' },
    { key: 'status', header: 'Status', type: 'badge' },
    { key: 'submittedAt', header: 'Submitted', type: 'date', sortable: true },
    { key: 'expiresAt', header: 'Expires', type: 'date' },
    { key: 'actions', header: '', render: (r) => <button type="button" className="underline text-sm" onClick={() => navigate(`/caregiver-submissions/${r.id}`)}>Review</button> },
  ]
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Caregiver forms</h1>
        <Dropdown variant="pill" items={STATUS_ITEMS} value={status} onChange={(v) => setStatus(v as CaregiverSubmissionStatus)} label="Status" />
      </div>
      <DataTable data={data} columns={columns} keyField="id" loading={isLoading} sortable emptyMessage={`No ${status.toLowerCase()} caregiver forms.`} />
    </div>
  )
}
```

- [ ] **Step 3: Tests → pass. Commit.**

---

## Task 11: Review page with diff, accept, reject

**Files:**
- Create: `src/pages/caregiver-admin/CaregiverSubmissionReviewPage.tsx`
- Test: `src/pages/caregiver-admin/CaregiverSubmissionReviewPage.test.tsx`

- [ ] **Step 1: Failing tests** — renders caregiver name/relationship/submitted-at; lists **only** changed rows from `computeCaregiverDiff`, grouped by `group`; "No changes" state when the diff is empty; Accept confirms then calls `useAcceptCaregiverSubmission` and navigates back to the list; Reject requires a note (button disabled until non-empty) then calls `useRejectCaregiverSubmission`; Accept/Reject hidden when status ≠ Submitted; gated on `canWriteParticipantDetails`.

- [ ] **Step 2: Implement**

```tsx
import { useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useCaregiverSubmission, useAcceptCaregiverSubmission, useRejectCaregiverSubmission } from '@/api/hooks/caregiver'
import { computeCaregiverDiff, type DiffRow } from '@/lib/caregiverDiff'
import { usePermissions } from '@/lib/permissions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatDateAu } from '@/lib/utils'

export default function CaregiverSubmissionReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { canWriteParticipantDetails } = usePermissions()
  const { data: s, isLoading } = useCaregiverSubmission(id)
  const accept = useAcceptCaregiverSubmission()
  const reject = useRejectCaregiverSubmission()
  const [confirmAccept, setConfirmAccept] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [showReject, setShowReject] = useState(false)

  const rows = useMemo(() => (s ? computeCaregiverDiff(s.current, s.payload) : []), [s])
  const byGroup = useMemo(() => rows.reduce<Record<string, DiffRow[]>>((acc, r) => { (acc[r.group] ??= []).push(r); return acc }, {}), [rows])

  if (isLoading) return <p>Loading…</p>
  if (!s) return <p>Submission not found.</p>
  const canAct = canWriteParticipantDetails && s.status === 'Submitted'

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-4">
        <Link to="/caregiver-submissions" className="mt-1 p-2 rounded-lg hover:bg-[var(--color-accent)]"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{s.participantName}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Submitted by <strong>{s.caregiverName ?? '—'}</strong>{s.caregiverRelationship ? ` (${s.caregiverRelationship})` : ''}{s.submittedAt ? ` on ${formatDateAu(s.submittedAt)}` : ''} · {s.status}
          </p>
        </div>
        {canAct && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowReject(true)} className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm">Reject…</button>
            <button type="button" onClick={() => setConfirmAccept(true)} className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm">Accept</button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">The caregiver submitted the form without changing any values.</p>
      ) : Object.entries(byGroup).map(([group, groupRows]) => (
        <section key={group} className="rounded-2xl border border-[var(--color-border)] overflow-hidden">
          <h2 className="px-4 py-2 bg-[var(--color-accent)] text-sm font-medium">{group}</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[var(--color-muted-foreground)]"><th className="p-3">Field</th><th className="p-3">Current</th><th className="p-3">Caregiver's value</th></tr></thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {groupRows.map((r) => (
                <tr key={r.field}><td className="p-3 font-medium">{r.label}</td><td className="p-3">{r.current}</td><td className="p-3">{r.proposed}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <ConfirmDialog open={confirmAccept} title="Accept this submission?" description="All the caregiver's changes above will be applied to the participant record." confirmLabel="Accept"
        onCancel={() => setConfirmAccept(false)}
        onConfirm={async () => { await accept.mutateAsync({ id: s.id, participantId: s.participantId }); navigate('/caregiver-submissions') }} />

      {showReject && (
        <div role="dialog" aria-label="Reject submission" className="rounded-2xl border border-[var(--color-border)] p-4 space-y-3">
          <label className="block text-sm font-medium" htmlFor="reject-note">What should the caregiver fix?</label>
          <textarea id="reject-note" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} className="w-full p-2 rounded-lg border border-[var(--color-border)]" rows={3} />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowReject(false)} className="px-3 py-2 text-sm">Cancel</button>
            <button type="button" disabled={!rejectNote.trim() || reject.isPending}
              onClick={async () => { await reject.mutateAsync({ id: s.id, note: rejectNote.trim() }); navigate('/caregiver-submissions') }}
              className="px-4 py-2 rounded-lg bg-[var(--color-destructive)] text-white text-sm disabled:opacity-50">Reject and reopen link</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

Match `ConfirmDialog`'s real prop names from `src/components/ConfirmDialog.tsx`. The diff table is small, static and not a data list — plain markup is acceptable here (it is not a `DataTable` use case); if the reviewer prefers, switch to `DataTable` with `verticalDividers`.

- [ ] **Step 3: Tests → pass. Commit.**

---

## Task 12: Routes, nav, gates, PR

**Files:**
- Modify: `src/App.tsx` (inside the shell, near `/participants/:id/profile`)
- Modify: the sidebar nav list (find it: `grep -rn "'/participants'" src/components/layout/`)

- [ ] **Step 1: Routes**

```tsx
const CaregiverSubmissionsPage = React.lazy(() => import('./pages/caregiver-admin/CaregiverSubmissionsPage'))
const CaregiverSubmissionReviewPage = React.lazy(() => import('./pages/caregiver-admin/CaregiverSubmissionReviewPage'))
// inside the shell:
<Route path="/caregiver-submissions" element={<PrivateRoute page="participants" requiresWrite><CaregiverSubmissionsPage /></PrivateRoute>} />
<Route path="/caregiver-submissions/:id" element={<PrivateRoute page="participants" requiresWrite><CaregiverSubmissionReviewPage /></PrivateRoute>} />
```

- [ ] **Step 2: Nav** — add an entry matching the existing Participants item's shape (label `Caregiver forms`, path `/caregiver-submissions`, an icon such as `ClipboardCheck`), gated identically to Participants.

- [ ] **Step 3: Full gates, commit, push, PR**

```bash
npm run build && npm test && npm run lint    # lint: exactly 77
git add src/App.tsx src/components/layout/ src/pages/caregiver-admin/ src/pages/ParticipantDetailPage.tsx src/pages/ParticipantDetailPage.test.tsx src/lib/caregiverDiff.ts src/lib/caregiverDiff.test.ts
git commit -m "feat(caregiver): admin link control, submissions list, and diff review with accept/reject

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
git diff HEAD --stat   # empty
git push -u origin feat/cg04-admin-review
gh pr create --base main --title "feat(caregiver): admin review surfaces (cg04)" --body-file <body: link control shows URL once; list filtered to Submitted; review shows changed fields only; accept confirms; reject requires a note and reopens; all gated canWriteParticipantDetails>
```

---

## Self-review against the spec

- §4 wizard: outside shell ✅ (T6), header-free client ✅ (T1 + test), `useWizard` with memoised steps ✅ (T5), name gate via step-0 validate ✅, field set from contract ✅ (T3 + `hiddenFields` T4), shared read-only — the profile steps already render `participant`-sourced shared fields read-only; **verify in T5's test** that a known shared field is read-only, draft on step change + Save-later ✅, submitted / rejected / invalid states ✅, no native `<select>` ✅ (reuses profile steps), CSP unchanged ✅.
- §5 admin: header control with URL-once + copy + revoke + status chip ✅ (T9), list `DataTable` default Submitted ✅ (T10), review side-by-side changed-only grouped, accept confirms, reject requires note ✅ (T11), gating ✅.
- §7 frontend tests: name gate ✅, draft persists (hydrate test) ✅, submitted read-only ✅, rejected note ✅, invalid neutral ✅, drift guard ✅ (T3), no auth headers ✅ (T1), diff changed-only + reject-needs-note ✅ (T8, T11).
- Type consistency: `CaregiverFormDto.current: Record<string, unknown>` (T1) matches `computeCaregiverDiff(current: Record<string, unknown>, …)` (T8) and `hydrateFormFromProjection` (T5) ✅; hook names identical across T2/T5/T9/T10/T11 ✅; `DiffRow.group` used by T11's grouping ✅.
- Docker: no frontend test reads outside `frontend/` ✅.
