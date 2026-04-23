# 공무 Alpha 오프라인 패키징 런북

## 목적

공공기관 내부망 Windows PC에 공무 Alpha를 반입할 때 필요한 빌드 산출물, 반입 체크리스트, 운영 메모를 한 문서에 고정한다.

## 기본 원칙

- 기본 동작은 로컬 우선이다.
- 외부 네트워크 의존 없이 설치와 1차 실행이 가능해야 한다.
- `Anything`는 검색 엔진으로 내장하지 않고 외부 실행 연계만 유지한다.
- 위험 작업은 승인형 정책을 유지한다.
- 설치 파일만 배포하지 않고 운영 메모와 기본 경로 정책을 함께 전달한다.

## 산출물 묶음

### 필수

- 데스크톱 번들
  - 명령: `npm run desktop:bundle`
  - 위치: `apps/desktop/src-tauri/target/release/bundle/`
- 검증 증거
  - 명령: `npm run verify:all`
  - 포함 내용: sidecar test, desktop test, desktop build, cargo check
- 운영 런북
  - 이 문서
  - `services/sidecar/README.md`

### 함께 전달할 메모

- 기본 sidecar 바인딩: `127.0.0.1:8765`
- 기본 워크스페이스 루트: `runtime-workspace/`
- 로그 경로: `runtime-workspace/logs/sidecar-runtime.log`
- 외부 연계: `Anything` 실행은 승인 후 외부 열기 방식
- 자동 복구: 관리 중인 sidecar 비정상 종료 시 desktop이 1회 자동 재시작 시도

## 빌드 절차

1. 루트에서 전체 검증을 먼저 통과시킨다.
   - `npm run verify:all`
2. 데스크톱 번들을 생성한다.
   - `npm run desktop:bundle`
3. 산출물 폴더를 확인한다.
   - `apps/desktop/src-tauri/target/release/bundle/`
4. 아래 항목을 함께 묶어 배포 패키지를 만든다.
   - 설치 파일 또는 압축 산출물
   - 버전/커밋 정보
   - 이 런북
   - `services/sidecar/README.md`

## 내부망 반입 체크리스트

- Windows 대상 PC에 WebView2 런타임 정책이 충족되는가
- Python 런타임을 외부에서 새로 받지 않아도 되는 배포 방식인가
- 실행 로그 경로가 사용자 쓰기 가능한 위치인가
- `runtime-workspace/` 생성 권한이 있는가
- `Anything` 설치/실행 경로가 사전 합의되었는가
- 외부 네트워크가 막힌 상태에서도 기본 화면, 일정, 업무대화, 지식폴더, 문서작성이 뜨는가

## 운영 점검 항목

### 첫 실행 직후

- 헤더의 런타임 배지가 정상 상태인지 확인
- `기타 환경설정` 화면에서 경로와 정책 값이 비어 있지 않은지 확인
- `실행기록`에 주요 작업 이력이 쌓이는지 확인

### 장애 대응

- sidecar 미연결:
  - `사이드카 시작` 버튼으로 수동 복구
  - 로그 확인: `runtime-workspace/logs/sidecar-runtime.log`
- sidecar 비정상 종료:
  - desktop이 1회 자동 재시작을 시도
  - 복구 실패 시 수동 재시작 후 로그 확인
- 파일정리/문서저장:
  - 승인 큐 상태 먼저 확인
  - 적용 실패 시 실행기록과 artifact 경로 확인

## 현재 한계

- 이 단계는 오프라인 설치 절차와 운영 기준을 고정한 Alpha 런북이다.
- 실제 기관 배포용 MSI/NSIS 산출물 검증은 Windows 실환경에서 추가 확인이 필요하다.
- Python sidecar를 완전 독립 실행 파일로 묶는 절차는 다음 단계에서 별도 확정한다.

## 다음 단계

1. Windows 실환경에서 `desktop:bundle` 산출물 설치 검증
2. Python sidecar 독립 배포 전략 확정
3. `Anything` 동봉 설치 또는 사전 설치 정책 결정
4. 운영자용 설치 체크리스트를 1페이지 문서로 축약

## 2026-04-23 Operator Addendum

- Primary package refresh command: `npm.cmd run desktop:bundle`
- Primary automated installer proof: `npm.cmd run desktop:smoke:nsis`
- Manual GUI helper: `npm.cmd run desktop:prepare:gui`
- In alpha staging, the sidecar operator note is published as `sidecar-README.md`
- For manual GUI uninstall validation, close the desktop app first and allow any bundled `gongmu-sidecar.exe` process to exit before uninstalling
