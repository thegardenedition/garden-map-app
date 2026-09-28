"use client";

import { GROUP_ICON, GROUP_LABEL, SUB_DEFS, type GroupId } from "@/lib/types";
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

// [z-index 및 다중 레이어 필터] 사양의 z-20 레이어에 해당 — 상단 검색바 바로 아래, 지도 위에 떠서
// 가로 스와이프(no-scrollbar)로 그룹→서브카테고리를 오간다. 호갱노노의 "여러 데이터 레이어를
// 동시에 켜는" 그리드를 벤치마킹해 그룹은 다중 선택 가능하다 — 예: 조경회사+공원을 동시에 켜서
// 지도에 같이 표시할 수 있다. 서브카테고리는 그룹이 정확히 1개일 때만 의미가 있으므로(그 하나의
// 그룹 안에서 더 좁히는 용도) 여전히 단일 선택이고, 그룹이 2개 이상이면 서브 칩 자체를 감춘다.
export default function FilterChips() {
  const activeGroups = useGardenMapStore((s) => s.activeGroups);
  const activeSub = useGardenMapStore((s) => s.activeSub);
  const toggleGroup = useGardenMapStore((s) => s.toggleGroup);
  const clearGroups = useGardenMapStore((s) => s.clearGroups);
  const setActiveSub = useGardenMapStore((s) => s.setActiveSub);

  const singleActiveGroup = activeGroups.size === 1 ? [...activeGroups][0] : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        <Chip active={activeGroups.size === 0} onClick={clearGroups}>
          전체
        </Chip>
        {GROUP_ORDER.map((g) => (
          <Chip key={g} active={activeGroups.has(g)} onClick={() => toggleGroup(g)}>
            {GROUP_ICON[g]} {GROUP_LABEL[g]}
          </Chip>
        ))}
      </div>
      {singleActiveGroup && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {SUB_DEFS[singleActiveGroup].map((sub) => (
            <Chip key={sub.id} sub active={activeSub === sub.id} onClick={() => setActiveSub(sub.id)}>
              {sub.icon} {sub.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
