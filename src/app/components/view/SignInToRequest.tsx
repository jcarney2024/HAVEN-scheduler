import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { MyAssignmentsResponse } from "@/api/types";

export function SignInToRequest({
  autoOpen = false,
  onSignedIn,
}: {
  /** When true, render the form expanded by default — used when the user clicked
   *  "Update my availability" on the landing and shouldn't have to hunt for sign-in. */
  autoOpen?: boolean;
  onSignedIn: (data: MyAssignmentsResponse, credentials: { netid: string; email: string }) => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [netid, setNetid] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!netid.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const data = await api.myAssignments(netid.trim(), email.trim(), { signIn: true });
      onSignedIn(data, { netid: netid.trim(), email: email.trim() });
    } catch (err) {
      toast.error((err as Error).message ?? "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-2">Drop or swap a shift, or update your availability</h2>
        <p className="text-sm text-slate-600 mb-3">
          Sign in to request a drop/swap on one of your shifts, or to update which Saturdays
          you're available since you first applied.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-[#0F4D92] text-white rounded-md px-4 py-2 font-semibold hover:bg-[#0B3D75] transition-colors"
        >
          Sign in with NetID + email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl shadow-lg p-6 space-y-3">
      <h2 className="text-lg font-semibold">Sign in</h2>
      <input
        type="text"
        placeholder="NetID"
        value={netid}
        onChange={(e) => setNetid(e.target.value)}
        className="w-full p-2 border border-slate-300 rounded-md"
        autoComplete="username"
        required
      />
      <input
        type="email"
        placeholder="Yale email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full p-2 border border-slate-300 rounded-md"
        autoComplete="email"
        required
      />
      <button
        type="submit"
        disabled={submitting}
        className="bg-[#0F4D92] text-white rounded-md px-4 py-2 font-semibold hover:bg-[#0B3D75] transition-colors disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
