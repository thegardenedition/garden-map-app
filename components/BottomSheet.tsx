"use client";

import { animate, motion, useDragControls, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { useEffect, useState } from "react";
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

  function handleDragEnd(_: unknown, info: PanInfo) {
    const currentY = y.get();
    const velocity = info.velocity.y;

    const order: SheetSnap[] = ["peek", "half", "full"];
    const idx = order.indexOf(snap);
    if (velocity > 500 && idx > 0) return onSnapChange(order[idx - 1]);
    if (velocity < -500 && idx < order.length - 1) return onSnapChange(order[idx + 1]);

    let closest: SheetSnap = snap;
    let minDist = Infinity;
    for (const s of order) {
      const dist = Math.abs(pxFor(s, vh, minTopPx) - currentY);
      if (dist < minDist) {
        minDist = dist;
        closest = s;
      }
    }
    onSnapChange(closest);
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
            예전에는 19px 이라 시트를 올리고 내리는 유일한 조작이 계속 빗나갔다. */}
        <div
          className="flex flex-shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
          style={{ touchAction: "none", minHeight: 44 }}
          onPointerDown={(e) => dragControls.start(e)}
          aria-label={dragHandleLabel}
        >
          <div className="h-[5px] w-9 rounded-full bg-[#DADDEF]" />
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
