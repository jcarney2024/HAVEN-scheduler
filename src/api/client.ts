import type {
  DirectorIdentity,
  ScheduleResponse,
  PublicDeptListItem,
  PublicSchedule,
  MyAssignmentsResponse,
  RequestsForDept,
} from "./types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(json.error ?? `HTTP ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return json as T;
}

export const api = {
  director: (netid: string, email: string) =>
    request<DirectorIdentity>(`/director/${encodeURIComponent(netid)}`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  schedule: (deptId: string, callerNetid: string, callerEmail: string) =>
    request<ScheduleResponse>(`/schedule/${encodeURIComponent(deptId)}`, {
      method: "POST",
      body: JSON.stringify({ callerNetid, callerEmail }),
    }),
  assign: (input: {
    callerNetid: string;
    callerEmail: string;
    departmentId: string;
    date: string;
    directorIds: string[];
    volunteerIds: string[];
  }) =>
    request<{ success: true }>("/assignment", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  submit: (deptId: string, callerNetid: string, callerEmail: string) =>
    request<{ success: true }>(`/submit/${encodeURIComponent(deptId)}`, {
      method: "POST",
      body: JSON.stringify({ callerNetid, callerEmail }),
    }),
  setAvailability: (input: {
    callerNetid: string;
    callerEmail: string;
    personId: string;
    kind: "director" | "volunteer";
    availableDates: string[];
  }) =>
    request<{ success: true }>("/availability", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  removeVolunteer: (input: {
    callerNetid: string;
    callerEmail: string;
    departmentId: string;
    personId: string;
    reason?: string;
  }) =>
    request<{ success: true; unscheduledCount: number }>("/remove-volunteer", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  viewList: () => request<PublicDeptListItem[]>("/view", { method: "GET" }),
  viewSchedule: (deptId: string) =>
    request<PublicSchedule>(`/view/${encodeURIComponent(deptId)}`, { method: "GET" }),
  myAssignments: (callerNetid: string, callerEmail: string, opts?: { signIn?: boolean }) =>
    request<MyAssignmentsResponse>("/me/assignments", {
      method: "POST",
      body: JSON.stringify({ callerNetid, callerEmail, signIn: opts?.signIn === true }),
    }),
  createRequest: (input: {
    callerNetid: string;
    callerEmail: string;
    deptId: string;
    requesterDate: string;
    targetNetid?: string;
    targetDate?: string;
    note?: string;
  }) => request<{ id: string; status: "Pending" }>("/requests", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  withdrawRequest: (id: string, callerNetid: string, callerEmail: string) =>
    request<{ id: string; status: "Withdrawn" }>(`/requests/${encodeURIComponent(id)}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ callerNetid, callerEmail }),
    }),
  requestsForDept: (deptId: string, callerNetid: string, callerEmail: string) =>
    request<RequestsForDept>(`/requests/for-dept/${encodeURIComponent(deptId)}`, {
      method: "POST",
      body: JSON.stringify({ callerNetid, callerEmail }),
    }),
  resolveRequest: (id: string, input: {
    callerNetid: string;
    callerEmail: string;
    action: "approve" | "reject";
    note?: string;
  }) => request<{ id: string; status: "Approved" | "Rejected" }>(`/requests/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify(input),
  }),
};
