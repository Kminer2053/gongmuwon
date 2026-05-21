# User Manual HTML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 처음 설치/이용하는 사용자를 위한 `로컬 AI에이전트 워크플레이스 : 공무원` 사용자 매뉴얼을 실제 앱 스크린샷 기반의 A4 가로 HTML 문서로 제작한다.

**Architecture:** 실제 업무엔진과 데스크톱 React UI를 개발 서버로 기동한 뒤 Playwright로 전체화면 스크린샷을 확보한다. 매뉴얼은 `docs/user-manual/` 아래에 HTML과 이미지 asset을 함께 두고, `@page size: A4 landscape` 및 print media CSS로 출력 품질을 맞춘다.

**Tech Stack:** Tauri/React frontend, Python FastAPI 업무엔진, Playwright screenshot automation, static HTML/CSS.

---

### Task 1: Manual Workspace

**Files:**
- Create: `docs/user-manual/gongmu-user-manual.html`
- Create: `docs/user-manual/assets/*.png`

- [ ] **Step 1: Create screenshot asset directory**

Run: `New-Item -ItemType Directory -Force docs/user-manual/assets`

- [ ] **Step 2: Start app runtime**

Run the sidecar and Vite dev server with hidden PowerShell windows and log files under `runtime-workspace/logs/manual-capture/`.

- [ ] **Step 3: Capture screenshots**

Use Playwright with a 1920x1080 viewport for the shell, chat, schedule, file search, knowledge, documents, settings, and print-cover screens.

### Task 2: HTML Manual

**Files:**
- Create: `docs/user-manual/gongmu-user-manual.html`

- [ ] **Step 1: Write manual content**

Include product purpose, installation, first run, feature overview, workflow, settings, troubleshooting, and support notes for a first-time user.

- [ ] **Step 2: Add print CSS**

Use A4 landscape `@page`, page breaks, readable typography, screenshot frames, and compact tables.

- [ ] **Step 3: Verify output**

Open the HTML through Playwright, capture a screenshot, and generate a PDF render if available.
