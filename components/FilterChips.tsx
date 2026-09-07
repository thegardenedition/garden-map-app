"use client";

import { GROUP_LABEL, SUB_DEFS, type GroupId } from "@/lib/types";
import { CategoryIcon, GROUP_COLOR } from "@/lib/icons";
import { useGardenMapStore } from "@/lib/store";

const GROUP_ORDER: GroupId[] = ["company", "material", "park"];

/*
 * [필터 바를 다시 짠 이유]
 *  1. 세부 카테고리 칩이 모바일에서 보이지 않았다. 배경이 bg-white/10 이라 딥블루(#06107D) 바
 *     위에서는 사실상 투명이었다. 알파값을 올리는 대신, 세부 칩은 한 단계 밝은 패널 안에 넣고
 *     칩 자체는 불투명한 딥블루로 칠했다 — 배경이 무엇이든 대비가 보장된다.
 *  2. flex-wrap 때문에 칩이 2~3줄로 접혀서 필터를 누를 때마다 바 높이가 변하고 지도가 들썩였다.
 *     원래 주석이 말하던 대로(가로 스와이프) 한 줄 고정 + 가로 스크롤로 되돌린다.
 *  3. "전체 / 초기화 / 그룹 3개"가 한 줄에 뒤섞여 있었다. 초기화는 필터가 아니라 검색어·지역·
 *     내 위치까지 되돌리는 별개의 행동이라 오른쪽 끝 아이콘 버튼으로 빼냈다.
 *  4. 대분류를 고르면 세부를 다시 끄는 길이 없었다. 세부 줄 맨 앞에 "전체"를 뒀다.
 *  5. 칩의 아이콘에 그룹 색을 입혀 지도 핀과 같은 색으로 읽히게 했다 — 칩과 핀이 같은 체계다.
 */

function GroupChip({
  group,
  active,
  onClick,
  children,
}: {
  group?: GroupId;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={[
        "tp-caption flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2",
        "shadow-[0_2px_8px_rgba(0,0,0,0.18)]",
        active ? "bg-[var(--color-neon-yellow)] text-[var(--color-deep-blue)]" : "bg-white text-[var(--color-deep-blue)]",
      ].join(" ")}
    >
      {group && <CategoryIcon group={group} size={14} color={GROUP_COLOR[group]} />}
      {children}
    </button>
  );
}

function SubChip({
  group,
  sub,
  active,
  onClick,
  children,
}: {
  group: GroupId;
  sub?: (typeof SUB_DEFS)[GroupId][number]["id"];
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={[
        "flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold",
        active
          ? "bg-[var(--color-neon-yellow)] text-[var(--color-deep-blue)]"
          : "bg-[var(--color-deep-blue)] text-white ring-1 ring-inset ring-white/25",
      ].join(" ")}
    >
      {sub && <CategoryIcon group={group} sub={sub} size={13} color={active ? GROUP_COLOR[group] : undefined} />}
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
      <div className="flex items-center gap-2">
        {/* 칩이 화면보다 넓어 잘릴 때, 잘린 자리가 고장난 것처럼 보이지 않도록 오른쪽 끝을
            흐리게 지운다 — 더 있으니 밀어보라는 신호. */}
        <div
          className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto"
          style={{ maskImage: "linear-gradient(to right, #000 calc(100% - 22px), transparent)", WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 22px), transparent)" }}
        >
          <GroupChip active={!activeGroup} onClick={() => setActiveGroup(null)}>
            전체
          </GroupChip>
          {GROUP_ORDER.map((g) => (
            <GroupChip
              key={g}
              group={g}
              active={activeGroup === g}
              onClick={() => setActiveGroup(activeGroup === g ? null : g)}
            >
              {GROUP_LABEL[g]}
            </GroupChip>
          ))}
        </div>
        {/* [초기화] 검색어·지역·필터·내 주변을 한 번에 처음으로. 카테고리 칩과 같은 줄에 섞여
            있으면 이것도 필터인 줄 알게 되므로, 오른쪽 끝에 아이콘 버튼으로 떼어 놓는다. */}
        {canReset && onReset && (
          <button
            onClick={onReset}
            aria-label="검색 조건 초기화"
            title="초기화"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[var(--color-neon-yellow)]/70 text-[15px] leading-none text-[var(--color-neon-yellow)]"
          >
            ↺
          </button>
        )}
      </div>

      {activeGroup && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-2xl bg-[var(--color-secondary-blur)] p-1.5">
          <SubChip group={activeGroup} active={!activeSub} onClick={() => setActiveSub(null)}>
            전체
          </SubChip>
          {SUB_DEFS[activeGroup].map((sub) => (
            <SubChip
              key={sub.id}
              group={activeGroup}
              sub={sub.id}
              active={activeSub === sub.id}
              onClick={() => setActiveSub(sub.id)}
            >
              {sub.label}
            </SubChip>
          ))}
        </div>
      )}
    </div>
  );
}
