# AI pack artifact validation

- createdAt: 2026-07-01T09:23:39.310Z
- ready: true
- packageDir: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\ai-pack\Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260701-1814`
- zipPath: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\ai-pack\Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260701-1814.zip`
- zipSizeBytes: 8016705324
- zipSha256: 1228032A47ACB02F35098A4D4F5130DFE8708B84B94EA140EC98E52A07A189A9
- model: gemma4:e2b
- multimodal: true
- embeddedModelStore: true

## 필수 파일

- PASS manifest: `manifest.json`
- PASS readme: `README.md`
- PASS third party notices: `THIRD_PARTY_NOTICES.md`
- PASS sha256 sums: `SHA256SUMS.txt`
- PASS guided monitor launcher: `START_INSTALL_GUI.bat`
- PASS start launcher: `START_INSTALL.bat`
- PASS validate launcher: `VALIDATE_INSTALL.bat`
- PASS evidence launcher: `COLLECT_EVIDENCE.bat`
- PASS full validation launcher: `RUN_FULL_VALIDATION.bat`
- PASS guided monitor script: `install-gongmu-ai-gui.ps1`
- PASS install script: `install-gongmu-ai.ps1`
- PASS validate script: `validate-gongmu-ai.ps1`
- PASS evidence script: `collect-clean-account-evidence.ps1`
- PASS app installer: `gongmu\Gongmu_0.1.0_x64-setup.exe`
- PASS Ollama installer: `ollama/OllamaSetup.exe`
- PASS Python 3.11 installer: `python/python-3.11.9-amd64.exe`
- PASS Gemma model manifest: `models/manifests/registry.ollama.ai/library/gemma4/e2b`

## 모델 저장소

- manifest: PASS
- blobCount: 4
- blobBytes: 7162405886

## 런처/스크립트 검증

- START_INSTALL.bat dry-run: true
- START_INSTALL_GUI.bat dry-run: true
- VALIDATE_INSTALL.bat dry-run: true
- COLLECT_EVIDENCE.bat dry-run: true
- RUN_FULL_VALIDATION.bat dry-run: true
- install-gongmu-ai.ps1 parse: true
- install-gongmu-ai-gui.ps1 parse: true
- validate-gongmu-ai.ps1 parse: true
- collect-clean-account-evidence.ps1 parse: true

## 실패 항목

- 없음


