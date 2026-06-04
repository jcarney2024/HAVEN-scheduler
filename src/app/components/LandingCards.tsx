import { motion } from "motion/react";
import type { DirectorIdentity } from "@/api/types";
import { DirectorLookup } from "./DirectorLookup";

export function LandingCards({
  onIdentity,
  onOpenView,
}: {
  onIdentity: (id: DirectorIdentity) => void;
  onOpenView: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full max-w-3xl mt-12 grid gap-6 md:grid-cols-2"
    >
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-2">Director sign-in</h2>
        <p className="text-sm text-slate-600 mb-4">
          Build or edit your department's clinic schedule.
        </p>
        <DirectorLookup onFound={onIdentity} />
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col">
        <h2 className="text-lg font-semibold mb-2">View schedules &amp; request a swap</h2>
        <p className="text-sm text-slate-600 mb-4">
          See a submitted department schedule, or sign in to request a drop or swap
          on one of your own shifts.
        </p>
        <button
          type="button"
          onClick={() => onOpenView()}
          className="mt-auto bg-[#0F4D92] text-white rounded-md px-4 py-2 font-semibold hover:bg-[#0B3D75] transition-colors"
        >
          Open
        </button>
      </div>
    </motion.div>
  );
}
