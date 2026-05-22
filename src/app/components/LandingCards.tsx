import { motion } from "motion/react";
import type { DirectorIdentity } from "@/api/types";
import { DirectorLookup } from "./DirectorLookup";

export function LandingCards({
  onIdentity,
  onOpenView,
}: {
  onIdentity: (id: DirectorIdentity) => void;
  /** autoSignIn=true pre-expands the sign-in form on /view so volunteers don't
   *  have to hunt for it when they came from "Update availability". */
  onOpenView: (opts?: { autoSignIn?: boolean }) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full max-w-5xl mt-12 grid gap-6 md:grid-cols-3"
    >
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-2">Director sign-in</h2>
        <p className="text-sm text-slate-600 mb-4">
          Build or edit your department's clinic schedule.
        </p>
        <DirectorLookup onFound={onIdentity} />
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col">
        <h2 className="text-lg font-semibold mb-2">Update my availability</h2>
        <p className="text-sm text-slate-600 mb-4">
          Sign in with your NetID + email to update which Saturdays you can work
          this term — your directors will be flagged that you've changed it since
          your application.
        </p>
        <button
          type="button"
          onClick={() => onOpenView({ autoSignIn: true })}
          className="mt-auto bg-[#0F4D92] text-white rounded-md px-4 py-2 font-semibold hover:bg-[#0B3D75] transition-colors"
        >
          Sign in to update
        </button>
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
