# Volunteer Compliance Self-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `/compliance/[netID]` page where a volunteer sees whether their Training, Contract, and HIPAA certificate are all on file, with a CTA to upload their HIPAA cert when it's missing.

**Architecture:** A new unauthenticated `GET /api/compliance/:netid` Hono endpoint looks the person up by NetID, reads `HIPAA Compliance Status` from All People, OR's the `Volunteer Contract`/`Volunteer Training` checkboxes from the Compliance table (reusing `buildComplianceByPersonId`), and returns three booleans. A new React `ComplianceCheck` component renders the result, wired into the existing pathname-based router in `App.tsx`. All testable logic lives in a pure `evaluateVolunteerCompliance` function.

**Tech Stack:** Hono (server), React 18 + Vite + Tailwind + lucide-react (client), Airtable (data), vitest (tests). Single root `tsconfig.json` (noEmit) covers `src`, `server`, `api`, `scripts`. Dev: `npm run dev` (vite :5173 proxies `/api` → Hono :3001).

**Spec:** `docs/superpowers/specs/2026-06-03-compliance-check-design.md`

---

### Task 1: `evaluateVolunteerCompliance` pure function

**Files:**
- Modify: `server/compliance.ts` (append)
- Test: `server/tests/compliance.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/compliance.test.ts`:

```ts
import { evaluateVolunteerCompliance } from "../compliance";

describe("evaluateVolunteerCompliance", () => {
  it("is fully compliant when all three are satisfied", () => {
    const r = evaluateVolunteerCompliance({ contract: true, training: true, hipaaStatus: "Compliant" });
    expect(r.contract).toBe(true);
    expect(r.training).toBe(true);
    expect(r.hipaaCompliant).toBe(true);
    expect(r.overallCompliant).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("treats a blank HIPAA status as not compliant", () => {
    const r = evaluateVolunteerCompliance({ contract: true, training: true, hipaaStatus: "" });
    expect(r.hipaaCompliant).toBe(false);
    expect(r.overallCompliant).toBe(false);
    expect(r.missing).toEqual(["hipaa"]);
  });

  it("treats 'Not Compliant' (or any non-'Compliant' value) as not compliant", () => {
    expect(evaluateVolunteerCompliance({ contract: true, training: true, hipaaStatus: "Not Compliant" }).hipaaCompliant).toBe(false);
    expect(evaluateVolunteerCompliance({ contract: true, training: true, hipaaStatus: "Pending" }).hipaaCompliant).toBe(false);
  });

  it("reports each missing item in UI order (training, contract, hipaa)", () => {
    const r = evaluateVolunteerCompliance({ contract: false, training: false, hipaaStatus: "Not Compliant" });
    expect(r.overallCompliant).toBe(false);
    expect(r.missing).toEqual(["training", "contract", "hipaa"]);
  });

  it("flags only the contract when training + hipaa are fine", () => {
    const r = evaluateVolunteerCompliance({ contract: false, training: true, hipaaStatus: "Compliant" });
    expect(r.missing).toEqual(["contract"]);
    expect(r.overallCompliant).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/compliance.test.ts`
Expected: FAIL — `evaluateVolunteerCompliance` is not exported / not a function.

- [ ] **Step 3: Implement the function**

Append to `server/compliance.ts`:

```ts
export type VolunteerComplianceResult = {
  contract: boolean;
  training: boolean;
  hipaaCompliant: boolean;
  overallCompliant: boolean;
  /** Failing items in UI order: training, contract, hipaa. */
  missing: ("contract" | "training" | "hipaa")[];
};

/**
 * Volunteer-facing compliance verdict from the three items a volunteer can act
 * on: Volunteer Training, Volunteer Contract, and the HIPAA certificate.
 * HIPAA is compliant ONLY when the status is exactly "Compliant"; any other
 * value (including blank/unset) is treated as not compliant so the upload CTA
 * shows rather than a false green.
 */
export function evaluateVolunteerCompliance(input: {
  contract: boolean;
  training: boolean;
  hipaaStatus: string;
}): VolunteerComplianceResult {
  const hipaaCompliant = input.hipaaStatus.trim() === "Compliant";
  const missing: ("contract" | "training" | "hipaa")[] = [];
  if (!input.training) missing.push("training");
  if (!input.contract) missing.push("contract");
  if (!hipaaCompliant) missing.push("hipaa");
  return {
    contract: input.contract,
    training: input.training,
    hipaaCompliant,
    overallCompliant: input.contract && input.training && hipaaCompliant,
    missing,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/tests/compliance.test.ts`
