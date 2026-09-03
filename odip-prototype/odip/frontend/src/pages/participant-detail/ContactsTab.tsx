import { useState } from 'react'
import { Contact2, Plus } from 'lucide-react'
import type { AxiosError } from 'axios'
import { useParticipantContactRoles, useDeleteContactRole } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { DataTable, type Column } from '@/components/DataTable'
import { usePermissions } from '@/lib/permissions'
import AddContactRoleForm from '@/components/contacts/AddContactRoleForm'
import {
  CONTACT_ROLE_TYPE_LABELS, CONTACT_ROLE_STATUS_LABELS, NOMINEE_SCOPE_LABELS,
} from '@/api/types/contacts'
import type { ParticipantContactRoleDto } from '@/api/types/contacts'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

/** The most relevant secondary line for a role row — different role types surface a different
 * "what matters most" field (research §3.1-3.14) rather than one fixed column always showing the
 * same (often-blank) field. */
function roleSummaryLine(role: ParticipantContactRoleDto): string {
  switch (role.roleType) {
    case 'Guardian':
      return role.appointingTribunal ? `Order via ${role.appointingTribunal}` : '—'
    case 'PlanNominee':
      return role.nomineeScope ? NOMINEE_SCOPE_LABELS[role.nomineeScope] : '—'
    case 'SupportCoordinator':
    case 'PlanManager':
    case 'Advocate':
    case 'Solicitor':
    case 'FinancialAdministrator':
    case 'Gp':
    case 'Specialist':
    case 'Pharmacy':
    case 'ProviderContact':
    case 'Interpreter':
      return role.organisationName || role.discipline || '—'
    default:
      return role.relationshipToParticipant || '—'
  }
}

export default function ContactsTab({ participantId }: { participantId: string | undefined }) {
  const { canWriteContacts: canWrite } = usePermissions()
  const { data: roles = [], isLoading } = useParticipantContactRoles(participantId)
  const deleteRole = useDeleteContactRole()

  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; role?: ParticipantContactRoleDto } | null>(null)
  const [deletingRole, setDeletingRole] = useState<ParticipantContactRoleDto | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  function openCreate() {
    setModalState({ mode: 'create' })
  }

  function openEdit(role: ParticipantContactRoleDto) {
    setModalState({ mode: 'edit', role })
  }

  function closeModal() {
    setModalState(null)
  }

  async function confirmDelete() {
    if (!deletingRole || !participantId) return
    setListError(null)
    try {
      await deleteRole.mutateAsync({ id: deletingRole.id, participantId })
      setDeletingRole(null)
    } catch (err) {
      setDeletingRole(null)
      setListError(extractErrorMessage(err, 'Failed to remove contact.'))
    }
  }

  const columns: Column<ParticipantContactRoleDto>[] = [
    {
      key: 'personFullName',
      header: 'Person',
      sortable: true,
      render: role => (
        <div>
          <p className="font-medium text-[var(--color-foreground)]">{role.personFullName}</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {[role.personMobile || role.personPhone, role.personEmail].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'roleType',
      header: 'Role',
      sortable: true,
      render: role => (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status={role.roleType} label={CONTACT_ROLE_TYPE_LABELS[role.roleType]} colorMap={{ [role.roleType.toLowerCase()]: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' }} />
          {role.isPrimary && <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Primary</span>}
        </span>
      ),
    },
    { key: 'summary', header: 'Detail', render: role => <span className="text-sm">{roleSummaryLine(role)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: role => (
        <StatusBadge
          status={role.status}
          label={CONTACT_ROLE_STATUS_LABELS[role.status]}
          colorMap={{ superseded: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]' }}
        />
      ),
    },
    ...(canWrite ? [{
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right' as const,
      render: (role: ParticipantContactRoleDto) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => openEdit(role)}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline min-h-[44px] px-2 py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setDeletingRole(role)}
            className="text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] min-h-[44px] px-2 py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
          >
            Remove
          </button>
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <Contact2 className="w-4 h-4" /> Contacts
        </h2>
        {canWrite && participantId && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all shadow-md shadow-[var(--color-primary)]/20"
          >
            <Plus className="w-4 h-4" /> Add contact
          </button>
        )}
      </div>

      {listError && (
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          <span>{listError}</span>
          <button
            type="button"
            onClick={() => setListError(null)}
            className="shrink-0 text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
          >
            Dismiss
          </button>
        </div>
      )}

      {!isLoading && roles.length === 0 ? (
        <EmptyState
          icon={Contact2}
          title="No contacts recorded"
          description="Add next of kin, guardians, support coordinators, plan managers, and other key contacts for this participant."
          action={canWrite && participantId ? { label: 'Add contact', onClick: openCreate } : undefined}
        />
      ) : (
        <DataTable
          data={roles}
          columns={columns}
          keyField="id"
          sortable
          loading={isLoading}
          emptyMessage="No contacts recorded"
        />
      )}

      <Modal
        open={!!modalState}
        onClose={closeModal}
        title={modalState?.mode === 'edit' ? 'Edit contact' : 'Add contact'}
        size="lg"
      >
        {modalState && (
          <AddContactRoleForm
            participantId={participantId}
            mode={modalState.mode}
            role={modalState.role}
            onSaved={closeModal}
            onCancel={closeModal}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deletingRole}
        onCancel={() => setDeletingRole(null)}
        onConfirm={confirmDelete}
        title="Remove this contact role?"
        message="This removes the role from this participant. The person record itself is kept, and any other roles they hold are unaffected."
        confirmLabel="Remove"
        variant="danger"
        loading={deleteRole.isPending}
      />
    </div>
  )
}
