import { call, expectStatus, Session } from './api';
import { addDays } from './dates';

let counter = 0;
const RUN = Date.now().toString(36).toUpperCase();

/** Letters and digits only: unique per run, worker and call. Used as the last/trip/vehicle name. */
export function uniqueToken(prefix = 'E2E'): string {
  counter += 1;
  const worker = (process.env.TEST_PARALLEL_INDEX ?? '0').replace(/\D/g, '') || '0';
  return `${prefix}${RUN}W${worker}N${counter}`;
}

export interface Created { id: string; token: string; [k: string]: any }

/** Participant created through intake and completed, so it ends up active (readiness mode Warn). */
export async function makeParticipant(coord: Session, token = uniqueToken()): Promise<Created> {
  const created = await expectStatus('create participant', 201, await call(coord, 'POST', '/participants', {
    firstName: 'Pw', lastName: token, isDraft: false, completeIntake: true,
  }));
  const id = created.data.id as string;
  const done = await expectStatus('complete participant', 200, await call(coord, 'PUT', `/participants/${id}`, {
    firstName: 'Pw', lastName: token, isDraft: false,
  }));
  if (done.data.isActive !== true) {
    throw new Error('participant not active after profile save: readiness gate is strict (is PR #169 / Warn mode missing?)');
  }
  return { ...done.data, id, token };
}

/** Support worker with a far-future screening date, so assignment raises no findings. */
export async function makeStaff(coord: Session, token = uniqueToken()): Promise<Created> {
  const res = await expectStatus('create staff', 201, await call(coord, 'POST', '/staff', {
    firstName: 'Wk', lastName: token, role: 'SupportWorker', position: 'SupportWorker',
    email: `wk.${token.toLowerCase()}@e2e.test`, isActive: true,
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

export async function publishShift(coord: Session, shiftId: string, participantId: string, serviceDate: string) {
  return expectStatus('publish shift', 200, await call(coord, 'PUT', `/rostering/shifts/${shiftId}`,
    shiftBody(participantId, serviceDate, { status: 'Published' })));
}
