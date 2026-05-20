export type ViewMode = "saturday" | "grid";

export function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="inline-flex border border-slate-300 rounded-lg overflow-hidden">
      {(["saturday", "grid"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === m ? "bg-[#0F4D92] text-white" : "bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {m === "saturday" ? "Saturday" : "Full grid"}
        </button>
      ))}
    </div>
  );
}