Expected: PASS (all existing + new cases green).

- [ ] **Step 5: Commit**

```bash
git add server/compliance.ts server/tests/compliance.test.ts
git commit -m "feat(compliance): evaluateVolunteerCompliance pure helper"
```

---

### Task 2: Public `GET /api/compliance/:netid` endpoint

**Files:**
- Modify: `server/app.ts` (import, `AllPeopleFields` type, new `findPersonByNetid` helper, new route)

No unit test — the existing server suite has no Airtable mocking; this endpoint is verified by typecheck + manual curl. The decision logic it depends on is already covered by Task 1.

- [ ] **Step 1: Add `evaluateVolunteerCompliance` to the compliance import**

In `server/app.ts`, change the import block:

```ts
import {
  buildComplianceByPersonId,
  buildNonCompliantByDept,
  evaluateVolunteerCompliance,
  type ComplianceRow,
} from "./compliance.js";
```

- [ ] **Step 2: Add the HIPAA field to `AllPeopleFields`**

In `server/app.ts`, find the top of the `AllPeopleFields` type and add the HIPAA status field:

```ts
type AllPeopleFields = {
  NetID?: string;
  "Contact Email"?: string;
  Name?: string;
  "HIPAA Compliance Status"?: string;
```

- [ ] **Step 3: Add the `findPersonByNetid` helper**

In `server/app.ts`, directly after the existing `findPerson` function (the one that takes `netid` + `email`), add:

```ts
// NetID-only person lookup for the public /compliance/:netid self-check. Unlike
// findPerson (which also requires the Contact Email), this trusts the NetID
// alone — an explicit, documented product decision (see the design spec).
async function findPersonByNetid(config: Config, netid: string) {
  const safeNetid = escapeFormulaString(netid.toLowerCase());
  const records = await listAll<AllPeopleFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
    filterByFormula: `LOWER({NetID}) = '${safeNetid}'`,
    pageSize: 1,
  });
  return records[0] ?? null;
}
```

- [ ] **Step 4: Add the route**

In `server/app.ts`, directly after the `app.get("/view/:deptId", ...)` handler closes (just before `async function getConfig`), add:

```ts
// Public, no auth. A volunteer opens /compliance/:netid to self-check whether
// their Training, Contract, and HIPAA certificate are on file. Returns coarse
// booleans only (plus name) — see the design spec for the accepted tradeoff.
app.get("/compliance/:netid", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const netid = c.req.param("netid");
  if (!netid) return c.json({ error: "Missing netid" }, 400);

  const person = await findPersonByNetid(config, netid);
  if (!person) return c.json({ found: false });

  const allCompliance = await listAll<ComplianceFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.complianceTableId,
    fields: ["Names", "Volunteer Contract", "Volunteer Training"],
  });
  const complianceByPersonId = buildComplianceByPersonId(
    allCompliance.map(
      (row): ComplianceRow => ({
        personIds: toIdList(row.fields.Names),
        contract: row.fields["Volunteer Contract"] === true,
        training: row.fields["Volunteer Training"] === true,
      }),
    ),
  );
  const flags = complianceByPersonId.get(person.id) ?? { contract: false, training: false };
  const result = evaluateVolunteerCompliance({
    contract: flags.contract,
    training: flags.training,
    hipaaStatus: selectName(person.fields["HIPAA Compliance Status"]),
  });

  return c.json({
    found: true,
    name: person.fields.Name ?? "",
    netid: person.fields.NetID ?? "",
    contract: result.contract,
    training: result.training,
    hipaaCompliant: result.hipaaCompliant,
    overallCompliant: result.overallCompliant,
  });
});
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.json`
Expected: no output (clean). Fixes any type error before moving on.

- [ ] **Step 6: Manual smoke against the dev API**

Start the API only: `npm run dev:api` (listens on `:3001`). In another shell:

```bash
# Unknown NetID -> { "found": false }
curl -s http://localhost:3001/api/compliance/definitely-not-a-real-netid

# A real NetID from All People -> { "found": true, "name": ..., "contract": ..., ... }
curl -s http://localhost:3001/api/compliance/<REAL_NETID>
```

