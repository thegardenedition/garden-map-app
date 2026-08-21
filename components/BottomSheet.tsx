"use client";

import { motion, useAnimation, type PanInfo } from "framer-motion";
import { useEffect, useRef } from "react";
import type { SheetSnap } from "@/lib/types";

// [바텀 시트 물리 엔진]
// Framer Motion의 useAnimation + PanInfo(velocity 포함)로 관성 기반 3단계 스냅을 구현한다.
// 드래그 종료 시 이동 거리뿐 아니라 손가락 속도(velocity.y)까지 반영해, 짧게 튕기듯 드래그해도
// 다음 스냅 포인트로 자연스럽게 이어지도록 한다. 모든 transform은 GPU 레이어(translate3d)에서 처리되어
// 리플로우 없이 60fps를 유지한다.

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

  return (
    <motion.div
      ref={containerRef}
      className="gpu absolute inset-x-0 bottom-0 z-[40] flex flex-col overflow-hidden rounded-t-[20px] bg-white shadow-[0_-8px_28px_rgba(0,0,0,0.28)]"
      style={{ height: "100dvh", touchAction: "none" }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.08}
      onDragEnd={handleDragEnd}
      animate={controls}
      initial={false}
    >
      <div className="flex-shrink-0 cursor-grab pt-2.5 pb-1 active:cursor-grabbing" aria-label={dragHandleLabel}>
        <div className="mx-auto h-[5px] w-9 rounded-full bg-[#DADDEF]" />
      </div>
      {children}
    </motion.div>
  );
}
