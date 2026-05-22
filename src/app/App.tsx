import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import type { DirectorIdentity } from "@/api/types";
import { LOGO_URL, BG_IMAGE } from "./constants";
import { LandingCards } from "./components/LandingCards";
import { ScheduleBuilder } from "./components/ScheduleBuilder";
import { PublicScheduleView } from "./components/view/PublicScheduleView";

type Step = "loading" | "lookup" | "schedule" | "view";

function initialStepFromUrl(): Step {
  if (typeof window === "undefined") return "loading";
  return window.location.pathname === "/view" ? "view" : "loading";
}

export default function App() {
  const [step, setStep] = useState<Step>(initialStepFromUrl());
  const [identity, setIdentity] = useState<DirectorIdentity | null>(null);

  useEffect(() => {
    if (step === "loading") {
      const t = setTimeout(() => setStep("lookup"), 200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [step]);

  // Keep URL in sync so /view is shareable + back button works.
  useEffect(() => {
    const target = step === "view" ? "/view" : "/";
    if (window.location.pathname !== target) {
      window.history.pushState({}, "", target);
    }
  }, [step]);

  // Respond to browser back/forward.
  useEffect(() => {
    function onPop() {
      const next: Step = window.location.pathname === "/view" ? "view" : "lookup";
      setStep(next);
      if (next === "lookup") setIdentity(null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function handleIdentity(found: DirectorIdentity) {
    setIdentity(found);
    setStep("schedule");
  }

  function handleSignOut() {
    setIdentity(null);
    setStep("lookup");
  }

  function handleOpenView() {
    setStep("view");
  }

  function handleBackToLanding() {
    setStep("lookup");
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-x-hidden font-sans text-slate-900">
      <Toaster position="top-center" richColors />
      <div className="absolute inset-0 z-0">
        <img src={BG_IMAGE} alt="" className="w-full h-full object-cover blur-md scale-105" />
        <div className="absolute inset-0 bg-[#0F4D92]/80" />
      </div>
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="p-4 sm:p-6 flex items-center justify-between gap-3 text-white border-b border-white/10">
          <button
            type="button"
            onClick={handleBackToLanding}
            className="flex items-center gap-3 sm:gap-4 text-left min-w-0"
          >
            <img src={LOGO_URL} alt="HAVEN Free Clinic" className="h-10 sm:h-12 w-auto shrink-0" />
            <div className="hidden sm:block h-8 w-px bg-white/20" />
            <p className="hidden sm:block text-sm font-medium text-blue-100 tracking-wide uppercase">
              Clinic Schedule
            </p>
          </button>
          {identity && (
            <button
              onClick={handleSignOut}
              className="text-sm text-blue-100 hover:text-white transition-colors shrink-0"
            >
              Sign out
            </button>
          )}
        </header>

        <main className="flex-1 flex items-start justify-center p-3 sm:p-6">
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
              <LandingCards
                key="landing"
                onIdentity={handleIdentity}
                onOpenView={handleOpenView}
              />
            )}
            {step === "schedule" && identity && (
              <ScheduleBuilder
                key="schedule"
                identity={identity}
              />
            )}
            {step === "view" && <PublicScheduleView key="view" />}
          </AnimatePresence>
        </main>

        <footer className="p-6 text-center text-blue-100/40 text-sm">
          &copy; {new Date().getFullYear()} HAVEN Free Clinic. Built by the HAVEN IT Department.
        </footer>
      </div>
    </div>
  );
}
