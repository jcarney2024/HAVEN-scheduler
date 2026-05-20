const BASE = "https://api.airtable.com/v0";
const PAT = process.env.AIRTABLE_PAT ?? "";

type AirtableRecord<F = Record<string, unknown>> = {
  id: string;
  createdTime: string;
  fields: F;
};

type ListResponse<F> = {
  records: AirtableRecord<F>[];
  offset?: string;
};

const headers = () => ({
  Authorization: `Bearer ${PAT}`,
  "Content-Type": "application/json",
});

async function fetchWithRetry(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    lastErr = res.status;
    await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
  }
  throw new Error(`Airtable retries exhausted (last status ${lastErr})`);
}

export async function listAll<F = Record<string, unknown>>(opts: {
  baseId: string;
  tableId: string;
  filterByFormula?: string;
  fields?: string[];
  pageSize?: number;
}): Promise<AirtableRecord<F>[]> {
  const out: AirtableRecord<F>[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams();
    params.set("pageSize", String(opts.pageSize ?? 100));
    if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
    (opts.fields ?? []).forEach((f) => params.append("fields[]", f));
    if (offset) params.set("offset", offset);
    const url = `${BASE}/${opts.baseId}/${encodeURIComponent(opts.tableId)}?${params.toString()}`;
    const res = await fetchWithRetry(url, { headers: headers() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable list failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as ListResponse<F>;
    out.push(...json.records);
    offset = json.offset;
  } while (offset);
  return out;
}

export async function createRecord<F = Record<string, unknown>>(opts: {
  baseId: string;
  tableId: string;
  fields: Record<string, unknown>;
}): Promise<AirtableRecord<F>> {
  const url = `${BASE}/${opts.baseId}/${encodeURIComponent(opts.tableId)}`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fields: opts.fields }),
  });
  if (!res.ok) throw new Error(`Airtable create failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as AirtableRecord<F>;
}

export async function patchRecord<F = Record<string, unknown>>(opts: {
  baseId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
}): Promise<AirtableRecord<F>> {
  const url = `${BASE}/${opts.baseId}/${encodeURIComponent(opts.tableId)}/${opts.recordId}`;
  const res = await fetchWithRetry(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields: opts.fields }),
  });
  if (!res.ok) throw new Error(`Airtable patch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as AirtableRecord<F>;
}

export function escapeFormulaString(s: string): string {
  return s.replace(/'/g, "\\'");
}

export type { AirtableRecord };
