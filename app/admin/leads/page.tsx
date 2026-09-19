"use client";

import { useCallback, useEffect, useState } from "react";

// [백엔드] mg-biz 워커의 GET/PATCH /leads(어드민)만 호출한다. mg-biz worker.js가 이 페이지
// 주소(https://garden-map-app.vercel.app/admin/leads)를 텔레그램 알림 링크로 이미 하드코딩해
// 두었다(ADMIN_URL 상수) — 그 링크가 실제로 여는 화면이 이 파일이다.
const WORKER_BASE = "https://mg-biz.chgreena.workers.dev";

// app/admin(핀 등록 도구)과 같은 비밀번호를 쓰지만(README: 두 워커 ADMIN_SECRET 통일),
// sessionStorage 키는 분리해 둔다 — 도구가 서로 다르니 한쪽에서 로그아웃해도 다른 쪽에 영향이
// 없어야 한다.
const SECRET_STORAGE_KEY = "mg_leads_admin_secret";

const STATUS_ORDER = ["new", "contacted", "qualified", "matched", "won", "lost", "spam", "self_serve"] as const;
type Status = (typeof STATUS_ORDER)[number];

const STATUS_LABEL: Record<Status, string> = {
  new: "신규",
  contacted: "연락함",
  qualified: "적격",
  matched: "매칭 완료",
  won: "성사",
  lost: "종료(미성사)",
  spam: "스팸",
  self_serve: "셀프 안내",
};
// [매칭 = 채널그린 연동 지점] 대표 지시(2026-09-19) "정원견적은 채널그린과 연동" — 파트너
// 업체(가든디자이너)를 배정하면 이 상태로 바꾼다. mg-biz의 status 설계가 이미 이 흐름을
// 전제하고 있어(new→contacted→qualified→matched→won/lost) 백엔드 변경 없이 화면만 얹는다.
const STATUS_HINT: Record<Status, string> = {
  new: "아직 손대지 않음",
  contacted: "1차 연락 완료",
  qualified: "상담 가능 확인됨",
  matched: "채널그린 파트너(가든디자이너) 배정됨",
  won: "계약 성사",
  lost: "연락 두절·거절 등으로 종료",
  spam: "허위·광고성",
  self_serve: "예산 500만 미만 — 셀프 가이드 안내 대상",
};

const SOURCE_LABEL: Record<string, string> = { map: "지도", article: "기사", project: "프로젝트", chgreen: "채널그린", expo: "박람회" };
const GTYPE_LABEL: Record<string, string> = { house: "주택정원", rooftop: "옥상정원", commercial: "상업공간", open: "오픈스페이스", other: "기타" };
const BUDGET_LABEL: Record<string, string> = {
  under_500: "500만 미만",
  "500_1500": "500~1,500만",
  "1500_4000": "1,500~4,000만",
  over_4000: "4,000만 이상",
};
const TIMING_LABEL: Record<string, string> = { asap: "바로", "1_3m": "1~3개월", "3_6m": "3~6개월", later: "6개월 이후" };

interface Lead {
  id: string;
  created_at: string;
  source: string;
  source_ref: string | null;
  region: string | null;
  gtype: string | null;
  area_m2: number | null;
  budget_band: string | null;
  timing: string | null;
  name: string;
  phone: string;
  email: string | null;
  memo: string | null;
  partner_pref: number;
  status: Status;
  assigned_to: string | null;
}

// app/admin(핀 등록 도구)의 같은 검사와 같은 이유 — fetch Headers는 ISO-8859-1 밖 문자를
// 못 받는다. 비밀번호에 한글·공백이 섞이면 여기서 먼저 걸러 안내한다.
// eslint-disable-next-line no-control-regex -- 프린터블 ASCII(0x21~0x7E)만 허용하려는 의도다.
function isAsciiOnly(value: string): boolean {
  return /^[\x21-\x7E]*$/.test(value);
}

