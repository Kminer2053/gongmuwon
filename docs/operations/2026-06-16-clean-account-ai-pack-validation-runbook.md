# 클린계정/폐쇄망 AI Pack 설치 검증 런북

작성일: 2026-06-16
최종 갱신: 2026-07-01

## 목적

`로컬 AI에이전트 워크플레이스 : 공무원`을 인터넷이 없는 Windows PC 또는 클린계정에 설치할 때, 앱 본체와 업무엔진, Ollama, `gemma4:e2b` 멀티모달 모델, 기본 LLM 설정이 한 번에 준비되는지 확인한다.

이 문서는 최종 완료 게이트 G11의 운영 증거로 사용한다. 현재 개발 PC에서 자동으로 확인 가능한 항목과, 실제 클린계정/폐쇄망 PC에서만 닫을 수 있는 항목을 분리한다.

## 검증 대상 산출물

- AI Pack zip: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\ai-pack\Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260701-1814.zip`
- AI Pack folder: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\ai-pack\Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260701-1814`
- App installer inside pack: `gongmu\Gongmu_0.1.0_x64-setup.exe`
- Ollama installer inside pack: `ollama\OllamaSetup.exe`
- Python installer inside pack: `python\python-3.11.9-amd64.exe`
- Embedded model: `models\manifests\registry.ollama.ai\library\gemma4\e2b`

## 산출물 동일성

- Zip size: `8,016,705,324 bytes`
- Zip SHA256: `1228032A47ACB02F35098A4D4F5130DFE8708B84B94EA140EC98E52A07A189A9`
- Embedded model blob bytes: `7,162,405,886 bytes`
- Embedded model blob count: `4`

## 개발 PC 자동 검증 결과

실행 명령:

```powershell
node scripts/validate-ai-pack-artifact.mjs --require-zip --min-zip-bytes 1000000 --run-launcher-dry-run --parse-powershell --hash-zip
```

결과:

- `ready: true`
- `START_INSTALL_GUI.bat` dry-run 통과
- `START_INSTALL.bat` dry-run 통과
- `VALIDATE_INSTALL.bat` dry-run 통과
- `COLLECT_EVIDENCE.bat` dry-run 통과
- `RUN_FULL_VALIDATION.bat` dry-run 통과
- `install-gongmu-ai-gui.ps1` PowerShell 문법 검증 통과
- `install-gongmu-ai.ps1` PowerShell 문법 검증 통과
- `validate-gongmu-ai.ps1` PowerShell 문법 검증 통과
- Python 3.11 설치파일 포함 확인
- Ollama 설치파일 포함 확인
- `gemma4:e2b` 모델 저장소 포함 확인
- 앱 NSIS 설치파일 포함 확인

자동 검증 리포트:

- `docs/operations/generated/ai-pack-artifact-validation.json`
- `docs/operations/generated/ai-pack-artifact-validation.md`

## 클린계정/폐쇄망 PC 검증 절차

1. `Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260701-1814.zip`을 대상 PC로 복사한다.
2. 대상 PC에서 zip SHA256을 확인한다.

```powershell
Get-FileHash .\Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260701-1814.zip -Algorithm SHA256
```

기대값:

```text
1228032A47ACB02F35098A4D4F5130DFE8708B84B94EA140EC98E52A07A189A9
```

3. zip을 로컬 폴더에 압축 해제한다.
4. 일반 사용자 권장 경로: 압축 해제 폴더에서 `START_INSTALL_GUI.bat`을 더블클릭한다.
5. 설치 모니터가 현재 단계, 사용자가 닫아야 하는 설치창/앱창, 로그 위치를 안내한다.
6. 클린계정 증거까지 한 번에 남겨야 하는 검증자는 `RUN_FULL_VALIDATION.bat`을 더블클릭한다.
7. GUI 모니터가 열리지 않거나 단계별 확인이 필요하면 `START_INSTALL.bat`, `VALIDATE_INSTALL.bat`, `COLLECT_EVIDENCE.bat`을 순서대로 더블클릭한다.
8. 공무원 앱을 실행한다.
9. 환경설정의 기본 LLM 공급자가 Ollama local profile로 잡혔는지 확인한다.
10. 업무대화에서 짧은 텍스트 질문을 입력한다.
11. 업무대화에서 이미지 1장을 첨부한 뒤 이미지 관련 질문을 입력한다.
12. 앱 종료 후 재실행하여 업무엔진이 자동 시작되는지 확인한다.

## 기대 결과

- Python 3.11이 없으면 설치 안내/설치가 진행된다.
- Ollama가 없으면 `OllamaSetup.exe` 설치가 진행된다.
- `gemma4:e2b` 모델이 인터넷 다운로드 없이 로컬 모델 저장소에서 감지된다.
- 앱 설정 파일에 local Ollama profile이 생성된다.
- `http://127.0.0.1:11434/api/chat` 텍스트 요청이 성공한다.
- `http://127.0.0.1:11434/api/chat` 이미지 요청이 성공한다.
- 공무원 앱의 업무엔진 상태가 정상으로 표시된다.
- 업무대화에서 로컬 LLM 응답이 생성된다.
- `evidence\ai-pack-clean-account-evidence.json`이 생성되고 `ready: true`가 기록된다.
- `evidence\ai-pack-clean-account-evidence.md`가 생성되고 각 점검 항목이 `PASS`로 기록된다.

