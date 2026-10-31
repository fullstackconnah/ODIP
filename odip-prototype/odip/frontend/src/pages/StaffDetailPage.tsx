import { useParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useStaffOverview, useSettings, useEnsureStaffSignInAccount, useConfirmStaffAddress, useRecordInvitesSent, useModuleVisibility, useStaffLeaveBalances } from '@/api/hooks'
import { Tabs } from '@/components/Tabs'
import { LeaveBalances } from '@/components/LeaveBalances'
import { Card } from '@/components/Card'
import { PageHeader, PageHeaderMeta } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NoticesRegion } from '@/components/NoticesRegion'
import { BackButton } from '@/components/BackButton'
import { useTabParam } from '@/hooks/useTabParam'
import { useNotices } from '@/hooks/useNotices'
import { PageState } from '@/components/PageState'
import { isNotFoundError } from '@/lib/httpStatus'
import { DataTable } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { usePermissions } from '@/lib/permissions'
import { canSendSetPasswordEmail } from '@/lib/setPasswordEmail'
import { describeEmailOutcome, ensureAndSendSetPasswordEmail } from '@/lib/signInEmail'
import { ADDRESS_CHECK_SENTENCE } from '@/lib/addressConfirmation'
import { extractErrorMessage, formatDateAu } from '@/lib/utils'
import { staffCredentials, type StaffCredential } from '@/lib/credentials'
import { DEADLINE_TONE, deadlineLabel } from '@/lib/deadline'
import { formatShiftTimeRange, formatVarianceMinutes } from '@/pages/rostering/lib/roster'
import AvailabilityList from '@/pages/schedule/AvailabilityList'
import { PersonWeek } from '@/pages/rostering/components/PersonWeek'
import {
  Pencil, CalendarOff, CalendarClock, CalendarDays, ShieldCheck, ClipboardList, AlertTriangle, ClipboardCheck, Mail,
} from 'lucide-react'
import type { StaffOverviewUpcomingShiftDto, StaffOverviewTripAssignmentDto } from '@/api/types/staff'
import type { IncidentListDto } from '@/api/types/incidents'
import type { CompletionQueueItemDto } from '@/api/types/rostering'
import { POSITION_LABELS } from '@/api/types/enums'
import { retryingAfterError } from '@/lib/queryPhase'

type Tab = 'availability' | 'credentials' | 'week' | 'upcoming' | 'incidents' | 'completions'

const TAB_KEYS: Tab[] = ['availability', 'credentials', 'upcoming', 'incidents', 'completions']
// The Week tab (spec 2026-10-28) is for the roles that roster; two module consts keep useTabParam's keys stable between renders.
const TAB_KEYS_WITH_WEEK: Tab[] = ['availability', 'credentials', 'week', 'upcoming', 'incidents', 'completions']

/** A table-cell link is the row's tap target: no height change on a mouse (--tap-min is 0 there), a
 * 44px floor under a coarse pointer (fits the 48px coarse row). */
const ROW_LINK = 'inline-flex min-h-[var(--tap-min)] items-center font-medium hover:text-[var(--color-primary)]'

// Which credentials apply and what state each is in is lib/credentials.ts (one rule for this tab, the Qualifications list and the Dashboard
// count); the day threshold is the same settings.qualificationWarningDays.
function credentialBadge(row: StaffCredential) {
  return <StatusBadge tone={DEADLINE_TONE[row.state.status]} label={deadlineLabel(row.state, 'long')} />
}

