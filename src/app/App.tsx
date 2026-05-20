import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import type { DirectorIdentity } from "@/api/types";
import { LOGO_URL, BG_IMAGE } from "./constants";
import { DirectorLookup } from "./components/DirectorLookup";
import { ScheduleBuilder } from "./components/ScheduleBuilder";

type Step = "loading" | "lookup" | "schedule";

export default function App() {
  const [step, setStep] = useState<Step>("loading");
  const [identity, setIdentity] = useState<DirectorIdentity | null>(null);

  useEffect(() => {
    // No setup step — backend config is via env vars. Brief delay so the
    // loading state doesn't pop in/out instantly.
    const t = setTimeout(() => setStep("lookup"), 200);
    return () => clearTimeout(t);
  }, []);

  function handleIdentity(found: DirectorIdentity) {
    setIdentity(found);
    setStep("schedule");
  }

  function handleSignOut() {
    setIdentity(null);
    setStep("lookup");
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden font-sans text-slate-900">
      <Toaster position="top-center" richColors />
      <div className="absolute inset-0 z-0">
        <img src={BG_IMAGE} alt="" className="w-full h-full object-cover blur-md scale-105" />
        <div className="absolute inset-0 bg-[#0F4D92]/80" />
      </div>
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="p-6 flex items-center justify-between text-white border-b border-white/10">
          <div className="flex items-center gap-4">
            <img src={LOGO_URL} alt="HAVEN Free Clinic" className="h-12 w-auto" />
            <div className="h-8 w-px bg-white/20" />
            <p className="text-sm font-medium text-blue-100 tracking-wide uppercase">
              Clinic Schedule
            </p>
          </div>
          {identity && (
            <button
              onClick={handleSignOut}
              className="text-sm text-blue-100 hover:text-white transition-colors"
            >
              Sign out
            </button>
          )}
        </header>

        <main className="flex-1 flex items-start justify-center p-4 sm:p-6">
          <AnimatePresence mode="wait">
            {step === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-white text-center mt-12"
              >
                <div className="animate-spin w-8 h-8 border-4 border-white/30 border-t-white rounded-full mx-auto mb-4" />
                <p>Loading…</p>
              </motion.div>
            )}
            {step === "lookup" && (
              <motion.div
                key="lookup"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="w-full max-w-md mt-12"
              >
                <DirectorLookup onFound={handleIdentity} />
              </motion.div>
            )}
            {step === "schedule" && identity && (
              <motion.div
                key="schedule"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="w-full max-w-6xl"
              >
                <ScheduleBuilder identity={identity} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="p-6 text-center text-blue-100/40 text-sm">
          &copy; {new Date().getFullYear()} HAVEN Free Clinic. Built by the HAVEN IT Department.
        </footer>
      </div>
    </div>
  );
}
