# Gongmu GraphRAG 업무기억체계 설계서

- 작성일: 2026-05-06
- 대상 기능: 내 지식폴더 고도화
- 기준 환경: Windows, 공공기관 폐쇄망, 로컬 우선
- 현재 구조: Tauri + React Desktop, Python FastAPI sidecar, SQLite, 업무대화 세션 중심

## 1. 목표

Gongmu의 지식폴더는 사용자가 등록한 로컬 업무폴더를 기반으로 문서를 수집하고, 본문과 구조를 추출한 뒤, 업무대화 세션과 연결되는 GraphRAG 기반 업무 기억체계로 발전한다.

최종 목표는 다음과 같다.

```text
지식폴더 등록
-> 하위 문서 자동 수집
-> 본문/구조 추출
-> 공공문서 구조 보존
-> section-aware chunking
-> local embedding
-> vector retrieval
-> ontology mapping
-> 업무 그래프 저장
-> 업무대화 세션 맥락과 병합
-> 자연어 GraphRAG 검색/답변
```

제품 목표는 “공공기관 업무자를 위한 로컬 우선 업무 기억 운영체계”다.

## 2. 핵심 원칙

- 모든 기본 데이터는 로컬에 저장한다.
- 외부 SaaS 업로드는 기본 금지다.
- 폐쇄망 설치와 실행을 지원한다.
- 업무대화 세션을 중심으로 일정, 파일, 지식폴더, 문서작성을 연결한다.
- HWP/HWPX는 단순 텍스트 추출이 아니라 공공문서 구조 보존을 목표로 한다.
- ingestion은 background queue 기반으로 처리해 UI freeze를 막는다.
- 답변에는 반드시 출처 문서와 연결 관계를 표시한다.
- DB 확장보다 인제스트 품질과 provenance를 우선한다.

## 3. 전체 구조

```text
Gongmu Desktop
  -> FastAPI Sidecar
      -> SQLite metadata store
      -> Local file scanner
      -> Document parser chain
      -> Chunking pipeline
      -> Embedding provider
      -> Ontology mapper
      -> SQLite graph mirror
      -> Optional ChromaDB vector backend
      -> Optional KuzuDB graph backend
      -> GraphRAG retrieval / ask
```

현재 SQLite가 정본 메타데이터 저장소다. ChromaDB/KuzuDB는 production backend 후보지만, 설치되지 않아도 SQLite fallback으로 기능이 유지된다.

## 4. 데이터 저장소 역할

### SQLite

SQLite는 Gongmu 업무기억체계의 정본 메타데이터 저장소다.

- 지식 소스 폴더
- 파일 인덱스
- ingestion job 상태
- 문서 메타데이터
- section/chunk/table block
- extraction quality report
- 업무대화 세션 연결
- 실행기록
- SQLite graph mirror
- backend status contract

### ChromaDB

ChromaDB는 semantic retrieval용 production vector backend 후보이다.

- chunk embedding 저장
- semantic query
- source document/section/table provenance 유지

현재는 optional backend로 감지하며, 없으면 SQLite vector fallback을 사용한다.

### KuzuDB

KuzuDB는 graph traversal용 production graph backend 후보이다.

- Document, Chunk, Task, Project, Issue, Policy, Organization, Person, Event 등 노드 저장
- HAS_CHUNK, RELATES_TO, DISCUSSES, REFERENCES, SENT_TO 등 관계 저장
- GraphRAG traversal

현재는 optional backend로 감지하며, 없으면 SQLite graph mirror를 사용한다.

## 5. 핵심 엔티티

- Document
- Chunk
- DocumentSection
- TableBlock
- Task
- Project
- Issue
- Organization
- Department
- Person
- Policy
- Event
- ApprovalLine
- Attachment
- Budget

모든 노드는 최소한 `id`, `node_type`, `label`, `source_document_id`, `confidence`, `metadata`, `created_at`을 가진다.

## 6. 핵심 관계

