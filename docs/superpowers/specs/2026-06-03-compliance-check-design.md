# Design: Volunteer Compliance Self-Check (`/compliance/[netID]`)

**Date:** 2026-06-03
**Status:** Approved (design)
**Branch:** `feat/compliance-check` (off `origin/main`)

## Problem

Directors can already see which volunteers are non-compliant (the sign-in
compliance banner, driven by `/director/:netid` + `buildComplianceByPersonId`).
Volunteers have no self-service way to check their own status. We want a
shareable deep link, `/compliance/[netID]`, that a volunteer opens to see
whether they are fully compliant, and — if their HIPAA certificate is not on
file / not compliant — directs them to upload it at
`https://updatemyinfo.havenfreeclinic.com`.

## Goal

When a volunteer opens `/compliance/<their-netid>`, show:

1. **Volunteer Training** — done / not done (Compliance table checkbox).
2. **Volunteer Contract** — done / not done (Compliance table checkbox).
3. **HIPAA Certificate** — compliant / not compliant (All People status).

An overall verdict ("You're all set" vs. "Action needed"), and — when HIPAA is
**Not Compliant** — a prominent call to action linking to
`https://updatemyinfo.havenfreeclinic.com` (instructions live on that page).

## Decisions (confirmed with the requester)

- **Identity model: NetID only, no verification.** Opening the link immediately
  shows that NetID's status — zero friction, matching "when volunteers land on
  this it checks." Accepted tradeoff: the endpoint returns contract/training/
  HIPAA status for any valid NetID with no authentication (see *Security* below).
- **"Completely compliant" = Training AND Contract AND HIPAA.** We intentionally
  do **not** use the Compliance table's full `Overall Compliance` formula (which
  also requires EHS, BBP, TB awareness, etc.) — those are items a volunteer
  cannot self-resolve and would be confusing on a volunteer-facing page.

## Data model (verified in Airtable, base `appkxTQ19GmaHgW1O`)

**All People** (`tblnHgBpknuqWvx9c`):
- `NetID` (singleLineText)
- `Name` (singleLineText)
- `HIPAA Compliance Status` (singleSelect) — options: **`Compliant`** /
  **`Not Compliant`**. (Also `HIPAA Certificate` attachment + `HIPAA Last
  Completed Date` exist but are not needed here.)

**Compliance** (`tblxmEYGZ1ZKqSeK4`):
- `Names` (multipleRecordLinks → All People) — a person may have multiple rows.
- `Volunteer Contract` (checkbox)
- `Volunteer Training` (checkbox)

Contract/training are OR'd across all of a person's Compliance rows (a contract
on file once is enough), which is exactly what the existing
`buildComplianceByPersonId` does. HIPAA status lives on All People.

## Architecture & data flow

```
Volunteer opens /compliance/jc2345
  -> vercel.json rewrites non-/api paths to the SPA (index.html)
  -> App.tsx detects the /compliance/<netid> path, renders <ComplianceCheck netid="jc2345" />
  -> GET /api/compliance/jc2345        (public, no auth)
        |- findPersonByNetid(config, netid)  -> All People row -> HIPAA Compliance Status
        '- listAll(Compliance) -> buildComplianceByPersonId() -> { contract, training } for person.id
  -> JSON { found, name, netid, contract, training, hipaaCompliant, overallCompliant }
  -> render status card; conditional HIPAA upload CTA
```

## Server changes (`server/`)

### `server/compliance.ts` — new pure, unit-tested function

```ts
export type VolunteerComplianceResult = {
  contract: boolean;
  training: boolean;
  hipaaCompliant: boolean;
  overallCompliant: boolean;
  missing: ("contract" | "training" | "hipaa")[];
};

export function evaluateVolunteerCompliance(input: {
  contract: boolean;
  training: boolean;
  hipaaStatus: string; // raw single-select value; "" when unset
}): VolunteerComplianceResult;
```

- `hipaaCompliant` is true **only** when `hipaaStatus.trim() === "Compliant"`.
  Empty/blank/any other value → not compliant (CTA shows). This is fail-safe:
  an un-set status is treated as "needs action," never as compliant.
- `overallCompliant = contract && training && hipaaCompliant`.
- `missing` lists the failing items in a stable order for the UI.

### `server/app.ts`

- **Extend `AllPeopleFields`** with `"HIPAA Compliance Status"?: string`.
- **New helper `findPersonByNetid(config, netid)`** — case-insensitive lookup:
  `filterByFormula = LOWER({NetID}) = '<escaped lower netid>'`, `pageSize: 1`,
  returns the first record or `null`. (The existing `findPerson` requires
  NetID + email; this one is NetID-only by design.)
