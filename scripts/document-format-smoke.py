from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from gongmu_sidecar.app import create_app


FORMATS = ("officialMemo", "onePageReport", "fullReport", "email")
CORE_PROBES = ("Lighting First", "Camera Reality", "Skin Texture", "Life Motion", "후속")


def extract_hwpx_text(path: Path) -> tuple[str, bool, int]:
    texts: list[str] = []
    xml_well_formed = True
    entry_count = 0
    with ZipFile(path) as archive:
        names = archive.namelist()
        entry_count = len(names)
        for name in names:
            if not name.lower().endswith(".xml"):
                continue
            try:
                root = ET.fromstring(archive.read(name))
            except Exception:
                xml_well_formed = False
                continue
            for elem in root.iter():
                if elem.text and elem.text.strip():
                    texts.append(elem.text.strip())
    text = re.sub(r"\s+", " ", " ".join(texts)).strip()
    return text, xml_well_formed, entry_count


def probe_hits(text: str) -> dict[str, bool]:
    return {probe: probe in text for probe in CORE_PROBES}


def create_source_file(root: Path) -> Path:
    source_dir = root / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    source = source_dir / "ai-content-guidelines.md"
    source.write_text(
        """# AI 콘텐츠 제작 핵심 노하우

## 제작 원칙
- Lighting First: 빛을 먼저 정해 장면의 사실감을 확보
- Camera Reality: 카메라 시점을 현실적으로 고정
- Skin Texture: 피부 질감과 작은 움직임으로 생동감 부여
- Life Motion: 미세한 움직임으로 자연스러운 결과물 확보

## 검토 기준
- 과도한 디테일과 비현실적 색감 배제
- 반복 생성 시 같은 규칙을 적용해 일관성 확보

## 후속 조치
- 제작 규칙을 팀 공통 체크리스트로 반영
- 결과물 검수 기준을 업무 매뉴얼에 추가
""",
        encoding="utf-8",
    )
    return source


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate four public document formats and verify HWPX readability.")
    parser.add_argument(
        "--root",
        default="runtime-workspace/cache/document-format-smoke-20260615",
        help="Sandbox root to recreate for the smoke run.",
    )
    parser.add_argument("--out", help="Optional JSON report path.")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if root.exists():
        shutil.rmtree(root)
    workspace = root / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    source = create_source_file(root)

    app = create_app(workspace)
    client = app.state.test_client_factory()

    results: list[dict[str, object]] = []
    for document_format in FORMATS:
        title = f"AI 콘텐츠 제작 노하우 {document_format}"
        payload = {
            "title": title,
            "purpose": "연결 파일의 제작 원칙과 검토 기준을 공공문서 형식으로 정리",
            "reference_set_id": None,
            "template_key": "report",
            "source_session_id": None,
            "outline": "AI 콘텐츠 제작 노하우를 문서 유형에 맞게 정리하고 후속 조치까지 제시",
            "document_format": document_format,
            "audience_type": "업무 담당자",
            "expected_length": "1페이지" if document_format == "onePageReport" else "자동",
            "urgency_level": "보통",
            "needs_traceability": "필요",
            "requires_official_form": "필요",
            "requested_action": "검토 및 업무매뉴얼 반영",
            "deadline": "2026-06-30",
            "security_level": "내부",
            "direct_file_paths": [str(source)],
            "user_template_path": None,
        }
        content_base_response = client.post("/api/documents/content-bases", json=payload)
        content_base_response.raise_for_status()
        content_base = content_base_response.json()

        requested = client.post(
            "/api/documents/finalize",
            json={"content_base_id": content_base["id"], "output_name": f"format-smoke-{document_format}"},
        )
        requested.raise_for_status()
        ticket_id = requested.json()["approval_ticket"]["id"]
        decision = client.post(
            f"/api/approval-tickets/{ticket_id}/decision",
            json={"status": "approved", "decision_note": "format smoke 승인"},
        )
        decision.raise_for_status()
        applied = client.post(f"/api/documents/finalize/{ticket_id}/apply")
        applied.raise_for_status()
        artifact = applied.json()["artifact"]

        content_base_path = Path(content_base["artifact"]["path"])
        markdown_path = Path(artifact["markdown_path"])
        hwpx_path = Path(artifact["path"])
        content_base_text = content_base_path.read_text(encoding="utf-8")
        markdown_text = markdown_path.read_text(encoding="utf-8")
        hwpx_text, xml_well_formed, entry_count = extract_hwpx_text(hwpx_path)

        result = {
            "format": document_format,
            "content_base_path": str(content_base_path),
            "markdown_path": str(markdown_path),
            "hwpx_path": str(hwpx_path),
            "artifact_format": artifact.get("format"),
            "template_source": artifact.get("template_source"),
            "hwpx_exists": hwpx_path.exists(),
            "hwpx_zip_entries": entry_count,
            "hwpx_xml_well_formed": xml_well_formed,
            "content_base_probe_hits": probe_hits(content_base_text),
            "markdown_probe_hits": probe_hits(markdown_text),
            "hwpx_probe_hits": probe_hits(hwpx_text),
            "markdown_length": len(markdown_text),
            "hwpx_text_length": len(hwpx_text),
        }
        results.append(result)

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "workspace": str(workspace),
        "source_file": str(source),
        "formats": results,
        "all_hwpx_readable": all(
            item["hwpx_exists"] and item["hwpx_xml_well_formed"] and int(item["hwpx_zip_entries"]) > 0
            for item in results
        ),
        "all_formats_match": all(item["artifact_format"] == item["format"] for item in results),
        "all_core_context_preserved": all(
            all(item["content_base_probe_hits"].values())
            and all(item["markdown_probe_hits"].values())
            and item["hwpx_probe_hits"]["Lighting First"]
            and item["hwpx_probe_hits"]["후속"]
            for item in results
        ),
    }

    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

    return 0 if report["all_hwpx_readable"] and report["all_formats_match"] and report["all_core_context_preserved"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
