import { call, expectStatus, login, type ApiResult, Session } from './api';
import { addDays, mondayOf, ZONE } from './dates';
import { DEMO_EMAIL_DOMAIN, SEEDED } from './env';

let counter = 0;
const RUN = Date.now().toString(36).toUpperCase();

/** Letters and digits only: unique per run, worker and call. Used as the last/trip/vehicle name. */
export function uniqueToken(prefix = 'E2E'): string {
  counter += 1;
  const worker = (process.env.TEST_PARALLEL_INDEX ?? '0').replace(/\D/g, '') || '0';
  return `${prefix}${RUN}W${worker}N${counter}`;
}

export interface Created { id: string; token: string; [k: string]: any }

/**
 * Participant created through intake (finalised), then switched on through the status endpoint, as the Active tab does: saving a participant never
 * activates them (owner decision 2026-10-13). Readiness mode Warn.
 */
export async function makeParticipant(coord: Session, token = uniqueToken()): Promise<Created> {
  const created = await expectStatus('create participant', 201, await call(coord, 'POST', '/participants', {
    firstName: 'Pw', lastName: token, isDraft: false, completeIntake: true,
  }));
  const id = created.data.id as string;
  const done = await expectStatus('activate participant', 200, await call(coord, 'POST', `/participants/${id}/status`, { isActive: true }));
  if (done.data.isActive !== true) {
    throw new Error('participant not active after the status change: readiness gate is strict (is Warn mode missing?)');
  }
  return { ...created.data, ...done.data, id, token };
}

/**
 * Support worker with a far-future screening date, so assignment raises no findings. Their address is at the Demo tenant's own email domain: any
 * other address that is not at a common provider is refused until the request carries `addressConfirmed` (400 AddressNeedsConfirmation).
 */
export async function makeStaff(coord: Session, token = uniqueToken()): Promise<Created> {
  const res = await expectStatus('create staff', 201, await call(coord, 'POST', '/staff', {
    firstName: 'Wk', lastName: token, role: 'SupportWorker', position: 'SupportWorker',
    email: `wk.${token.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`, isActive: true,
    workerScreeningNumber: 'WS1', workerScreeningExpiryDate: '2099-01-01', isDriverEligible: true,
  }));
  return { ...res.data, id: res.data.id, token };
}

export async function makeVehicle(coord: Session, token = uniqueToken('V')): Promise<Created> {
  const res = await expectStatus('create vehicle', 201, await call(coord, 'POST', '/vehicles', {
    vehicleName: token, registration: token.slice(0, 10), vehicleType: 'Van', totalSeats: 8, wheelchairPositions: 1,
  }));
  return { ...res.data, id: res.data.id, token };
}

export async function makeTrip(coord: Session, startDate: string, token = uniqueToken('T')): Promise<Created> {
  const res = await expectStatus('create trip', 201, await call(coord, 'POST', '/trips', {
    tripName: token, startDate, durationDays: 3, destination: 'E2E Destination',
  }));
  return { ...res.data, id: res.data.id, token, endDate: addDays(startDate, 2) };
}

export async function makeBooking(coord: Session, tripInstanceId: string, participantId: string) {
  return expectStatus('create booking', 201, await call(coord, 'POST', '/bookings', { tripInstanceId, participantId }));
}

export function shiftBody(participantId: string, serviceDate: string, extra: Record<string, unknown> = {}) {
  return {
    participantId, staffId: null, serviceDate, startTime: '09:00:00', endTime: '17:00:00',
    endsNextDay: false, ratio: 'OneToOne', nightType: 'None', ...extra,
  };
}

export async function makeShift(coord: Session, participantId: string, serviceDate: string): Promise<Created> {
  const res = await expectStatus('create shift', 200, await call(coord, 'POST', '/rostering/shifts', shiftBody(participantId, serviceDate)));
  return { ...res.data, id: res.data.id, token: '' };
}

export async function assignShift(coord: Session, shiftId: string, staffId: string) {
  return expectStatus('assign shift', 200, await call(coord, 'POST', `/rostering/shifts/${shiftId}/assign`, { staffId }));
}

// staffId: the PUT body is the whole shift, and a shift nobody is on is not published (409).
export async function publishShift(coord: Session, shiftId: string, participantId: string, serviceDate: string, staffId: string) {
  return expectStatus('publish shift', 200, await call(coord, 'PUT', `/rostering/shifts/${shiftId}`,
    shiftBody(participantId, serviceDate, { staffId, status: 'Published' })));
}

/** The claim engine will not price anything without provider settings ("Provider settings are not
 *  configured", ClaimGenerationService) and prices the trip in the organisation's own state. The scratch
 *  database's seeded provider row is replaced once, by the SuperAdmin, if it is missing -- API setup against
 *  this isolated app only. The claim itself is still generated through the UI. */
