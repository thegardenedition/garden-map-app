"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오맵 JS SDK는 공식 타입 정의가 없는 전역 스크립트라 any가 불가피하다 */

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { GROUP_LABEL, SUB_DEFS, type GroupId } from "@/lib/types";

// [백엔드] 지도 앱과 완전히 같은 워커를 그대로 쓴다 — lib/api.ts의 WORKER_BASE와 동일한 값.
// 이 페이지는 그 워커의 /custom-pins(GET 공개 조회, POST 등록, PATCH 수정, DELETE 삭제,
// PATCH /custom-pins/__verify__ 로 비밀번호 즉시 검증)만 호출한다.
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

// [ASCII 검사] fetch의 Headers는 ISO-8859-1(라틴-1) 밖의 문자를 헤더 값으로 못 받는다.
// 비밀번호에 한글이나 이모지가 섞여 있으면 X-Admin-Secret 헤더를 만드는 순간
// "String contains non ISO-8859-1 code point" 예외가 떠서 요청 자체가 나가지도 못하고
// 죽는다 — 실제로 대표가 겪은 사고다. 서버에 물어보기 전에 여기서 먼저 걸러 안내한다.
// 공백·제어문자도 막는다 — 앞뒤 공백이 섞이면 헤더 전송은 되지만 값이 달라져 401만 뜨고
// 이유를 알 수 없다(비즈니스 세션 검토 반영, 2026-09-17).
function isAsciiOnly(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- 프린터블 ASCII(0x21~0x7E)만 허용하려는 의도다.
  return /^[\x21-\x7E]*$/.test(value);
}

