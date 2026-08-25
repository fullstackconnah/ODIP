export type UserRole = 'SuperAdmin' | 'Admin' | 'Coordinator' | 'SupportWorker' | 'ReadOnly';

export type PageKey =
  | 'dashboard'
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

  const isSuperAdmin = role === 'SuperAdmin';
  const isAdmin = role === 'Admin';
  const isCoordinator = role === 'Coordinator';
  const isSupportWorker = role === 'SupportWorker';
  const isReadOnly = role === 'ReadOnly';

  return {
    role,
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
     * Participant notes are shift-facing (care preferences, routines) — any role that
     * works a shift can write one. Only ReadOnly is excluded.
     */
    canWriteNotes: isSuperAdmin || isAdmin || isCoordinator || isSupportWorker,

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
