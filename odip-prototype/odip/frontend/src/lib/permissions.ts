export type UserRole = 'SuperAdmin' | 'Admin' | 'Coordinator' | 'SupportWorker' | 'ReadOnly';

export type PageKey =
  | 'dashboard'
  | 'portal'
  | 'portal-leave'
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
  | 'leave-approvals'
  | 'settings'
  | 'medications'
  | 'caregiver-submissions'
  | 'agreement-drafts'
  | 'budgets';

const SUPPORT_WORKER_PAGES: PageKey[] = [
  'dashboard',
  'portal',
  'portal-leave',
  'trips',
  'schedule',
  'participants',
  'tasks',
  'incidents',
  'medications',
];

/**
 * The pages ReadOnly cannot open. ReadOnly reads most of the app, but each of these sits behind a controller that admits only
 * SuperAdmin, Admin and Coordinator for EVERY request, reads included (ReadOnlyMiddleware, which 403s writes, never gets that far):
 * RosteringController (the five Rostering pages, and the flagged-notes read that Incidents makes), LeaveController, BillingController
 * and ClaimsController (billing, claims), CaregiverSubmissionsController, SettingsController / ProviderSettingsController, and the GETs of ServiceAgreementDraftsController (the agreement draft
 * page: a draft carries unit prices, totals and the pricing answer, and money is never visible to ReadOnly or SupportWorker; SupportWorker's allow-list above does not name it either), and the
 * Budgets list (GET api/v1/funding/budgets is class-wide SuperAdmin, Admin and Coordinator, like the participant's Funding tab: every figure on it is money, and `canManageFunding` below is its rule).
 * Listing them here keeps the menu, the routes and the in-page links from offering ReadOnly a page that can only answer 403.
 */
const READ_ONLY_REFUSED_PAGES: PageKey[] = [
  'rostering',
  'leave-approvals',
  'billing',
  'claims',
  'settings',
  'caregiver-submissions',
  'agreement-drafts',
  'budgets',
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

    /** Whether the user can access a given page/route. SupportWorker has a restricted set; ReadOnly is refused the pages the API refuses it. */
    canAccessPage: (page: PageKey): boolean => {
      if (isSupportWorker) return SUPPORT_WORKER_PAGES.includes(page);
      if (isReadOnly) return !READ_ONLY_REFUSED_PAGES.includes(page);
      return true;
    },

    /**
     * Controls create/edit/delete button visibility.
     * SupportWorker: false — buttons hidden (except canCreateIncidents).
     * ReadOnly: true — buttons visible, backend blocks the actual mutations.
     */
    canWrite: !isSupportWorker,

    /**
     * Participant inquiry, draft-intake, and onboarding mutations are restricted by
     * ParticipantInquiriesController to Admin, Coordinator, and SuperAdmin. This is
     * deliberately separate from canWrite: ReadOnly historically satisfied canWrite
     * even though the lifecycle API rejects its mutation requests.
     */
    canManageParticipantLifecycle: isSuperAdmin || isAdmin || isCoordinator,

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
     * Removing a routine is narrower than writing one: a support worker can add and edit a routine but not remove it. DELETE participants/routines/{id}
     * now retires the routine (IsActive = false; the ticks recorded against it on past shifts survive) and answers 403 to any other role. Mirrors the
     * backend's ParticipantRoutinesController.Delete role gate exactly.
     */
    canDeleteRoutines: isSuperAdmin || isAdmin || isCoordinator,

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

    /** Mirrors PortalController's leave endpoints — any non-ReadOnly authenticated user. */
    canRequestLeave: !isReadOnly,

    /** Mirrors LeaveController's [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]. */
    canApproveLeave: isSuperAdmin || isAdmin || isCoordinator,

    /** Mirrors PortalController's shift start/finish — any non-ReadOnly authenticated user, own shifts only. */
    canCompleteOwnShifts: !isReadOnly,

    /** Mirrors RosteringController's completion review actions — [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]. */
    canReviewCompletions: isSuperAdmin || isAdmin || isCoordinator,

    /** Mirrors AdminNotificationsController's [Authorize(Roles = "Admin,SuperAdmin")] — gates the
     * Settings → Failed Sends admin tab. Notification preferences themselves need no boolean:
     * any non-ReadOnly authenticated user manages their own (ReadOnlyMiddleware already 403s the
     * PUT ahead of the controller). */
    canManageNotifications: isSuperAdmin || isAdmin,

    /**
     * A participant's plan budget (the Funding tab, and the budget card on Intake and the Profile wizard). It is money, and money is never visible to SupportWorker or ReadOnly:
     * mirrors ParticipantFundingController's class-wide [Authorize(Roles = "SuperAdmin,Admin,Coordinator")], reads included. Deliberately NOT canWrite, which ReadOnly satisfies.
     */
    canManageFunding: isSuperAdmin || isAdmin || isCoordinator,
  };
}