## 실패 시 수집할 증거

다음 파일 또는 화면을 보관한다.

- `install-gongmu-ai.log`
- `install-gongmu-ai-gui.log`
- `validate-gongmu-ai.log`
- `evidence\collect-clean-account-evidence.log`
- `evidence\ai-pack-clean-account-evidence.json`
- `evidence\ai-pack-clean-account-evidence.md`
- `settings.json`
- `ollama list` 출력
- `Get-Process ollama` 출력
- 앱 화면의 업무엔진 상태 스크린샷
- 업무대화 텍스트 질문/이미지 질문 실패 화면

## 개발 저장소로 증거 반입 후 검증

대상 PC에서 생성된 `evidence` 폴더 전체를 개발 저장소의 아래 inbox 경로로 복사한다. 이 방식이 기본 경로이며, JSON뿐 아니라 설치 로그, 검증 로그, 검토용 Markdown을 함께 보존한다.

```text
release\clean-account-evidence-inbox
```

그 다음 개발 저장소에서 아래 명령을 실행한다.

```powershell
npm.cmd run release:ai-pack:evidence:finalize
```

기대 결과:

- `ready: true`
- 모든 필수 점검 항목 `PASS`
- `docs\operations\generated\clean-account-evidence\` 아래로 evidence 파일과 로그 복사
- `docs\operations\generated\clean-account-evidence-validation.json` 생성
- `docs\operations\generated\clean-account-evidence-validation.md` 생성
- `docs\operations\generated\clean-account-evidence-import.json` 생성
- `verify:completion:preflight`와 `verify:completion:audit` 재실행

검증자가 `ai-pack-clean-account-evidence.json` 파일 하나만 전달한 경우, 또는 압축 해제된 AI pack 루트 폴더 전체를 가져온 경우에는 `--from`에 해당 경로를 직접 지정할 수 있다.

```powershell
node scripts/finalize-clean-account-evidence.mjs --from "D:\받은증거\ai-pack-clean-account-evidence.json"
```

수용 검증만 따로 재실행해야 할 때는 아래 명령을 사용할 수 있다.

```powershell
npm.cmd run release:ai-pack:evidence:validate
```

finalize/import 명령은 `ai-pack-clean-account-evidence.json`, 검토용 Markdown, evidence 수집 로그, 설치 로그, 검증 로그를 `docs\operations\generated\clean-account-evidence\` 아래로 복사한 뒤 즉시 수용 검증을 실행한다. 반입 리포트는 아래 경로에 남는다.

```text
docs\operations\generated\clean-account-evidence-import.json
docs\operations\generated\clean-account-evidence-import.md
```

## 현재 남은 완료 조건

이 문서와 자동 검증 리포트는 산출물 구조, 포함 파일, 런처 문법, dry-run, 해시 동일성을 증명한다. 다만 최종 완료 게이트 G11을 완전히 닫으려면 실제 클린계정 또는 VM에서 `START_INSTALL_GUI.bat` 일반 사용자 경로 또는 `RUN_FULL_VALIDATION.bat` 검증자 경로를 실행한 로그와 `ready: true` 증거가 필요하다. GUI가 어려운 경우 `START_INSTALL.bat`, `VALIDATE_INSTALL.bat`, `COLLECT_EVIDENCE.bat` 단계별 fallback을 사용한다. 반입한 evidence는 반드시 `npm.cmd run release:ai-pack:evidence:import` 또는 `npm.cmd run release:ai-pack:evidence:validate`로 재검증한다.

따라서 현재 상태는 “배포 산출물 준비 및 자동 검증 완료, 클린계정 실사용 증거 대기”로 판정한다.

## 클린계정 증거 요청 폴더 생성

대상 PC 검증자에게 전달할 실행 순서와 반입 경로를 별도 폴더로 생성하려면 개발 저장소에서 아래 명령을 실행한다.

```powershell
npm.cmd run release:ai-pack:evidence:request
```

생성 위치:

```text
release\clean-account-evidence-request
```

생성 파일:

- `README.md`: 대상 PC에서 zip 해시 확인, `START_INSTALL_GUI.bat` 안내형 설치, `RUN_FULL_VALIDATION.bat` 검증자 경로 또는 `START_INSTALL.bat`, `VALIDATE_INSTALL.bat`, `COLLECT_EVIDENCE.bat` 단계별 실행, evidence 반입 순서를 안내한다.
- `REQUEST.json`: 현재 AI pack zip 경로, SHA256, 모델명, 멀티모달/내장 여부, 반입 대상 경로를 기계가 읽을 수 있는 형식으로 기록한다.
- `EXPECTED_SHA256.txt`: 대상 PC에서 `Get-FileHash` 결과와 대조할 zip SHA256을 기록한다.
- `COPY_TARGETS.txt`: 대상 PC에서 생성된 `evidence\ai-pack-clean-account-evidence.json`을 개발 저장소의 어느 경로로 복사해야 하는지 기록한다.

이 요청 폴더는 최종 완료 증거가 아니라 검증 누락을 줄이기 위한 전달물이다. 최종 G11 완료 판정은 대상 PC에서 생성된 evidence JSON을 반입하고 `npm.cmd run release:ai-pack:evidence:validate`가 `ready: true`로 통과해야만 인정한다.
