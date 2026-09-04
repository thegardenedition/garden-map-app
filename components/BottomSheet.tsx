"use client";

import { motion, useAnimation, useDragControls, type PanInfo } from "framer-motion";
import { useEffect, useRef } from "react";
import type { SheetSnap } from "@/lib/types";

// [바텀 시트 물리 엔진]
// Framer Motion의 useAnimation + PanInfo(velocity 포함)로 관성 기반 3단계 스냅을 구현한다.
// 드래그 종료 시 이동 거리뿐 아니라 손가락 속도(velocity.y)까지 반영해, 짧게 튕기듯 드래그해도
// 다음 스냅 포인트로 자연스럽게 이어지도록 한다. 모든 transform은 GPU 레이어(translate3d)에서 처리되어
// 리플로우 없이 60fps를 유지한다.
//
// [드래그 손잡이 전용 트리거] dragListener={false} + useDragControls로, 드래그 제스처는 반드시
// 손잡이(핸들 바)에서 시작된 경우에만 시트를 움직인다. 예전엔 motion.div 전체가 드래그 대상이라,
// 결과 리스트를 스크롤하려고 밀어도 리스트 대신 시트 전체가 끌려 올라왔다 — 네이버 지도처럼
// "손잡이는 시트를 움직이고, 리스트 영역은 리스트가 스크롤된다"로 분리했다.
//
// [1:1 손가락 추적] dragConstraints를 {top:0, bottom:0}(범위가 사실상 없는 값)으로 두면 모든
// 이동이 "제약 범위 밖" 취급되어 dragElastic(0.08 = 8%)이 항상 적용되고, 그래서 손가락을 많이
// 움직여도 시트는 조금만 따라오는 뻑뻑한 느낌이 났다. full~peek 사이의 실제 이동 가능 범위를
// dragConstraints로 정확히 지정해, 그 범위 안에서는 손가락과 1:1로 붙어 움직이고 양 끝에서만
// 살짝 탄성(dragElastic)이 걸리도록 고쳤다.

const SNAP_VH: Record<SheetSnap, number> = { peek: 0.3, half: 0.5, full: 0.9 };

function pxFor(snap: SheetSnap, viewportH: number) {
  return viewportH * (1 - SNAP_VH[snap]);
}

export default function BottomSheet({
  snap,
  onSnapChange,
  children,
  dragHandleLabel,
}: {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  children: React.ReactNode;
  dragHandleLabel?: string;
}) {
  const controls = useAnimation();
  const dragControls = useDragControls();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const vh = window.innerHeight;
    controls.start({ y: pxFor(snap, vh), transition: { type: "spring", damping: 32, stiffness: 300 } });
  }, [snap, controls]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    const vh = window.innerHeight;
    const currentY = pxFor(snap, vh) + info.offset.y;
    const velocity = info.velocity.y;

    const order: SheetSnap[] = ["peek", "half", "full"];
    const idx = order.indexOf(snap);
    if (velocity > 500 && idx > 0) {
      onSnapChange(order[idx - 1]);
      return;
    }
    if (velocity < -500 && idx < order.length - 1) {
      onSnapChange(order[idx + 1]);
      return;
    }

    let closest: SheetSnap = snap;
    let minDist = Infinity;
    for (const s of order) {
      const dist = Math.abs(pxFor(s, vh) - currentY);
      if (dist < minDist) {
        minDist = dist;
        closest = s;
      }
    }
    onSnapChange(closest);
  }

  const vhNow = typeof window !== "undefined" ? window.innerHeight : 800;

  return (
    <motion.div
      ref={containerRef}
      className="gpu absolute inset-x-0 bottom-0 z-[40] flex flex-col overflow-hidden rounded-t-[20px] bg-white shadow-[0_-8px_28px_rgba(0,0,0,0.28)]"
      style={{ height: "100dvh" }}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: pxFor("full", vhNow), bottom: pxFor("peek", vhNow) }}
      dragElastic={0.15}
      onDragEnd={handleDragEnd}
      animate={controls}
      initial={false}
    >
      <div
        className="flex-shrink-0 cursor-grab pt-2.5 pb-1 active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => dragControls.start(e)}
        aria-label={dragHandleLabel}
      >
        <div className="mx-auto h-[5px] w-9 rounded-full bg-[#DADDEF]" />
      </div>
      {children}
    </motion.div>
  );
}