function PasswordGate({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // [저장 즉시 맞는지 확인] 예전엔 비밀번호를 그냥 저장해 두고, 실제로 핀을 등록해봐야만
  // 틀렸다는 걸 알 수 있었다(양식을 다 채운 뒤에야 401을 보게 됨). 인증이 필요한 가벼운
  // 요청을 하나 미리 보내 그 자리에서 맞음/틀림을 보여준다.
  // [판정 규칙 — 비즈니스 세션 검토로 수정, 2026-09-17] 처음엔 "401만 틀림, 나머지는 다
  // 통과"로 짰는데, 그러면 워커에 시크릿 자체가 빠져 500이 나는 상황도 통과로 잘못 봤다.
  // 워커가 실제로 주는 값은 셋뿐이다 — 키 틀림 401(본문도 안 봄), 키 맞음+빈 본문 400
  // ("바꿀 항목이 없습니다", DB는 안 건드림), 그 외(게이트 403·5xx·네트워크 오류)는 인증
  // 여부를 아예 판단할 수 없는 상황이다. 그래서 400만 "통과"로 좁히고, 나머지(401 제외)는
  // "확인 실패, 잠시 후 다시"로 구분한다.
  async function verifyAndSubmit(candidate: string) {
    if (!isAsciiOnly(candidate)) {
      setError("한글·이모지·공백 등은 서버로 보낼 수 없습니다. 영문·숫자·기호로만, 띄어쓰기 없이 입력해 주세요.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`${WORKER_BASE}/custom-pins/__verify__`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Admin-Secret": candidate },
        body: "{}",
      });
      if (res.status === 401) {
        setError("비밀번호가 올바르지 않습니다.");
        return;
      }
      if (res.status !== 400) {
        setError("확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      onSubmit(candidate);
    } catch {
      setError("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !checking) verifyAndSubmit(value.trim());
        }}
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-[var(--color-deep-blue)] shadow-[0_4px_18px_rgba(0,0,0,0.25)]"
      >
        <p className="tp-title mb-1">가든 핀 등록</p>
        <p className="tp-body mb-4 text-[#5A62A0]">관리자 비밀번호를 입력하세요.</p>
        <input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          autoFocus
          className="tp-body mb-3 w-full rounded-xl bg-[var(--color-secondary-blur)]/10 px-3 py-3 text-[var(--color-deep-blue)] outline-none"
          placeholder="비밀번호"
        />
        {error && (
          <p className="tp-caption mb-3 rounded-xl bg-red-50 px-3 py-2.5 font-bold text-[var(--color-danger)]">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={checking}
          className="tp-cta w-full rounded-xl bg-[var(--color-deep-blue)] py-3 text-[var(--color-neon-yellow)] disabled:opacity-50"
        >
          {checking ? "확인 중..." : "확인"}
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

  // [수정 모드] 새 핀 등록과 같은 폼을 재사용한다 — editingId가 있으면 그 id로 PATCH,
  // 없으면 지금처럼 POST. 폼을 두 벌 만들지 않아도 되고, 사용자 입장에서도 "같은 화면,
  // 채워진 값"이 곧 수정이라는 게 더 직관적이다.
  const [editingId, setEditingId] = useState<string | null>(null);

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

  function resetForm() {
    setEditingId(null);
    setName("");
    setSub("");
    setLat(null);
    setLng(null);
    setAddress("");
    setPhotoUrl("");
    setNote("");
  }

  // [수정 시작] 목록의 값을 그대로 폼에 채운다. 화면 위쪽 폼으로 스크롤해 사용자가
  // "무엇을 고치는 중인지" 바로 보이게 한다.
  function startEdit(p: CustomPinRow) {
    setEditingId(p.id);
    setName(p.name);
    setGroup(p.group_id);
    setSub(p.sub_id ?? "");
    setLat(p.lat);
    setLng(p.lng);
    setAddress(p.address ?? "");
    setPhotoUrl(p.photo_url ?? "");
    setNote(p.note ?? "");
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      // [빈 문자열을 그대로 보낸다 — 비즈니스 세션 검토 반영] 예전엔 비어 있으면 필드
      // 자체를 뺐다(undefined → JSON.stringify가 생략). POST(새로 등록)에서는 어차피
      // 지울 이전 값이 없어 문제가 안 됐지만, PATCH(수정)에서는 "이 필드는 안 바꾼다"는
      // 뜻이 돼버려 주소·사진·메모를 비우고 저장해도 옛 값이 그대로 남는 버그였다.
      // 워커가 빈 문자열을 null로 저장해주므로 그냥 trim한 값을 그대로 보낸다.
      const isEdit = editingId != null;
      const res = await fetch(`${WORKER_BASE}/custom-pins${isEdit ? `/${editingId}` : ""}`, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Secret": secret },
        body: JSON.stringify({
          name: name.trim(),
          group_id: group,
          sub_id: sub,
          lat,
          lng,
          address: address.trim(),
          photo_url: photoUrl.trim(),
          note: note.trim(),
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
      setResult({
        type: "success",
        message: isEdit ? `수정했습니다. (id: ${data.id})` : `등록됐습니다. (id: ${data.id})`,
      });
      resetForm();
      loadRecent();
    } catch (err) {
      setResult({ type: "error", message: err instanceof Error ? err.message : "처리에 실패했습니다." });
    } finally {
      setSubmitting(false);
    }
  }

  // [삭제] 워커는 소프트 삭제(status='deleted')만 한다 — 행 자체는 남고 목록에서만 빠진다.
  // 되돌릴 방법이 있다는 걸 확인창 문구에도 남겨 실수로 지웠을 때 안심할 수 있게 한다.
  async function handleDelete(p: CustomPinRow) {
    if (!secret) return;
    if (!window.confirm(`"${p.name}" 핀을 삭제할까요?\n목록에서만 사라지고 데이터는 남아 복구할 수 있습니다.`)) return;
    setResult(null);
    try {
      const res = await fetch(`${WORKER_BASE}/custom-pins/${p.id}`, {
        method: "DELETE",
        headers: { "X-Admin-Secret": secret },
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
      if (editingId === p.id) resetForm();
      setResult({ type: "success", message: `"${p.name}"을(를) 삭제했습니다.` });
      loadRecent();
    } catch (err) {
      setResult({ type: "error", message: err instanceof Error ? err.message : "삭제에 실패했습니다." });
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
        {editingId && (
          <div className="flex items-center justify-between rounded-xl bg-[var(--color-secondary-blur)]/10 px-3 py-2.5">
            <p className="tp-caption font-bold text-[var(--color-deep-blue)]">이 핀을 수정하는 중입니다</p>
            <button type="button" onClick={resetForm} className="tp-caption font-bold text-[#9AA0C4]">
              취소
            </button>
          </div>
        )}
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
          {submitting ? (editingId ? "수정 중..." : "등록 중...") : editingId ? "수정 저장" : "등록"}
        </button>
      </form>

      {recent.length > 0 && (
        <div className="mt-6">
          <p className="tp-caption mb-2 text-[var(--color-muted)]">최근 등록한 핀 ({recent.length})</p>
          <ul className="flex flex-col gap-2">
            {recent.slice(0, 10).map((p) => (
              <li
                key={p.id}
                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[var(--color-deep-blue)] ${
                  editingId === p.id ? "bg-[var(--color-neon-yellow)]/20 ring-2 ring-[var(--color-deep-blue)]/30" : "bg-white/95"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="tp-body truncate font-bold">{p.name}</p>
                  <p className="tp-caption truncate text-[#9AA0C4]">
                    {GROUP_LABEL[p.group_id]} · {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                    {p.address ? ` · ${p.address}` : ""}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="tp-caption rounded-full bg-[var(--color-secondary-blur)]/10 px-3 py-1.5 font-bold text-[var(--color-deep-blue)]"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p)}
                    className="tp-caption rounded-full bg-red-50 px-3 py-1.5 font-bold text-[var(--color-danger)]"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