Expected: the unknown NetID returns `{"found":false}`; the real NetID returns the full object with `contract`/`training`/`hipaaCompliant`/`overallCompliant` booleans. Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add server/app.ts
git commit -m "feat(compliance): public GET /api/compliance/:netid endpoint"
```

---

### Task 3: Client types + API method

**Files:**
- Modify: `src/api/types.ts` (append a type)
- Modify: `src/api/client.ts` (import + new method)

- [ ] **Step 1: Add the response type**

Append to `src/api/types.ts`:

```ts
export type ComplianceCheckResponse =
  | { found: false }
  | {
      found: true;
      name: string;
      netid: string;
      contract: boolean;
      training: boolean;
      hipaaCompliant: boolean;
      overallCompliant: boolean;
    };
```

- [ ] **Step 2: Import the type in the client**

In `src/api/client.ts`, add `ComplianceCheckResponse` to the existing type import block:

```ts
import type {
  DirectorIdentity,
  ScheduleResponse,
  PublicDeptListItem,
  PublicSchedule,
  MyAssignmentsResponse,
  RequestsForDept,
  RhdReadinessResponse,
  ComplianceCheckResponse,
} from "./types";
```

- [ ] **Step 3: Add the `complianceCheck` method**

In `src/api/client.ts`, directly after the `viewSchedule` method, add:

```ts
  complianceCheck: (netid: string) =>
    request<ComplianceCheckResponse>(`/compliance/${encodeURIComponent(netid)}`, { method: "GET" }),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.json`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/client.ts
git commit -m "feat(compliance): client type + api.complianceCheck"
```

---

### Task 4: `ComplianceCheck` component

**Files:**
- Create: `src/app/components/ComplianceCheck.tsx`

- [ ] **Step 1: Create the component**

Create `src/app/components/ComplianceCheck.tsx`:

```tsx
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { api } from "@/api/client";
import type { ComplianceCheckResponse } from "@/api/types";

const HIPAA_UPLOAD_URL = "https://updatemyinfo.havenfreeclinic.com";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; data: ComplianceCheckResponse };

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <span className="font-medium text-slate-800">{label}</span>
      {ok ? (
        <span className="flex items-center gap-1.5 text-green-600 font-semibold text-sm">
          <CheckCircle2 className="w-5 h-5" /> Complete
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-red-600 font-semibold text-sm">
          <XCircle className="w-5 h-5" /> Not yet
        </span>
      )}
    </div>
  );
}

function ComplianceResult({
  data,
}: {
  data: Extract<ComplianceCheckResponse, { found: true }>;
}) {
  const firstName = data.name.trim().split(/\s+/)[0] || "there";
  return (
    <>
      <p className="text-slate-600 text-sm mb-4">Hi {firstName} — here's where you stand.</p>

      {data.overallCompliant ? (
        <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 p-3 mb-4">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          <p className="text-sm text-green-800 font-medium">
            You're all set — fully compliant. Thank you!
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 font-medium">
            Action needed — a few items still need to be completed.
          </p>
        </div>
      )}

      <div className="mb-2">
        <StatusRow label="Volunteer Training" ok={data.training} />
        <StatusRow label="Volunteer Contract" ok={data.contract} />
        <StatusRow label="HIPAA Certificate" ok={data.hipaaCompliant} />
      </div>

      {!data.hipaaCompliant && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 mt-4">
          <p className="text-sm text-amber-900 font-medium mb-2">
            Your HIPAA certificate isn't on file (or isn't current).
          </p>
          <p className="text-sm text-amber-800 mb-3">
            Upload it at the link below — step-by-step instructions are on that page.
          </p>
          <a
            href={HIPAA_UPLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-[#0F4D92] text-white rounded-md px-4 py-2 font-semibold text-sm hover:bg-[#0B3D75] transition-colors"
          >
            Upload HIPAA certificate
          </a>
        </div>
      )}
    </>
  );
}

export function ComplianceCheck({ netid }: { netid: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    api
      .complianceCheck(netid)
      .then((data) => {
        if (!cancelled) setState({ status: "loaded", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [netid]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="w-full max-w-md mt-4"
    >
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h1 className="text-xl font-bold text-slate-900 mb-1">Compliance check</h1>

        {state.status === "loading" && (
          <div className="text-center py-10">
            <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-[#0F4D92] rounded-full mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Checking your status…</p>
          </div>
        )}

        {state.status === "error" && (
          <p className="text-slate-600 text-sm py-6">
            Something went wrong loading your status. Refresh the page to try again.
          </p>
        )}

        {state.status === "loaded" && state.data.found === false && (
          <p className="text-slate-600 text-sm py-6">
            We couldn't find a volunteer with NetID{" "}
            <span className="font-semibold">{netid}</span>. Double-check your link, or ask
            your director if you think this is a mistake.
          </p>
        )}

        {state.status === "loaded" && state.data.found === true && (
          <ComplianceResult data={state.data} />
        )}
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.json`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add src/app/components/ComplianceCheck.tsx
git commit -m "feat(compliance): ComplianceCheck result component"
```

---

### Task 5: Wire `/compliance/:netid` into `App.tsx` routing

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Import the component**

In `src/app/App.tsx`, after the `PublicScheduleView` import, add:

```ts
import { ComplianceCheck } from "./components/ComplianceCheck";
```

- [ ] **Step 2: Extend the `Step` union and add the path parser**

Replace the `type Step` line and `initialStepFromUrl` with:

```ts
type Step = "loading" | "lookup" | "schedule" | "view" | "compliance";

