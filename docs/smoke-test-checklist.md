# HAVEN Scheduler — Smoke-Test Checklist

Run these against a local dev server with a working `.env.local` (real
`AIRTABLE_PAT`). Start with `npm run dev` — Vite on `:5173`, API on `:3001`.

For curl examples, replace `YOU_NETID` / `YOU_EMAIL` with a real director
account on a real department, and replace `DEPT_ID` / `REQ_ID` with values
copied from prior responses.

---

## 1. Public read endpoints (no auth)

### `GET /api/view` — published-department list

```bash
curl -s http://localhost:3001/view | jq
```

**Expect:** an array of `{id, name}`. Should include only departments
whose `Schedule Status = "Submitted"` in Airtable. **Departments still in
Draft must NOT appear.**

### `GET /api/view/:deptId` — public schedule for one department

```bash
curl -s http://localhost:3001/view/DEPT_ID | jq
```

**Expect:** `{deptName, submittedAt, dates: [{date, directors, volunteers}]}`.
- Each `volunteers[].name` and `directors[].name` is a real person from
  All People — no empty strings.
- Each date appears at most once (recent dedup fix).
- A `403` is correct if the dept is Draft.

---

## 2. Director auth + workspace

### `POST /api/director/:netid` — director sign-in

```bash
curl -s -X POST http://localhost:3001/director/YOU_NETID \
  -H 'Content-Type: application/json' \
  -d '{"email":"YOU_EMAIL"}' | jq
```

**Expect:** `{person, isAdmin, departments: [{id, name, pendingRequestCount}]}`.
- `pendingRequestCount` should match Airtable's count of `Status="Pending"`
  on each dept. **If it's 0 across the board and you know there are
  pending requests, that's the LABR-bug — re-deploy `claude/fix-requests-filter-find-arrayjoin`.**
- `isAdmin` is `true` only for ITCM/EXEC directors.
- For non-admins, `departments` should include cross-managed depts (per
  `MANAGES_OTHER_DEPTS` in server/app.ts).

### `POST /api/schedule/:deptId` — load the builder

```bash
curl -s -X POST http://localhost:3001/schedule/DEPT_ID \
  -H 'Content-Type: application/json' \
  -d '{"callerNetid":"YOU_NETID","callerEmail":"YOU_EMAIL"}' | jq '.dates,.assignments[0],.roster.volunteers[0]'
```

**Expect:** `dates`, `assignments` (one per Saturday with director/volunteer/shadow ID lists), and rich `roster` (Person objects with availability + conflicts + minShiftsWanted).

---

## 3. Schedule edits (writes — be careful)

Pick a test department or use Director Mode → Shadow Mode against a
volunteer slot you can cleanly revert.

### `POST /api/assignment` — toggle one person on/off a date

UI walkthrough:
1. Sign in as a director.
2. Pick a department.
3. Click any volunteer cell in **Assign mode** — should toggle `●` ↔ `○` and persist (refresh page; it should stay).
4. Switch to **Shadow mode**. Click the same cell — should toggle `◐` ↔ `○`.
5. Switch back to Assign — the cell shows `◐` (shadow) with the "shadowing" tooltip.

Concurrent edit check:
1. Open the same department in two browser tabs.
2. Toggle the same cell in tab A.
3. Save in tab B. Tab B should *not* clobber tab A's change (recent dedup
   fix should self-heal duplicate `(dept, date)` rows on save).

### `POST /api/submit/:deptId` — submit/publish

UI walkthrough:
1. From the builder, hit the **Submit** button.
2. Header should show a green "Submitted" pill.
3. Schedule should now appear in the public dropdown at `/`.
4. Edit the schedule (e.g., move a person). The pill should revert to draft state and the dept should disappear from the public dropdown (per `4f5554e` and `c0169be`).
5. Re-submit. Pill back to green, public dropdown re-includes it.

### `POST /api/remove-volunteer` — director removes someone from the roster

UI walkthrough:
1. In the builder, click the trash icon next to a volunteer name.
2. Confirmation modal lists the Saturdays they'll be unscheduled from.
3. Confirm. They should disappear from the roster and from every shift they were on.
4. **Check Airtable's `SU 26 Removal Log` table** — there should be a new row with Summary, Removed By, Volunteer Removed, Department, Removed At, Unscheduled Count, and (optionally) Reason. **All field names must populate; if any are blank in Airtable but you provided them in the UI, that's schema drift.**

---

## 4. Volunteer self-service flow

### `POST /api/me/assignments` — sign in below the public view

UI walkthrough:
1. Go to `/view`, pick a dept.
2. Below the schedule, "Sign in with NetID + email." Enter a real volunteer's NetID and email.
3. After sign-in, **My assignments** card should show every Saturday they're on (regular OR shadow). Shadow rows show a purple `SHADOW` badge.
4. **Critical:** the card must show their assignments, NOT "You're not currently scheduled" when they're actually on the schedule. (That's the bug fixed in `claude/fix-me-assignments-empty`, now merged.)

