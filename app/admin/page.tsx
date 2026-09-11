"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오맵 JS SDK는 공식 타입 정의가 없는 전역 스크립트라 any가 불가피하다 */

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { GROUP_LABEL, SUB_DEFS, type GroupId } from "@/lib/types";

// [백엔드] 지도 앱과 완전히 같은 워커를 그대로 쓴다 — lib/api.ts의 WORKER_BASE와 동일한 값.
// 이 페이지는 그 워커에 이번에 새로 생긴 /custom-pins(GET 공개 조회, POST 관리자 등록)만 호출한다.
const WORKER_BASE = "https://nongsaro-proxy.chgreena.workers.dev";

// components/MapCanvas.tsx가 쓰는 것과 같은 카카오맵 JS 키(클라이언트 전용, 도메인 제한 키라
// 저장소에 이미 그대로 노출돼 있다). 클러스터러는 이 페이지엔 필요 없어 libraries 파라미터는 뺐다.
const KAKAO_JS_KEY = "b6ccb52c66e30ecdb1b781cf75283988";

// 로그인 시스템을 새로 만들지 않고, 이 도구 전용 비밀번호 하나만 세션에 들고 있는다.
// 브라우저 탭을 닫으면 사라진다 — 계속 로그인해 두는 관리자 콘솔이 아니라 가끔 쓰는 등록 도구라
// 이 정도 수명이면 충분하다.
const SECRET_STORAGE_KEY = "gm_admin_secret";

const GROUP_ORDER: GroupId[] = ["company", "material", "park"];

// components/MapCanvas.tsx 초기 중심(지도 전체 보기)과 동일 — 국토 중앙 대략치.
const DEFAULT_CENTER = { lat: 36.2, lng: 127.9 };

declare global {
  interface Window {
    kakao: any;
  }
}

interface CustomPinRow {
  id: string;
  name: string;
  group_id: GroupId;
  sub_id: string | null;
  lat: number;
  lng: number;
  address: string | null;
  photo_url: string | null;
  note: string | null;
  promoted_to_slug: string | null;
}

function useAdminSecret() {
  const [secret, setSecretState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSecretState(sessionStorage.getItem(SECRET_STORAGE_KEY));
    setReady(true);
  }, []);

  const setSecret = useCallback((value: string) => {
    sessionStorage.setItem(SECRET_STORAGE_KEY, value);
    setSecretState(value);
  }, []);

  const clearSecret = useCallback(() => {
    sessionStorage.removeItem(SECRET_STORAGE_KEY);
    setSecretState(null);
  }, []);

  return { secret, setSecret, clearSecret, ready };
}

function PasswordGate({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-[var(--color-deep-blue)] shadow-[0_4px_18px_rgba(0,0,0,0.25)]"
      >
        <p className="tp-title mb-1">가든 핀 등록</p>
        {/* 여기서는 비밀번호를 서버에 확인하지 않는다 — 처음 등록을 시도할 때 워커가 401을
            돌려주면 그때 지우고 다시 물어본다. 이 도구 하나만을 위해 별도 검증 엔드포인트를
            둘 만큼 무거운 기능이 아니다. */}
        <p className="tp-body mb-4 text-[#5A62A0]">관리자 비밀번호를 입력하세요.</p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          className="tp-body mb-3 w-full rounded-xl bg-[var(--color-secondary-blur)]/10 px-3 py-3 text-[var(--color-deep-blue)] outline-none"
          placeholder="비밀번호"
        />
        <button
          type="submit"
          className="tp-cta w-full rounded-xl bg-[var(--color-deep-blue)] py-3 text-[var(--color-neon-yellow)]"
        >
          확인
        </button>
      </form>
    </div>
  );
}

