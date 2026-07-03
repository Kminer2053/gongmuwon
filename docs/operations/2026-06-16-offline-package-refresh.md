# 폐쇄망 설치패키지 및 AI 풀팩 갱신 증거

## 목적

G11 `폐쇄망 설치패키지와 clean install 증거` 게이트에 필요한 최신 산출물을 Windows 기준으로 재생성하고, 공무원 프로그램 구동에 필요한 로컬 AI 의존성 준비 상태를 기록한다.

이번 갱신은 두 종류의 산출물을 분리한다.

- 앱 설치 패키지: Gongmu NSIS 설치파일과 오프라인 배포 zip
- AI 풀팩: Python 3.11 감지/선택 설치, Ollama 감지/설치, `gemma4:e2b` 모델 캐시 반입, Gongmu 모델 설정, 텍스트/이미지 입력 검증 배치파일

## 실행 기준

- 기준일: 2026-06-16
- 작업 브랜치: `codex/work-aware-graphrag`
- Windows 개발 환경: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex`

## 실행 명령과 결과

### AI pack 생성기 회귀 테스트

```powershell
node scripts/prepare-ollama-ai-pack.test.mjs
node scripts/package-scripts.test.mjs
node scripts/prepare-offline-release.test.mjs
```

결과:

- `prepare-ollama-ai-pack.test.mjs`: 통과
- `package-scripts.test.mjs`: 통과
- `prepare-offline-release.test.mjs`: 통과

검증 범위:

- AI pack manifest에 Python/Ollama/Gemma 포함 상태가 기록된다.
- `START_INSTALL_GUI.bat`, `START_INSTALL.bat`, `VALIDATE_INSTALL.bat`, `COLLECT_EVIDENCE.bat`, `RUN_FULL_VALIDATION.bat`가 생성된다.
- 설치 PowerShell이 Python 3.11, Ollama, 모델 캐시, Gongmu 설정, 이미지 입력 API 검증 루틴을 포함한다.
- 오프라인 release 생성기는 sidecar bundle freshness gate를 유지한다.

### offline release

```powershell
npm.cmd run release:offline
```

결과:

- package dir: `release/offline/Gongmu_0.1.0_windows_x64_offline_20260616_0940`
- zip: `release/offline/Gongmu_0.1.0_windows_x64_offline_20260616_0940.zip`
- zip size: `310,011,622 bytes`
- zip SHA256: `63B614998E60E3E2D38F2A977085AB8D4BBB8E58E257626663B2C0A293F3F85E`
- installer: `release/offline/Gongmu_0.1.0_windows_x64_offline_20260616_0940/Gongmu_0.1.0_x64-setup.exe`
- installer SHA256: `672F2639E45F758A05E0F28665DD83B0E13927FFBAB60B9D209DBB5BF880DDD8`

### AI 풀팩

```powershell
node scripts/prepare-ollama-ai-pack.mjs `
  --include-models runtime-workspace\cache\ollama-models\gemma4-e2b `
  --include-ollama-installer runtime-workspace\cache\ollama\OllamaSetup.exe `
  --include-python-installer runtime-workspace\cache\python\python-3.11.9-amd64.exe
```

결과:

- package dir: `release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-0941`
- zip: `release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-0941.zip`
- zip size: `8,016,692,659 bytes`
- zip SHA256: `DEF75FF14C2FE99C0DF6AB36ED1E818A3135509D9C69E95BFE3C39525108D293`
- model embedded: `yes`
- Python installer embedded: `yes`

포함 항목:

- `gongmu/`: 최신 offline release 설치파일
- `python/python-3.11.9-amd64.exe`
- `ollama/OllamaSetup.exe`
- `models/`: Ollama `gemma4:e2b` 모델 캐시
- `START_INSTALL_GUI.bat`
- `START_INSTALL.bat`
- `VALIDATE_INSTALL.bat`
- `COLLECT_EVIDENCE.bat`
- `RUN_FULL_VALIDATION.bat`
- `install-gongmu-ai-gui.ps1`
- `install-gongmu-ai.ps1`
- `validate-gongmu-ai.ps1`
- `README.md`
- `THIRD_PARTY_NOTICES.md`
- `SHA256SUMS.txt`

## 내장 의존성 해시