/** Returns the decoded NetID when the path is /compliance/<netid>, else null. */
function complianceNetidFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/compliance\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function initialStepFromUrl(): Step {
  if (typeof window === "undefined") return "loading";
  if (window.location.pathname === "/view") return "view";
  if (complianceNetidFromPath(window.location.pathname)) return "compliance";
  return "loading";
}
```

- [ ] **Step 3: Add compliance NetID state**

In `App()`, directly after the `viewAutoSignIn` state line, add:

```ts
  const [complianceNetid, setComplianceNetid] = useState<string | null>(
    typeof window === "undefined" ? null : complianceNetidFromPath(window.location.pathname),
  );
```

- [ ] **Step 4: Guard the URL-sync effect so it never rewrites a compliance deep link**

Replace the existing "Keep URL in sync" effect with:

```ts
  // Keep URL in sync so /view is shareable + back button works. The
  // /compliance/<netid> deep link manages its own URL — never rewrite it.
  useEffect(() => {
    if (step === "compliance") return;
    const target = step === "view" ? "/view" : "/";
    if (window.location.pathname !== target) {
      window.history.pushState({}, "", target);
    }
  }, [step]);
```

- [ ] **Step 5: Handle the compliance path in `popstate`**

Replace the existing `popstate` effect with:

```ts
  // Respond to browser back/forward.
  useEffect(() => {
    function onPop() {
      const path = window.location.pathname;
      const cNetid = complianceNetidFromPath(path);
      if (path === "/view") {
        setStep("view");
        return;
      }
      if (cNetid) {
        setComplianceNetid(cNetid);
        setStep("compliance");
        return;
      }
      setStep("lookup");
      setIdentity(null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
```

- [ ] **Step 6: Render the compliance step**

In the `<AnimatePresence mode="wait">` block, directly after the `{step === "view" && (...)}` entry, add:

```tsx
            {step === "compliance" && complianceNetid && (
              <ComplianceCheck key="compliance" netid={complianceNetid} />
            )}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc -p tsconfig.json`
Expected: no output (clean).

- [ ] **Step 8: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(compliance): route /compliance/:netid to ComplianceCheck"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites PASS (includes the new `evaluateVolunteerCompliance` cases).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc -p tsconfig.json`
Expected: no output (clean).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds with no type/compile errors.

- [ ] **Step 4: End-to-end manual smoke**

Run: `npm run dev` (starts vite :5173 + Hono :3001). In a browser:
- `http://localhost:5173/compliance/<REAL_NETID>` → shows the name, three status rows, an overall banner, and — when HIPAA isn't compliant — the amber "Upload HIPAA certificate" CTA linking to `https://updatemyinfo.havenfreeclinic.com` (opens in a new tab).
- `http://localhost:5173/compliance/not-a-real-netid` → shows the friendly "couldn't find a volunteer with NetID …" message, no CTA.
- Confirm the browser back button returns to the landing page and the URL is not clobbered while on the compliance page.

Stop the dev server when done. No commit (verification only).

---

## Notes for the implementer

- **Don't** add login-log writes to the compliance endpoint — it is not an authenticated sign-in.
- **Don't** broaden the verdict to the Compliance table's `Overall Compliance` formula (EHS/BBP/TB are intentionally excluded).
- `selectName(...)` (already in `server/app.ts`) handles both the REST string shape and the MCP `{name}` object shape of the single-select; use it for `HIPAA Compliance Status`.
- `ComplianceFields` is the existing local type in `server/app.ts` (`Names`, `Volunteer Contract`, `Volunteer Training`) — reuse it, don't redefine.
