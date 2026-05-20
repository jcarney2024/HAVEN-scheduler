import { useState } from "react";
import { toast } from "sonner";
import { Search, Loader2 } from "lucide-react";
import { api } from "@/api/client";
import type { DirectorIdentity } from "@/api/types";

export function DirectorLookup({ onFound }: { onFound: (id: DirectorIdentity) => void }) {
  const [email, setEmail] = useState("");
  const [netid, setNetid] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !netid) {
      toast.error("Please provide both NetID and email.");
      return;
    }
    setLoading(true);
    try {
      const id = await api.director(netid.trim().toLowerCase(), email.trim().toLowerCase());
      onFound(id);
      toast.success(`Welcome, ${id.person.name.split(" ")[0] || "director"}!`);
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (status === 403) {
        toast.error("You're not listed as a SU 26 director. Contact the IT department.");
      } else if (status === 404) {
        toast.error("We couldn't find a HAVEN record matching that NetID + email.");
      } else {
        toast.error((e as Error).message || "Lookup failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-xl shadow-lg border border-slate-100">
      <h2 className="text-2xl font-bold">Sign in</h2>
      <p className="text-slate-500 mt-2">NetID + email — same as on your HAVEN record.</p>

      <form onSubmit={submit} className="space-y-4 mt-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">NetID</label>
          <input
            value={netid}
            onChange={(e) => setNetid(e.target.value)}
            placeholder="abc1234"
            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#0F4D92] focus:outline-none transition-all"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yale.edu"
            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#0F4D92] focus:outline-none transition-all"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0F4D92] text-white p-3 rounded-lg font-medium hover:bg-[#0B3D75] disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
          Continue
        </button>
      </form>
    </div>
  );
}
