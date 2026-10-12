// 실행: npm test  (Node 내장 시험기, 별도 설치 없음)
import { test } from "node:test";
import assert from "node:assert/strict";
import { approxCount, browseNotice, countMissing, searchNotice } from "./truncation.ts";

test("countMissing: limit 때문에 못 받은 행의 합을 센다", () => {
  // 2026-10-12 실측: 첫 화면 영역에서 조경회사 2147곳 중 500, 자재 955곳 중 500
  assert.equal(countMissing([{ total: 2147, fetched: 500 }, { total: 955, fetched: 500 }]), 1647 + 455);
  // 서울 중심 확대 화면: 조경회사 604곳 중 500, 자재 231곳 전부
  assert.equal(countMissing([{ total: 604, fetched: 500 }, { total: 231, fetched: 231 }]), 104);
});

test("countMissing: 다 받았거나 서버 값이 이상해도 음수·NaN 이 나오지 않는다", () => {
  assert.equal(countMissing([]), 0);
  assert.equal(countMissing([{ total: 40, fetched: 40 }]), 0);
  assert.equal(countMissing([{ total: 10, fetched: 12 }]), 0);
});

test("approxCount: 10 미만은 그대로, 이상은 10 단위", () => {
  assert.equal(approxCount(3), 3);
  assert.equal(approxCount(104), 100);
  assert.equal(approxCount(2102), 2100);
  assert.equal(approxCount(15), 20);
});

test("browseNotice: 못 받은 게 없으면 문구 없음, 있으면 숫자와 확대 안내", () => {
  assert.equal(browseNotice(0), null);
  assert.equal(browseNotice(-5), null);
  assert.equal(browseNotice(Number.NaN), null);
  assert.match(browseNotice(104) ?? "", /약 100곳이 더 있어요/);
  assert.match(browseNotice(104) ?? "", /확대/);
  assert.match(browseNotice(3) ?? "", /몇 곳이 더 있어요/);
  assert.match(browseNotice(2102) ?? "", /약 2,100곳/);
});

test("searchNotice: 숫자 없이 줄이는 방법만 안내", () => {
  assert.equal(searchNotice(0), null);
  const text = searchNotice(50) ?? "";
  assert.match(text, /일부만/);
  assert.doesNotMatch(text, /\d/);
});
