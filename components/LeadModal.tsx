"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import Script from "next/script";
import type { Place } from "@/lib/types";

/*
 * [지도 CTA → 리드 폼]
 * "믿을 수 있는 정원전문가 찾기" 버튼이 여는 모달. mg-biz 워커(비즈니스 모델 기획 세션이
 * 소유·배포)의 /leads 엔드포인트로 곧장 접수한다. 계약(필드·동의 문안·Turnstile 사이트키)은
 * 2026-09-16 세션 간 합의로 고정됐다 — 필드를 늘리거나 문구를 바꿀 때는 그쪽 세션과 다시
 * 맞춰야 한다(계약이 어긋나면 서버가 400을 준다).
 */
const LEADS_ENDPOINT = "https://mg-biz.chgreena.workers.dev/leads";
const TURNSTILE_SITE_KEY = "0x4AAAAAAEzXrschn6x6Odo7";
const PRIVACY_POLICY_URL = "https://magazinegreen.co.kr/privacy-policy";

type BudgetBand = "under_500" | "500_1500" | "1500_4000" | "over_4000";
type Timing = "asap" | "1_3m" | "3_6m" | "later";
type GType = "house" | "rooftop" | "commercial" | "open" | "other";

const GTYPE_OPTIONS: { value: GType; label: string }[] = [
  { value: "house", label: "주택정원" },
  { value: "rooftop", label: "옥상/베란다" },
  { value: "commercial", label: "상업공간" },
  { value: "open", label: "공공/오픈스페이스" },
  { value: "other", label: "기타" },
];
const BUDGET_OPTIONS: { value: BudgetBand; label: string }[] = [
  { value: "under_500", label: "500만원 미만" },
  { value: "500_1500", label: "500~1,500만원" },
  { value: "1500_4000", label: "1,500~4,000만원" },
  { value: "over_4000", label: "4,000만원 이상" },
];
const TIMING_OPTIONS: { value: Timing; label: string }[] = [
  { value: "asap", label: "가능한 빨리" },
  { value: "1_3m", label: "1~3개월 내" },
  { value: "3_6m", label: "3~6개월 내" },
  { value: "later", label: "아직 미정" },
];

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const inputClass = "rounded-xl border border-[#F0F1FC] bg-white px-3 py-2.5 text-[14px] text-[#0A0A23] outline-none focus:border-[var(--color-deep-blue)]";
const labelClass = "tp-caption font-bold text-[#5A5A78]";