- Python 3.11.9 installer SHA256: `5EE42C4EEE1E6B4464BB23722F90B45303F79442DF63083F05322F1785F5FDDE`
- OllamaSetup.exe SHA256: `C445439B0101F0CC6A3419A4A198353472DBEF22028843E4FC10203EF7352C75`
- Gemma4 E2B model cache: `6 files`, `7,162,407,576 bytes`, 약 `6.671 GB`

## AI 풀팩 동작 구조

`START_INSTALL_GUI.bat`는 일반 사용자를 위한 권장 진입점이다. 내부적으로 `install-gongmu-ai-gui.ps1` 안내형 설치 모니터를 실행해 현재 단계, 사용자 조치, 로그 위치를 화면에 표시한다.

`START_INSTALL.bat`는 GUI 모니터를 사용할 수 없는 환경을 위한 콘솔 fallback 진입점이다. 내부적으로 `install-gongmu-ai.ps1`를 실행한다.

설치 스크립트의 처리 순서:

1. Gongmu NSIS 설치파일이 있으면 실행한다.
2. Python 3.11을 감지한다.
3. Python 3.11이 없고 `python/python-3.11.x-amd64.exe`가 있으면 설치한다.
4. Ollama를 감지한다.
5. Ollama가 없고 `ollama/OllamaSetup.exe`가 있으면 설치한다.
6. `models/`에 포함된 Ollama 모델 캐시를 `%USERPROFILE%\.ollama\models`로 복사한다.
7. Ollama server를 `127.0.0.1:11434`에서 시작한다.
8. `gemma4:e2b` 모델이 Ollama에 등록되어 있는지 확인한다.
9. Gongmu 설정 파일을 Ollama local-first / `gemma4:e2b` 기준으로 쓴다.
10. Ollama `/api/chat`으로 텍스트 응답을 확인한다.
11. Ollama `/api/chat`의 `images` 입력으로 이미지 입력 API 응답을 확인한다.

`VALIDATE_INSTALL.bat`는 설치 후 점검용 진입점이다. 내부적으로 `validate-gongmu-ai.ps1`를 실행한다.

검증 스크립트의 처리 범위:

- Python 3.11 감지
- Ollama 실행파일 감지
- Ollama server `/api/tags` 응답 확인
- `gemma4:e2b` 모델 등록 확인
- Gongmu `settings.json`이 Ollama / `gemma4:e2b`를 가리키는지 확인

`RUN_FULL_VALIDATION.bat`는 설치, 검증, evidence 수집을 한 번에 실행하는 클린계정 검증자용 진입점이다.

## Python 3.11 정책

Gongmu Windows 설치 앱은 PyInstaller로 번들된 업무엔진을 포함하므로 일반 실행에는 시스템 Python이 필수는 아니다. 다만 다음 경우를 위해 Python 3.11 설치 감지와 선택 설치를 AI 풀팩에 포함한다.

- 업무엔진 진단
- 복구 스크립트 실행
- 개발 모드 또는 운영 지원자가 sidecar를 직접 실행해야 하는 상황
- Python 버전 혼선으로 인한 장애 분석

따라서 AI 풀팩 manifest의 `python.requiredForBundledApp`은 `false`이며, 설치 스크립트는 기본적으로 Python 3.11 미감지를 경고로 처리한다. `-RequirePython` 옵션을 주면 Python 3.11 미감지를 실패로 처리할 수 있다.

## 남은 G11 경계

이번 증거로 앱 설치 zip과 AI 풀팩 생성, 의존성 내장, 설치/검증 스크립트 생성은 확인됐다. 다만 G11을 완전 `pass`로 올리려면 다음 증거가 아직 필요하다.

- clean-account 또는 VM에서 일반 사용자 경로인 `START_INSTALL_GUI.bat` 실행
- 검증자 경로인 `RUN_FULL_VALIDATION.bat` 실행 후 evidence ready=true 확보
- 설치된 Gongmu 앱 실행
- 업무엔진 health OK 확인
- Ollama `gemma4:e2b` 텍스트 응답 확인
- 이미지 첨부 입력 응답 확인
- uninstall 후 잔여 파일 목록 확인

따라서 현재 판정은 `partial` 유지가 맞다.
