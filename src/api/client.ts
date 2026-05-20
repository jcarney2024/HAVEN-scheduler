import type {
  DirectorIdentity,
  ScheduleResponse,
  PublicDeptListItem,
  PublicSchedule,
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
};
