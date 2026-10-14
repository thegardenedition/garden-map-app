// 실행: npm test (Node 내장 시험기, 설치 0)
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanAddressForGeocode, liveGeocodeAddress, locationNotice, type AddressGeocoder } from "./liveGeocode.ts";

test("주소에서 호수·층·건물명·괄호를 잘라 번지까지만 남긴다", () => {
  assert.equal(cleanAddressForGeocode("경기도 김포시 사우중로74번길 29 701-27호 (시그마프라자)"), "경기도 김포시 사우중로74번길 29");
  assert.equal(cleanAddressForGeocode("서울특별시 송파구 충민로 66 ,라이프동 제2층 제와이-2122호(문정동,가든파이브라이프)"), "서울특별시 송파구 충민로 66");
  // 번지가 건물명 뒤에 있으면(고잔동 한양빌딩 311-2호) 자르지 못한다 — 이 경우 카카오가 결과를 못 주면 「찾지 못했어요」로 끝난다
  assert.equal(cleanAddressForGeocode("경기 안산시 단원구 고잔동 한양빌딩 311-2호"), "경기 안산시 단원구 고잔동 한양빌딩 311-2호");
});

test("번호길 사이 띄어쓰기를 맞춘다", () => {
  assert.equal(cleanAddressForGeocode("강원특별자치도 인제군 인제읍 인제로 124번길 6"), "강원특별자치도 인제군 인제읍 인제로124번길 6");
});

test("지번 주소는 동 번지까지", () => {
  assert.equal(cleanAddressForGeocode("경기 파주시 문산읍 문산리61-38 아트텔 1205호"), "경기 파주시 문산읍 문산리61-38");
});

test("번지를 못 찾으면 괄호만 걷어 낸 원문", () => {
  assert.equal(cleanAddressForGeocode("경남 양산시 덕계동"), "경남 양산시 덕계동");
});

function fake(status: string, result: { x: string; y: string }[]): AddressGeocoder {
  return { addressSearch: (_q, cb) => cb(result, status) };
}

test("성공하면 [경도, 위도]", async () => {
  const r = await liveGeocodeAddress("서울특별시 송파구 충민로 66", fake("OK", [{ x: "127.1", y: "37.4" }]));
  assert.deepEqual(r, { status: "ok", coordinates: [127.1, 37.4] });
});

test("결과 없음 / 오류 / SDK 없음을 구분한다", async () => {
  assert.deepEqual(await liveGeocodeAddress("서울 중구 세종대로 110", fake("ZERO_RESULT", [])), { status: "zero" });
  assert.deepEqual(await liveGeocodeAddress("서울 중구 세종대로 110", fake("ERROR", [])), { status: "error" });
  assert.deepEqual(await liveGeocodeAddress("서울 중구 세종대로 110", null), { status: "unavailable" });
});

test("SDK 가 예외를 던져도 error 로 끝난다", async () => {
  const bad: AddressGeocoder = {
    addressSearch() {
      throw new Error("boom");
    },
  };
  assert.deepEqual(await liveGeocodeAddress("서울 중구 세종대로 110", bad), { status: "error" });
});

test("좌표가 숫자가 아니면 성공으로 치지 않는다", async () => {
  const r = await liveGeocodeAddress("서울 중구 세종대로 110", fake("OK", [{ x: "abc", y: "37" }]));
  assert.deepEqual(r, { status: "zero" });
});

test("안내 문구는 정식 위치처럼 말하지 않는다", () => {
  assert.match(locationNotice("live"), /조금 다를 수 있어요/);
  assert.match(locationNotice("approx"), /인근 건물 기준/);
});
