# CAP 스타일 데모영상 자동 생성 — 숙련도 이식팩

> 새 세션 첫 메시지에 이 문서를 통째로 붙여넣고 "이 앱(URL/리포)으로 기능시연 영상 만들어줘"라고 지시하면 됩니다.
> 검증 실적: AX 플레이그라운드 기능시연 — 씬 0~8 클립 전부 자동 생성 + 최종 합본(`~/Downloads/액플_데모캡처/final/AX_기능시연_합본.mp4`). 사용자 평 "완전 잘 만든다".

당신(Claude)은 **Cap(화면녹화 앱) 없이**, Playwright 헤드리스 브라우저로 실서비스를 직접 조작·녹화하면서 자막·라벨·커서·줌을 코드로 굽고, ffmpeg로 후처리해 Cap 품질의 데모 mp4를 만든다. 아래는 실전에서 완성한 파이프라인 전체다 — 일반 지식보다 이 문서를 우선하라.

---

## 0. 아키텍처 한 장

```
[대상 웹앱 localhost]
   ↓ Playwright(chromium, recordVideo 1920×1080)
   페이지 진입 → DOM에 오버레이 주입(자막바·좌하단 라벨·가짜 커서·body 줌)
   → 대본 시퀀스 실행(커서 이동→클릭, 타이핑 delay, LLM 대기는 waitForFunction으로 감지)
   → ctx.close()로 webm flush
   ↓ ffmpeg
   대기(dead-air) 구간만 6~9배속 압축 → mp4 → 몽타주(tile 3x3)로 눈검증
   → 씬별 클립 완성 → concat 합본 → 특정 시점 프레임 스팟체크
```

핵심 발명 3가지: ① **오버레이를 `document.documentElement`(html) 자식으로** 주입 — body에 zoom(transform)을 걸어도 자막·커서는 안 움직임 ② **가짜 커서**(SVG + CSS transition 0.7s cubic-bezier)로 부드러운 마우스 연출 ③ **LLM 대기 자동 감지**(`waitForFunction`으로 결과 텍스트 출현 감시 + `waitMs` 기록 → 후처리 배속의 근거).

## 1. 사전 준비

- 대상 앱 dev 서버 가동(`curl -s -m 5 -o /dev/null -w "%{http_code}" http://localhost:3000/`으로 확인 — **사용자 서버는 죽이지 말 것**)
- playwright-core 로컬 설치(스크래치에): `npm i playwright-core` + 시스템 Chrome 실행 경로 사용(`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`) — 브라우저 다운로드 불필요
- ffmpeg·ffprobe 설치 확인
- **파일 업로드가 있는 씬**: 채팅 첨부로는 자동화 불가 — 사용자에게 로컬 파일 저장을 요청(예: `~/Downloads/<프로젝트>/safety.png`)
- **대본 먼저**: 씬별 [동작/입력/줌/빨림/자막(밸류프롭)/라벨] 표를 만들어 사용자 승인 후 촬영(참고 양식: `~/Downloads/액플_데모캡처/AX데모_제작가이드.md`의 2장)

## 2. 씬 캡처 스크립트 — 검증된 골격 (그대로 복붙 후 시퀀스만 교체)

