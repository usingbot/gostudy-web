import type {
  AdminSelf,
  AdminUserDetail,
  AdminUserSummary,
  ChalkMutationResult,
  RoleAuditPage,
  RoleChangeResult,
  UserRole,
} from '../types';

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
  ) {
    super(status === 0 ? 'Admin request did not receive a response' : `Admin API failed: ${status}`);
  }
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const value = await response.json() as {error?: unknown};
    return typeof value.error === 'string' ? value.error : null;
  } catch {
    return null;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new AdminApiError(0, null);
  }
  if (!response.ok) {
    throw new AdminApiError(response.status, await readErrorCode(response));
  }
  return response.json() as Promise<T>;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
}

export function fetchAdminSelf(signal?: AbortSignal): Promise<AdminSelf> {
  return requestJson('/api/admin/me', {signal});
}

export async function searchAdminUser(
  userId: string,
  signal?: AbortSignal,
): Promise<AdminUserSummary> {
  const search = new URLSearchParams({query: userId});
  const response = await requestJson<{users: AdminUserSummary[]}>(
    `/api/admin/users?${search}`,
    {signal},
  );
  if (response.users.length !== 1) {
    throw new AdminApiError(500, null);
  }
  return response.users[0];
}

export function fetchAdminUser(
  userId: string,
  beforeTransactionId?: string,
  signal?: AbortSignal,
): Promise<AdminUserDetail> {
  const search = new URLSearchParams({limit: '20'});
  if (beforeTransactionId) {
    search.set('beforeTransactionId', beforeTransactionId);
  }
  return requestJson(`/api/admin/users/${encodeURIComponent(userId)}?${search}`, {signal});
}

export function fetchRoleAudit(
  beforeAuditId?: string,
  signal?: AbortSignal,
): Promise<RoleAuditPage> {
  const search = new URLSearchParams({limit: '20'});
  if (beforeAuditId) {
    search.set('beforeAuditId', beforeAuditId);
  }
  return requestJson(`/api/admin/role-audit?${search}`, {signal});
}

export function adjustChalk(
  kind: 'grant' | 'deduct',
  userId: string,
  input: {amount: string; reason: string; requestId: string},
): Promise<ChalkMutationResult> {
  return postJson(`/api/admin/users/${encodeURIComponent(userId)}/chalk/${kind}`, input);
}

export function changeAdminUserRole(
  userId: string,
  input: {expectedRole: UserRole; role: UserRole; reason: string},
): Promise<RoleChangeResult> {
  return postJson(`/api/admin/users/${encodeURIComponent(userId)}/role`, input);
}
