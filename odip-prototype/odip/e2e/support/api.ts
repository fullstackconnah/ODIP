import { API_V1, DEMO_TENANT_ID } from './env';

export interface Session {
  username: string;
  token: string;
  role: string;
  tenantId: string | null;
  user: Record<string, unknown>;
}

export interface ApiResult<T = any> {
  status: number;
  body: any;
  data: T;
}

/** Mint a dev-login session (a 30 minute JWT). Throws with the response text if the API refuses. */
export async function login(username: string): Promise<Session> {
  const res = await fetch(`${API_V1}/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`dev-login(${username}) -> ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  const d = body.data;
  return { username, token: d.token, role: d.role, tenantId: d.tenantId ?? null, user: d };
}

/** Authenticated call. `path` is relative to /api/v1. SuperAdmins always act inside the Demo tenant. */
export async function call<T = any>(
  session: Session,
  method: string,
  path: string,
  payload?: unknown,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` };
  if (session.role === 'SuperAdmin') headers['x-view-as-tenant'] = DEMO_TENANT_ID;
  if (payload !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API_V1}${path}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain-text body */
  }
  return { status: res.status, body, data: body?.data };
}

/** Like `call` but fails with the full response when the status is not the expected one. */
export async function expectStatus<T = any>(
  what: string,
  expected: number | number[],
  result: ApiResult<T>,
): Promise<ApiResult<T>> {
  const ok = Array.isArray(expected) ? expected.includes(result.status) : result.status === expected;
  if (!ok) {
    throw new Error(`${what}: expected ${expected}, got ${result.status}: ${JSON.stringify(result.body).slice(0, 400)}`);
  }
  return result;
}