```js
// cap_scene.js — Playwright 녹화 + 자막/커서/줌 주입 (실전 검증 원본)
const SCR = process.env.SCR || __dirname;
const { chromium } = require(SCR + '/node_modules/playwright-core');
const fs = require('fs');
const OUT = SCR + '/clips_raw';
fs.mkdirSync(OUT, { recursive: true });
const APP = 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  await page.goto(APP + '/panel/knowledge', { waitUntil: 'networkidle', timeout: 60000 });

  // 오버레이(자막·라벨·커서) — html 자식이라 body 줌에 영향 안 받음
  await page.evaluate(() => {
    const html = document.documentElement;
    const mk = (id) => { const d = document.createElement('div'); d.id = id; html.appendChild(d); return d; };
    mk('__cap'); const lbl = mk('__lbl'); lbl.textContent = '3. AI 지식검색'; mk('__cur');
    const st = document.createElement('style');
    st.textContent = `
      #__cap{position:fixed;left:50%;bottom:54px;transform:translateX(-50%);background:rgba(15,18,28,.85);color:#fff;font:600 30px/1.45 -apple-system,'Apple SD Gothic Neo',sans-serif;padding:16px 34px;border-radius:12px;z-index:2147483646;max-width:80%;text-align:center;opacity:0;transition:opacity .35s;box-shadow:0 8px 28px rgba(0,0,0,.35)}
      #__cap.on{opacity:1}
      #__lbl{position:fixed;left:36px;bottom:36px;background:rgba(37,99,235,.95);color:#fff;font:700 24px -apple-system,sans-serif;padding:9px 18px;border-radius:9px;z-index:2147483646}
      #__cur{position:fixed;left:960px;top:540px;width:28px;height:28px;z-index:2147483647;pointer-events:none;transition:left .7s cubic-bezier(.4,0,.2,1),top .7s cubic-bezier(.4,0,.2,1);background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 2l15 9-7 1 4 8-3 1-4-8-5 5z' fill='black' stroke='white' stroke-width='1.4'/></svg>") no-repeat;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))}
      body{transition:transform .8s cubic-bezier(.4,0,.2,1)}
    `;
    html.appendChild(st);
    window.__cap = (t) => { const c = document.getElementById('__cap'); c.textContent = t; c.classList.add('on'); };
    window.__capOff = () => document.getElementById('__cap').classList.remove('on');
    window.__cur = (x, y) => { const c = document.getElementById('__cur'); c.style.left = (x - 4) + 'px'; c.style.top = (y - 2) + 'px'; };
    window.__zoom = (s, ox, oy) => { document.body.style.transformOrigin = ox + 'px ' + oy + 'px'; document.body.style.transform = 'scale(' + s + ')'; };
    window.__unzoom = () => { document.body.style.transform = 'none'; };
  });

  // 헬퍼: 텍스트로 요소 찾아 중심좌표 / 커서 이동 후 클릭
  const box = async (sel, txt) => page.evaluate(({ sel, txt }) => {
    const el = txt ? [...document.querySelectorAll(sel)].find(x => (x.textContent || '').includes(txt)) : document.querySelector(sel);
    if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { sel, txt });
  const moveClick = async (p) => { if (!p) return; await page.evaluate(({ x, y }) => window.__cur(x, y), p); await sleep(800); await page.mouse.click(p.x, p.y); await sleep(350); };

  // ── 시퀀스(씬마다 이 블록만 교체) — 예: AI 지식검색 ──
  await page.evaluate(() => window.__cap('그래프 RAG로 사규·매뉴얼 등 사내 지식을 쉽게 찾아요')); await sleep(2600);
  await moveClick(await box('button', '심층'));
  const ta = await box('textarea'); if (ta) { await page.evaluate(({ x, y }) => window.__cur(x, y), ta); await sleep(700); await page.mouse.click(ta.x, ta.y); }
  await page.type('textarea', '징계의 종류와 절차, 재심 청구 방법은?', { delay: 55 }); await sleep(800);
  await moveClick(await box('button', 'AI에게 질문'));
  const tSubmit = Date.now();
  await page.evaluate(() => window.__cap('AI가 103개 사규를 근거로 분석 중…'));
  await page.waitForFunction(() => /한계|적용 순서|## 근거/.test(document.body.innerText) && document.body.innerText.length > 1600, { timeout: 120000 });
  const waitMs = Date.now() - tSubmit;   // ← 후처리 배속 구간의 근거
  await sleep(900);
  await page.evaluate(() => window.__cap('요약·근거·적용순서·한계 4단 구조 + 출처 인용')); await sleep(1800);
  await page.mouse.wheel(0, 350); await sleep(1600);
  await page.evaluate(() => { window.__zoom(1.35, document.body.clientWidth * 0.72, 360); }); await sleep(2200);
  await page.evaluate(() => window.__unzoom()); await sleep(900);
  await moveClick(await box('button', '지식그래프'));
  await page.evaluate(() => window.__cap('규정 간 관계·위계를 그래프로 한눈에')); await sleep(2800);
  await page.evaluate(() => window.__capOff()); await sleep(700);

  await ctx.close(); // ★ 비디오 flush — 이거 없으면 webm이 안 나온다
  await browser.close();
  const webm = fs.readdirSync(OUT).filter(f => f.endsWith('.webm')).map(f => OUT + '/' + f).sort();
  console.log(JSON.stringify({ waitMs, webm: webm[webm.length - 1] }));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
```

**여러 씬으로 확장**: 위 파일을 `gen.js`로 만들어 `node gen.js <씬번호>` 인자로 씬별 시퀀스 함수를 디스패치(실전에서 이 구조로 0~8 전부 생성). 시퀀스마다 `waitMs`(배속 구간)와 클립명을 stdout JSON으로.

