// 2호 라운드 G4(자연어 8문) + W(위키답변 8+1문) + WI-4 무근거/유근거 배터리
// 사용: node verify-g4w.mjs [runs] [outPath]
const BASE = "http://127.0.0.1:8765";
const runs = Number(process.argv[2] || 1);
const outPath = process.argv[3] || "g4w-results.json";

async function ask(query) {
  const r = await fetch(`${BASE}/api/knowledge/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ query, limit: 8 }),
  });
  return await r.json();
}

const includesAny = (text, words) => words.filter((w) => text.toLowerCase().includes(w.toLowerCase()));

// G4 자연어 8문 (release-acceptance-plan.md §3-D 고정 질의셋)
const G4 = [
  { id: "B-01", q: "인사 규정에서 '전보'와 '전직'은 각각 무슨 뜻이야?", kw: ["수평적", "보직변경", "직종을 달리"], min: 2, src: "인사 규정" },
  { id: "B-02", q: "위험성평가는 어떤 종류로 구분해서 실시해?", kw: ["최초평가", "정기평가", "수시평가"], min: 2, src: "위험성평가" },
  { id: "B-03", q: "AI혁신추진단 정기회의에서 클라우드와 LLM 도입은 어느 업체를 우선 접촉하기로 했어?", kw: ["NHN", "우선 접촉"], min: 2, src: "정기회의(2차) 결과보고" },
  { id: "B-04", q: "출장여비에는 어떤 항목이 포함돼?", kw: ["교통비", "일비", "숙박비", "식비"], min: 3, src: "여비지급 세칙" },
  { id: "B-05", q: "공공기관 안전관리등급은 어떤 기준으로 매겨져?", kw: ["공공안전지수", "안전역량", "안전수준", "안전성과"], min: 2, src: "안전관리등급제 운영에 관한 지침" },
  { id: "B-06", q: "우리 부서 2026년 AI 업무계획 핵심 내용 알려줘", kw: ["로드맵", "비전", "AX"], min: 2, src: "" },
  { id: "B-07", q: "감사에서 지적사항이 나오면 어떻게 처리해야 해?", kw: ["시정", "조치", "지적"], min: 2, src: "감사 규정" },
  { id: "B-08", q: "물품이나 용역을 구매하려면 어떤 절차를 거쳐야 해?", kw: ["구매", "조달", "계약"], min: 2, src: "" },
];

// W 고정 8문 (1호 스코어카드 유지) — 판정: citations>=2 + 핵심어 1개 이상
const W = [
  { id: "W-1", q: "안전보건경영시스템이 뭐고 우리가 갖춘 문서는?", kw: ["안전보건"], min: 1 },
  { id: "W-2", q: "제안요청서에 뭘 포함해야 해?", kw: ["제안", "요청"], min: 1 },
  { id: "W-3", q: "AI 업무 추진 계획 핵심 알려줘", kw: ["AI"], min: 1 },
  { id: "W-4", q: "공공안전지수 산출 방법", kw: ["공공안전지수", "PSI"], min: 1 },
  { id: "W-5", q: "사업계획 수립 절차와 핵심 내용은?", kw: ["사업계획"], min: 1 },
  { id: "W-6", q: "직원 교육훈련은 어떻게 운영돼?", kw: ["교육"], min: 1 },
  { id: "W-7", q: "고객만족도 조사는 어떻게 진행해?", kw: ["고객"], min: 1 },
  { id: "W-8", q: "채용 절차가 어떻게 돼?", kw: ["채용", "채용 절차", "면접"], min: 1 },
];

// WI-4 무근거 10문 — 불변식: no_evidence==true 이면 citations==0
const NOEV = [
  "우리 부서 회식 규정 알려줘",
  "사무실 주차장 이용 규정이 어떻게 되나요?",
  "연차휴가 신청 방법 알려줘",
  "구내식당 운영시간은?",
  "경조사비 지급 기준을 정리해줘",
  "야근 식대는 얼마까지 지원돼?",
  "유연근무 신청 절차 알려줘",
  "명함 제작은 어디에 요청해?",
  "출입증 재발급 방법이 뭐야?",
  "동호회 지원금 규정 알려줘",
];

// 유근거 회귀 5문 — citations>=1 유지
const WITHEV = [
  "공공안전지수 산출 방법",
  "위험성평가는 어떤 종류로 구분해?",
  "출장여비 구성 항목 알려줘",
  "인사 규정의 전보 정의가 뭐야?",
  "감사 지적사항 처리 방법",
];

const NO_EVIDENCE_RE = /찾(?:을 수 없|지 못)|(?:알|확인할) 수 없|모(?:르겠|릅니다)|출처\s*:?\s*없음/;

const all = { runs, g4: [], w: [], noev: [], withev: [] };

for (let run = 1; run <= runs; run++) {
  for (const c of G4) {
    const r = await ask(c.q);
    const answer = String(r.answer || "");
    const hits = includesAny(answer, c.kw);
    const srcOk = !c.src || (r.citations || []).some((x) => String(x.source_path || "").includes(c.src));
    all.g4.push({ run, id: c.id, pass: hits.length >= c.min && srcOk, kwHits: hits, srcOk, citations: (r.citations || []).length, answerHead: answer.slice(0, 120) });
    console.error(`run${run} ${c.id}: kw=${hits.length}/${c.min} src=${srcOk}`);
  }
  for (const c of W) {
    const r = await ask(c.q);
    const answer = String(r.answer || "");
    const cit = (r.citations || []).length;
    const hits = includesAny(answer, c.kw);
    const noEv = NO_EVIDENCE_RE.test(answer.slice(0, 200));
    all.w.push({ run, id: c.id, pass: cit >= 2 && hits.length >= c.min && !noEv, citations: cit, kwHits: hits, answerHead: answer.slice(0, 120) });
    console.error(`run${run} ${c.id}: cit=${cit} kw=${hits.length}`);
  }
  for (const q of NOEV) {
    const r = await ask(q);
    const answer = String(r.answer || "");
    const noEv = r.no_evidence === true || NO_EVIDENCE_RE.test(answer.slice(0, 200));
    const cit = (r.citations || []).length;
    const invariantOk = !noEv || cit === 0; // 핵심 불변식
    all.noev.push({ run, q, noEv, citations: cit, invariantOk, flagged: r.no_evidence === true });
    console.error(`run${run} NOEV [${invariantOk ? "OK" : "VIOLATION"}] noEv=${noEv} cit=${cit}`);
  }
  for (const q of WITHEV) {
    const r = await ask(q);
    const cit = (r.citations || []).length;
    all.withev.push({ run, q, pass: cit >= 1 && String(r.answer || "").length > 0, citations: cit });
    console.error(`run${run} WITHEV cit=${cit}`);
  }
}

const count = (arr, f = (x) => x.pass) => `${arr.filter(f).length}/${arr.length}`;
const summary = {
  g4_pass: count(all.g4),
  w_pass: count(all.w),
  noev_invariant_ok: count(all.noev, (x) => x.invariantOk),
  noev_detected: count(all.noev, (x) => x.noEv),
  withev_pass: count(all.withev),
};
all.summary = summary;
await import("node:fs").then((fs) => fs.writeFileSync(outPath, JSON.stringify(all, null, 2)));
console.log(JSON.stringify(summary));
