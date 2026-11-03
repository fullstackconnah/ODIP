import { useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSendProblemReport } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { TextAreaField } from '@/components/TextAreaField'
import { httpStatusOf } from '@/lib/httpStatus'
import { PLATFORM_INFO } from '@/lib/platformInfo'
import { problemReportAppVersion, problemReportPagePath } from '@/lib/problemReportPath'

const MAX = 2000

// The no-break space and the word joiner keep "Bunya Support" on one line.
const PRODUCT = 'Bunya ⁠Support'

const COPY = {
  lead: "Tell us what went wrong and we'll look into it.",
  label: 'What happened?',
  hint: "Don't include participant names. We add this page, the app version, your browser, your organisation and your name.",
  empty: 'Write a few words about what went wrong.',
  sent: `Sent. Thanks, the ${PRODUCT} team has your\u00A0report.`,
  saved: `Saved. We couldn't reach the ${PRODUCT} team just now, so we'll send it shortly. You don't need to send it again.`,
  failed: "Your report wasn't sent. Check your connection and try again.",
  tooMany: "You've sent a few reports in a row. Try again in a few minutes.",
}

// shortcut: third copy; lift to components/ when a fourth appears (also in pages/settings/WhatsNewEntryPanel.tsx)
/** `42 / 2000`; from 90% of the limit it turns destructive. */
function CharCount({ id, used, max }: { id: string; used: number; max: number }) {
  const near = used >= max * 0.9
  return (
    <p id={id} className={`mt-1 text-right text-xs tabular-nums ${near ? 'font-medium text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}>
      {used} / {max}
    </p>
  )
}

/** The server explains a 400 in errors[0] (ApiResponse.Fail); a 429 and anything else get fixed words. */
function failureCopy(error: unknown): string {
  const status = httpStatusOf(error)
  if (status === 429) return COPY.tooMany
  if (status === 400) {
    const first = (error as { response?: { data?: { errors?: string[] } } }).response?.data?.errors?.[0]
    if (first) return first
  }
  return COPY.failed
}

type Phase = 'writing' | 'sent' | 'saved'

/**
 * "Report a problem": one free-text note from the sidebar foot. The browser sends the text, the page (ids hidden) and the app version;
 * the server adds who, which organisation and which browser. Answers "Sent" (it reached the team) or "Saved" (kept, goes out shortly).
 */
export default function ReportProblemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation()
  const { mutate, isPending } = useSendProblemReport()
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('writing')
  const [fieldError, setFieldError] = useState<string>()
  const [sendError, setSendError] = useState<string>()
  const countId = useId()
  const textRef = useRef<HTMLTextAreaElement>(null)
  const sendRef = useRef<HTMLButtonElement>(null)
  const doneRef = useRef<HTMLButtonElement>(null)
  // A report still in flight when the dialog is closed must not paint its answer into the next time it opens.
  const attempt = useRef(0)

  useEffect(() => {
    if (phase !== 'writing') doneRef.current?.focus()
  }, [phase])

  const close = () => {
    attempt.current += 1
    setText('')
    setPhase('writing')
    setFieldError(undefined)
    setSendError(undefined)
    onClose()
  }

  const send = () => {
    if (isPending) return
    const note = text.trim()
    if (!note) {
      setFieldError(COPY.empty)
      textRef.current?.focus()
      return
    }
    setFieldError(undefined)
    setSendError(undefined)
    const mine = attempt.current
    mutate(
      { text: note, pagePath: problemReportPagePath(pathname), appVersion: problemReportAppVersion(PLATFORM_INFO) },
      {
        onSuccess: result => { if (attempt.current === mine) setPhase(result.status === 'Saved' ? 'saved' : 'sent') },
        onError: error => {
          if (attempt.current !== mine) return
          setSendError(failureCopy(error))
          sendRef.current?.focus()
        },
      },
    )
  }

  const writing = phase === 'writing'
  return (
    <Modal
      open={open}
      onClose={isPending ? () => {} : close}
      hideClose={isPending}
      title="Report a problem"
      size="md"
      initialFocusRef={textRef}
      footer={writing ? (
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button
            ref={sendRef}
            aria-busy={isPending}
            aria-disabled={isPending || undefined}
            className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
            onClick={send}
          >
            {isPending ? 'Sending…' : 'Send'}
          </Button>
        </>
      ) : (
        <Button ref={doneRef} onClick={close}>Done</Button>
      )}
    >
      {writing ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-muted-foreground)]">{COPY.lead}</p>
          <div>
            <TextAreaField
              ref={textRef}
              label={COPY.label}
              rows={5}
              maxLength={MAX}
              value={text}
              readOnly={isPending}
              hint={COPY.hint}
              keepHint
              error={fieldError ?? sendError}
              descriptionId={countId}
              onChange={e => { setText(e.target.value); if (fieldError) setFieldError(undefined); if (sendError) setSendError(undefined) }}
            />
            <CharCount id={countId} used={text.length} max={MAX} />
          </div>
        </div>
      ) : (
        <p className="text-sm" role="status">{phase === 'sent' ? COPY.sent : COPY.saved}</p>
      )}
    </Modal>
  )
}