## 3. ffmpeg 후처리 레시피 (전부 실전 사용)

```bash
# ① 대기(dead-air) 구간만 배속 — waitMs 기준으로 [0,A)는 정속, [A,B)는 9배, [B,끝) 정속
ffmpeg -y -i in.webm -filter_complex "
[0:v]trim=0:${A},setpts=PTS-STARTPTS[v1];
[0:v]trim=${A}:${B},setpts=(PTS-STARTPTS)/9[v2];
[0:v]trim=${B},setpts=PTS-STARTPTS[v3];
[v1][v2][v3]concat=n=3:v=1[v]" -map "[v]" -r 30 -c:v libx264 -pix_fmt yuv420p out.mp4

# ② 품질 눈검증 — 몽타주(항상! 렌더 후 반드시 이걸로 자막·줌·겹침 확인)
ffmpeg -y -i out.mp4 -vf "fps=1/2.5,scale=600:-1,tile=3x3" -frames:v 1 montage.png

# ③ 길이 확인
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 out.mp4

# ④ 합본 — 씬별 편집본 e0.mp4~e9.mp4 목록으로 concat
printf "file 'e0.mp4'\nfile 'e1.mp4'\n..." > list.txt
ffmpeg -y -f concat -safe 0 -i list.txt -c copy 합본.mp4

# ⑤ 합본 스팟체크 — 특정 시점 프레임 뽑아 타일로
for t in 5 60 130 190; do ffmpeg -y -ss $t -i 합본.mp4 -frames:v 1 f_$t.png; done
```

## 4. 검수 루프 (품질의 실체)

1. 씬 1편 생성 → **몽타주로 자체 검증**(자막 위치·라벨·줌 대상·겹침) → 문제 있으면 시퀀스 수정 재생성
2. **PoC 1편을 먼저 사용자에게** 보여주고 승인 후 나머지 전개(실전 관례 — "샘플 보고 판단하세요")
3. 사용자는 초 단위 피드백을 준다("2초경 겹침", "10초 스크린샷 안 보임") — 해당 sleep/줌 좌표를 정확히 수정
4. 합본 후 시점별 프레임 스팟체크 + **사용자가 실제 재생**으로 최종 확인 — 자동 지표만 믿지 말 것

## 5. 함정 목록 (전부 실제로 겪음)

1. `ctx.close()` 전에 browser.close() 하면 webm이 flush 안 됨 — 순서 고정
2. 파일 업로드 자동화는 **로컬 파일 필수**(`page.setInputFiles`) — 채팅 첨부 이미지는 못 씀, 사용자에게 저장 요청
3. `waitUntil:'networkidle'` 없이 goto하면 초기 렌더 중 촬영됨
4. LLM 대기를 고정 sleep으로 하지 말 것 — `waitForFunction`(결과 텍스트 패턴+길이)으로 감지하고 waitMs 기록
5. body 줌(transform)을 쓰므로 오버레이는 반드시 html 직속 — 아니면 자막이 같이 확대됨
6. 대기 구간은 반드시 배속 압축(28초 dead-air → 3초 실증) — 안 하면 지루한 영상
7. 타이핑은 `page.type(sel, text, {delay:55})` — 실시간 입력처럼 보이는 검증값
8. 좌표 클릭 전 커서 이동 후 `sleep(800)` — 시청자가 커서를 따라올 시간

## 6. 톤·연출 표준 (완성본 기준)

- 1920×1080 · 30fps · 씬당 25~45초, 합본 6~7분
- 하단 중앙 자막바: 반투명 남색(rgba(15,18,28,.85)) + 흰 글씨 30px — 씬의 밸류프롭 1문장
- 좌하단 파란 라벨: `N. 기능명`
- 씬 구조: 진입 자막(2.5s) → 핵심 조작(커서 또박또박) → 대기(배속) → 결과 강조(줌 1.35 + 자막 교체) → 페이드
- 씬별 대본·자막 카피 예시는 `~/Downloads/액플_데모캡처/AX데모_제작가이드.md` 2장 참조(액플 10개 씬 완성 대본)

## 7. 산출물 규격

- 씬 클립: `<프로젝트>/clips/N_이름.mp4` / 합본: `<프로젝트>/final/이름_합본.mp4`
- 완성 예시(품질 기준): `~/Downloads/액플_데모캡처/clips/*.mp4`, `final/AX_기능시연_합본.mp4`