export async function ensureProviderSettings(session: Session): Promise<void> {
  const sa: Session = await login(SEEDED.superAdmin);
  const current: ApiResult = await expectStatus(
    'GET provider-settings',
    200,
    await call(sa, 'GET', '/provider-settings'),
  );
  if (current.data?.organisationName) return;
  await expectStatus(
    'PUT provider-settings',
    [200, 201],
    await call(sa, 'PUT', '/provider-settings', {
      registrationNumber: 'E2E-0000-01',
      abn: '00000000000',
      organisationName: 'E2E Browser Acceptance (SYNTHETIC)',
      address: '1 Example Street, Newtown NSW 2042',
      state: 'NSW',
      gstRegistered: true,
      isPaceProvider: false,
      bankAccountName: 'E2E Browser Acceptance',
      bsb: '000000',
      accountNumber: '00000000',
      invoiceFooterNotes: 'SYNTHETIC E2E TEST DATA.',
      managerName: 'E2E Manager',
      managerPhone: '0412345678',
    }),
  );
}

/**
 * A service agreement revision saved from one support block, as the plan builder saves it (the server prices it).
 * The block is Community access in the community, on `days` from 9am to 3pm, Skip on a public holiday (the default Review would hold up the approval), in NSW, the provider's state.
 * shortcut: the plan is the seeded catalogue's year (2026-27); move it when the seed moves to 2027-28.
 */
export async function saveBlocksDraft(coord: Session, participantId: string, days: string[], from: string, to: string): Promise<Created> {
  const res = await expectStatus('save agreement draft', 200, await call(coord, 'POST', `/participants/${participantId}/service-agreement-drafts`, {
    planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: from, agreementEndDate: to, state: 'NSW', serviceTypes: [], baseVersion: 0,
    blocks: [{
      block: {
        id: 'e2e-block', supportType: 'CommunityAccess', intensity: 'Standard', days, start: '09:00:00', end: '15:00:00', workers: 1, participantsPresent: 1,
        setting: 'Community', location: { state: 'NSW', zone: 'National' }, onPublicHoliday: 'Skip',
      },
      requirements: {},
    }],
  }));
  return { ...res.data, id: res.data.id, token: '' };
}

/** Approves a revision for rostering, as the agreement page's dialog does. The preview's reasons come first, so a refused approval says why. */
/** Starts the roster week holding `date`, as the board's Start rostering does. A week already started answers 409 roster-week-started: fine here, the e2e organisation is shared. */
export async function startWeek(coord: Session, date: string) {
  const res = await call(coord, 'POST', `/rostering/weeks/${mondayOf(date)}/start`);
  if (res.status === 409 && res.body?.code === 'roster-week-started') return;
  await expectStatus('start week', 200, res);
}

export async function approveDraft(coord: Session, participantId: string, draftId: string) {
  const preview = await expectStatus('approval preview', 200, await call(coord, 'GET', `/participants/${participantId}/service-agreement-drafts/${draftId}/approval-preview`));
  if (!preview.data.canApprove) throw new Error(`the draft cannot be approved: ${JSON.stringify(preview.data.reasons)}`);
  return expectStatus('approve draft', 200, await call(coord, 'POST', `/participants/${participantId}/service-agreement-drafts/${draftId}/approve`, {}));
}

/**
 * The first 90-minute start on `day`, at or after `earliest` ("10:00"), when the signed-in coordinator has no shift (an overnight one from the day
 * before included) and no other intake visit. Booking refuses a busy staff member (409 intake-staff-busy), and the seeded coordinator may have a
 * shift then (plan check S5). Returns "HH:mm" in the provider's zone.
 */
export async function freeIntakeStart(coord: Session, day: string, earliest: string): Promise<string> {
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const busy: [number, number][] = [];
  const mine = await expectStatus('my shifts', 200, await call(coord, 'GET', `/portal/my-shifts?from=${addDays(day, -1)}&to=${day}`));
  for (const s of mine.data.shifts) {
    if (s.status === 'Cancelled') continue;
    const shift = s.serviceDate === day ? 0 : -1440;
    busy.push([shift + minutes(s.startTime), shift + minutes(s.endTime) + (s.endsNextDay ? 1440 : 0)]);
  }
  const visits = await expectStatus('intake visits', 200, await call(coord, 'GET', `/intake-visits?from=${day}&to=${day}&staffUserId=${coord.user.id}`));
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const v of visits.data) {
    const start = minutes(local.format(new Date(v.startsAt)));
    busy.push([start, start + v.durationMinutes]);
  }
  for (let start = minutes(earliest); start + 90 <= 24 * 60; start += 30) {
    if (busy.every(([from, to]) => start + 90 <= from || to <= start)) return `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
  }
  throw new Error(`No free 90-minute intake slot on ${day} from ${earliest}`);
}

/** "2:00 pm", as the screens write a visit's start. */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
