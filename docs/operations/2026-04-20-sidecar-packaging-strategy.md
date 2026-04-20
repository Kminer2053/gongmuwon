# 공무 Sidecar 독립 배포 전략

## 목적

Windows 내부망 PC에서 공무 데스크톱과 Python sidecar를 함께 배포할 때, sidecar를 어떤 방식으로 독립 실행 가능하게 묶을지 기준을 고정한다.

## 현재 결론

Alpha 기준 권장안은 `PyInstaller one-folder bundle`이다.

이 선택의 이유는 다음과 같다.

- 현재 sidecar는 `FastAPI + SQLite + LanceDB + NetworkX` 조합이며 Python 런타임 의존이 분명하다.
- `Nuitka`는 성능과 보호 측면에서 장점이 있지만 초기 설정과 디버깅 비용이 더 크다.
- 지금 단계의 목표는 최적화보다 내부망 반입 가능성과 운영 단순성 확보에 있다.
- one-file보다 one-folder가 디버깅, DLL/모델/추가 파일 동봉, 장애 대응에 유리하다.

## 배포 옵션 비교

### 1. PyInstaller one-folder

- 장점
  - 가장 빠르게 안정적인 독립 배포 형태를 만들기 쉽다.
  - Windows 운영자가 폴더 단위로 반입/교체하기 쉽다.
  - sidecar 로그, 추가 데이터, 설정 파일을 함께 다루기 쉽다.
- 단점
  - 산출물 크기가 커질 수 있다.
  - 백신/보안 정책에 따라 예외 확인이 필요할 수 있다.

### 2. PyInstaller one-file

- 장점
  - 배포 파일 수가 적다.
- 단점
  - 실행 시 임시 폴더 해제 비용이 생긴다.
  - 문제 분석과 보안 예외 대응이 더 까다롭다.

### 3. Nuitka

- 장점
  - 성능과 바이너리화 측면에서 더 유리할 수 있다.
- 단점
  - 설정과 빌드 파이프라인이 더 복잡하다.
  - 현재 MVP/Alpha 단계에서는 과한 선택일 가능성이 높다.

## 권장 운영 구조

- 데스크톱 앱: `Tauri bundle`
- sidecar: `PyInstaller one-folder`
- 공통 문서:
  - 오프라인 패키징 런북
  - sidecar 운영 README
  - release manifest

## 산출물 기대 형태

### 데스크톱

- 위치 예시: `apps/desktop/src-tauri/target/release/bundle/`

### sidecar

- 위치 예시: `release/sidecar/windows-x64/gongmu-sidecar/`
- 포함 예상
  - `gongmu-sidecar.exe`
  - Python 런타임 관련 파일
  - 필요한 native dependency
  - 기본 설정 메모

## Windows 실환경에서 확인할 것

1. sidecar 단독 실행 시 `127.0.0.1:8765` 바인딩이 정상인가
2. 데스크톱에서 `사이드카 시작/종료/재시작`이 정상인가
3. 비정상 종료 후 자동 재시작이 1회 동작하는가
4. 로그가 `runtime-workspace/logs/sidecar-runtime.log`에 남는가
5. 외부 네트워크 차단 상태에서도 일정/업무대화/문서작성/지식폴더가 기본 동작하는가

## 현재 상태

- 이 저장소에는 아직 PyInstaller spec과 Windows 빌드 검증 결과가 없다.
- 현재 단계에서는 전략 문서와 Alpha release staging만 준비되어 있다.
- 실제 sidecar 독립 실행 파일 생성 절차는 Windows 빌드 환경에서 다음 단계로 확정한다.

## 다음 단계

1. Windows 빌드 환경에서 PyInstaller spec 초안 생성
2. sidecar one-folder 산출물 생성 및 실행 검증
3. 데스크톱 bundle과 함께 반입 패키지 구조 확정
4. 운영자용 설치 절차를 1페이지 체크리스트로 축약
