import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { api } from "@/api/client";
import type { ComplianceCheckResponse } from "@/api/types";

const HIPAA_UPLOAD_URL = "https://updatemyinfo.havenfreeclinic.com";
const CONTRACT_URL = "https://airtable.com/appOq1yOiA1Lfzq8L/pagtBHXs01CPcOO5l/form";
const MAKEUP_TRAINING_URL = "https://airtable.com/appOq1yOiA1Lfzq8L/pagzNM5jQ2SKmbVyI/form";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; data: ComplianceCheckResponse };

function StatusRow({
  label,
  ok,
  action,
}: {
  label: string;
  ok: boolean;
  /** Where to go to complete this item. Shown only when the item is not ok. */
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-slate-100 last:border-0">
      <span className="font-medium text-slate-800">{label}</span>
      {ok ? (
        <span className="flex items-center gap-1.5 text-green-600 font-semibold text-sm shrink-0">
          <CheckCircle2 className="w-5 h-5" /> Complete
        </span>
      ) : (
        <span className="flex items-center gap-3 shrink-0">
          {action && (
            <a
              href={action.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#0F4D92] font-semibold text-sm hover:underline whitespace-nowrap"
            >
              {action.label} →
            </a>
          )}
          <span className="flex items-center gap-1.5 text-red-600 font-semibold text-sm">
            <XCircle className="w-5 h-5" /> Not yet
          </span>
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
            Action needed — please finish the items marked “Not yet” below.
          </p>
        </div>
      )}

      <div className="mb-2">
        <StatusRow
          label="Volunteer Training"
          ok={data.training}
          action={{ href: MAKEUP_TRAINING_URL, label: "Make-up training" }}
        />
        <StatusRow
          label="Volunteer Contract"
          ok={data.contract}
          action={{ href: CONTRACT_URL, label: "Sign contract" }}
        />
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