- **New public route** `app.get("/compliance/:netid", ...)`, placed alongside
  the other public endpoints (`/view`):
  1. `getConfig()`; 400 if not configured.
  2. `findPersonByNetid`. If null → `c.json({ found: false })` (200).
  3. `listAll<ComplianceFields>(complianceTableId, fields: ["Names","Volunteer Contract","Volunteer Training"])`
     → `buildComplianceByPersonId(...)` → flags for `person.id`
     (default `{ contract:false, training:false }` if no row).
  4. `hipaaStatus = selectName(person.fields["HIPAA Compliance Status"])`.
  5. `evaluateVolunteerCompliance(...)`.
  6. Return the response contract below.
- No login-log write (this is not an authenticated sign-in).

### Response contract

```jsonc
// found
{
  "found": true,
  "name": "Jane Doe",
  "netid": "jc2345",
  "contract": true,
  "training": false,
  "hipaaCompliant": false,
  "overallCompliant": false
}
// not found
{ "found": false }
```

## Client changes (`src/`)

### `src/api/types.ts`

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

### `src/api/client.ts`

```ts
complianceCheck: (netid: string) =>
  request<ComplianceCheckResponse>(`/compliance/${encodeURIComponent(netid)}`, { method: "GET" }),
```

### `src/app/components/ComplianceCheck.tsx` — new component

- Props: `{ netid: string }`. Fetches `api.complianceCheck(netid)` on mount;
  holds `loading` / `error` / `data` state.
- **Loading:** spinner consistent with the app's existing loading treatment.
- **Error (network/500):** simple retry message.
- **`found: false`:** "We couldn't find a volunteer with NetID '<netid>'. Check
  your link or ask your director." No CTA.
- **`found: true`:** white `rounded-xl shadow` card (matches existing cards):
  - Greeting with the volunteer's name.
  - Overall banner: green **"You're all set"** when `overallCompliant`, else
    amber **"Action needed"** summarizing what's missing.
  - Three line items — **Volunteer Training**, **Volunteer Contract**,
    **HIPAA Certificate** — each with a lucide `CheckCircle2` (green) /
    `XCircle` (red) icon reflecting its boolean.
  - When `hipaaCompliant === false`: prominent amber callout with a button
    linking to `https://updatemyinfo.havenfreeclinic.com`
    (`target="_blank" rel="noopener noreferrer"`) and copy: "Upload your HIPAA
    certificate there — the instructions are on that page."
- Styling reuses existing tokens (brand blue `#0F4D92`, Tailwind classes seen in
  `SignInToRequest`/`LandingCards`). Icons come from `lucide-react` (existing dep).

### `src/app/App.tsx` — routing

- Add `"compliance"` to the `Step` union.
- Add `compliancePath` parsing: a helper `parseCompliancePath(pathname)` that
  returns the decoded NetID when `pathname` matches `^/compliance/([^/]+)/?$`,
  else `null`. Store the netid in state (`complianceNetid`).
- `initialStepFromUrl()`: `/view` → `"view"`; a compliance path → `"compliance"`;
  else `"loading"`.
- **URL-sync effect:** today it forces every non-`/view` step to `/`. Guard it so
  that when `step === "compliance"` it does **not** rewrite the URL (leave the
  `/compliance/<netid>` path intact).
- **`popstate` handler:** recompute the step from the path, including the
  compliance case, and set `complianceNetid` accordingly.
- Render: when `step === "compliance"`, render `<ComplianceCheck netid={complianceNetid} />`
  inside the existing header/background chrome (same as the `view` branch).

## Testing

- **Unit** (`server/tests/compliance.test.ts`): add cases for
  `evaluateVolunteerCompliance`:
  - all three compliant → `overallCompliant: true`, `missing: []`.
  - each single item missing → correct `missing` entry, `overallCompliant: false`.
  - blank HIPAA status (`""`) → `hipaaCompliant: false`.
  - HIPAA status other than "Compliant" (e.g. "Not Compliant") → not compliant.
- The full `vitest` suite (`npm test`) must stay green.
- Manual smoke (dev server): a compliant NetID, a partially-compliant NetID, and
  an unknown NetID render the three expected states.

## Security / privacy (accepted tradeoff)

`GET /api/compliance/:netid` is unauthenticated and returns a person's contract,
training, and HIPAA status for any valid NetID. This was an explicit product
decision (zero-friction self-check; Yale NetIDs are semi-guessable). The page
exposes only these three coarse booleans plus the person's name — no documents,
emails, dates, or other PII. If this is revisited later, the natural hardening is
to require Yale-email confirmation (the `/me/*` pattern already in the app).

## Out of scope

- Linking to the page from the landing UI (the link is shared directly).
- Showing the full `Overall Compliance` formula items (EHS/BBP/TB/etc.).
- Rendering or uploading the HIPAA certificate itself (handled by
  updatemyinfo.havenfreeclinic.com).
- Any write/mutation — this feature is read-only.