- Document -> HAS_CHUNK -> Chunk
- Document -> HAS_SECTION -> DocumentSection
- DocumentSection -> HAS_TABLE -> TableBlock
- Document -> RELATES_TO -> Task
- Task -> PART_OF -> Project
- Document -> DISCUSSES -> Issue
- Document -> REFERENCES -> Policy
- Document -> GENERATED_FROM -> Event
- Document -> APPROVED_BY -> Person
- Document -> SENT_TO -> Department
- Document -> ATTACHED -> Attachment
- Document -> HAS_BUDGET -> Budget

## 7. 문서 처리 파이프라인

```text
파일 감지
-> scan 결과 저장
-> ingestion job 생성
-> 포맷 판별
-> parser chain 실행
-> structured document 생성
-> extraction quality report 생성
-> section-aware chunk 생성
-> table-specific chunk 생성
-> embedding 생성
-> ontology mapping
-> graph mirror 저장
-> retrieval index 반영
```

현재 지원 포맷:

- TXT
- MD
- DOCX
- XLSX
- PPTX
- PDF
- HWPX XML fallback
- HWP/HWPX KORdoc bridge contract

## 8. HWP/HWPX 처리 전략

HWP/HWPX 처리는 KORdoc 기반 parser를 우선 사용하는 구조를 목표로 한다.

```text
Python Sidecar
-> subprocess
-> Node runner
-> KORdoc parser
-> normalized JSON
-> StructuredDocument
```

Fallback chain:

1. KORdoc native parsing
2. HWPX ZIP/XML local fallback
3. metadata-only fallback
4. 향후 OCR fallback

공공문서에서 반드시 보존해야 하는 요소:

- 제목
- 섹션
- 문단
- 표
- 결재선
- 붙임
- 수신/참조
- 시행문 정보
- 문서번호
- 조직명
- 시행일자
- 보안등급

## 9. Structured Document Model

```text
Document
  -> Section
      -> Heading
      -> Paragraph
      -> Table
      -> Attachment
```

표는 flatten하지 않는다. 반드시 structured JSON으로 보존한다.

```json
{
  "type": "table",
  "headers": ["항목", "예산", "비고"],
  "rows": [["시스템 개선", "30,000천원", "신규"]]
}
```

Retrieval을 위해 표는 별도 table-specific chunk로도 저장한다.

## 10. Chunking 전략

일반 paragraph 단위 chunking만 사용하지 않는다. 공공문서에서 의미가 유지되는 section-aware chunking을 기본으로 한다.

우선 단위:

- 추진배경
- 추진목적
- 세부추진계획
- 예산
- 추진일정
- 기대효과
- 붙임

표는 section chunk와 별도로 `표: <section heading>` chunk를 생성한다. 표 내부 값으로 검색하면 table evidence가 citation 우선 근거가 되도록 ranking boost를 적용한다.

## 11. Extraction Quality Gate

GraphRAG 품질은 저장량이 아니라 “질 좋은 chunk와 관계가 들어갔는지”로 판단한다.

문서별 quality report:

- parser name/version
- score
- section count
- paragraph count
- table count
- text char count
- metadata field count
- partial extraction 여부
- warnings

대표 warning:

- `partial_extraction`
- `low_text`
- `no_sections`
- `no_structured_tables`
- `low_quality_score`

UI는 문서 목록, 구조 상세, grounded answer citation에서 품질 경고를 보여준다.

## 12. Ontology Mapping

초기 ontology mapper는 deterministic rule 기반이다. LLM 기반 entity extraction은 품질 게이트가 안정된 뒤 추가한다.

현재 매핑 대상:

- 업무
- 사업
- 과제
- 프로젝트
- 이슈
- 정책
- 조직
- 부서
- 담당자
- 수신/참조
- 예산/금액
- 기간/일정
- 붙임/첨부

공공문서 alias 예:

- `사업`, `사업명`
- `업무`, `업무명`
- `이슈`, `현안`
- `정책`, `근거법령`
- `담당자`, `담당`
- `부서`, `소관부서`
- `예산`, `금액`, `소요예산`, `사업비`
- `기간`, `추진기간`, `사업기간`
- `붙임`, `첨부`, `첨부파일`