export default function StaffDetailPage() {
  const { id } = useParams()
  const { canWrite, canAccessPage, isSuperAdmin, isAdmin, isCoordinator } = usePermissions()
  const canAccessLeaveApprovals = canAccessPage('leave-approvals')
  // POST /staff/{id}/sign-in-account is Admin, Coordinator and SuperAdmin only (the same three roles canWrite admits), and
  // Firebase sends the email, so without Firebase (local dev auth) the action is not offered rather than offered and broken.
  const canManageSignIn = (isSuperAdmin || isAdmin || isCoordinator) && canSendSetPasswordEmail()
  const ensureAccount = useEnsureStaffSignInAccount()
  const recordInvite = useRecordInvitesSent()
  // POST /staff/{id}/confirm-address takes the same three roles. It needs no Firebase, so it is not behind canSendSetPasswordEmail.
  const canConfirmAddress = isSuperAdmin || isAdmin || isCoordinator
  const confirmAddress = useConfirmStaffAddress()
  const [confirming, setConfirming] = useState(false)
  // What became of each "Send set-password email", kept at the top of the page until dismissed.
  const { notices, notify, dismiss } = useNotices()
  const [sending, setSending] = useState(false)

  const canAccessRostering = canAccessPage('rostering')
  const [tab, setTab] = useTabParam(canAccessRostering ? TAB_KEYS_WITH_WEEK : TAB_KEYS, 'availability')

  const pageQuery = useStaffOverview(id)
  const { data: overview, isLoading, isError, error, refetch } = pageQuery
  const { data: settings } = useSettings()
  const warningDays = settings?.qualificationWarningDays ?? 30
  // Balances are payroll data: Admin and SuperAdmin only (the endpoint refuses the rest), and only once the organisation is connected.
  const ehConnected = useModuleVisibility().data?.employmentHeroConnected === true
  const showBalances = (isAdmin || isSuperAdmin) && ehConnected
  const balances = useStaffLeaveBalances(id ?? '', showBalances && !!id && tab === 'availability')

  const credentialRows = useMemo(
    () => (overview ? staffCredentials(overview.staff, { warnDays: warningDays }) : []),
    [overview, warningDays]
  )

  // The server makes sure the account exists first (staff added through the staff form have none), then Firebase is asked to send the link;
  // what is said afterwards follows what actually happened in those two steps (lib/signInEmail.ts).
  async function handleSendSetPasswordEmail() {
    // The button says "busy" with aria-disabled, not `disabled` (that can drop keyboard focus on the button just activated), so a click
    // still arrives while a send is under way: this is what refuses it.
    if (sending) return
    const email = overview?.staff.email
    if (!overview || !email) return
    setSending(true)
    const outcome = await ensureAndSendSetPasswordEmail(email, () => ensureAccount.mutateAsync(overview.staff.id))
    setSending(false)
    if (outcome.ok) recordInvite.mutate([overview.staff.id])
    const { tone, message } = describeEmailOutcome(outcome, 'use Send set-password email on this page')
    // The staff id is the notice's subject, so a later send that works replaces this person's earlier failure.
    notify(tone, overview.staff.fullName, message, overview.staff.id)
  }

  // The sync brought an address the organisation has not checked: until an Admin confirms it, the person cannot sign in (so there is no invite to send).
  async function handleConfirmAddress() {
    if (!overview || confirmAddress.isPending) return
    const { id: staffId, fullName } = overview.staff
    try {
      await confirmAddress.mutateAsync(staffId)
      notify('success', fullName, `${fullName}'s address is confirmed. You can send their sign-in invite now.`, staffId)
    } catch (e) {
      notify('danger', fullName, extractErrorMessage(e, "That address couldn't be confirmed. Try again."), staffId)
    }
    setConfirming(false)
  }

  // Dismissing the last notice hands focus back to the button that raised it.
  const focusSendButton = () => document.querySelector<HTMLElement>('[data-send-set-password]')

  if (isLoading && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="staff member" />
  if (!overview) {
    return (isError || retryingAfterError(pageQuery)) && !isNotFoundError(error)
      ? <PageState kind="error" noun="staff member" onRetry={() => refetch()} />
      : <PageState kind="not-found" noun="staff member" backTo="/staff" backLabel="staff" />
  }

  const { staff } = overview
  // Join only the parts that exist: an empty position used to leave the row starting with a
  // stray " · " separator.
  const positionAndRegion = [POSITION_LABELS[staff.position] ?? staff.position, staff.region || 'No region'].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <div className="flex items-start gap-2">
        {/* A box the height of the display title's first line, so the icon's centre is the title's (the icon overflows it evenly). */}
        <div className="flex h-[calc(var(--text-display)*var(--text-display-lh))] items-center">
          <BackButton to="/staff" label="staff" variant="icon" />
        </div>
        <div className="flex-1 min-w-0">
          <PageHeader
            variant="detail"
            title={staff.fullName}
            subtitle={
              <PageHeaderMeta>
                <StatusBadge status={staff.isActive ? 'Active' : 'Inactive'} />
                <span>{positionAndRegion}</span>
                {staff.employmentStartDate && <span>Start date {formatDateAu(staff.employmentStartDate)} · From Employment Hero</span>}
              </PageHeaderMeta>
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                {canAccessLeaveApprovals && (
                  <Button to={`/rostering/leave?userId=${id}`} variant="secondary" size="md">
                    <CalendarOff className="w-4 h-4" /> Leave & availability
                  </Button>
                )}
                {canConfirmAddress && staff.isActive && staff.signInAddressUnconfirmed === true && (
                  <Button variant="secondary" size="md" onClick={() => setConfirming(true)} data-confirm-address>
                    <Mail className="w-4 h-4" /> Confirm address
                  </Button>
                )}
                {canManageSignIn && staff.isActive && !!staff.email && staff.signInAddressUnconfirmed !== true && (
                  <>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={handleSendSetPasswordEmail}
                    data-send-set-password
                    aria-disabled={sending || undefined}
                    aria-busy={sending || undefined}
                    className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                  >
                    <Mail className="w-4 h-4" /> Send set-password email
                  </Button>
                  {staff.signInInviteSentAt && !staff.hasSignedIn && <span className="text-[13px] text-[var(--color-muted-foreground)]">{`Invite sent ${formatDateAu(staff.signInInviteSentAt)}`}</span>}
                  </>
                )}
                {canWrite && (
                  <Button to={`/staff/${id}/edit`} variant="primary" size="md">
                    <Pencil className="w-4 h-4" /> Edit
                  </Button>
                )}
              </div>
            }
          />
        </div>
      </div>

      {canConfirmAddress && staff.isActive && staff.signInAddressUnconfirmed === true && (
        <Callout tone="warning">{`${staff.email} came from Employment Hero and isn't at your organisation's domain or a common email provider. ${staff.firstName} can't sign in until you confirm it.`}</Callout>
      )}
      <ConfirmDialog
        open={confirming}
        title="Check this address"
        message={<><strong className="break-all">{staff.email}</strong><br />{ADDRESS_CHECK_SENTENCE}</>}
        confirmLabel="Use this address"
        cancelLabel="Go back"
        loading={confirmAddress.isPending}
        onConfirm={handleConfirmAddress}
        onCancel={() => setConfirming(false)}
      />

      {/* Notices for the actions above. Always mounted (a live region must exist before its content), and collapsed while empty. */}
      <NoticesRegion notices={notices} onDismiss={dismiss} focusAfterDismiss={focusSendButton} className="empty:-mt-[var(--section-gap)]" />

      <Tabs
        tabs={[
          { id: 'availability', label: 'Availability', icon: CalendarClock },
          { id: 'credentials', label: 'Credentials', icon: ShieldCheck },
          ...(canAccessRostering ? [{ id: 'week' as const, label: 'Week', icon: CalendarDays }] : []),
          { id: 'upcoming', label: 'Upcoming', icon: ClipboardList },
          { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
          { id: 'completions', label: 'Completions', icon: ClipboardCheck },
        ]}
        active={tab}
        onChange={setTab}
        ariaLabel="Staff detail sections"
      />

      {tab === 'availability' && (
        <Card>
          {/* AvailabilityList's root carries `pl-8 py-2` — an indent for the Schedule page's
              accordion rows. Inside this Card it read as a blank ~30px icon slot left of the
              "Availability" label (no icon was ever meant to fill it), so flush it to the Card's
              own padding from out here. */}
          <div className="[&>div]:p-0">
            <AvailabilityList staffId={id!} availability={overview.availability} />
          </div>
        </Card>
      )}

      {tab === 'availability' && showBalances && (
        <Card>
          <LeaveBalances
            query={balances}
            noneMessage="Employment Hero has no leave balances for this person yet."
            loadingMessage="Reading balances from Employment Hero…"
            headingLevel={3}
            notLinked={
              <>
                <span>Not linked to Employment Hero, so we can't show balances.</span>
                <Link className="flex w-fit items-center text-[13px] underline pointer-coarse:min-h-[var(--tap-min)]" to="/settings?section=integrations">Link in Settings → Integrations</Link>
              </>
            }
          />
        </Card>
      )}

      {tab === 'credentials' && (
        <Card>
          {credentialRows.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No credentials on file" description="This staff member has no qualification flags or expiry dates set." />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {credentialRows.map((row) => (
                <li key={row.key} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    {row.expiryDate && (
                      <p className="text-xs tabular-nums text-[var(--color-muted-foreground)]">Expires {formatDateAu(row.expiryDate)}</p>
                    )}
                  </div>
                  {credentialBadge(row)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'week' && id && (
        <Card>
          <PersonWeek kind="staff" personId={id} name={staff.fullName} headingLevel={2} />
        </Card>
      )}

      {tab === 'upcoming' && (
        <div className="flex flex-col gap-[var(--section-gap)]">
          <Card title="Upcoming shifts">
            <DataTable
              data={overview.upcomingShifts}
              keyField="shiftId"
              emptyMessage="No shifts in the next 14 days"
              columns={[
                { key: 'serviceDate', header: 'Date', type: 'date' },
                {
                  key: 'startTime',
                  header: 'Time',
                  render: (s: StaffOverviewUpcomingShiftDto) => (
                    <span title={s.endsNextDay ? `${formatShiftTimeRange(s.startTime, s.endTime)} — ends the next day` : undefined}>
                      {formatShiftTimeRange(s.startTime, s.endTime)}
                    </span>
                  ),
                },
                {
                  key: 'participantName',
                  header: 'Participant',
                  render: (s: StaffOverviewUpcomingShiftDto) => (
                    <Link to={`/participants/${s.participantId}`} className={ROW_LINK}>
                      {s.participantName}
                    </Link>
                  ),
                },
                { key: 'status', header: 'Status', type: 'badge' },
              ]}
            />
          </Card>
          <Card title="Upcoming trip assignments">
            <DataTable
              data={overview.upcomingTripAssignments}
              keyField="assignmentId"
              emptyMessage="No upcoming trip assignments"
              columns={[
                {
                  key: 'tripName',
                  header: 'Trip',
                  render: (a: StaffOverviewTripAssignmentDto) => (
                    <Link to={`/trips/${a.tripInstanceId}`} className={ROW_LINK}>
                      {a.tripName}
                    </Link>
                  ),
                },
                { key: 'startDate', header: 'Start', type: 'date' },
                { key: 'endDate', header: 'End', type: 'date' },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === 'incidents' && (
        <Card>
          {overview.recentIncidents.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No recent incidents" description="No incidents involve this staff member yet." />
          ) : (
            <DataTable
              data={overview.recentIncidents}
              keyField="id"
              columns={[
                {
                  key: 'title',
                  header: 'Title',
                  render: (i: IncidentListDto) => (
                    <Link to={`/incidents/${i.id}`} className={ROW_LINK}>
                      {i.title}
                    </Link>
                  ),
                },
                { key: 'incidentDateTime', header: 'Date', type: 'date' },
                { key: 'severity', header: 'Severity', type: 'badge' },
                { key: 'status', header: 'Status', type: 'badge' },
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'completions' && (
        <Card
          title="Recent completions"
          action={
            <Link to="/rostering/completions" className="inline-flex min-h-[var(--tap-min)] items-center text-xs text-[var(--color-primary)] hover:underline">
              Open completions review →
            </Link>
          }
        >
          {overview.recentCompletions.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="No recent completions" description="This staff member hasn't submitted a shift completion yet." />
          ) : (
            <DataTable
              data={overview.recentCompletions}
              keyField="completionId"
              columns={[
                { key: 'participantName', header: 'Participant' },
                { key: 'serviceDate', header: 'Date', type: 'date' },
                {
                  key: 'varianceMinutesStart',
                  header: 'Variance',
                  render: (c: CompletionQueueItemDto) => (
                    <span className={c.isOutlierVariance ? 'text-[var(--color-destructive)] font-medium' : undefined}>
                      {formatVarianceMinutes(c.varianceMinutesStart)}
                    </span>
                  ),
                },
                { key: 'status', header: 'Status', type: 'badge' },
              ]}
            />
          )}
        </Card>
      )}
    </div>
  )
}
