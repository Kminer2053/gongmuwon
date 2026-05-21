# GraphRAG Sprint 2 - KORdoc Parser Bridge 계획

작성일: 2026-05-06

## 목표

공공기관 문서에서 중요한 HWP/HWPX 처리를 위해 KORdoc parser bridge 경계를 만든다. 폐쇄망 환경을 고려해 런타임에 npm registry 접근이 필요하지 않은 구조를 목표로 한다.

## 현재 상태

2026-05-06 기준 1차 구현 완료. 실제 KORdoc native parser의 오프라인 vendoring 검증은 후속 작업이다.

## 구현 완료 범위

- [x] `kordoc_bridge.py` 추가
- [x] `KORdocUnavailable`, `KORdocParseError`
- [x] `GONGMU_KORDOC_RUNNER` 기반 runner 해석
- [x] `GONGMU_NODE_EXE` 또는 `node` 기반 Node 실행
- [x] fake runner success contract 테스트
- [x] fake runner failure fallback 테스트
- [x] KORdoc-first parser path
- [x] KORdoc 실패 시 HWPX XML fallback
- [x] parser readiness API
- [x] `POST /api/knowledge/parse-hwp`
- [x] `POST /api/knowledge/parse-hwpx`
- [x] sidecar packaging resource 후보 경로
- [x] desktop UI의 KORdoc readiness 표시

## Runner 계약

```text
node kordoc_runner.js <absolute-file-path>
```

성공 시 normalized JSON을 stdout으로 출력한다.

```json
{
  "success": true,
  "parser": "kordoc",
  "version": "2.x",
  "metadata": {
    "title": "사업계획",
    "document_number": "ABC-123"
  },
  "blocks": [
    {"type": "heading", "text": "사업계획", "level": 1},
    {"type": "paragraph", "text": "본문"},
    {"type": "table", "headers": ["항목"], "rows": [["사업 A"]]}
  ]
}
```

## 검증

최근 검증:

```text
npm.cmd run sidecar:test
116 passed

npm.cmd run desktop:test
18 test files passed, 47 tests passed
```

## 후속 과제

- `kordoc-*.tgz` vendoring
- embedded Node runtime 포함
- 실제 HWP/HWPX 공공문서 품질 검증
- 암호화/손상 문서 fallback chain 강화
- OCR fallback 검토
