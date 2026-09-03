"use client";

/**
 * ShareButton.tsx
 * ------------------------------------------------------------------
 * 모바일(Android/iOS)에서는 navigator.share가 OS의 공유 시트를 띄우는데,
 * 여기에 카카오톡이 이미 자동으로 포함됩니다(설치되어 있으면). 그래서
 * 카카오 JS SDK를 별도로 붙이지 않아도 "카카오톡 공유"가 됩니다.
 *
 * navigator.share를 지원하지 않는 환경(대부분의 데스크톱 브라우저)에서는
 * 링크를 클립보드에 복사하는 것으로 대체합니다.
 * ------------------------------------------------------------------ */

import { useState } from "react";

export default function ShareButton({
  title,
  text,
  url,
}: {
  /** 공유 카드 제목 (장소명) */
  title: string;
  /** 공유 카드 설명 (주소 등, 선택) */
  text?: string;
  /** 공유할 링크 */
  url: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        // 사용자가 공유 시트를 취소한 경우는 조용히 무시
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("아래 링크를 복사하세요", url);
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label="공유하기"
      className="tp-caption rounded-2xl border-[1.5px] border-[var(--color-deep-blue)] px-4 py-2.5 text-[var(--color-deep-blue)]"
    >
      {copied ? "링크 복사됨" : "공유하기"}
    </button>
  );
}
