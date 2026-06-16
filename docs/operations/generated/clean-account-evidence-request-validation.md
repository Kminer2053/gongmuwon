# clean-account evidence request validation

- createdAt: 2026-06-16T03:33:01.252Z
- ready: true
- artifactReportPath: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\generated\ai-pack-artifact-validation.json`
- requestPath: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\clean-account-evidence-request\REQUEST.json`

## Checks

- PASS AI pack artifact validation is ready: ready=true
- PASS request is ready: ready=true
- PASS request zip path matches latest AI pack: C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\ai-pack\Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-1213.zip
- PASS request zip SHA256 matches latest AI pack: E0ADF41DD714E5E35F961363B62543C4EC90CB827BFAC6EF9ACDBA2B44EC05B7
- PASS request zip size matches latest AI pack: 8016697130
- PASS request model matches latest AI pack: gemma4:e2b
- PASS request keeps multimodal embedded model flags: multimodal=true; embedded=true
- PASS target PC steps prefer one-click validation: copy AI Pack zip | verify SHA256 | extract zip | run RUN_FULL_VALIDATION.bat | or run START_INSTALL.bat, VALIDATE_INSTALL.bat, COLLECT_EVIDENCE.bat step by step | copy evidence JSON back to repository | run release:ai-pack:evidence:validate
- PASS README mentions one-click validation launcher: C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\clean-account-evidence-request\README.md
- PASS request points to clean-account evidence JSON: evidence\ai-pack-clean-account-evidence.json -> docs/operations/generated/clean-account-evidence/ai-pack-clean-account-evidence.json
- PASS request includes repository validation command: npm.cmd run release:ai-pack:evidence:validate

## Errors

- none
