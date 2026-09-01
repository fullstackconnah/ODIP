export type UserRole = 'SuperAdmin' | 'Admin' | 'Coordinator' | 'SupportWorker' | 'ReadOnly';

export type PageKey =
  | 'dashboard'
  | 'portal'
  | 'trips'
  | 'schedule'
  | 'participants'
  | 'accommodation'
  | 'vehicles'
  | 'staff'
  | 'tasks'
  | 'incidents'
  | 'bookings'
  | 'qualifications'
  | 'claims'
  | 'billing'
  | 'rostering'
  | 'settings'
  | 'medications';

const SUPPORT_WORKER_PAGES: PageKey[] = [
  'dashboard',
  'portal',
  'trips',
  'schedule',
  'participants',
  'tasks',
  'incidents',
  'medications',
];

function getCurrentUser(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem('odip_user') || '{}');
  } catch {
    return {};
  }
}

export function usePermissions() {
  const user = getCurrentUser();
  const role = (user.role ?? null) as UserRole | null;
  // The signed-in user's own id (AuthResponseDto.id, stored wholesale into odip_user at login —
  // see LoginPage.applyLoginSuccess). Post staff/user unification this is the self-exclusion
  // source (e.g. excluding yourself from a witness picker). Null/undefined alike collapse to
  // null: a stale odip_user payload from before this field existed (or any blob missing it)
  // just means "no self-exclusion to apply" — never a crash. The server still enforces this
  // regardless of what the client filters out.
  const id = (user.id ?? null) as string | null;

  // The signed-in (or, under SuperAdmin "view as", the viewed-as) user's display name —
  // AuthResponseDto.fullName, overwritten by UserSwitcher.selectUser on a view-as switch so this
  // always matches who the server will actually attribute a new record to. Used for read-only
  // "administered by" style displays (see RecordAdministrationModal) rather than any write path.
  const fullName = (user.fullName ?? null) as string | null;

  const isSuperAdmin = role === 'SuperAdmin';
  const isAdmin = role === 'Admin';
  const isCoordinator = role === 'Coordinator';
  const isSupportWorker = role === 'SupportWorker';
  const isReadOnly = role === 'ReadOnly';

  return {
    role,
    id,
    fullName,
    isSuperAdmin,
    isAdmin,
    isCoordinator,
    isSupportWorker,
    isReadOnly,

    /** Whether the user can access a given page/route. SupportWorker has a restricted set. */
    canAccessPage: (page: PageKey): boolean => {
      if (isSupportWorker) return SUPPORT_WORKER_PAGES.includes(page);
      return true;
    },

    /**
     * Controls create/edit/delete button visibility.
     * SupportWorker: false — buttons hidden (except canCreateIncidents).
     * ReadOnly: true — buttons visible, backend blocks the actual mutations.
     */
    canWrite: !isSupportWorker,

    /**
     * SupportWorker can create incidents (their only write action).
     * ReadOnly: true — button visible, backend blocks the save.
     */
    canCreateIncidents: true,

    /**
     * Medication CRUD (create/edit medications, amend administrations) is limited to
     * clinical/coordination roles — Admin, Coordinator, SuperAdmin.
     */
    canManageMedications: isSuperAdmin || isAdmin || isCoordinator,

    /**
     * Recording a dose administration on the MAR is broader than full medication
     * management — support workers giving doses on shift need this too.
     */
    canRecordAdministrations: isSuperAdmin || isAdmin || isCoordinator || isSupportWorker,

    /**
     * The cross-participant medication administration report endpoint
     * (GET /medications/administrations/report) is role-gated server-side to
     * Admin/Coordinator/SuperAdmin — narrower than canRecordAdministrations. Mirrors that gate
     * so the Report tab isn't shown to a role whose request would just 403.
     */
    canViewAdministrationReport: isSuperAdmin || isAdmin || isCoordinator,

    /**
     * Participant notes are shift-facing (care preferences, routines) — any role that
     * works a shift can write one. Only ReadOnly is excluded.
     */
    canWriteNotes: isSuperAdmin || isAdmin || isCoordinator || isSupportWorker,

    /**
     * Participant routines/specifics are shift-facing in the same way notes are — any role
     * that works a shift can write one. Only ReadOnly is excluded.
     */
    canWriteRoutines: isSuperAdmin || isAdmin || isCoordinator || isSupportWorker,

    /**
     * INTAKE-09: participant risk entries are shift-facing in the same way routines/notes are —
     * any role that works a shift can write one. Only ReadOnly is excluded. Mirrors the
     * backend's ParticipantRiskEntriesController role gate exactly.
     */
    canWriteRisks: isSuperAdmin || isAdmin || isCoordinator || isSupportWorker,

    /**
     * Restrictive practice register entries carry authorisation/compliance information — same
     * clinical/coordination gate as medication management, narrower than routines/notes.
     */
    canWriteRestrictivePractices: isSuperAdmin || isAdmin || isCoordinator,

    /**
     * CONTACT-01/02/03: contact roles can carry sensitive information (guardian tribunal orders,
     * solicitor/financial-administration references) — same coordination-only gate as restrictive
     * practices, narrower than routines/notes/risks. Mirrors
     * ParticipantContactRolesController/PersonsController's Admin/Coordinator/SuperAdmin role gate
     * exactly.
     */
    canWriteContacts: isSuperAdmin || isAdmin || isCoordinator,

    /**
     * INTAKE sub-wave B: consent decisions are compliance-adjacent (photo/video, alcohol, OTC
     * medication, emergency medical, privacy, travel insurance, T&C acceptance) — same
     * coordination-only gate as contacts/restrictive practices, narrower than routines/notes/
     * risks. Mirrors ParticipantConsentsController.Upsert's Admin/Coordinator/SuperAdmin role
     * gate exactly.
     */
    canWriteConsents: isSuperAdmin || isAdmin || isCoordinator,

    /**
     * INTAKE sub-wave C1: the structured health-condition grid is support-planning clinical
     * detail — same coordination-only gate as consents/contacts/restrictive practices. Mirrors
     * ParticipantHealthConditionsController.Upsert's Admin/Coordinator/SuperAdmin role gate exactly.
     */
    canWriteHealthConditions: isSuperAdmin || isAdmin || isCoordinator,

    /**
     * INTAKE sub-wave C2: the structured ADL rating grid is support-planning clinical detail —
     * same coordination-only gate as health conditions/consents/contacts/restrictive practices.
     * Mirrors ParticipantAdlAssessmentsController.Upsert's Admin/Coordinator/SuperAdmin role gate
     * exactly.
     */
    canWriteAdlAssessments: isSuperAdmin || isAdmin || isCoordinator,

    /**
     * CORE-02: gates every `usePatchParticipant()` consumer (the wizard's per-step "Save
     * changes", the detail-tab section-edit panels) — mirrors ParticipantsController.Patch's
     * `[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]` gate exactly, same as the pre-existing
     * PUT gate. Deliberately narrower than the broader `canWrite` (`!isSupportWorker`), which the
     * backend's real Patch/Update role gate never allows for SupportWorker anyway.
     */
    canWriteParticipantDetails: isSuperAdmin || isAdmin || isCoordinator,

    /**
     * PD-6: gates `useUpdateSupportProfile()` — the `/support-profile` sub-resource's own PUT,
     * separate from `canWriteParticipantDetails`'s PATCH gate because it's a genuinely different
     * resource/endpoint. Mirrors `ParticipantsController.UpdateSupportProfile`'s
     * `[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]` gate exactly — same three roles as
     * `canWriteParticipantDetails` today, but kept as its own named boolean (not reused) so the
     * two can diverge later without silently changing the other's meaning.
     */
    canWriteSupportProfile: isSuperAdmin || isAdmin || isCoordinator,

    /**
     * Computed participant risk alerts (task 6c) are coordinator/admin-facing — mirrors the
     * backend's ParticipantAlertsController role gate exactly. SupportWorker/ReadOnly excluded
     * (the portal already shows participant flags to support workers separately).
     */
    canViewAlerts: isSuperAdmin || isAdmin || isCoordinator,

    /**
     * Coordinator sees Provider Settings tab but cannot save changes.
     * False for Coordinator and SupportWorker.
     */
    canEditProviderSettings: !isCoordinator && !isSupportWorker,

    /**
     * Bank details fields are hidden from Coordinator.
     */
    showBankDetails: !isCoordinator,
  };
}
