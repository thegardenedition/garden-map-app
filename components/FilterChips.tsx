"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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

// [슬라이딩 하이라이트 — 2026-09-19] 예전엔 활성 칩 배경이 흰색↔네온옐로우로 순간 전환됐다.
// layoutId 공유 배경을 활성 칩 안에서만 조건부로 그리면, 선택이 다른 칩으로 옮겨갈 때 Framer
// Motion이 이전 위치·크기에서 새 위치·크기로 알아서 FLIP 애니메이션을 태운다(세그먼트 컨트롤
// 느낌). 바탕은 항상 흰색/딥블루로 깔아 두고 그 위에 하이라이트를 얹으므로, 값 자체(대분류
// 선택 로직·보이는 최종 색)는 그대로다 — 전환 방식만 바뀐다.
const CHIP_HIGHLIGHT_TRANSITION = { type: "spring" as const, damping: 26, stiffness: 380 };

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
      className="tp-caption relative flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3 py-2 text-[var(--color-deep-blue)] shadow-[0_4px_12px_-4px_rgba(0,0,0,0.10)]"
    >
      {active && (
        <motion.div
          layoutId="groupChipHighlight"
          className="absolute inset-0 rounded-full bg-[var(--color-neon-yellow)]"
          transition={CHIP_HIGHLIGHT_TRANSITION}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">
        {group && <CategoryIcon group={group} size={14} color={GROUP_COLOR[group]} />}
        {children}
      </span>
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
        "relative flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--color-deep-blue)] px-2.5 py-1.5 text-[11.5px] font-semibold",
        active ? "" : "ring-1 ring-inset ring-white/25",
      ].join(" ")}
    >
      {active && (
        <motion.div
          layoutId="subChipHighlight"
          className="absolute inset-0 rounded-full bg-[var(--color-neon-yellow)]"
          transition={CHIP_HIGHLIGHT_TRANSITION}
        />
      )}
      <span
        className={`relative z-10 flex items-center gap-1 transition-colors duration-200 ${
          active ? "text-[var(--color-deep-blue)]" : "text-white"
        }`}
      >
        {sub && <CategoryIcon group={group} sub={sub} size={13} color={active ? GROUP_COLOR[group] : undefined} />}
        {children}
      </span>
    </button>
  );
}

// [z-index 및 2-Depth 필터] 사양의 z-20 레이어에 해당 — 상단 검색바 바로 아래, 지도 위에 떠서
// 가로 스와이프(no-scrollbar)로 그룹→서브카테고리 2단계를 오간다.
//
// [소분류를 팝오버로 — 2026-09-20] 모바일(variant="popover")에서는 소분류 줄이 이전처럼
// 대분류 줄 아래 문서 흐름에 얹히지 않는다. 대분류를 고를 때마다 상단 스택 전체 높이가
// 늘어나 그만큼 지도가 좁아지던 문제를, 소분류를 absolute 오버레이로 띄워 없앤다 — 열려도
// 아래 지도 영역은 그대로다. "대분류가 골라졌다"(activeGroup, 검색 필터 값 자체)와 "소분류
// 목록이 화면에 펼쳐져 있다"(subPanelOpen, 순전히 UI 상태)를 나눠서, 바깥을 탭해 패널만
// 닫아도 선택된 필터는 유지된다. 데스크톱 사이드바(variant="inline", 기본값)는 폭이 좁고
// 세로 스크롤 컨테이너라 오버레이가 어색해 예전처럼 인라인을 그대로 쓴다.
export default function FilterChips({
  onReset,
  canReset,
  variant = "inline",
}: {
  onReset?: () => void;
  canReset?: boolean;
  variant?: "inline" | "popover";
}) {
  const activeGroup = useGardenMapStore((s) => s.activeGroup);
  const activeSub = useGardenMapStore((s) => s.activeSub);
  const setActiveGroup = useGardenMapStore((s) => s.setActiveGroup);
  const setActiveSub = useGardenMapStore((s) => s.setActiveSub);

  const isPopover = variant === "popover";
  const [subPanelOpen, setSubPanelOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 대분류를 새로 고르거나 끄면 패널도 그에 맞춰 자동으로 열리거나 닫힌다.
  useEffect(() => {
    setSubPanelOpen(Boolean(activeGroup));
  }, [activeGroup]);

  // 패널이 펼쳐진 동안 그 바깥(지도 등)을 탭하면 패널만 닫는다 — 선택값은 그대로 둔다.
  useEffect(() => {
    if (!isPopover || !subPanelOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setSubPanelOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isPopover, subPanelOpen]);

  function handleGroupClick(g: GroupId) {
    if (activeGroup === g) {
      // 팝오버 모드에서 바깥 탭으로 패널만 닫아 둔 상태라면, 같은 칩을 다시 눌렀을 때
      // 그룹을 끄는 대신 패널을 다시 연다 — 그래야 "닫은 패널 다시 열기" 길이 생긴다.
      if (isPopover && !subPanelOpen) {
        setSubPanelOpen(true);
      } else {
        setActiveGroup(null);
      }
    } else {
      setActiveGroup(g);
      setSubPanelOpen(true);
    }
  }

  const subChips = activeGroup && (
    <>
      <SubChip group={activeGroup} active={!activeSub} onClick={() => setActiveSub(null)}>
        전체
      </SubChip>
      {/* browsable: false 인 소분류는 칩으로 내걸지 않는다 — 지금은 "조경종합"뿐이고,
          이유는 lib/types.ts 의 해당 항목에 적어 뒀다. 이미 선택돼 있다면(예전 상태가
          남아 있는 경우) 끄지 못하는 상태가 되므로 그때는 예외적으로 보여준다. */}
      {SUB_DEFS[activeGroup]
        .filter((sub) => sub.browsable !== false || activeSub === sub.id)
        .map((sub) => (
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
    </>
  );

  return (
    <div ref={rootRef} className={isPopover ? "relative flex flex-col gap-2" : "flex flex-col gap-2"}>
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
            <GroupChip key={g} group={g} active={activeGroup === g} onClick={() => handleGroupClick(g)}>
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

      {isPopover ? (
        <AnimatePresence>
          {activeGroup && subPanelOpen && (
            <motion.div
              key="sub-panel"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="no-scrollbar absolute left-0 right-0 top-full z-[var(--z-mobile-topstack)] mt-2 flex gap-1.5 overflow-x-auto rounded-2xl bg-[var(--color-secondary-blur)] p-1.5 shadow-[0_12px_28px_-8px_rgba(0,0,0,0.25)]"
            >
              {subChips}
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        activeGroup && (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-2xl bg-[var(--color-secondary-blur)] p-1.5">
            {subChips}
          </div>
        )
      )}
    </div>
  );
}