curl version:
```bash
curl -s -X POST http://localhost:3001/me/assignments \
  -H 'Content-Type: application/json' \
  -d '{"callerNetid":"VOLUNTEER_NETID","callerEmail":"VOLUNTEER_EMAIL"}' | jq '.assignments,.volunteerAvailability'
```

### `POST /api/me/availability` — volunteer self-updates availability

UI walkthrough:
1. From the landing page, click "Update my availability."
2. Sign in. Pick/unpick Saturdays. Submit.
3. In Airtable: `All People[<this person>]` should have updated `SU 26 — Volunteer-Updated Availability` and `SU 26 — Volunteer Updated At`.
4. As a director on that volunteer's dept, the builder should show an "updated" badge next to their name (per `d22812e`).

### `POST /api/availability/acknowledge` — director acknowledges the update

UI walkthrough:
1. As a director, click the "updated" badge on a volunteer who self-updated.
2. The badge should clear, and Airtable should set `SU 26 — Volunteer Update Acknowledged At`.

---

## 5. Drop/swap requests

### Regular volunteer drop

UI walkthrough:
1. Sign in via the public view as a regular volunteer on a Saturday.
2. Click **Request swap** → "Just drop this shift" → optional note → Submit.
3. Toast: "Request submitted."
4. Row should now show **"Pending — withdraw"**.
5. Check Airtable `SU 26 Shift Requests` — new row with `Status=Pending`, `Type=Drop`, your `Requester` and date.

### Regular volunteer named swap

UI walkthrough:
1. Same flow, choose "Swap with a specific person."
2. Pick a partner volunteer on a different Saturday (drop-down must populate from the public schedule).
3. Submit. Same outcome as above except `Target` and `Target Date` are set on the Airtable row, and `Type` becomes `Named swap`.

### Withdraw your own request

UI walkthrough:
1. From My Assignments, click **Pending — withdraw**.
2. Toast: "Request withdrawn." Airtable row `Status` flips to `Withdrawn`.

### Director queue

UI walkthrough:
1. Sign in as a director.
2. Top-bar tab "Pending requests" should show a number ≥ 1 (matching `pendingRequestCount` from `/director`).
3. Open the tab. Each row shows requester name + date, target/target-date if named swap, optional note.
4. **Critical:** if there are any Pending rows in Airtable for this dept and the queue is empty, the LABR-bug is back — re-check `claude/fix-requests-filter-find-arrayjoin` is deployed.

### Director approves a drop

UI walkthrough:
1. Find a Pending drop. Click "Approve."
2. The requester should be removed from `Su26 Schedule[(dept, date)].Volunteers on Shift` (or `Directors on Shift` for a director-drop).
3. The request row's `Status=Approved`, `Resolver`, `Resolved At` set.

### Director approves a named swap

UI walkthrough:
1. Find a Pending named swap.
2. Click "Approve."
3. Requester and target should swap places on the two Saturdays in `Su26 Schedule`.
4. If the schedule has changed since submission (e.g., one of them was removed), expect `409 Schedule has changed since request was submitted`.

### Shadow drop

UI walkthrough:
1. Mark yourself as a shadow on a Saturday (Director → Shadow mode).
2. Sign in to `/view` as that shadow. My Assignments shows the row with the purple `SHADOW` badge.
3. The action button should say **"Request drop"** (not "Request swap").
4. Click it. Modal title: "Request to drop — ...". The named-swap radio is hidden; copy reads "Shadow shifts can be dropped through the portal but can't be swapped."
5. Submit. Director approves. The shadow should be removed from `Shadow Volunteers on Shift` (not `Volunteers on Shift`).

### Duplicate-request race

To exercise the post-create check from `claude/audit-followups`:
```bash
# Two near-simultaneous submissions, same person + dept + date.
for i in 1 2; do
  curl -s -X POST http://localhost:3001/requests \
    -H 'Content-Type: application/json' \
    -d '{"callerNetid":"VOL","callerEmail":"VOL@","deptId":"DEPT","requesterDate":"2026-06-20"}' &
done
wait
```
**Expect:** one succeeds (`201`), the other returns `409 Pending request already exists`. In Airtable, exactly one Pending row should remain — the loser was auto-withdrawn.

---

## 6. Sign-in log

After exercising any sign-in flow above, check Airtable's `SU 26 Login Log`
table — each successful sign-in should have a row with Person link, NetID,
Email, Surface (`Director` or `Public viewer`), Signed In At, and User Agent.

---

## Known limitations / things this checklist does NOT verify

- Email automations on `Status` changes in `SU 26 Shift Requests` (Airtable-side).
- Stripe / billing flows (none in this app).
- The mobile builder layout — eyeball it but no automated regression.
- HAVEN logo favicon — check the browser tab on `/`; should show the
  circled "HAVEN" mark (light theme) or its inverted color (dark theme).
