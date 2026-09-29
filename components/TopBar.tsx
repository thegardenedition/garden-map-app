"use client";

import { useState } from "react";
import { REGION_LIST } from "@/lib/types";
import { useGardenMapStore } from "@/lib/store";
import { getCategorySuggestions } from "@/lib/searchSuggestions";
import SearchSuggestDropdown from "./SearchSuggestDropdown";

export default function TopBar({
  onSubmit,
  onSuggestOpenChange,
}: {
  onSubmit: (overrideTerm?: string) => void;
  // [z-index] 이 드롭다운은 topstack 컨테이너(app/page.tsx) 안에 있어서, 바텀시트보다
  // 위에 그려지려면 그 컨테이너 자체의 z-index를 올려야 한다 — 열림/닫힘을 부모에 알린다.
  onSuggestOpenChange?: (open: boolean) => void;
}) {
  const region = useGardenMapStore((s) => s.region);
  const setRegion = useGardenMapStore((s) => s.setRegion);
  const searchTerm = useGardenMapStore((s) => s.searchTerm);
  const setSearchTerm = useGardenMapStore((s) => s.setSearchTerm);
  const recent = useGardenMapStore((s) => s.recentSearches);
  const [suggestOpen, setSuggestOpen] = useState(false);

  function setOpen(open: boolean) {
    setSuggestOpen(open);
    onSuggestOpenChange?.(open);
  }

  function pick(term: string) {
    setSearchTerm(term);
    setOpen(false);
    onSubmit(term);
  }

  return (
    <div className="relative flex items-center gap-1.5 rounded-2xl bg-white p-2 shadow-[0_4px_18px_rgba(0,0,0,0.25)]">
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
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setOpen(false);
            onSubmit();
          }
        }}
        placeholder="예: 조경, 잔디, 수목원..."
        className="tp-body min-h-[44px] min-w-0 flex-1 bg-transparent text-[var(--color-deep-blue)] outline-none placeholder:text-[#B4B8D6]"
      />
      <button
        onClick={() => onSubmit()}
        aria-label="검색"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--color-deep-blue)] text-lg text-[var(--color-neon-yellow)]"
      >
        ⌕
      </button>
      {suggestOpen && (
        <SearchSuggestDropdown
          categories={getCategorySuggestions(searchTerm)}
          recent={searchTerm.trim() ? [] : recent}
          onPick={pick}
          variant="light"
        />
      )}
    </div>
  );
}
