#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "docs", "user-manual", "assets");
const baseUrl = process.env.GONGMU_MANUAL_URL ?? "http://127.0.0.1:5173";

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

async function clickIfVisible(page, label) {
  const button = page.getByRole("button", { name: label }).first();
  if ((await button.count()) > 0) {
    await button.click();
    await page.waitForTimeout(900);
  }
}

async function screenshot(page, fileName) {
  await page.screenshot({
    path: path.join(outputDir, fileName),
    fullPage: false,
  });
}

async function run() {
  ensureDir(outputDir);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  page.setDefaultTimeout(10_000);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await screenshot(page, "01-gongmu-first-screen.png");

  await clickIfVisible(page, "업무 엔진 상태");
  await screenshot(page, "02-work-engine-status.png");
  await page.keyboard.press("Escape").catch(() => {});

  await clickIfVisible(page, "업무대화");
  await page.getByLabel("업무대화 입력").fill("오늘 해야 할 업무를 정리해줘");
  await screenshot(page, "03-work-chat.png");

  await clickIfVisible(page, "일정");
  await screenshot(page, "04-schedule-calendar.png");

  await clickIfVisible(page, "파일찾기");
  await screenshot(page, "05-file-search.png");

  await clickIfVisible(page, "내 지식폴더");
  await screenshot(page, "06-knowledge-map.png");

  await clickIfVisible(page, "문서작성");
  await screenshot(page, "07-document-authoring.png");

  await clickIfVisible(page, "실행기록");
  await screenshot(page, "08-execution-logs.png");

  await clickIfVisible(page, "기타 환경설정");
  await screenshot(page, "09-settings.png");

  await browser.close();

  const files = fs
    .readdirSync(outputDir)
    .filter((fileName) => fileName.endsWith(".png"))
    .sort();
  console.log(JSON.stringify({ outputDir: path.relative(repoRoot, outputDir), files }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
