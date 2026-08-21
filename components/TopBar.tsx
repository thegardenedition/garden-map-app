"use client";

import { REGION_LIST } from "@/lib/types";
import { useGardenMapStore } from "@/lib/store";

export default function TopBar({ onSubmit }: { onSubmit: () => void }) {
  const region = useGardenMapStore((s) => s.region);
  const setRegion = useGardenMapStore((s) => s.setRegion);
  const searchTerm = useGardenMapStore((s) => s.searchTerm);
  const setSearchTerm = useGardenMapStore((s) => s.setSearchTerm);

  return (
    <div className="flex items-center gap-1.5 rounded-2xl bg-white p-2 shadow-[0_4px_18px_rgba(0,0,0,0.25)]">
      <select
        value={region}
        onChange={(e) => setRegion(e.target.value as typeof region)}
        className="min-h-[44px] flex-shrink-0 rounded-xl bg-[var(--color-secondary-blur)]/10 px-3 text-[13px] font-bold text-[var(--color-deep-blue)] outline-none"
        style={{ maxWidth: 78 }}
      >
        {REGION_LIST.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <input
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        placeholder="예: 조경, 잔디, 수목원..."
        className="tp-body min-h-[44px] min-w-0 flex-1 bg-transparent text-[var(--color-deep-blue)] outline-none placeholder:text-[#B4B8D6]"
      />
      <button
        onClick={onSubmit}
        aria-label="검색"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--color-deep-blue)] text-lg text-[var(--color-neon-yellow)]"
      >
        ⌕
      </button>
    </div>
  );
}
