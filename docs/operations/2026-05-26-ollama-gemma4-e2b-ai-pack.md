# Ollama + GEMMA4 E2B IT 멀티모달 AI 팩 생성 절차

## 목적

`로컬 AI에이전트 워크플레이스 : 공무원`을 폐쇄망 또는 내부망 PC에서 바로 테스트할 수 있도록 Ollama 로컬 런타임과 `gemma4:e2b` 모델 연결 절차를 한 번에 묶는다.

## 포함 대상

- 공무원 Windows 오프라인 설치파일
- Ollama Windows 설치파일(제작 시 제공한 경우)
- Ollama 모델 캐시 `gemma4:e2b`(제작 PC에 pull되어 있고 `--include-models`로 지정한 경우)
- `install-gongmu-ai.ps1` 원클릭 설정 스크립트
- 라이선스/고지 문서와 SHA256 무결성 목록

## 모델 기준

- 모델명: `gemma4:e2b`
- 표시명: `GEMMA4 E2B IT 멀티모달`
- 연결 방식: Ollama `/api/chat`
- 이미지 입력 확인: `messages[].images` base64 입력으로 멀티모달 API 응답 확인

## 인터넷 가능한 제작 PC에서 모델 포함 팩 만들기

Ollama가 이미 설치되어 있다면 아래처럼 모델을 pull한 뒤 기본 캐시를 포함한다.

```powershell
ollama pull gemma4:e2b
npm.cmd run release:offline
npm.cmd run release:ai-pack -- --include-models "$env:USERPROFILE\.ollama\models" --include-ollama-installer "C:\path\to\OllamaSetup.exe"
```

Ollama가 아직 설치되어 있지 않은 제작 PC에서는 Ollama Registry에서 모델 캐시 형태로 직접 내려받을 수 있다.

```powershell
npm.cmd run release:download:gemma4
npm.cmd run release:offline
npm.cmd run release:ai-pack -- --include-models ".\runtime-workspace\cache\ollama-models\gemma4-e2b" --include-ollama-installer "C:\path\to\OllamaSetup.exe"
```

생성 위치:

```text
release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_YYYYMMDD-HHMM/
release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_YYYYMMDD-HHMM.zip
```

## 폐쇄망 PC에서 설치

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install-gongmu-ai.ps1
```

스크립트가 수행하는 작업:

- 공무원 설치파일 실행
- Ollama 설치파일 실행 또는 기존 설치 감지
- Ollama 서버 시작
- 포함된 모델 캐시를 `%USERPROFILE%\.ollama\models`로 복사
- `gemma4:e2b` 모델 존재 확인
- 공무원 설정파일을 Ollama + `gemma4:e2b` 기준으로 저장
- 텍스트 응답과 이미지 입력 API를 짧게 검증

## 현재 Windows 개발 PC의 주의점

이 세션의 현재 PC에는 `ollama.exe`와 `%USERPROFILE%\.ollama\models` 캐시가 감지되지 않았다. 따라서 Ollama 설치 없이 모델 포함 팩을 만들려면 `npm.cmd run release:download:gemma4`로 Registry 모델 캐시를 먼저 내려받은 뒤 `release:ai-pack`에 `--include-models`를 지정한다.
