// The templates a new block can start from: a block with its days, times, ratio and extras filled in, so most of a week is two clicks and a check.
// A template is only a starting block: nothing about it is priced or fixed, and every field stays editable on the steps that follow.
import type { AgreementState, DraftBlock, PlanBlock, PlanPriceZone, PlanWorkerGender } from '@/api/types'
import { emptyBlock } from './planBlocks'

export type PlanTemplateKey = 'community-weekdays' | 'saturday-outing' | 'personal-care-mornings' | 'overnight-sleepover' | 'weekend-respite-sta' | 'blank'

export interface PlanTemplate {
  key: PlanTemplateKey
  title: string
  /** One plain sentence on what the template is for. */
  summary: string
  /** The block it starts from, on the given id, for the agreement's state and price zone. */
  build: (id: string, state: AgreementState, zone: PlanPriceZone) => DraftBlock
}

const NO_PREFERENCE: PlanWorkerGender = 'NoPreference'

function entry(block: PlanBlock): DraftBlock {
  return { block, requirements: { workerGender: NO_PREFERENCE, driver: false, skills: [] } }
}

export const PLAN_TEMPLATES: readonly PlanTemplate[] = [
  {
    key: 'community-weekdays',
    title: 'Community access weekdays',
    summary: 'One worker takes the participant out in the community on weekday mornings.',
    build: (id, state, zone) => entry({ ...emptyBlock(id, state, zone), supportType: 'CommunityAccess', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], start: '09:00:00', end: '13:00:00' }),
  },
  {
    key: 'saturday-outing',
    title: 'Saturday group outing 1:3',
    summary: 'A day out for three participants with one worker, each paying a third.',
    build: (id, state, zone) => entry({ ...emptyBlock(id, state, zone), supportType: 'GroupActivity', days: ['Saturday'], start: '09:00:00', end: '15:00:00', participantsPresent: 3 }),
  },
  {
    key: 'personal-care-mornings',
    title: 'Personal care mornings',
    summary: 'Help with getting up and ready at home, before the day starts.',
    build: (id, state, zone) => entry({ ...emptyBlock(id, state, zone), supportType: 'PersonalCare', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], start: '07:00:00', end: '09:00:00', setting: 'AtHome' }),
  },
  {
    key: 'overnight-sleepover',
    title: 'Overnight with sleepover',
    summary: 'A worker stays the night and may sleep: one sleepover item, not eight hours.',
    build: (id, state, zone) => entry({
      ...emptyBlock(id, state, zone), supportType: 'PersonalCare', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      start: '22:00:00', end: '06:00:00', setting: 'AtHome', workerMaySleep: true,
    }),
  },
  {
    key: 'weekend-respite-sta',
    title: 'Weekend respite (STA)',
    summary: 'Two nights of short-term accommodation from Friday afternoon, with support hours and a sleepover.',
    build: (id, state, zone) => entry({
      ...emptyBlock(id, state, zone), supportType: 'StaSupport', days: ['Friday', 'Saturday'], start: '16:00:00', end: '16:00:00', setting: 'Accommodation',
      workerMaySleep: true, sleepoverWindow: { from: '22:00:00', to: '06:00:00' }, accommodation: { nights: 1, workerOnSite: false },
    }),
  },
  {
    key: 'blank',
    title: 'Blank',
    summary: 'Start from nothing and choose every day, time and support yourself.',
    build: (id, state, zone) => entry(emptyBlock(id, state, zone)),
  },
]

export function templateByKey(key: string): PlanTemplate | undefined {
  return PLAN_TEMPLATES.find(template => template.key === key)
}
