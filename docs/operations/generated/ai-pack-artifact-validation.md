# AI pack artifact validation

- createdAt: 2026-06-16T02:12:49.031Z
- ready: true
- packageDir: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\ai-pack\Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-1046`
- zipPath: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\ai-pack\Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-1046.zip`
- zipSizeBytes: 8016696189
- zipSha256: B8A86027570FA8F7262E403B64AB7BCF23545469ABB0FBBB1C63DAECCC0D75DC
- model: gemma4:e2b
- multimodal: true
- embeddedModelStore: true

## 필수 파일

- PASS manifest: `manifest.json`
- PASS readme: `README.md`
- PASS third party notices: `THIRD_PARTY_NOTICES.md`
- PASS sha256 sums: `SHA256SUMS.txt`
- PASS start launcher: `START_INSTALL.bat`
- PASS validate launcher: `VALIDATE_INSTALL.bat`
- PASS evidence launcher: `COLLECT_EVIDENCE.bat`
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
- VALIDATE_INSTALL.bat dry-run: true
- COLLECT_EVIDENCE.bat dry-run: true
- install-gongmu-ai.ps1 parse: true
- validate-gongmu-ai.ps1 parse: true
- collect-clean-account-evidence.ps1 parse: true

## 실패 항목

- 없음


