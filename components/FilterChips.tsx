"use client";

import { GROUP_LABEL, SUB_DEFS, type GroupId } from "@/lib/types";
import { CategoryIcon } from "@/lib/icons";
import { useGardenMapStore } from "@/lib/store";

const GROUP_ORDER: GroupId[] = ["company", "material", "park"];

function Chip({
  active,
  sub,
  onClick,
  children,
}: {
  active: boolean;
  sub?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "tp-caption flex-shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 shadow-[0_2px_8px_rgba(0,0,0,0.18)]",
        active
          ? sub
            ? "bg-[var(--color-neon-yellow)] text-[var(--color-deep-blue)]"
            : "bg-[var(--color-neon-yellow)] text-[var(--color-deep-blue)]"
          : sub
            ? "bg-white/10 text-white"
            : "bg-white text-[var(--color-deep-blue)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// [z-index 및 2-Depth 필터] 사양의 z-20 레이어에 해당 — 상단 검색바 바로 아래, 지도 위에 떠서
// 가로 스와이프(no-scrollbar)로 그룹→서브카테고리 2단계를 오간다.
export default function FilterChips({
  onReset,
  canReset,
}: {
  onReset?: () => void;
  canReset?: boolean;
}) {
  const activeGroup = useGardenMapStore((s) => s.activeGroup);
  const activeSub = useGardenMapStore((s) => s.activeSub);
  const setActiveGroup = useGardenMapStore((s) => s.setActiveGroup);
  const setActiveSub = useGardenMapStore((s) => s.setActiveSub);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Chip active={!activeGroup} onClick={() => setActiveGroup(null)}>
          전체
        </Chip>
        {/* [초기화] 검색어·지역·필터·내 주변 상태를 한 번에 처음으로. 예전에는 이 버튼이 없어서
            "내 주변"에 한번 들어가면 브라우저를 새로고침해야 전국 탐색으로 돌아올 수 있었다. */}
        {canReset && onReset && (
          <button
            onClick={onReset}
            aria-label="검색 조건 초기화"
            className="tp-caption flex-shrink-0 whitespace-nowrap rounded-full border border-white/40 bg-transparent px-3.5 py-2 text-white"
          >
            ↺ 초기화
          </button>
        )}
        {GROUP_ORDER.map((g) => (
          <Chip key={g} active={activeGroup === g} onClick={() => setActiveGroup(activeGroup === g ? null : g)}>
            <span className="inline-flex items-center gap-1.5">
              <CategoryIcon group={g} size={15} />
              {GROUP_LABEL[g]}
            </span>
          </Chip>
        ))}
      </div>
      {activeGroup && (
        <div className="flex flex-wrap gap-2">
          {SUB_DEFS[activeGroup].map((sub) => (
            <Chip key={sub.id} sub active={activeSub === sub.id} onClick={() => setActiveSub(sub.id)}>
              <span className="inline-flex items-center gap-1.5">
                <CategoryIcon group={activeGroup} sub={sub.id} size={14} />
                {sub.label}
              </span>
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