## 13. Retrieval 구조

```text
질문
-> query token 분석
-> chunk text score
-> vector similarity score
-> graph term score
-> active work-session file boost
-> table evidence boost
-> reranking
-> citations 생성
-> grounded answer 생성
```

현재 `/api/knowledge/retrieve`는 다음 신호를 결합한다.

- 텍스트 포함/토큰 겹침
- embedding cosine similarity
- 문서에 연결된 ontology label
- 업무대화 세션에 연결된 파일 경로
- table evidence boost

`/api/knowledge/ask`는 deterministic extractive grounded answer를 생성하고, citation과 retrieval summary를 반환한다.

## 14. Citation 계약

GraphRAG 답변 citation은 최소한 다음 정보를 가진다.

- document id
- title
- file path
- chunk id
- parser name
- quality score
- partial 여부
- evidence type: `section` 또는 `table`
- quality warnings
- score breakdown
- relations

Ask 결과 summary:

- source count
- table evidence count
- partial count
- low-quality count
- relation count

## 15. 업무대화 세션 통합

업무대화 세션은 Gongmu의 작업 중심축이다.

세션 맥락:

- 대화 내용
- 연결 일정
- 연결 파일
- 연결 지식폴더 문서
- 실행기록
- 문서작성 산출물

GraphRAG retrieve/ask는 `session_id`를 받을 수 있고, 해당 세션에 연결된 파일은 retrieval ranking에서 boost된다.

## 16. UX 목표

지식폴더 화면은 상세 데이터 나열보다 “현재 지식체계가 한눈에 들어오는 그래프”를 우선한다.

현재 UX:

- 상단 지식 그래프 미리보기
- 그래프 스크롤/확장
- 노드 클릭 기반 관계 보기
- 검색어 기반 관계 보기
- 관련 문서 표시
- 관련 문서 section/table drill-down
- grounded answer 및 citations 표시
- active vector/graph backend 표시
- KORdoc readiness 표시
- ingestion job 처리 시간 표시

후속 UX:

- 관계 편집
- 노드 병합/별칭 관리
- force-directed graph layout
- 고급 table/section viewer
- 그래프 탐색 히스토리

## 17. 폐쇄망 대응

기본 원칙:

- 인터넷 없이 동작
- npm registry 런타임 접근 불필요
- 모든 기본 데이터 로컬 저장
- 외부 업로드 금지 기본값
- local embedding/LLM endpoint 분리
- KORdoc runner와 Node runtime은 배포 리소스로 vendoring 가능하게 설계

현재 KORdoc은 bridge contract와 runner readiness가 준비되어 있으며, 실제 오프라인 패키징에서 `kordoc-*.tgz`와 embedded Node runtime 포함 검증이 남아 있다.

## 18. 현재 구현 상태

2026-05-06 기준 완료:

- Sprint 1 ingestion foundation
- Sprint 2 KORdoc bridge boundary 및 HWPX fallback
- Sprint 3 ontology graph mirror
- Sprint 4 hybrid retrieval 및 ask
- Sprint 5 graph UX 기본 고도화
- GraphRAG ingestion quality gate
- PDF/DOCX/HWPX/Markdown fixture regression
- backend contract/offline fallback status
- ingestion runtime metrics

최근 검증:

```text
npm.cmd run sidecar:test
116 passed

npm.cmd run desktop:test
18 test files passed, 47 tests passed

node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
Finished dev profile
```

## 19. 남은 고도화 과제

- ChromaDB/KuzuDB production adapter 실제 구현 및 오프라인 번들 검증
- KORdoc native parser 실제 문서 품질 검증
- HWP/HWPX 깨진 문서 fallback chain 강화
- OCR fallback 검토
- 대량 폴더 ingestion 성능 측정
- incremental scan 및 변경 감지 자동화
- LLM 기반 entity extraction과 rule 기반 extraction 비교 평가
- GraphRAG answer를 LLM 합성 답변으로 확장하되 citation과 quality warning 유지
- 사용자 수정 가능한 ontology/alias 관리 UI
- Obsidian 호환 Markdown vault export/import
