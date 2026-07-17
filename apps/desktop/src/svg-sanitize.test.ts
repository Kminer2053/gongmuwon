import { describe, it, expect } from "vitest";
import { sanitizeSvg } from "./screens/DocumentsScreen";

// SEC-4a: rhwp SVG 를 dangerouslySetInnerHTML 로 넣기 전 능동 콘텐츠 제거.
describe("sanitizeSvg", () => {
  it("정상 내용(텍스트·도형)은 보존한다", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="10" height="5"/><text x="3" y="4">보고서 요약</text></svg>',
    );
    expect(out).toContain("보고서 요약");
    expect(out).toContain("<rect");
    expect(out).toContain('width="10"');
  });

  it("<script> 를 제거한다", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__x=1</script><text>ok</text></svg>',
    );
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).toContain("ok");
  });

  it("on* 이벤트 핸들러를 제거한다", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" onclick="steal()" x="0"/></svg>',
    );
    expect(out.toLowerCase()).not.toContain("onload");
    expect(out.toLowerCase()).not.toContain("onclick");
    expect(out).toContain('x="0"');
  });

  it("<foreignObject> 를 제거한다(임의 HTML 삽입 벡터)", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror="alert(1)"></body></foreignObject><text>ok</text></svg>',
    );
    expect(out.toLowerCase()).not.toContain("foreignobject");
    expect(out.toLowerCase()).not.toContain("onerror");
  });

  it("외부 href 참조는 제거하되 data: 이미지와 #조각은 남긴다", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<image xlink:href="https://evil.example/x.png" x="0"/>' +
        '<image xlink:href="data:image/png;base64,AAAA" x="1"/>' +
        '<use xlink:href="#frag"/>' +
        "</svg>",
    );
    expect(out).not.toContain("evil.example");
    expect(out).toContain("data:image/png;base64,AAAA");
    expect(out).toContain("#frag");
  });

  it("javascript: URL 을 제거한다", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>x</text></a></svg>',
    );
    expect(out.toLowerCase()).not.toContain("javascript:");
  });
});
