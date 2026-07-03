# clean-account evidence request validation

- createdAt: 2026-07-03T06:24:43.271Z
- ready: true
- artifactReportPath: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\generated\ai-pack-artifact-validation.json`
- requestPath: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\clean-account-evidence-request\REQUEST.json`

## Checks

- PASS AI pack artifact validation is ready: ready=true
- PASS request is ready: ready=true
- PASS request zip path matches latest AI pack: C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\ai-pack\Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260701-1814.zip
- PASS request zip SHA256 matches latest AI pack: 1228032A47ACB02F35098A4D4F5130DFE8708B84B94EA140EC98E52A07A189A9
- PASS request zip size matches latest AI pack: 8016705324
- PASS request model matches latest AI pack: gemma4:e2b
- PASS request keeps multimodal embedded model flags: multimodal=true; embedded=true
- PASS target PC steps include guided setup monitor: copy AI Pack zip | verify SHA256 | extract zip | run START_INSTALL_GUI.bat for guided setup | run RUN_FULL_VALIDATION.bat | or run START_INSTALL.bat, VALIDATE_INSTALL.bat, COLLECT_EVIDENCE.bat step by step | run COLLECT_RUNTIME_EVIDENCE.bat after launching Gongmu | copy evidence folder back to repository inbox | run release:ai-pack:evidence:finalize
- PASS target PC steps prefer one-click validation: copy AI Pack zip | verify SHA256 | extract zip | run START_INSTALL_GUI.bat for guided setup | run RUN_FULL_VALIDATION.bat | or run START_INSTALL.bat, VALIDATE_INSTALL.bat, COLLECT_EVIDENCE.bat step by step | run COLLECT_RUNTIME_EVIDENCE.bat after launching Gongmu | copy evidence folder back to repository inbox | run release:ai-pack:evidence:finalize
- PASS README mentions guided setup monitor launcher: C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\clean-account-evidence-request\README.md
- PASS README mentions one-click validation launcher: C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\clean-account-evidence-request\README.md
- PASS request points to clean-account evidence inbox: evidence -> release/clean-account-evidence-inbox
- PASS request includes repository finalization command: npm.cmd run release:ai-pack:evidence:finalize
- PASS README keeps finalizer as the single primary repository command: release:runtime-evidence:validate may be mentioned only as a runtime-only fallback or as work performed inside the finalizer
- PASS README has readable Korean operator guidance: README must include readable Korean headings/instructions for target-PC operators and no likely mojibake
- PASS request includes runtime validation command: npm.cmd run release:runtime-evidence:validate
- PASS request includes runtime evidence collector: C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\clean-account-evidence-request\COLLECT_RUNTIME_EVIDENCE.ps1; C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\clean-account-evidence-request\COLLECT_RUNTIME_EVIDENCE.bat; C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\clean-account-evidence-request\runtime-clean-account-evidence.template.json
- PASS runtime evidence template has readable Korean guidance: runtime evidence template must keep Korean check details readable and no likely mojibake

## Errors

- none