export default function LeadModal({ place, onClose }: { place: Place; onClose: () => void }) {
  // [document.body로 포탈] 데스크탑 Sidebar는 그냥 스크롤 컨테이너지만, 모바일 BottomSheet는
  // 프레이머 모션 translateY transform이 걸린 조상이다. transform이 걸린 조상은 CSS 스펙상
  // position:fixed 자손의 컨테이닝 블록이 되어 모달이 뷰포트가 아니라 시트 안에 갇힌다 —
  // magazinegreen-projects 라이트박스와 같은 문제, 같은 해법.
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<"form" | "submitting" | "done" | "error">("form");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [partnerPref, setPartnerPref] = useState<1 | 3>(3);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const turnstileTokenRef = useRef<string>("");

  useEffect(() => {
    setMounted(true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // [카카오맵 스크립트와 같은 패턴] MapCanvas.tsx의 setInterval 폴링을 그대로 따른다 —
  // Turnstile 스크립트가 이미 로드돼 있으면(모달 재오픈) 즉시 그리고, 아직이면 로드를 기다린다.
  useEffect(() => {
    let cancelled = false;
    function tryRender() {
      if (cancelled || turnstileWidgetId.current) return;
      if (window.turnstile && turnstileRef.current) {
        turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => {
            turnstileTokenRef.current = token;
          },
          "expired-callback": () => {
            turnstileTokenRef.current = "";
          },
        });
        return;
      }
      setTimeout(tryRender, 250);
    }
    tryRender();
    return () => {
      cancelled = true;
      if (turnstileWidgetId.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;

    const data = new FormData(e.currentTarget);
    // [허니팟] 사람 눈에는 안 보이지만 봇은 채운다 — 값이 있으면 서버가 조용히 저장을 건너뛴다.
    const website = String(data.get("website") || "");
    const name = String(data.get("name") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    const consent = data.get("consent") === "on";
    const consent3rd = data.get("consent_3rd") === "on";

    if (!name || !phone || !consent || !consent3rd) {
      setErrorMsg("이름·연락처와 필수 동의 항목을 확인해주세요.");
      return;
    }
    if (!turnstileTokenRef.current) {
      setErrorMsg("잠시 후 다시 시도해주세요. (보안 확인 준비 중)");
      return;
    }

    setStatus("submitting");
    setErrorMsg(null);

    const payload: Record<string, unknown> = {
      turnstile_token: turnstileTokenRef.current,
      name,
      phone,
      consent: true,
      consent_3rd: true,
      website,
      source: "map",
      source_ref: place.placeId,
      partner_pref: partnerPref,
      consent_news: data.get("consent_news") === "on",
      landing_path: window.location.pathname + window.location.search,
    };
    const email = String(data.get("email") || "").trim();
    if (email) payload.email = email;
    const region = String(data.get("region") || "").trim();
    if (region) payload.region = region;
    const gtype = String(data.get("gtype") || "");
    if (gtype) payload.gtype = gtype;
    const areaRaw = String(data.get("area_m2") || "").trim();
    if (areaRaw) {
      const area = Number(areaRaw);
      if (Number.isFinite(area)) payload.area_m2 = area;
    }
    const budgetBand = String(data.get("budget_band") || "");
    if (budgetBand) payload.budget_band = budgetBand;
    const timing = String(data.get("timing") || "");
    if (timing) payload.timing = timing;
    const memo = String(data.get("memo") || "").trim();
    if (memo) payload.memo = memo;

    const params = new URLSearchParams(window.location.search);
    for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
      const v = params.get(key);
      if (v) payload[key] = v;
    }

    try {
      const res = await fetch(LEADS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        setStatus("done");
      } else {
        setStatus("form");
        setErrorMsg((body && body.error) || "접수 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.");
        if (window.turnstile && turnstileWidgetId.current) window.turnstile.reset(turnstileWidgetId.current);
        turnstileTokenRef.current = "";
      }
    } catch {
      setStatus("form");
      setErrorMsg("네트워크 연결을 확인하고 다시 시도해주세요.");
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="max-h-[92dvh] w-full max-w-[440px] overflow-y-auto rounded-t-[24px] bg-white p-6 sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="tp-title text-[#0A0A23]">믿을 수 있는 정원전문가 찾기</h3>
            <p className="tp-body mt-1 text-[#5A5A78]">{place.placeName} 근처 상담을 채널그린이 연결해드려요.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex-shrink-0 text-[18px] text-[#9AA0C4]">
            ✕
          </button>
        </div>

        {status === "done" ? (
          <div className="py-6 text-center">
            <p className="tp-body text-[#0A0A23]">접수됐습니다. 채널그린 매니저가 1영업일 내 연락드립니다.</p>
            <button
              type="button"
              onClick={onClose}
              className="tp-cta mt-5 w-full rounded-2xl bg-[var(--color-deep-blue)] py-3.5 text-white"
            >
              닫기
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* 허니팟: 실제 이용자에게는 보이지 않는다 */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

            <label className="flex flex-col gap-1">
              <span className={labelClass}>이름 *</span>
              <input name="name" required maxLength={40} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>연락처 *</span>
              <input name="phone" required inputMode="tel" placeholder="010-0000-0000" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>이메일</span>
              <input name="email" type="email" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>지역</span>
              <input name="region" maxLength={20} placeholder="예: 경기" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>정원 유형</span>
              <select name="gtype" defaultValue="" className={inputClass}>
                <option value="">선택 안 함</option>
                {GTYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>면적(㎡)</span>
              <input name="area_m2" type="number" min={0} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>예산대</span>
              <select name="budget_band" defaultValue="" className={inputClass}>
                <option value="">선택 안 함</option>
                {BUDGET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>희망 시기</span>
              <select name="timing" defaultValue="" className={inputClass}>
                <option value="">선택 안 함</option>
                {TIMING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>문의 내용</span>
              <textarea name="memo" maxLength={2000} rows={3} className={inputClass} />
            </label>

            <div ref={turnstileRef} className="my-1" />

            {/* 동의 문안은 약관·방침 개정안 03절 확정 문구를 그대로 옮긴다 — 표현을 바꾸지 않는다. */}
            <label className="flex items-start gap-2 text-[12px] leading-[1.5] text-[#5A5A78]">
              <input type="checkbox" name="consent" required className="mt-0.5 flex-shrink-0" />
              <span>
                [필수] 개인정보 수집·이용 동의 — 항목: 이름·연락처·이메일·지역·정원 유형·면적·예산대·희망 시기·문의
                내용·유입 경로 / 목적: 정원·조경 상담 연결 / 보유: 상담 종료 후 6개월
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12px] leading-[1.5] text-[#5A5A78]">
              <input type="checkbox" name="consent_3rd" required className="mt-0.5 flex-shrink-0" />
              <span>
                [필수] 제3자 제공 동의 — 제공받는 자:{" "}
                <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className="underline">
                  매거진 그린 파트너 업체 목록
                </a>
                에 공개된 업체 중 신청 지역·정원 유형에 맞는 최대 3곳(원하시는 수:{" "}
                <span className="inline-flex items-center gap-2 align-middle">
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      checked={partnerPref === 1}
                      onChange={() => setPartnerPref(1)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    1곳
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      checked={partnerPref === 3}
                      onChange={() => setPartnerPref(3)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    3곳까지
                  </span>
                </span>
                ) — 배정 즉시 업체명을 알려드립니다 / 항목: 위와 같음 / 보유: 상담 종료 후 6개월. 채널그린(회사 운영)
                매니저가 직접 상담하는 단계는 제3자 제공이 아니며, 이후 가든디자이너·파트너 업체에 전달할 때 업체명을
                알려드립니다.
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12px] leading-[1.5] text-[#5A5A78]">
              <input type="checkbox" name="consent_news" className="mt-0.5 flex-shrink-0" />
              <span>[선택] 뉴스레터 「정원에서 보내는 편지」 수신</span>
            </label>

            {errorMsg && <p className="text-[12.5px] text-red-600">{errorMsg}</p>}

            <button
              type="submit"
              disabled={status === "submitting"}
              className="tp-cta mt-1 w-full rounded-2xl bg-[var(--color-neon-yellow)] py-3.5 text-[var(--color-deep-blue)] disabled:opacity-60"
            >
              {status === "submitting" ? "접수 중..." : "상담 신청하기"}
            </button>
            <p className="text-center text-[11px] text-[#9AA0C4]">
              매거진 그린(채널그린)은 통신판매중개자로서 상담·시공 계약의 당사자가 아닙니다.
            </p>
          </form>
        )}
      </motion.div>
    </div>,
    document.body
  );
}
