import { LOGO_URL, BG_IMAGE } from "./constants";

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden font-sans text-slate-900">
      <div className="absolute inset-0 z-0">
        <img src={BG_IMAGE} alt="" className="w-full h-full object-cover blur-md scale-105" />
        <div className="absolute inset-0 bg-[#0F4D92]/80" />
      </div>
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="p-6 flex items-center text-white border-b border-white/10">
          <img src={LOGO_URL} alt="HAVEN Free Clinic" className="h-12 w-auto" />
          <div className="h-8 w-px bg-white/20 mx-4" />
          <p className="text-sm font-medium text-blue-100 tracking-wide uppercase">
            Clinic Schedule
          </p>
        </header>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-xl p-8 shadow-lg max-w-md w-full text-center">
            <h1 className="text-2xl font-bold text-slate-900">Hello HAVEN</h1>
            <p className="text-slate-500 mt-2">Scaffold render — replaced in next tasks.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
