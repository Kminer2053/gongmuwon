# 폐쇄망 설치패키지 및 AI Pack 갱신 증거

## 목적

G11 `폐쇄망 설치패키지와 clean install 증거` 게이트 중 현재 HEAD 기준 설치파일, offline release zip, Ollama/Gemma4 E2B IT AI pack 산출물을 갱신했다.

## 실행 시각

- 기준 시각: 2026-06-16 02:12 KST
- 작업 브랜치: `codex/work-aware-graphrag`

## 실행 명령과 결과

### sidecar bundle freshness

```powershell
npm.cmd run sidecar:bundle:freshness
```

결과:

- `status=fresh`
- bundled 업무엔진 manifest가 현재 sidecar source fingerprint와 일치

### bundled sidecar smoke

```powershell
npm.cmd run sidecar:smoke:bundled
```

결과:

- `status=pass`
- bundled 업무엔진 `/health` 응답: `status=ok`
- 지식폴더 2.0 work profile read/save/persist 확인
- GraphRAG backend status 확인
- ChromaDB vector backend 활성 가능 상태 확인

### desktop bundle

```powershell
npm.cmd run desktop:bundle
```

결과:

- PyInstaller sidecar bundle 재생성 성공
- Tauri resource sidecar 동기화 성공
- bundled sidecar smoke 통과
- Vite production build 성공
- Rust/Tauri release build 성공
- NSIS 설치파일 생성 성공

생성 설치파일:

- `apps/desktop/src-tauri/target/release/bundle/nsis/Gongmu_0.1.0_x64-setup.exe`

### NSIS smoke

```powershell
npm.cmd run desktop:smoke:nsis
```

결과:

- 설치 경로: `runtime-workspace/cache/nsis-smoke-install-20260615-170955`
- 업무엔진 workspace: `runtime-workspace/cache/nsis-smoke-workspace-20260615-170955`
- bundled 업무엔진 `/health`: `status=ok`
- uninstall cleanup: `remaining_install_files: []`

### offline release

```powershell
npm.cmd run release:offline
```

결과:

- package dir: `release/offline/Gongmu_0.1.0_windows_x64_offline_20260616_0211`
- zip: `release/offline/Gongmu_0.1.0_windows_x64_offline_20260616_0211.zip`
- installer: `release/offline/Gongmu_0.1.0_windows_x64_offline_20260616_0211/Gongmu_0.1.0_x64-setup.exe`
- installer sha256: `672F2639E45F758A05E0F28665DD83B0E13927FFBAB60B9D209DBB5BF880DDD8`

### AI Pack

```powershell
npm.cmd run release:ai-pack
```

결과:

- package dir: `release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-0209`
- zip: `release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-0209.zip`
- model embedded: `no`

## 판정

현재 HEAD 기준 설치파일, offline release zip, AI pack 스크립트 패키지는 갱신 완료했다. NSIS smoke는 설치, bundled 업무엔진 health, 제거 후 잔여 파일 없음까지 확인했다.

G11은 아래 두 항목 때문에 `partial`을 유지한다.

- 별도 계정 또는 VM에서 GUI install/run/uninstall 증거 갱신 필요
- AI pack에 Gemma 모델 바이너리까지 포함할지, 현재처럼 Ollama 설치/모델 pull 스크립트 패키지로 둘지 최종 출고 정책 확정 필요
