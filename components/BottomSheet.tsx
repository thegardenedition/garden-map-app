"use client";

import { animate, motion, useDragControls, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { useEffect, useState, type KeyboardEvent } from "react";
import type { SheetSnap } from "@/lib/types";

// [바텀 시트 물리 엔진]
// 드래그 종료 시 이동 거리뿐 아니라 손가락 속도(velocity.y)까지 반영해, 짧게 튕기듯 드래그해도
// 다음 스냅 포인트로 자연스럽게 이어지도록 한다. 모든 transform은 GPU 레이어에서 처리된다.
//
// [드래그 손잡이 전용 트리거] dragListener={false} + useDragControls로, 드래그 제스처는 반드시
// 손잡이(핸들 바)에서 시작된 경우에만 시트를 움직인다. 예전엔 motion.div 전체가 드래그 대상이라,
// 결과 리스트를 스크롤하려고 밀어도 리스트 대신 시트 전체가 끌려 올라왔다 — 네이버 지도처럼
// "손잡이는 시트를 움직이고, 리스트 영역은 리스트가 스크롤된다"로 분리했다.
//
// [위치를 MotionValue 로 들고 있는 이유 — 2026-09-09]
// 예전에는 useAnimation 으로 y 를 명령형으로만 움직였다. 그래서 "지금 시트가 어디까지 올라와
// 있는가"를 바깥에서 알 수 없었고, 아래 두 가지를 할 수 없었다.
//   1) 내용 영역 높이를 화면에 보이는 만큼으로 맞추기(아래 [화면 밖 목록] 참고)
//   2) 지도 위 버튼을 시트에 붙여 함께 움직이기
// y 를 MotionValue 로 두면 드래그 중에도 매 프레임 값이 따라오므로 둘 다 자연스럽게 풀린다.

const SNAP_VH: Record<SheetSnap, number> = { peek: 0.3, half: 0.5, full: 0.9 };
const SNAP_ORDER: SheetSnap[] = ["peek", "half", "full"];

// minTopPx: 시트가 이보다 위로는 올라가지 않는다. 상단 검색바·필터 칩을 덮지 않게 하려고
// 화면 쪽에서 그 스택의 아래 끝을 재서 넘겨준다. 못 재면 0 이라 예전과 같이 동작한다.
function pxFor(snap: SheetSnap, viewportH: number, minTopPx = 0) {
  return Math.max(viewportH * (1 - SNAP_VH[snap]), minTopPx);
}

export default function BottomSheet({
  snap,
  onSnapChange,
  children,
  dragHandleLabel,
  minTopPx = 0,
  floatingActions,
}: {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  children: React.ReactNode;
  dragHandleLabel?: string;
  minTopPx?: number;
  // 시트 바로 위에 떠 있어야 하는 버튼들. 시트의 자식으로 그려지므로 스냅이 바뀌든 손가락으로
  // 끌든 항상 시트를 따라 움직인다. 예전에는 지도 위에 30vh 로 좌표를 박아 뒀는데, 시트가
  // half(50%)로 열리는 순간 그 아래로 완전히 묻혀 눌리지 않았다.
  floatingActions?: React.ReactNode;
}) {
  const dragControls = useDragControls();
  const [vh, setVh] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  const y = useMotionValue(pxFor(snap, vh, minTopPx));

  // 화면 회전이나 주소창 접힘으로 높이가 바뀌면 스냅 위치도 다시 계산해야 한다.
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const controls = animate(y, pxFor(snap, vh, minTopPx), { type: "spring", damping: 32, stiffness: 300 });
    return () => controls.stop();
  }, [snap, vh, minTopPx, y]);

  /*
   * [화면 밖 목록 — 2026-09-09 실측으로 드러난 문제]
   * 시트는 height:100dvh 인 상자를 아래로 밀어 놓은 것이다. half(50%)에서는 상자가
   * 406~1218px 을 차지하는데 화면은 812px 까지다. 그런데 목록 스크롤 영역이 이 상자의 높이를
   * 그대로 물려받아 748px 이었고, 그중 406px(54%)이 화면 아래에 있었다. 끝까지 스크롤해도
   * 마지막 다섯 곳은 y=828~1140 에 놓여 영영 보이지 않았다.
   * 내용 영역 높이를 "화면에 실제로 보이는 만큼"으로 묶는다. y 를 따라가므로 드래그 중에도 맞다.
   */
  const visibleH = useTransform(y, (v) => Math.max(vh - v, 0));

  // 탭(드래그 없이 눌렀다 뗌)일 때 한 단계 펼치는 동작. 손잡이 클릭과 키보드 Enter/Space가
  // 동일한 규칙을 쓰도록 함수로 뽑아둔다. full 에서는 더 펼칠 곳이 없으니 half 로 접는다.
  function advanceOneStep(from: SheetSnap): SheetSnap {
    if (from === "full") return "half";
    const idx = SNAP_ORDER.indexOf(from);
    return SNAP_ORDER[Math.min(idx + 1, SNAP_ORDER.length - 1)];
  }

  function handleDragEnd(_: unknown, info: PanInfo) {
    // [탭과 드래그 구분 — 2026-09-09]
    // 손잡이는 누르기만 해도 dragControls.start 가 호출돼 onDragEnd 까지 이어진다. 이동 거리가
    // 사실상 0이면 "펼치려고 눌렀다"는 의도로 보고 탭 동작(한 단계 펼치기)으로 처리한다.
    if (Math.abs(info.offset.y) < 5) {
      return onSnapChange(advanceOneStep(snap));
    }

    // [스냅 되돌아가기 버그 수정 — 2026-09-09]
    // 예전에는 속도 조건을 만족하면 드래그를 "시작한" 스냅(snap prop)을 기준으로 한 칸만 옮겼다.
    // 그래서 peek 에서 full 근처까지 빠르게 길게 끌어도 반응은 "peek 옆 칸인 half"로만 왔다 —
    // 눈으로는 거의 다 열어놨는데 눈앞에서 도로 반 정도만 열리는 것처럼 보였다. 이제는 손을 뗀
    // 실제 위치(currentY)에서 제일 가까운 스냅을 먼저 찾고, 속도는 그 자리에서 ±1칸만 보정한다.
    const currentY = y.get();
    let closestIdx = 0;
    let minDist = Infinity;
    SNAP_ORDER.forEach((s, i) => {
      const dist = Math.abs(pxFor(s, vh, minTopPx) - currentY);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    });

    const velocity = info.velocity.y;
    if (velocity > 500) closestIdx = Math.max(closestIdx - 1, 0);
    else if (velocity < -500) closestIdx = Math.min(closestIdx + 1, SNAP_ORDER.length - 1);

    onSnapChange(SNAP_ORDER[closestIdx]);
  }

  // [손잡이 키보드 접근성 — 2026-09-09] 화살표로 한 단계씩, Enter/Space 로는 탭과 같은 동작.
  function handleHandleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const idx = SNAP_ORDER.indexOf(snap);
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onSnapChange(SNAP_ORDER[Math.min(idx + 1, SNAP_ORDER.length - 1)]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onSnapChange(SNAP_ORDER[Math.max(idx - 1, 0)]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSnapChange(advanceOneStep(snap));
    }
  }

  /*
   * [전체 확장에서는 모서리를 지운다 — 2026-09-09]
   * full(90%)까지 올라온 시트는 사실상 화면 전체나 다름없는데 위쪽 모서리만 둥글게 남아 있으면
   * "바텀 시트"라는 인상이 계속 남아 어중간해 보인다. 그 상태에서만 각지게 바꿔서 하나의
   * 독립된 화면(페이지)처럼 보이게 한다. peek/half 로 돌아가면 다시 둥글어진다.
   */
  const sheetRadius = snap === "full" ? "rounded-t-none" : "rounded-t-[20px]";

  return (
    <motion.div
      // overflow-hidden 을 여기에 두지 않는다. floatingActions 는 시트 위쪽(bottom:100%)에
      // 놓이므로 여기서 자르면 통째로 사라진다. 둥근 모서리 클리핑은 아래 내용 상자가 맡는다.
      className={`gpu absolute inset-x-0 bottom-0 z-[40] flex flex-col ${sheetRadius} bg-white shadow-[0_-8px_28px_rgba(0,0,0,0.28)] transition-[border-radius] duration-300`}
      style={{ height: "100dvh", y }}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: pxFor("full", vh, minTopPx), bottom: pxFor("peek", vh, minTopPx) }}
      dragElastic={0.15}
      onDragEnd={handleDragEnd}
    >
      {floatingActions && (
        // 버튼 사이 간격으로는 지도를 만질 수 있게 한다(상단 스택과 같은 이유).
        // 껍데기만 터치를 흘려보내고, 버튼 각각이 pointer-events-auto 를 갖는다.
        <div className="pointer-events-none absolute bottom-full right-3.5 mb-[18px] flex flex-col gap-2.5">
          {floatingActions}
        </div>
      )}

      <motion.div
        className={`flex flex-col overflow-hidden ${sheetRadius} transition-[border-radius] duration-300`}
        style={{
          height: visibleH,
          // 홈 인디케이터가 있는 기기에서 목록 마지막 줄이 그 아래로 들어가지 않게 한다.
          // 이 앱은 웹플로우에 iframe 으로 박혀 있어 그 경우엔 0 이지만, Vercel 주소로 직접
          // 열었을 때는 실제로 값이 들어온다.
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* [손잡이] 보이는 막대는 5px 그대로 두되, 손가락이 닿는 영역은 44px 로 넓힌다.
            예전에는 19px 이라 시트를 올리고 내리는 유일한 조작이 계속 빗나갔다.
            role/tabIndex/onKeyDown 은 마우스·터치 없이 키보드만으로도 스냅을 바꿀 수 있게 한다. */}
        <div
          role="button"
          tabIndex={0}
          className="flex flex-shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
          style={{ touchAction: "none", minHeight: 44 }}
          onPointerDown={(e) => dragControls.start(e)}
          onKeyDown={handleHandleKeyDown}
          aria-label={dragHandleLabel}
        >
          <div className="h-[5px] w-9 rounded-full bg-[#DADDEF]" />
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
