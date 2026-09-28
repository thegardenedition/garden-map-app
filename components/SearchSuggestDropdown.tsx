"use client";

/**
 * components/SearchSuggestDropdown.tsx
 * ------------------------------------------------------------------------
 * TopBar(모바일, 흰 배경)와 Sidebar(데스크탑, 진한 배경) 양쪽에서 재사용하는 검색
 * 자동완성 드롭다운. 항목은 onMouseDown으로 처리한다 — input의 onBlur가 먼저 발생하면
 * 드롭다운이 사라져 클릭이 아무것도 못 누르게 되는데, mousedown은 blur보다 먼저 발생해
 * 이 경쟁을 피할 수 있다.
 */
export default function SearchSuggestDropdown({
  categories,
  recent,
  onPick,
  variant,
}: {
  categories: string[];
  recent: string[];
  onPick: (term: string) => void;
  variant: "light" | "dark";
}) {
  if (categories.length === 0 && recent.length === 0) return null;

  const isDark = variant === "dark";

  return (
    <div
      className={[
        "absolute left-0 right-0 top-full z-[var(--z-search-suggest)] mt-1.5 overflow-hidden rounded-2xl py-1.5 shadow-[0_10px_28px_rgba(0,0,0,0.28)]",
        isDark ? "bg-[var(--color-deep-blue)] ring-1 ring-white/15" : "bg-white ring-1 ring-black/5",
      ].join(" ")}
    >
      {categories.length > 0 && (
        <div className="px-1.5 py-1">
          <div className={["tp-caption px-2.5 pb-1", isDark ? "text-white/40" : "text-[#8A90B4]"].join(" ")}>분류</div>
          {categories.map((label) => (
            <button
              key={label}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(label);
              }}
              className={[
                "tp-body block w-full rounded-xl px-2.5 py-2 text-left",
                isDark ? "text-white hover:bg-white/10" : "text-[var(--color-deep-blue)] hover:bg-black/5",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="px-1.5 py-1">
          <div className={["tp-caption px-2.5 pb-1", isDark ? "text-white/40" : "text-[#8A90B4]"].join(" ")}>최근 검색어</div>
          {recent.map((term) => (
            <button
              key={term}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(term);
              }}
              className={[
                "tp-body flex w-full items-center gap-1.5 rounded-xl px-2.5 py-2 text-left",
                isDark ? "text-white/80 hover:bg-white/10" : "text-[#5A5F82] hover:bg-black/5",
              ].join(" ")}
            >
              <span aria-hidden className="opacity-60">
                ⏱
              </span>
              {term}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
