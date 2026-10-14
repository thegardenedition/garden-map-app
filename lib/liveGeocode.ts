// [실시간 주소 → 좌표 변환 — 저장하지 않는다]
// 공공 대장에서 온 업체 중 좌표를 못 빌린 곳(locationState === "pending")은 지도에 핀이 없다.
// 사용자가 그 업체를 눌러 상세를 열었을 때만, 브라우저가 카카오 지도 SDK(services.Geocoder)로
// 주소를 한 번 변환해 임시 핀을 보여 준다. 결과는 열려 있는 상세 화면의 메모리에만 두고
// 어디에도 저장하지 않는다(서버·localStorage·모듈 전역 캐시 없음). 카카오 데브톡 답변은
// 실시간 호출·표시는 허용, 저장은 불가라는 취지이고, 같은 업체를 다시 열면 다시 변환한다.
//
// 순수 로직(주소 다듬기, 상태 해석)은 이 파일에 두고 SDK 는 주입받아 시험할 수 있게 한다.

export type LiveGeocodeResult =
  | { status: "ok"; coordinates: [number, number] } // [lng, lat]
  | { status: "zero" } // 주소로는 찾았으나 결과 없음
  | { status: "error" } // SDK 가 오류를 돌려줌
  | { status: "unavailable" }; // SDK(services)가 없거나 끝내 로드되지 않음

interface AddressSearchItem {
  x: string;
  y: string;
}

// 카카오 SDK 의 Geocoder 중 우리가 쓰는 부분만 좁힌 모양(시험에서 가짜로 바꿔 끼운다).
export interface AddressGeocoder {
  addressSearch(query: string, callback: (result: AddressSearchItem[], status: string) => void): void;
}

const ROAD = /([가-힣0-9]+(?:대로|로|길))\s*(\d+)(?:-(\d+))?/;
const JIBUN = /([가-힣0-9]+(?:동|읍|면|리|가))\s*(?:산\s*)?(\d+)(?:-(\d+))?/;

// 호수·층·건물명·괄호·쉼표 뒤를 잘라 「도로명 번지」 또는 「동 지번」까지만 남긴다.
// 카카오 주소 검색은 건물명이나 호수가 붙으면 결과를 못 주는 경우가 많다.
export function cleanAddressForGeocode(raw: string): string {
  const base = (raw || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/，/g, ",")
    .split(",")[0]
    .replace(/\s+/g, " ")
    .replace(/(대로|로|길)\s+(\d+(?:번)?길)/g, "$1$2") // 「테헤란로 8길 46」→「테헤란로8길 46」
    .trim();
  const road = ROAD.exec(base);
  if (road) return base.slice(0, road.index + road[0].length).trim();
  const jibun = JIBUN.exec(base);
  if (jibun) return base.slice(0, jibun.index + jibun[0].length).trim();
  return base;
}

// 카카오 지도 SDK 의 services 라이브러리에서 Geocoder 를 꺼낸다. 아직 로드 전이면 null.
export function getKakaoGeocoder(): AddressGeocoder | null {
  if (typeof window === "undefined") return null;
  const services = (window as unknown as { kakao?: { maps?: { services?: { Geocoder?: new () => AddressGeocoder } } } }).kakao?.maps
    ?.services;
  return services?.Geocoder ? new services.Geocoder() : null;
}

export async function liveGeocodeAddress(address: string, geocoder: AddressGeocoder | null): Promise<LiveGeocodeResult> {
  if (!geocoder) return { status: "unavailable" };
  const query = cleanAddressForGeocode(address);
  if (!query) return { status: "zero" };
  return new Promise<LiveGeocodeResult>((resolve) => {
    try {
      geocoder.addressSearch(query, (result, status) => {
        if (status === "OK" && result?.length) {
          const lng = Number(result[0].x);
          const lat = Number(result[0].y);
          if (Number.isFinite(lng) && Number.isFinite(lat)) return resolve({ status: "ok", coordinates: [lng, lat] });
        }
        resolve(status === "ERROR" ? { status: "error" } : { status: "zero" });
      });
    } catch {
      resolve({ status: "error" });
    }
  });
}

// 상세 화면에 쓰는 한 줄 안내 문구. 정식 핀이 아닌 위치를 정식처럼 말하지 않는다.
export type LocationNoticeKind = "loading" | "live" | "approx" | "zero" | "error";

export function locationNotice(kind: LocationNoticeKind): string {
  switch (kind) {
    case "loading":
      return "지도 위치를 찾는 중이에요";
    case "live":
      return "주소로 찾은 위치예요. 건물 위치와 조금 다를 수 있어요";
    case "approx":
      return "주소 근처 건물을 기준으로 표시했어요";
    case "zero":
      return "아직 지도에 표시하지 못했어요. 주소는 아래에서 복사할 수 있어요";
    case "error":
      return "지도 위치를 불러오지 못했어요. 주소는 아래에서 복사할 수 있어요";
  }
}