function LocationPicker({
  lat,
  lng,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [sdkReady, setSdkReady] = useState(false);

  // 지도 생성은 한 번만 — SDK가 준비된 시점의 lat/lng(보통 아직 null)로 중심을 잡고,
  // 이후 값 변화는 아래 두 번째 useEffect가 마커만 옮긴다.
  useEffect(() => {
    if (!sdkReady || !mapDivRef.current || mapRef.current || !window.kakao?.maps) return;
    window.kakao.maps.load(() => {
      const kakao = window.kakao;
      if (!mapDivRef.current) return;
      const center = new kakao.maps.LatLng(lat ?? DEFAULT_CENTER.lat, lng ?? DEFAULT_CENTER.lng);
      const map = new kakao.maps.Map(mapDivRef.current, { center, level: lat != null ? 4 : 12 });
      mapRef.current = map;
      if (lat != null && lng != null) {
        markerRef.current = new kakao.maps.Marker({ position: center, map });
      }
      kakao.maps.event.addListener(map, "click", (e: any) => {
        onPick(e.latLng.getLat(), e.latLng.getLng());
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady]);

  // 직접입력·"내 위치 사용"으로 lat/lng가 바뀌면 지도 마커도 따라간다.
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (lat == null || lng == null || !kakao?.maps || !map) return;
    const position = new kakao.maps.LatLng(lat, lng);
    if (markerRef.current) {
      markerRef.current.setPosition(position);
    } else {
      markerRef.current = new kakao.maps.Marker({ position, map });
    }
    map.panTo(position);
  }, [lat, lng]);

  return (
    <>
      <Script
        src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false`}
        strategy="afterInteractive"
        onReady={() => setSdkReady(true)}
      />
      <div ref={mapDivRef} className="h-56 w-full overflow-hidden rounded-xl bg-[var(--color-secondary-blur)]" />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="tp-caption mb-1.5 block text-[#5A62A0]">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "tp-body w-full rounded-xl bg-[var(--color-secondary-blur)]/10 px-3 py-2.5 text-[var(--color-deep-blue)] outline-none placeholder:text-[#B4B8D6]";

export default function AdminPinPage() {
  const { secret, setSecret, clearSecret, ready } = useAdminSecret();

  const [name, setName] = useState("");
  const [group, setGroup] = useState<GroupId>("company");
  const [sub, setSub] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [address, setAddress] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [note, setNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [recent, setRecent] = useState<CustomPinRow[]>([]);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch(`${WORKER_BASE}/custom-pins`);
      const data = await res.json();
      setRecent(data.results ?? []);
    } catch {
      // 최근 등록 목록은 참고용이라, 실패해도 등록 폼 자체는 그대로 쓸 수 있게 둔다.
    }
  }, []);

  useEffect(() => {
    if (secret) loadRecent();
  }, [secret, loadRecent]);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
      },
      () => setResult({ type: "error", message: "위치를 가져오지 못했습니다. 지도를 직접 클릭해 등록해 주세요." }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!secret) return;
    if (!name.trim() || lat == null || lng == null) {
      setResult({ type: "error", message: "이름과 위치(지도 클릭)는 필수입니다." });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`${WORKER_BASE}/custom-pins`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Secret": secret },
        body: JSON.stringify({
          name: name.trim(),
          group_id: group,
          sub_id: sub || undefined,
          lat,
          lng,
          address: address.trim() || undefined,
          photo_url: photoUrl.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      if (res.status === 401) {
        clearSecret();
        setResult({ type: "error", message: "비밀번호가 올바르지 않습니다. 다시 입력해 주세요." });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult({ type: "success", message: `등록됐습니다. (id: ${data.id})` });
      setName("");
      setSub("");
      setLat(null);
      setLng(null);
      setAddress("");
      setPhotoUrl("");
      setNote("");
      loadRecent();
    } catch (err) {
      setResult({ type: "error", message: err instanceof Error ? err.message : "등록에 실패했습니다." });
    } finally {
      setSubmitting(false);
    }
  }

  // sessionStorage는 서버에 없는 값이라, 첫 렌더에서는 항상 비어 있다고 가정해야
  // 클라이언트/서버 렌더 결과가 어긋나는 하이드레이션 오류가 안 난다.
  if (!ready) return null;

  if (!secret) {
    return <PasswordGate onSubmit={setSecret} />;
  }

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="tp-title">가든 핀 등록</p>
          <p className="tp-caption mt-1 text-[var(--color-muted)]">
            지도에 장소를 간단히 등록합니다. 프로젝트 기사로는 남지 않는 &ldquo;간단 핀&rdquo;입니다.
          </p>
        </div>
        <button
          onClick={clearSecret}
          className="tp-caption flex-shrink-0 rounded-full border border-white/25 px-3 py-1.5 text-white/80"
        >
          로그아웃
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-[0_4px_18px_rgba(0,0,0,0.25)]">
        <Field label="이름 *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 동그린 조경"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="분류 *">
            <select
              value={group}
              onChange={(e) => {
                setGroup(e.target.value as GroupId);
                setSub("");
              }}
              className={inputClass}
            >
              {GROUP_ORDER.map((g) => (
                <option key={g} value={g}>
                  {GROUP_LABEL[g]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="세부 분류">
            <select value={sub} onChange={(e) => setSub(e.target.value)} className={inputClass}>
              <option value="">선택 안 함</option>
              {SUB_DEFS[group].map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="위치 * (지도를 클릭해서 지정)">
          <LocationPicker
            lat={lat}
            lng={lng}
            onPick={(newLat, newLng) => {
              setLat(newLat);
              setLng(newLng);
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="tp-caption text-[#9AA0C4]">
              {lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "아직 선택 안 함"}
            </p>
            <button
              type="button"
              onClick={useMyLocation}
              className="tp-caption rounded-full bg-[var(--color-secondary-blur)]/10 px-3 py-1.5 font-bold text-[var(--color-deep-blue)]"
            >
              내 위치 사용
            </button>
          </div>
        </Field>

        <Field label="주소 (선택)">
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="선택 입력" className={inputClass} />
        </Field>

        <Field label="사진 URL (선택)">
          {/* R2 버킷이 아직 이 계정에서 활성화되지 않아 파일 업로드는 다음 단계 작업이다.
              그 전까지는 외부에 이미 올라간 이미지 주소를 붙여넣는 것으로 대신한다. */}
          <input
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="https://... (직접 업로드는 준비 중)"
            className={inputClass}
          />
        </Field>

        <Field label="메모 (선택)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="선택 입력"
            className={inputClass}
          />
        </Field>

        {result && (
          <p
            className={`tp-caption rounded-xl px-3 py-2.5 font-bold ${
              result.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-[var(--color-danger)]"
            }`}
          >
            {result.message}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="tp-cta rounded-xl bg-[var(--color-deep-blue)] py-3 text-[var(--color-neon-yellow)] disabled:opacity-50"
        >
          {submitting ? "등록 중..." : "등록"}
        </button>
      </form>

      {recent.length > 0 && (
        <div className="mt-6">
          <p className="tp-caption mb-2 text-[var(--color-muted)]">최근 등록한 핀 ({recent.length})</p>
          <ul className="flex flex-col gap-2">
            {recent.slice(0, 10).map((p) => (
              <li key={p.id} className="rounded-xl bg-white/95 px-3 py-2.5 text-[var(--color-deep-blue)]">
                <p className="tp-body font-bold">{p.name}</p>
                <p className="tp-caption text-[#9AA0C4]">
                  {GROUP_LABEL[p.group_id]} · {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                  {p.address ? ` · ${p.address}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
