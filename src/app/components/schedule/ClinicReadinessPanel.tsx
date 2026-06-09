import { useEffect, useState } from "react";
import type { Attending, ClinicReadiness, ProcedureKey, ProcedureStatus } from "@/api/types";

const PROC_LABEL: Record<ProcedureKey, string> = {
  iudIn: "IUD In", iudOut: "IUD Out", nexplanon: "Nexplanon", gac: "GAC", emb: "EMB", seesMale: "Sees male",
};
const PROC_ORDER: ProcedureKey[] = ["iudIn", "iudOut", "nexplanon", "gac", "emb", "seesMale"];
const STATUS_CLASS: Record<ProcedureStatus, string> = {
  yes: "bg-emerald-100 text-emerald-800 border-emerald-300",
  no: "bg-red-100 text-red-800 border-red-300",
  unknown: "bg-slate-100 text-slate-500 border-slate-300",
};

export function ClinicReadinessPanel({
  readiness,
  attendings,
  disabled,
  onChange,
}: {
  readiness: ClinicReadiness;
  attendings: Attending[];
  disabled: boolean;
  onChange: (patch: { attendingId?: string | null; director?: string | null; proceduresBooked?: number | null }) => void;
}) {
  // Local draft so typing the director doesn't write to Airtable on every
  // keystroke; commit on blur. Re-sync when the active date or persisted value changes.
  const [directorDraft, setDirectorDraft] = useState(readiness.director ?? "");
  useEffect(() => {
    setDirectorDraft(readiness.director ?? "");
  }, [readiness.date, readiness.director]);

  if (readiness.closed) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-500">
        Clinic closed — no attending or volunteers scheduled.
      </div>
    );
  }
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1">
          Attending:
          <select
            value={readiness.attending?.id ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ attendingId: e.target.value || null })}
            className="border border-slate-300 rounded px-1 py-0.5"
          >
            <option value="">—</option>
            {attendings.map((a) => (
              <option key={a.id} value={a.id}>{a.scheduleName}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Director:
          <input
            type="text"
            value={directorDraft}
            disabled={disabled}
            onChange={(e) => setDirectorDraft(e.target.value)}
            onBlur={() => {
              const v = directorDraft.trim() || null;
              if (v !== (readiness.director ?? null)) onChange({ director: v });
            }}
            className="w-20 border border-slate-300 rounded px-1 py-0.5"
          />
        </label>
        <span className={readiness.depoOk ? "text-emerald-700" : "text-red-700 font-semibold"}>
          {readiness.depoOk ? "Depo OK (RN on shift)" : "No RN — reschedule depo/injections"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PROC_ORDER.map((k) => (
          <span key={k} className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_CLASS[readiness.procedures[k]]}`} title={`${PROC_LABEL[k]}: ${readiness.procedures[k]}`}>
            {PROC_LABEL[k]}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>SCTM: <strong className="tabular-nums">{readiness.coverage.sctm}</strong></span>
        <span>JCTM: <strong className="tabular-nums">{readiness.coverage.jctm}</strong></span>
        <span className={readiness.coverage.rn === 0 ? "text-red-700" : ""}>RN: <strong className="tabular-nums">{readiness.coverage.rn}</strong></span>
        <span>Spanish: <strong className="tabular-nums">{readiness.coverage.spanish}</strong></span>
        <label className="flex items-center gap-1">
          Procedures booked:
          <input
            key={`${readiness.date}:${readiness.proceduresBooked ?? ""}`}
            type="number" min={0} step={1}
            defaultValue={readiness.proceduresBooked ?? ""}
            disabled={disabled}
            onBlur={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                if (readiness.proceduresBooked !== null) onChange({ proceduresBooked: null });
                return;
              }
              const n = Number(raw);
              if (!Number.isFinite(n) || n < 0) return;
              const next = Math.trunc(n);
              if (next !== (readiness.proceduresBooked ?? null)) onChange({ proceduresBooked: next });
            }}
            className="w-16 border border-slate-300 rounded px-1 py-0.5 tabular-nums"
          />
        </label>
        {readiness.procedureCapWarning && (
          <span className="text-red-700 font-semibold">Over max ({readiness.proceduresBooked})</span>
        )}
      </div>

      {readiness.emails.length > 0 && (
        <button
        type="button"
        onClick={async () => {
          const text = readiness.emails.join(", ");
          try {
            await navigator.clipboard.writeText(text);
            alert("Email list copied!");
          } catch {
            prompt("Copy the email list below:", text);
          }
        }}
        className="text-[11px] text-[#0F4D92] underline cursor-pointer"
        title={readiness.emails.join(", ")}
        >
          Copy clinic email list ({readiness.emails.length})
          </button>
        )}
    </div>
  );
}
