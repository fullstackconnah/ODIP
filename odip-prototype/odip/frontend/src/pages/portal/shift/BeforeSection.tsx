import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, HeartPulse, Phone } from 'lucide-react'
import { useAcknowledgeHandover } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { TAP_AREA } from '@/components/tapArea'
import { formatWithTimeZone, formatDateAu } from '@/lib/utils'
import { SHIFT_PACKAGE_ERROR_CODES } from '@/api/types'
import { apiErrorMessages, hasApiErrorCode, shiftDetailFromError } from '@/lib/shiftPackageErrors'
import { Chip, Fact, Section } from './ui'
import type { PortalEmergencyContactDto, PortalShiftDetailDto } from '@/api/types'

function Handover({ shift, canAct, online }: { shift: PortalShiftDetailDto; canAct: boolean; online: boolean }) {
  const ack = useAcknowledgeHandover()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { handover, handoverTrail } = shift

  async function markRead() {
    if (!handover) return
    setError(null)
    try {
      await ack.mutateAsync({ id: shift.id, data: { completionId: handover.completionId } })
    } catch (err) {
      if (hasApiErrorCode(err, SHIFT_PACKAGE_ERROR_CODES.handoverChanged)) {
        const fresh = shiftDetailFromError(err)
        if (fresh) qc.setQueryData(['portal-shift-detail', shift.id], fresh)
        setError('A newer handover arrived. Read it, then mark it as read.')
      } else {
        setError(apiErrorMessages(err)[0] ?? "Couldn't mark the handover as read. Try again.")
      }
    }
  }

  if (!handover) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">No handover from a previous shift.</p>
  }
  return (
    <div className="space-y-2">
      {handover.nothingToHandOver || !handover.text
        ? <p className="text-sm italic text-[var(--color-muted-foreground)]">{handover.nothingToHandOver ? 'Nothing to hand over.' : 'No handover note was written.'}</p>
        : <p className="text-sm whitespace-pre-wrap">{handover.text}</p>}
      <p className="text-xs text-[var(--color-muted-foreground)]">
        From {handover.authorName}, shift of {formatDateAu(handover.shiftDate)}, finished {formatWithTimeZone(handover.submittedAt, shift.timeZoneId, { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
      {handoverTrail.length > 0 && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Recent shifts: {handoverTrail.map(t => `${t.workerName} (${formatDateAu(t.shiftDate)})`).join(', ')}
        </p>
      )}
      {handover.requiresAcknowledgement && (handover.isRead ? (
        <p className="text-sm font-medium">
          Read{handover.readAt ? ` ${formatWithTimeZone(handover.readAt, shift.timeZoneId, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
        </p>
      ) : canAct && (
        <Button variant="secondary" size="lg" onClick={markRead} disabled={ack.isPending || !online}>
          {ack.isPending ? 'Saving…' : 'Mark as read'}
        </Button>
      ))}
      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
    </div>
  )
}

/** Fixed order: allergies, diet, communication, behaviour, HIDPA, address. Every field has an explicit "Not recorded". */
function AtAGlance({ shift }: { shift: PortalShiftDetailDto }) {
  const g = shift.atAGlance
  const hidpa = [g.hidpa.epilepsy && 'Epilepsy', g.hidpa.enteralFeeding && 'Enteral feeding', g.hidpa.dysphagia && 'Dysphagia'].filter(Boolean) as string[]
  const a = g.address
  const address = a ? [a.street, a.suburb, [a.state, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ') : null
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          Allergies
          {g.allergies.isAnaphylaxisRisk === true && <Chip tone="danger">Anaphylaxis risk</Chip>}
        </h3>
        <dl className="grid gap-2">
          <Fact label="Allergies" value={g.allergies.detail} />
          <Fact
            label="Anaphylaxis"
            value={g.allergies.isAnaphylaxisRisk === null ? null : g.allergies.isAnaphylaxisRisk ? 'Anaphylaxis risk' : 'Recorded as no anaphylaxis risk'}
          />
          <Fact label="Management" value={g.allergies.managementNotes} />
        </dl>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">Diet</h3>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Fact label="Choking risk" value={g.diet.chokingRiskDetail} />
          <Fact label="PEG regime" value={g.diet.pegRegimeDetail} />
          <Fact label="Modified diet" value={g.diet.modifiedDietDetail} />
          <Fact label="Meal assistance" value={g.diet.mealAssistanceDetail} />
          <Fact label="Giving medicine with food" value={g.diet.medicationTricks} />
        </dl>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">Communication</h3>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Fact label="Expressive skills" value={g.communication.expressiveSkills} />
          <Fact label="Receptive skills" value={g.communication.receptiveSkills} />
          <Fact label="Reading ability" value={g.communication.readingAbility} />
          <Fact label="Aids" value={g.communication.aids} />
        </dl>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">Behaviour</h3>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Fact label="Triggers" value={g.behaviour.triggers} />
          <Fact label="Early warning signs" value={g.behaviour.earlyWarningSigns} />
          <Fact label="De-escalation strategies" value={g.behaviour.deEscalationStrategies} />
          <Fact label="What not to do" value={g.behaviour.whatNotToDo} />
          <Fact label="What helps me calm down" value={g.behaviour.whatHelpsMeCalmDown} />
        </dl>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">HIDPA flags</h3>
        <p className="text-sm">{hidpa.length ? hidpa.join(', ') : 'None flagged'}</p>
      </div>
      {a !== null && (
        <div>
          <h3 className="text-sm font-semibold mb-1">Address</h3>
          <dl><Fact label="Address" value={address} /></dl>
        </div>
      )}
    </div>
  )
}

function rankContacts(list: PortalEmergencyContactDto[]): PortalEmergencyContactDto[] {
  return [...list].sort((x, y) =>
    Number(y.isPrimary) - Number(x.isPrimary)
    || (x.priorityOrder ?? Number.MAX_SAFE_INTEGER) - (y.priorityOrder ?? Number.MAX_SAFE_INTEGER))
}

function telHref(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, '')}`
}

function Contacts({ contacts }: { contacts: PortalEmergencyContactDto[] }) {
  if (contacts.length === 0) return <p className="text-sm text-[var(--color-muted-foreground)]">No emergency contacts recorded.</p>
  return (
    <ul className="space-y-2">
      {rankContacts(contacts).map(c => (
        <li key={c.id} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
          <p className="font-medium flex items-center gap-2 flex-wrap">
            {c.name}
            {c.isPrimary && <Chip>Primary</Chip>}
          </p>
          <p className="text-xs text-[var(--color-muted-foreground)]">{[c.roleLabel, c.relationship].filter(Boolean).join(', ')}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {c.mobile && (
              <a href={telHref(c.mobile)} className={`${TAP_AREA} inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--color-border)] font-medium`}>
                <Phone className="w-4 h-4" aria-hidden="true" /> Call mobile {c.mobile}
              </a>
            )}
            {c.phone && (
              <a href={telHref(c.phone)} className={`${TAP_AREA} inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--color-border)] font-medium`}>
                <Phone className="w-4 h-4" aria-hidden="true" /> Call phone {c.phone}
              </a>
            )}
            {!c.mobile && !c.phone && <span className="text-[var(--color-muted-foreground)] italic">No number recorded</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function HandoverSection({ shift, canAct, online, compact = false }: { shift: PortalShiftDetailDto; canAct: boolean; online: boolean; compact?: boolean }) {
  const withheld = shift.sensitiveInfoWithheldReason
  const h = shift.handover
  // Compact (mid-shift on a phone): once the handover is read, or there is nothing to read, it folds to one line.
  const settled = !h || !h.requiresAcknowledgement || h.isRead
  return (
    <Section
      id="before-handover"
      title="Handover"
      icon={<BookOpen className="w-4 h-4" aria-hidden="true" />}
      collapse={compact && settled ? { summary: h ? 'Handover read' : 'No handover' } : null}
    >
      {withheld
        ? <Callout tone="info">{withheld}</Callout>
        : <Handover shift={shift} canAct={canAct} online={online} />}
    </Section>
  )
}

export function GlanceSection({ shift, className, compact = false }: { shift: PortalShiftDetailDto; className?: string; compact?: boolean }) {
  const g = shift.atAGlance
  const hidpa = [g.hidpa.epilepsy && 'Epilepsy', g.hidpa.enteralFeeding && 'Enteral feeding', g.hidpa.dysphagia && 'Dysphagia'].filter(Boolean) as string[]
  // Folded, the facts that must never be missed stay on the line: the anaphylaxis risk and the HIDPA flags.
  const summary = (
    <>
      {g.allergies.isAnaphylaxisRisk === true && <Chip tone="danger">Anaphylaxis risk</Chip>}
      <span>{hidpa.length ? `HIDPA: ${hidpa.join(', ')}` : 'No HIDPA flags'}</span>
    </>
  )
  return (
    <Section id="before-glance" title="At a glance" icon={<HeartPulse className="w-4 h-4" aria-hidden="true" />} className={className} collapse={compact ? { summary } : null}>
      <AtAGlance shift={shift} />
    </Section>
  )
}

export function ContactsSection({ shift, compact = false }: { shift: PortalShiftDetailDto; compact?: boolean }) {
  const list = shift.emergencyContacts
  return (
    <Section
      id="before-contacts"
      title="Emergency contacts"
      icon={<Phone className="w-4 h-4" aria-hidden="true" />}
      collapse={compact && list ? { summary: list.length ? `${list.length} to call` : 'None recorded' } : null}
    >
      {shift.emergencyContacts === null
        ? <Callout tone="info">{shift.sensitiveInfoWithheldReason ?? 'Emergency contacts are not shown for this shift yet.'}</Callout>
        : <Contacts contacts={shift.emergencyContacts} />}
    </Section>
  )
}
