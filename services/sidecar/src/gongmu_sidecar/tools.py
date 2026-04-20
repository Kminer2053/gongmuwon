from __future__ import annotations

TOOLS = [
    {
        "key": "ocr",
        "label": "OCR",
        "description": "스캔 문서를 참고자료 텍스트로 변환한다.",
        "status": "later",
    },
    {
        "key": "document-summary",
        "label": "문서 요약",
        "description": "긴 문서를 핵심 쟁점과 후속 조치 중심으로 요약한다.",
        "status": "mvp",
    },
    {
        "key": "entity-extract",
        "label": "엔티티 추출",
        "description": "인물, 부서, 사업명을 지식 후보로 정리한다.",
        "status": "mvp",
    },
    {
        "key": "metadata-cleanup",
        "label": "메타데이터 정리",
        "description": "참고자료의 제목, 날짜, 주제 태그를 보강한다.",
        "status": "mvp",
    },
    {
        "key": "template-check",
        "label": "템플릿 점검",
        "description": "문서 섹션 누락 여부를 점검한다.",
        "status": "mvp",
    },
]