function useAdminSecret() {
  const [secret, setSecretState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSecretState(sessionStorage.getItem(SECRET_STORAGE_KEY));
    setReady(true);
  }, []);

  // [함수를 매 렌더마다 새로 만들지 않는다 — 2026-09-20 무한 루프 사고]
  // useCallback 없이 두면 이 훅을 부르는 컴포넌트가 리렌더될 때마다 setSecret·clearSecret이
  // "새로운" 함수가 된다. 아래 AdminLeadsPage의 load()는 clearSecret을 의존성 배열에
  // 넣는데, 그 값이 매번 바뀌는 것으로 보이니 load 자체도 매번 새로 만들어지고, load를
  // 의존성으로 둔 useEffect가 매 렌더마다 다시 실행돼 서버를 계속 다시 불렀다(실측:
  // 2.5초 만에 54,685회 요청). useCallback으로 묶어 "값이 실제로 바뀔 때만" 새 함수가
  // 되게 하면 이 되풀이가 끊긴다.
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
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // [저장 즉시 맞는지 확인 — app/admin과 같은 이유] mg-biz엔 핀 도구의 __verify__ 같은 전용
  // 확인 엔드포인트가 없다. 대신 실제로 쓸 GET /leads를 가장 가벼운 형태(limit=1)로 그대로
  // 호출한다 — 아무것도 바꾸지 않는 조회라 "확인용으로 한 번 더 부르는" 부담이 없다.
  async function verifyAndSubmit(candidate: string) {
    if (!isAsciiOnly(candidate)) {
      setError("한글·이모지·공백 등은 서버로 보낼 수 없습니다. 영문·숫자·기호로만, 띄어쓰기 없이 입력해 주세요.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`${WORKER_BASE}/leads?limit=1`, {
        headers: { "X-Admin-Secret": candidate },
      });
      if (res.status === 401) {
        setError("비밀번호가 올바르지 않습니다.");
        return;
      }
      if (!res.ok) {
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
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-green-tint)] p-6 text-[var(--color-ink)]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !checking) verifyAndSubmit(value.trim());
        }}
        className="w-full max-w-sm border border-black/5 bg-white p-6 shadow-[0_24px_60px_-32px_rgba(11,83,69,0.25)]"
      >
        <p className="mb-1 text-[20px] font-extrabold tracking-tight">견적 리드 관리</p>
        <p className="mb-4 text-[13px] text-[var(--color-gray-3)]">관리자 비밀번호를 입력하세요. (가든 핀 등록 도구와 같은 비밀번호)</p>
        <input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          autoFocus
          className="mb-3 w-full border border-[var(--color-gray-2)] px-3 py-3 text-[15px] outline-none focus:border-[var(--color-green)]"
          placeholder="비밀번호"
        />
        {error && <p className="mb-3 bg-red-50 px-3 py-2.5 text-[12.5px] font-bold text-[var(--color-danger)]">{error}</p>}
        <button
          type="submit"
          disabled={checking}
          className="w-full bg-[var(--color-green)] py-3 text-[16px] font-bold text-white disabled:opacity-50"
        >
          {checking ? "확인 중..." : "확인"}
        </button>
      </form>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// [정원 정보 한 줄 요약] 리드 목록에서 자주 보는 4개 값(유형·면적·예산·시기)을 필드별로
// 늘어놓으면 카드가 너무 길어진다. 값이 있는 것만 가운뎃점으로 이어 붙인다.
function gardenSummary(l: Lead): string {
  const parts = [
    l.gtype ? GTYPE_LABEL[l.gtype] ?? l.gtype : null,
    l.area_m2 ? `${l.area_m2}㎡` : null,
    l.budget_band ? BUDGET_LABEL[l.budget_band] ?? l.budget_band : null,
    l.timing ? TIMING_LABEL[l.timing] ?? l.timing : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "정원 정보 없음";
}

// [배정 업체 입력 — 별도 컴포넌트] 목록 전체가 리렌더될 때마다 입력 중이던 커서 위치가
// 튀지 않도록, 이 필드만 자기 값을 들고 있다가 포커스를 벗어날 때만 저장한다.
function AssignedToInput({ leadId, value, onSave }: { leadId: string; value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, leadId]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onSave(draft);
      }}
      placeholder="배정 안 함"
      className="w-full border border-[var(--color-gray-2)] px-2.5 py-2 text-[13px] outline-none focus:border-[var(--color-green)]"
    />
  );
}

function LeadCard({ lead, saving, onPatch }: { lead: Lead; saving: boolean; onPatch: (id: string, body: Record<string, unknown>) => void }) {
  return (
    <div className="border border-black/5 bg-white p-4 shadow-[0_10px_28px_-20px_rgba(11,83,69,0.3)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-extrabold">{lead.name}</span>
            <span className="text-[13px] text-[var(--color-gray-1)]">{lead.phone}</span>
            {lead.email && <span className="text-[12px] text-[var(--color-gray-2)]">{lead.email}</span>}
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-gray-2)]">
            {formatDate(lead.created_at)} · {SOURCE_LABEL[lead.source] ?? lead.source}
            {lead.region ? ` · ${lead.region}` : ""}
          </p>
        </div>
        <span className="flex-shrink-0 bg-[var(--color-green-tint)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-green)]">
          업체 {lead.partner_pref}곳 희망
        </span>
      </div>

      <p className="mt-2.5 text-[13px] text-[var(--color-ink)]">{gardenSummary(lead)}</p>

      {lead.memo && <p className="mt-2 whitespace-pre-wrap border-l-2 border-[var(--color-green-tint)] pl-3 text-[13px] leading-relaxed text-[var(--color-gray-3)]">{lead.memo}</p>}

      <div className="mt-3.5 grid grid-cols-1 gap-2.5 border-t border-[var(--color-green-tint)] pt-3.5 sm:grid-cols-[180px_1fr_auto]">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[var(--color-gray-2)]">상태</label>
          <select
            value={lead.status}
            onChange={(e) => onPatch(lead.id, { status: e.target.value })}
            className="w-full border border-[var(--color-gray-2)] bg-white px-2.5 py-2 text-[13px] font-semibold outline-none focus:border-[var(--color-green)]"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-[var(--color-gray-2)]">{STATUS_HINT[lead.status]}</p>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[var(--color-gray-2)]">배정 업체(채널그린 파트너)</label>
          <AssignedToInput leadId={lead.id} value={lead.assigned_to ?? ""} onSave={(v) => onPatch(lead.id, { assigned_to: v })} />
        </div>
        <div className="flex items-end">{saving && <span className="text-[11px] text-[var(--color-gray-2)]">저장 중...</span>}</div>
      </div>
    </div>
  );
}

