import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Tab = { iso: string; display: string; hasDot?: boolean };

export function DateTabStrip({
  tabs,
  activeIso,
  onSelect,
}: {
  tabs: Tab[];
  activeIso: string;
  onSelect: (iso: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    function update() {
      if (!el) return;
      const overflowing = el.scrollWidth > el.clientWidth + 1;
      setCanLeft(overflowing && el.scrollLeft > 4);
      setCanRight(overflowing && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [tabs.length]);

  // Keep the active tab in view when it changes (e.g. when the user clicks a
  // tab that's mostly off-screen — scroll it into the visible portion).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-iso="${activeIso}"]`);
    if (!active) return;
    const left = active.offsetLeft - el.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < el.scrollLeft) {
      el.scrollTo({ left: left - 24, behavior: "smooth" });
    } else if (right > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: right - el.clientWidth + 24, behavior: "smooth" });
    }
  }, [activeIso]);

  function scrollBy(dir: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.6), behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div ref={scrollerRef} className="flex gap-1 overflow-x-auto pb-2 scroll-smooth">
        {tabs.map((t) => (
          <button
            key={t.iso}
            data-iso={t.iso}
            onClick={() => onSelect(t.iso)}
            className={`flex-shrink-0 px-3 py-1.5 text-sm rounded-full border transition-colors ${
              activeIso === t.iso
                ? "bg-[#0F4D92] text-white border-[#0F4D92]"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {t.display}
            {t.hasDot && (
              <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </button>
        ))}
      </div>

      {canLeft && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 bottom-2 w-12 bg-gradient-to-r from-white to-transparent"
          />
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll dates left"
            className="absolute left-0 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </>
      )}

      {canRight && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 bottom-2 w-16 bg-gradient-to-l from-white to-transparent"
          />
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="Scroll dates right"
            className="absolute right-0 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
