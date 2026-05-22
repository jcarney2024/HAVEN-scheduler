import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { MyAssignmentsResponse } from "@/api/types";
import { displayDate } from "./displayDate";

export function MyAvailability({
  data,
  credentials,
  onSaved,
}: {
  data: MyAssignmentsResponse;
  credentials: { netid: string; email: string };
  onSaved: () => void;
}) {
  const initial = useMemo(
    () => new Set(data.volunteerAvailability.myDates),
    [data.volunteerAvailability.myDates],
  );
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    if (selected.size !== initial.size) return true;
    for (const d of selected) if (!initial.has(d)) return true;
    return false;
  }, [selected, initial]);

  function toggle(iso: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }

  async function submit() {
    setSaving(true);
    try {
      await api.setMyAvailability({
        callerNetid: credentials.netid,
        callerEmail: credentials.email,
        availableDates: [...selected].sort(),
      });
      toast.success("Availability updated — directors will see your changes.");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message ?? "Couldn't update availability");
    } finally {
      setSaving(false);
    }
  }

  const { source, volunteerUpdatedAt, directorOverrideActive } = data.volunteerAvailability;
  const sourceLabel =
    source === "volunteer-updated"
      ? `Showing your last self-update from ${
          volunteerUpdatedAt ? new Date(volunteerUpdatedAt).toLocaleDateString() : "earlier"
        }.`
      : source === "application"
      ? "Showing the availability you submitted in your original application."
      : "No availability on file yet — pick the Saturdays you can work below.";

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">My Saturday availability</h2>
        <p className="text-sm text-slate-500 mt-1">{sourceLabel}</p>
        {directorOverrideActive && (
          <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            Heads up: your director has manually pinned your availability for now. We'll save
            your update either way, but you may want to reach out to them so they un-pin it.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {data.dates.map((d) => {
          const isOn = selected.has(d.iso);
          return (
            <label
              key={d.iso}
              className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                isOn
                  ? "bg-amber-50 border-amber-300"
                  : "bg-white border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                checked={isOn}
                onChange={() => toggle(d.iso)}
                className="w-4 h-4 accent-amber-500"
              />
              <span className="text-sm">{displayDate(d.iso)}</span>
            </label>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <p className="text-xs text-slate-500">
          {selected.size === 0
            ? "No Saturdays selected — you'll be marked unavailable."
            : `${selected.size} Saturday${selected.size === 1 ? "" : "s"} selected.`}
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={!dirty || saving}
          className="bg-[#0F4D92] text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-[#0B3D75] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : dirty ? "Save availability" : "Saved"}
        </button>
      </div>
    </div>
  );
}