export default function AdminLeadsPage() {
  const { secret, setSecret, clearSecret, ready } = useAdminSecret();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!secret) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (statusFilter) params.set("status", statusFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      const res = await fetch(`${WORKER_BASE}/leads?${params}`, { headers: { "X-Admin-Secret": secret } });
      if (res.status === 401) {
        setError("비밀번호가 올바르지 않습니다. 다시 로그인해 주세요.");
        clearSecret();
        return;
      }
      if (!res.ok) {
        setError(`목록을 불러오지 못했습니다 (${res.status})`);
        return;
      }
      const data = await res.json();
      setLeads(data.results ?? []);
    } catch {
      setError("서버에 연결하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [secret, statusFilter, sourceFilter, clearSecret]);

  useEffect(() => {
    load();
  }, [load]);

  async function patchLead(id: string, body: Record<string, unknown>) {
    if (!secret) return;
    setSavingId(id);
    // [낙관적 갱신] 응답을 기다리는 동안 목록이 멈춰 보이지 않도록 먼저 화면에 반영하고,
    // 실패하면 되돌린다 — 상태 드롭다운 하나 바꾸자고 전체를 다시 불러올 필요는 없다.
    const prev = leads;
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, ...body } as Lead : l)));
    try {
      const res = await fetch(`${WORKER_BASE}/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Admin-Secret": secret },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setLeads(prev);
        alert("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } catch {
      setLeads(prev);
      alert("서버에 연결하지 못했습니다.");
    } finally {
      setSavingId(null);
    }
  }

  async function exportCsv() {
    if (!secret) return;
    const params = new URLSearchParams({ format: "csv" });
    if (statusFilter) params.set("status", statusFilter);
    if (sourceFilter) params.set("source", sourceFilter);
    try {
      const res = await fetch(`${WORKER_BASE}/leads?${params}`, { headers: { "X-Admin-Secret": secret } });
      if (!res.ok) {
        alert("내려받지 못했습니다.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("서버에 연결하지 못했습니다.");
    }
  }

  if (!ready) return null;
  if (!secret) return <PasswordGate onSubmit={setSecret} />;

  return (
    <div className="min-h-screen bg-[var(--color-green-tint)] text-[var(--color-ink)]">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[20px] font-extrabold tracking-tight">견적 리드 관리</p>
            <p className="mt-1 text-[12.5px] text-[var(--color-gray-3)]">
              지도·기사·프로젝트·채널그린 CTA에서 들어온 견적 요청. 파트너를 배정하면 상태를 &ldquo;매칭 완료&rdquo;로 바꿉니다.
            </p>
          </div>
          <button onClick={clearSecret} className="flex-shrink-0 border border-black/10 px-3 py-1.5 text-[12.5px] text-[var(--color-gray-1)]">
            로그아웃
          </button>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2 border border-black/5 bg-white p-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-[var(--color-gray-2)] px-2.5 py-2 text-[13px] outline-none"
          >
            <option value="">전체 상태</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="border border-[var(--color-gray-2)] px-2.5 py-2 text-[13px] outline-none"
          >
            <option value="">전체 출처</option>
            {Object.entries(SOURCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button onClick={load} disabled={loading} className="border border-[var(--color-gray-2)] px-3 py-2 text-[13px] font-semibold disabled:opacity-50">
            {loading ? "불러오는 중..." : "새로고침"}
          </button>
          <button onClick={exportCsv} className="ml-auto bg-[var(--color-green)] px-3.5 py-2 text-[13px] font-bold text-white">
            CSV 내보내기
          </button>
        </div>

        {error && <p className="mb-4 bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-[var(--color-danger)]">{error}</p>}

        {!loading && !error && leads.length === 0 && (
          <div className="border border-dashed border-[var(--color-gray-2)] bg-white/60 px-4 py-10 text-center text-[13px] text-[var(--color-gray-2)]">
            아직 접수된 견적 요청이 없습니다.
            <br />
            2026-09-23 방침 시행 전까지는 폼이 신청을 받지 않아 목록이 비어 있는 게 정상입니다.
          </div>
        )}

        <div className="flex flex-col gap-3">
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} saving={savingId === lead.id} onPatch={patchLead} />
          ))}
        </div>
      </div>
    </div>
  );
}
