"""주제 어휘집 팩 엔진 — 3층 병합·결정적 매칭·LLM 선택 후보·팩 검증·후보 큐.

주제 생성을 개방형 창작에서 '통제어휘 기반 선택'으로 전환한다(파편화·중복 차단).
규격: docs/design/2026-07-12-topic-vocab-pack-spec.md

- L1 공통(내장): assets/topic_vocab_common.json — 앱 배포 자산, 읽기 전용.
- L2 기관팩: <workspace>/vocab/institution-pack.json — 임포트 API로 복사 저장.
- L3 승인 확장: DB vocab_user_topics(정본) + <workspace>/vocab/user-approved.json 미러.

병합 우선순위 L3 > L2 > L1 (§3): 동일 id는 상위 층이 name/scope_note를 오버라이드,
synonyms는 합집합. enabled:false는 결합 결과에서 제외(하위 층 정의 포함).
매칭 키는 knowledge_wiki.normalize_topic_key 재사용(NFC·소문자·공백/조사 제거).

경량모델 대응 원칙(빌드타임 지능): 결정적 매칭은 비용 0으로 코드가 수행하고,
LLM에는 '후보 목록에서 선택'만 시킨다 — 창작 금지, 없으면 NEW: 제안 → 후보 큐.
"""

from __future__ import annotations

import json
import hashlib
import re
from collections import Counter
from pathlib import Path
from typing import Any
from uuid import uuid4

from .db import Database, now_iso
from .knowledge_wiki import normalize_topic_key
from .taxonomy_rules import nfc
from .workspace import WorkspacePaths

# §2 필드 규칙
TOPIC_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
SUPPORTED_SCHEMA_VERSIONS = {1}
MAX_TOPICS_PER_PACK = 1000
MAX_SYNONYMS_PER_TOPIC = 20
# §4-2 LLM 선택 후보 상한(결정적 부분 매칭 상위 + 워크스페이스 빈도 상위 합계)
CANDIDATE_LIMIT = 30
# §4-1 결정적 매칭 본문 예산·채택 상한
MATCH_BODY_CHARS = 1500
MATCH_TOP_N = 3
# 부분 매칭(후보 랭킹용) bigram 겹침 임계 — 완전 일치(1.0)보다 느슨한 결정적 근사.
PARTIAL_MATCH_THRESHOLD = 0.5
# §6 확장(자동 선별): hit_count가 이 값 이상이면 반복 등장 — 사람 검토(review) 가치.
REVIEW_HIT_THRESHOLD = 3
# 괄호 그룹 제거 — '예산편성(2026)' 같은 한정어 변형을 본 키로 환원하기 위한 전처리.
_PAREN_GROUP_RE = re.compile(r"[(\[{（［｛〔【][^)\]}）］｝〕】]*[)\]}）］｝〕】]")

COMMON_PACK_PATH = Path(__file__).resolve().parent / "assets" / "topic_vocab_common.json"

LAYER_COMMON = "common"
LAYER_INSTITUTION = "institution"
LAYER_USER = "user"


class VocabValidationError(Exception):
    """후보 승인/병합 입력이 어휘집 계약을 깨는 경우(키 충돌 등) — API 400."""


def _clean_label(value: Any) -> str:
    return re.sub(r"\s+", " ", nfc(str(value or ""))).strip()


def _normalize_haystack(text: Any) -> str:
    """매칭 대상 텍스트 정규화 — 키(normalize_topic_key)와 같은 좌표계(NFC·소문자·공백 제거).

    조사 제거는 하지 않는다: 키가 어간이므로 '예산편성지침을'에도 부분 문자열로 매칭된다.
    """
    return re.sub(r"\s+", "", nfc(str(text or "")).lower())


def _bigrams(text: str) -> set[str]:
    return {text[i : i + 2] for i in range(len(text) - 1)}


def _topic_keys(entry: dict[str, Any]) -> list[str]:
    """주제의 매칭 키 목록 = name + synonyms 각각의 normalize_topic_key (2자 미만 제외)."""
    keys: list[str] = []
    seen: set[str] = set()
    for label in [entry.get("name") or "", *(entry.get("synonyms") or [])]:
        key = normalize_topic_key(str(label))
        if len(key) >= 2 and key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def validate_pack(
    content: Any, *, existing_topics: list[dict[str, Any]] | None = None
) -> tuple[list[str], list[str]]:
    """팩 검증기 (§5) — (errors, warnings). 오류가 하나라도 있으면 저장 금지(부분 임포트 금지).

    검증: schema_version 지원 여부, id 형식·팩 내 유일성, name 필수, 정규화 키 충돌(§3-3
    — 팩 내부 + 기존 층과의 충돌, 동일 id 오버라이드는 허용), 크기 상한.
    오류는 중단 없이 전체 목록으로 모아 반환한다.
    """
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(content, dict):
        return (["팩 JSON 최상위가 객체가 아닙니다"], warnings)

    schema_version = content.get("schema_version")
    if not isinstance(schema_version, int) or schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        errors.append(
            f"지원하지 않는 schema_version입니다: {schema_version!r} "
            f"(지원: {sorted(SUPPORTED_SCHEMA_VERSIONS)})"
        )

    pack_meta = content.get("pack")
    if not isinstance(pack_meta, dict):
        warnings.append("pack 메타 블록이 없습니다 — 이름/버전이 비어 있는 팩으로 저장됩니다")
    elif not _clean_label(pack_meta.get("name")):
        warnings.append("pack.name이 비어 있습니다")

    topics = content.get("topics")
    if not isinstance(topics, list) or not topics:
        errors.append("topics 배열이 비어 있거나 없습니다")
        return (errors, warnings)
    if len(topics) > MAX_TOPICS_PER_PACK:
        errors.append(f"topics가 상한을 초과했습니다: {len(topics)}개 (최대 {MAX_TOPICS_PER_PACK})")

    seen_ids: set[str] = set()
    # 정규화 키 → (id, 출처 라벨) — 서로 다른 id의 키 충돌을 반려한다 (§3-3).
    key_owners: dict[str, tuple[str, str]] = {}
    existing_key_owners: dict[str, tuple[str, str]] = {}
    for existing in existing_topics or []:
        existing_id = str(existing.get("id") or "")
        for label in [existing.get("name") or "", *(existing.get("synonyms") or [])]:
            key = normalize_topic_key(str(label))
            if len(key) >= 2:
                existing_key_owners.setdefault(key, (existing_id, str(label)))

    for index, topic in enumerate(topics):
        where = f"topics[{index}]"
        if not isinstance(topic, dict):
            errors.append(f"{where}: 객체가 아닙니다")
            continue
        topic_id = str(topic.get("id") or "")
        if not topic_id:
            errors.append(f"{where}: id가 없습니다")
        elif not TOPIC_ID_RE.match(topic_id):
            errors.append(
                f"{where}: id 형식 오류 '{topic_id}' (영문 소문자·숫자·하이픈, 2~64자)"
            )
        if topic_id:
            if topic_id in seen_ids:
                errors.append(f"{where}: id '{topic_id}'가 팩 안에서 중복됩니다")
            seen_ids.add(topic_id)
        name = _clean_label(topic.get("name"))
        if not name:
            errors.append(f"{where} (id={topic_id or '?'}): name이 없습니다")
        synonyms = topic.get("synonyms")
        if synonyms is not None and not isinstance(synonyms, list):
            errors.append(f"{where} (id={topic_id or '?'}): synonyms가 배열이 아닙니다")
            synonyms = []
        synonyms = [s for s in (synonyms or []) if _clean_label(s)]
        if len(synonyms) > MAX_SYNONYMS_PER_TOPIC:
            errors.append(
                f"{where} (id={topic_id or '?'}): synonyms {len(synonyms)}개 "
                f"(항목당 최대 {MAX_SYNONYMS_PER_TOPIC})"
            )
        enabled = topic.get("enabled")
        if enabled is not None and not isinstance(enabled, bool):
            warnings.append(f"{where} (id={topic_id or '?'}): enabled가 불리언이 아니라 무시됩니다")
        # 정규화 키 충돌 — 같은 주제 내부 중복(name==synonym)은 조용히 접는다.
        own_keys: set[str] = set()
        for label in [name, *[_clean_label(s) for s in synonyms]]:
            key = normalize_topic_key(label)
            if len(key) < 2 or key in own_keys:
                continue
            own_keys.add(key)
            holder = key_owners.get(key)
            if holder is not None and holder[0] != topic_id:
                errors.append(
                    f"{where} (id={topic_id or '?'}): '{label}'의 정규화 키 '{key}'가 "
                    f"팩 내 다른 주제(id={holder[0]}, '{holder[1]}')와 충돌합니다"
                )
                continue
            key_owners.setdefault(key, (topic_id, label))
            existing_holder = existing_key_owners.get(key)
            # 동일 id는 오버라이드 관계(§2) — 키 공유가 정상이다.
            if existing_holder is not None and existing_holder[0] != topic_id:
                errors.append(
                    f"{where} (id={topic_id or '?'}): '{label}'의 정규화 키 '{key}'가 "
                    f"기존 어휘집 주제(id={existing_holder[0]}, '{existing_holder[1]}')와 충돌합니다"
                )
    return (errors, warnings)


class TopicVocabManager:
    """3층 어휘집 로드·병합·매칭·임포트·후보 큐 — 워크스페이스당 1인스턴스.

    병합 스냅샷은 캐시되며 임포트/제거/후보 결정 시 invalidate된다.
    """

    def __init__(self, paths: WorkspacePaths, db: Database) -> None:
        self.paths = paths
        self.db = db
        self.vocab_dir = paths.root / "vocab"
        self.institution_pack_path = self.vocab_dir / "institution-pack.json"
        self.user_mirror_path = self.vocab_dir / "user-approved.json"
        self._merged_cache: list[dict[str, Any]] | None = None

    # ------------------------------------------------------------ 층 로드

    def invalidate(self) -> None:
        self._merged_cache = None

    def load_common_pack(self) -> dict[str, Any]:
        try:
            payload = json.loads(COMMON_PACK_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            # L1 자산 파손 시에도 파이프라인은 동작해야 한다(§7) — 빈 팩 폴백.
            return {"schema_version": 1, "pack": {"name": "", "version": ""}, "topics": []}
        return payload if isinstance(payload, dict) else {"topics": []}

    def load_institution_pack(self) -> dict[str, Any] | None:
        if not self.institution_pack_path.exists():
            return None
        try:
            payload = json.loads(self.institution_pack_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def load_user_topics(self) -> list[dict[str, Any]]:
        rows = self.db.fetch_all("SELECT * FROM vocab_user_topics ORDER BY created_at ASC")
        topics: list[dict[str, Any]] = []
        for row in rows:
            try:
                synonyms = json.loads(str(row.get("synonyms_json") or "[]"))
            except json.JSONDecodeError:
                synonyms = []
            topics.append(
                {
                    "id": str(row.get("id") or ""),
                    "name": _clean_label(row.get("name")),
                    "synonyms": [_clean_label(s) for s in synonyms if _clean_label(s)],
                    "broader": row.get("broader"),
                    "scope_note": _clean_label(row.get("scope_note")),
                    "work_area_hint": _clean_label(row.get("work_area_hint")),
                    "enabled": bool(row.get("enabled", 1)),
                }
            )
        return topics

    @staticmethod
    def _pack_topics(pack: dict[str, Any] | None) -> list[dict[str, Any]]:
        if not isinstance(pack, dict):
            return []
        topics = pack.get("topics")
        return [t for t in topics if isinstance(t, dict)] if isinstance(topics, list) else []

    def merged_topics(self, *, include_disabled: bool = False) -> list[dict[str, Any]]:
        """§3 층 병합: L3 > L2 > L1. 동일 id 오버라이드 + synonyms 합집합.

        반환 항목: {id, name, synonyms, broader, scope_note, work_area_hint, enabled,
        layer(최상위 기여 층), _keys(정규화 매칭 키)}.
        """
        if self._merged_cache is not None and not include_disabled:
            return self._merged_cache
        merged: dict[str, dict[str, Any]] = {}
        order: list[str] = []
        layers = [
            (LAYER_COMMON, self._pack_topics(self.load_common_pack())),
            (LAYER_INSTITUTION, self._pack_topics(self.load_institution_pack())),
            (LAYER_USER, self.load_user_topics()),
        ]
        for layer_name, topics in layers:
            for topic in topics:
                topic_id = str(topic.get("id") or "").strip()
                if not topic_id:
                    continue
                name = _clean_label(topic.get("name"))
                synonyms = [
                    _clean_label(s) for s in (topic.get("synonyms") or []) if _clean_label(s)
                ]
                enabled_value = topic.get("enabled")
                enabled = enabled_value if isinstance(enabled_value, bool) else True
                entry = merged.get(topic_id)
                if entry is None:
                    merged[topic_id] = {
                        "id": topic_id,
                        "name": name,
                        "synonyms": list(dict.fromkeys(synonyms)),
                        "broader": topic.get("broader"),
                        "scope_note": _clean_label(topic.get("scope_note")),
                        "work_area_hint": _clean_label(topic.get("work_area_hint")),
                        "enabled": enabled,
                        "layer": layer_name,
                    }
                    order.append(topic_id)
                    continue
                # 상위 층 오버라이드 — 빈 값은 '오버라이드 없음'(synonym-only 병합 행).
                if name:
                    entry["name"] = name
                if _clean_label(topic.get("scope_note")):
                    entry["scope_note"] = _clean_label(topic.get("scope_note"))
                if topic.get("broader"):
                    entry["broader"] = topic.get("broader")
                if _clean_label(topic.get("work_area_hint")):
                    entry["work_area_hint"] = _clean_label(topic.get("work_area_hint"))
                entry["synonyms"] = list(dict.fromkeys([*entry["synonyms"], *synonyms]))
                entry["enabled"] = enabled
                entry["layer"] = layer_name
        result = []
        for topic_id in order:
            entry = merged[topic_id]
            entry["_keys"] = _topic_keys(entry)
            result.append(entry)
        if include_disabled:
            return result
        enabled_only = [entry for entry in result if entry["enabled"] and entry["name"]]
        self._merged_cache = enabled_only
        return enabled_only

    def key_index(self) -> dict[str, dict[str, Any]]:
        """정규화 키 → 주제(enabled만). 층 간 잔존 충돌은 상위 층(L3>L2>L1) 우선."""
        priority = {LAYER_USER: 0, LAYER_INSTITUTION: 1, LAYER_COMMON: 2}
        index: dict[str, dict[str, Any]] = {}
        for entry in sorted(self.merged_topics(), key=lambda e: priority.get(e["layer"], 9)):
            for key in entry["_keys"]:
                index.setdefault(key, entry)
        return index

    def canonical_names(self) -> dict[str, str]:
        """정규화 키 → 정식명(name) — 저장 전 병합 사전에 덧입혀 정식명 수렴을 보장한다(§4-4)."""
        return {key: entry["name"] for key, entry in self.key_index().items()}

    def contains(self, label: Any) -> bool:
        key = normalize_topic_key(_clean_label(label))
        return bool(key) and key in self.key_index()

    # ------------------------------------------------------ §4 결정적 매칭

    def match_document(
        self, *, title: str, file_name: str, body: str
    ) -> list[dict[str, Any]]:
        """결정적 매칭(비용 0): 제목/파일명 히트×2 + 본문(상위 1,500자) 히트×1, 상위 3."""
        title_hay = _normalize_haystack(title)
        file_hay = _normalize_haystack(file_name)
        body_hay = _normalize_haystack(str(body or "")[:MATCH_BODY_CHARS])
        scored: list[tuple[int, str, dict[str, Any]]] = []
        for entry in self.merged_topics():
            score = 0
            for key in entry["_keys"]:
                score += 2 * title_hay.count(key) + 2 * file_hay.count(key) + body_hay.count(key)
            if score > 0:
                scored.append((score, entry["id"], entry))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [{**entry, "score": score} for score, _id, entry in scored[:MATCH_TOP_N]]

    def candidate_topics(
        self, *, title: str, file_name: str, body: str, limit: int = CANDIDATE_LIMIT
    ) -> list[dict[str, Any]]:
        """LLM 선택 후보(k≤30, §4-2): 결정적 부분 매칭 상위 + 워크스페이스 빈도 상위.

        부분 매칭은 키 bigram의 문서 내 겹침 비율(결정적)로 근사한다.
        """
        hay = "\n".join(
            [
                _normalize_haystack(title),
                _normalize_haystack(file_name),
                _normalize_haystack(str(body or "")[:MATCH_BODY_CHARS]),
            ]
        )
        hay_bigrams = _bigrams(hay)
        by_id: dict[str, dict[str, Any]] = {}
        partial: list[tuple[float, str, dict[str, Any]]] = []
        for entry in self.merged_topics():
            by_id[entry["id"]] = entry
            best = 0.0
            for key in entry["_keys"]:
                grams = _bigrams(key)
                if not grams:
                    continue
                best = max(best, len(grams & hay_bigrams) / len(grams))
            if best > 0:
                partial.append((best, entry["id"], entry))
        partial.sort(key=lambda item: (-item[0], item[1]))
        result: list[dict[str, Any]] = [
            entry for score, _id, entry in partial if score >= PARTIAL_MATCH_THRESHOLD
        ][:limit]
        chosen = {entry["id"] for entry in result}
        # 워크스페이스 빈도 상위 — 이미 자주 쓰이는 주제일수록 이 문서일 확률이 높다.
        for topic_id in self._workspace_frequency_ids():
            if len(result) >= limit:
                break
            entry = by_id.get(topic_id)
            if entry is not None and entry["id"] not in chosen:
                chosen.add(entry["id"])
                result.append(entry)
        # 여전히 여유가 있으면 임계 미달 부분 매칭 순으로 채운다(후보 부족 방지).
        for _score, _id, entry in partial:
            if len(result) >= limit:
                break
            if entry["id"] not in chosen:
                chosen.add(entry["id"])
                result.append(entry)
        return result[:limit]

    def _workspace_frequency_ids(self) -> list[str]:
        """현 워크스페이스 topics_json 빈도 상위 — 어휘집 id로 환원되는 것만."""
        index = self.key_index()
        counts: Counter[str] = Counter()
        rows = self.db.fetch_all(
            "SELECT topics_json FROM knowledge_wiki_docs WHERE status != ?", ("missing",)
        )
        for row in rows:
            try:
                topics = json.loads(str(row.get("topics_json") or "[]"))
            except json.JSONDecodeError:
                continue
            if not isinstance(topics, list):
                continue
            for topic in topics:
                entry = index.get(normalize_topic_key(_clean_label(topic)))
                if entry is not None:
                    counts[entry["id"]] += 1
        return [topic_id for topic_id, _count in counts.most_common()]

    # -------------------------------------------------- §4 LLM 선택 프롬프트

    def selection_hint(self, candidates: list[dict[str, Any]]) -> str:
        """보강 프롬프트에 붙일 후보 목록('name — scope_note') + 창작 금지·NEW 규칙 (§4-2)."""
        lines: list[str] = []
        for entry in candidates:
            note = _clean_label(entry.get("scope_note"))
            lines.append(f"- {entry['name']} — {note}" if note else f"- {entry['name']}")
        listing = "\n".join(lines) if lines else "(후보 없음)"
        return (
            "\ntopics는 반드시 아래 [주제 후보] 목록의 이름을 글자 그대로 복사해 "
            "최대 3개 선택하세요. 목록에 없는 주제명을 창작하거나 변형하는 것은 금지합니다. "
            "정말 맞는 후보가 없을 때만 'NEW: <제안명>' 형식 항목을 넣으세요.\n"
            "[주제 후보]\n" + listing
        )

    @staticmethod
    def _strip_candidate_echo(label: str) -> str:
        """실LLM이 후보 줄('- name — scope_note')을 통째로 복사한 출력에서 이름부만 취한다.

        (2026-07-12 실측: gemma가 scope_note까지 복사 → 키 불일치로 정상 선택이
        후보 큐에 오적재.) '—'(em dash)는 selection_hint가 소유한 구분자다 —
        어휘집 주제명은 '·'만 쓰고 '—'를 쓰지 않는다.
        """
        stripped = label.lstrip("-•*").strip()
        if "—" in stripped:
            stripped = stripped.split("—", 1)[0].strip()
        return stripped

    def resolve_selection(self, topics: Any) -> tuple[list[str], list[str]]:
        """LLM 출력 주제를 (정식명 선택분, NEW 제안분)으로 분해한다 (§4-3·4).

        어휘집에 없는 이름(창작 금지 위반 포함)은 topics_json에 넣지 않고 제안으로 돌린다.
        """
        index = self.key_index()
        selected: list[str] = []
        proposals: list[str] = []
        for raw in topics if isinstance(topics, list) else []:
            label = self._strip_candidate_echo(_clean_label(raw))
            if not label:
                continue
            new_match = re.match(r"^new\s*[:：]\s*(.+)$", label, re.IGNORECASE)
            if new_match:
                proposal = self._strip_candidate_echo(_clean_label(new_match.group(1)))
                if proposal:
                    proposals.append(proposal)
                continue
            entry = index.get(normalize_topic_key(label))
            if entry is not None:
                if entry["name"] not in selected:
                    selected.append(entry["name"])
            else:
                proposals.append(label)
        return selected[:MATCH_TOP_N], proposals

    # ------------------------------------------------------ §5 팩 임포트 API

    def vocab_overview(self) -> dict[str, Any]:
        """GET /api/knowledge/vocab 응답 (§5)."""
        common_topics = self._pack_topics(self.load_common_pack())
        institution = self.load_institution_pack()
        institution_meta = None
        if institution is not None:
            pack_meta = institution.get("pack") if isinstance(institution.get("pack"), dict) else {}
            institution_meta = {
                "name": _clean_label(pack_meta.get("name")),
                "version": _clean_label(pack_meta.get("version")),
                "topics": len(self._pack_topics(institution)),
            }
        user_topics = self.load_user_topics()
        return {
            "layers": {
                "common": len(common_topics),
                "institution": institution_meta,
                "user": len(user_topics),
            },
            "topics": [
                {
                    "id": entry["id"],
                    "name": entry["name"],
                    "layer": entry["layer"],
                    "synonyms_count": len(entry["synonyms"]),
                    "enabled": bool(entry["enabled"]),
                }
                for entry in self.merged_topics(include_disabled=True)
            ],
        }

    def import_pack(
        self, *, path: str | None = None, content: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """POST /api/knowledge/vocab/pack (§5) — 검증 통과 시에만 저장(부분 임포트 금지).

        성공 시 기존 문서를 재평가 대상(dirty)으로 마킹 — 재보강 때 새 어휘집으로 재태깅.
        """
        warnings: list[str] = []
        if content is None:
            if not path:
                return {"ok": False, "imported": None, "errors": ["path 또는 content가 필요합니다"], "warnings": []}
            pack_file = Path(str(path)).expanduser()
            if not pack_file.is_file():
                return {
                    "ok": False,
                    "imported": None,
                    "errors": [f"팩 파일을 찾을 수 없습니다: {pack_file}"],
                    "warnings": [],
                }
            try:
                content = json.loads(pack_file.read_text(encoding="utf-8-sig"))
            except (OSError, json.JSONDecodeError) as exc:
                return {
                    "ok": False,
                    "imported": None,
                    "errors": [f"팩 파일을 읽거나 파싱하지 못했습니다: {exc}"],
                    "warnings": [],
                }
        # 기존 층(L1+L3)과의 키 충돌 검증 — 교체 대상인 기존 L2는 비교에서 제외한다.
        existing = [
            *self._pack_topics(self.load_common_pack()),
            *self.load_user_topics(),
        ]
        errors, warnings = validate_pack(content, existing_topics=existing)
        if errors:
            return {"ok": False, "imported": None, "errors": errors, "warnings": warnings}
        self.vocab_dir.mkdir(parents=True, exist_ok=True)
        normalized = json.dumps(content, ensure_ascii=False, indent=2)
        self.institution_pack_path.write_text(nfc(normalized), encoding="utf-8")
        self.invalidate()
        # 임포트 성공 → 기존 문서 주제 재평가 대상 표시(dirty). 재보강에서 재태깅된다.
        self._mark_all_docs_stale()
        pack_meta = content.get("pack") if isinstance(content.get("pack"), dict) else {}
        imported = {
            "name": _clean_label(pack_meta.get("name")),
            "version": _clean_label(pack_meta.get("version")),
            "topics": len(self._pack_topics(content)),
        }
        self.db.log(
            feature="knowledge",
            action="knowledge.vocab.pack.imported",
            status="completed",
            inputs={"path": path or "(inline content)"},
            outputs=imported,
        )
        return {"ok": True, "imported": imported, "errors": [], "warnings": warnings}

    def remove_institution_pack(self) -> dict[str, Any]:
        """DELETE /api/knowledge/vocab/pack (§5) — 문서 주제는 유지, 이후 태깅에만 반영."""
        removed = False
        if self.institution_pack_path.exists():
            try:
                self.institution_pack_path.unlink()
                removed = True
            except OSError:
                removed = False
        self.invalidate()
        return {"ok": True, "removed": removed}

    def _mark_all_docs_stale(self) -> None:
        self.db.execute(
            "UPDATE knowledge_wiki_docs SET summary_stale = 1, updated_at = ? "
            "WHERE status != 'missing'",
            (now_iso(),),
        )

    # ------------------------------------------------------ §6 L3 후보 큐

    def recommend_action(self, name: Any, *, hit_count: int) -> tuple[str, str | None]:
        """§6 확장 자동 선별(triage) — 결정적 3분기 규칙. (action, target_id) 반환.

        실측(2026-07-12, 후보 298건)상 ~95%가 (a) 기존 주제의 표기 변형, (b) 일회성 잡음.
        1) 정규화 키(+괄호 제거 변형)가 결합 어휘집 주제 키와 포함관계면 → merge + 대상 id
        2) 아니고 hit_count >= REVIEW_HIT_THRESHOLD(반복 등장) → review (사람 검토 가치)
        3) 그 외(일회성) → reject
        추천일 뿐 자동 확정이 아니다 — 적용은 apply_recommended/개별 결정에서 일어난다.
        """
        label = _clean_label(name)
        cand_keys: list[str] = []
        for variant in [label, _PAREN_GROUP_RE.sub("", label)]:
            key = normalize_topic_key(variant)
            if len(key) >= 2 and key not in cand_keys:
                cand_keys.append(key)
        # (완전 일치 > 긴 겹침) 순으로 대상 선정 — 동률은 id 오름차순(결정적).
        matches: list[tuple[int, int, str]] = []  # (exact, contained_len, topic_id)
        for entry in self.merged_topics():
            for topic_key in entry["_keys"]:
                for cand_key in cand_keys:
                    if topic_key in cand_key or cand_key in topic_key:
                        matches.append(
                            (
                                1 if topic_key == cand_key else 0,
                                min(len(topic_key), len(cand_key)),
                                entry["id"],
                            )
                        )
        if matches:
            matches.sort(key=lambda item: (-item[0], -item[1], item[2]))
            return ("merge", matches[0][2])
        if int(hit_count) >= REVIEW_HIT_THRESHOLD:
            return ("review", None)
        return ("reject", None)

    def enqueue_candidate(
        self, name: Any, *, doc: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        """NEW 제안/어휘집 미포함 자유 주제를 후보 큐에 적재 — norm_key 단위로 접는다.

        동일 키 재등장 시 hit_count++ + sample_docs 갱신(최대 5) + 추천 재계산(hit 승격).
        이미 어휘집에 있는 키는 적재하지 않는다. 결정(승인/거절/병합)된 후보는 상태를
        유지한 채 집계만 갱신한다.
        """
        label = _clean_label(name)
        key = normalize_topic_key(label)
        if not key or len(label) > 60:
            return None
        if key in self.key_index():
            return None
        sample = None
        if doc is not None:
            sample = {
                "doc_id": str(doc.get("id") or ""),
                "slug": str(doc.get("slug") or ""),
                "title": str(doc.get("title") or ""),
            }
        row = self.db.fetch_one("SELECT * FROM vocab_candidates WHERE norm_key = ?", (key,))
        if row is not None:
            samples = self._merge_samples(row.get("sample_docs_json"), sample)
            new_hits = int(row.get("hit_count") or 0) + 1
            # hit 승격 재계산 — 결정된 후보는 추천을 동결(상태와 함께 이력으로 보존)한다.
            if str(row.get("status")) == "pending":
                action, target_id = self.recommend_action(row.get("name"), hit_count=new_hits)
                self.db.execute(
                    "UPDATE vocab_candidates SET hit_count = ?, sample_docs_json = ?, "
                    "recommended_action = ?, recommended_target_id = ? WHERE id = ?",
                    (
                        new_hits,
                        json.dumps(samples, ensure_ascii=False),
                        action,
                        target_id,
                        row["id"],
                    ),
                )
            else:
                self.db.execute(
                    "UPDATE vocab_candidates SET hit_count = ?, sample_docs_json = ? WHERE id = ?",
                    (new_hits, json.dumps(samples, ensure_ascii=False), row["id"]),
                )
            return self.db.fetch_one("SELECT * FROM vocab_candidates WHERE id = ?", (row["id"],))
        action, target_id = self.recommend_action(label, hit_count=1)
        payload = {
            "id": str(uuid4()),
            "name": label,
            "norm_key": key,
            "hit_count": 1,
            "sample_docs_json": json.dumps([sample] if sample else [], ensure_ascii=False),
            "status": "pending",
            "merged_into_id": None,
            "first_seen_at": now_iso(),
            "decided_at": None,
            "recommended_action": action,
            "recommended_target_id": target_id,
        }
        self.db.insert("vocab_candidates", payload)
        return payload

    @staticmethod
    def _merge_samples(raw: Any, sample: dict[str, Any] | None) -> list[dict[str, Any]]:
        try:
            samples = json.loads(str(raw or "[]"))
        except json.JSONDecodeError:
            samples = []
        if not isinstance(samples, list):
            samples = []
        samples = [s for s in samples if isinstance(s, dict)]
        if sample and sample.get("doc_id"):
            samples = [s for s in samples if s.get("doc_id") != sample["doc_id"]]
            samples.insert(0, sample)
        return samples[:5]

    def list_candidates(self, *, status: str = "pending") -> list[dict[str, Any]]:
        if status == "all":
            rows = self.db.fetch_all(
                "SELECT * FROM vocab_candidates ORDER BY hit_count DESC, first_seen_at ASC"
            )
        else:
            rows = self.db.fetch_all(
                "SELECT * FROM vocab_candidates WHERE status = ? "
                "ORDER BY hit_count DESC, first_seen_at ASC",
                (status,),
            )
        return [self._serialize_candidate(row) for row in rows]

    @staticmethod
    def _serialize_candidate(row: dict[str, Any]) -> dict[str, Any]:
        try:
            samples = json.loads(str(row.get("sample_docs_json") or "[]"))
        except json.JSONDecodeError:
            samples = []
        return {
            "id": row.get("id"),
            "name": row.get("name"),
            "norm_key": row.get("norm_key"),
            "hit_count": int(row.get("hit_count") or 0),
            "sample_docs": samples if isinstance(samples, list) else [],
            "status": row.get("status"),
            "merged_into_id": row.get("merged_into_id"),
            "first_seen_at": row.get("first_seen_at"),
            "decided_at": row.get("decided_at"),
            # §6 확장 자동 선별 추천 — 구버전 행(마이그레이션 전 적재)은 review로 폴백.
            "recommended_action": str(row.get("recommended_action") or "review"),
            "recommended_target_id": row.get("recommended_target_id"),
        }

    def pending_candidate_count(self) -> int:
        row = self.db.fetch_one(
            "SELECT COUNT(*) AS count FROM vocab_candidates WHERE status = 'pending'"
        )
        return int((row or {}).get("count") or 0)

    def review_candidate_count(self) -> int:
        """사람 검토가 필요한 pending 후보 수 — 대시보드 '주제 후보 검토 n건' 배지 근거."""
        row = self.db.fetch_one(
            "SELECT COUNT(*) AS count FROM vocab_candidates "
            "WHERE status = 'pending' AND recommended_action = 'review'"
        )
        return int((row or {}).get("count") or 0)

    def apply_recommended(self) -> dict[str, int]:
        """§6 확장: 추천 일괄 적용 — pending 중 merge/reject 추천분을 전부 처리한다.

        review 추천분은 남긴다(사람 검토). merge는 recommended_target_id로 병합하되,
        적용 시점에 대상이 사라졌으면(팩 제거 등) 후보를 review로 강등해 pending에 남긴다
        — 프론트 그룹핑(자동 처리 예정)과 남은 목록이 어긋나지 않게 한다.
        응답: {merged, rejected, remaining_review}.
        """
        rows = self.db.fetch_all(
            "SELECT * FROM vocab_candidates WHERE status = 'pending' "
            "AND recommended_action IN ('merge', 'reject') "
            "ORDER BY hit_count DESC, first_seen_at ASC"
        )
        merged = 0
        rejected = 0
        for row in rows:
            candidate_id = str(row.get("id") or "")
            if str(row.get("recommended_action")) == "merge":
                try:
                    self.decide_candidate(
                        candidate_id,
                        action="merge",
                        merge_into_id=str(row.get("recommended_target_id") or ""),
                    )
                    merged += 1
                except (KeyError, ValueError, VocabValidationError):
                    # 대상 소실/동시 결정 — 자동 확정 대신 사람 검토로 강등.
                    self.db.execute(
                        "UPDATE vocab_candidates SET recommended_action = 'review', "
                        "recommended_target_id = NULL WHERE id = ? AND status = 'pending'",
                        (candidate_id,),
                    )
            else:
                try:
                    self.decide_candidate(candidate_id, action="reject")
                    rejected += 1
                except (KeyError, ValueError, VocabValidationError):
                    continue
        remaining = self.pending_candidate_count()
        self.db.log(
            feature="knowledge",
            action="knowledge.vocab.candidates.apply_recommended",
            status="completed",
            inputs={"queued": len(rows)},
            outputs={"merged": merged, "rejected": rejected, "remaining_review": remaining},
        )
        return {"merged": merged, "rejected": rejected, "remaining_review": remaining}

    def decide_candidate(
        self,
        candidate_id: str,
        *,
        action: str,
        merge_into_id: str | None = None,
        name_override: str | None = None,
        synonyms: list[str] | None = None,
    ) -> dict[str, Any]:
        """후보 결정 (§6): approve → L3 편입+미러+표본 dirty / merge → 대상 synonym 추가 / reject.

        KeyError: 후보 없음(404) · ValueError: 이미 결정됨(409) ·
        VocabValidationError: 키 충돌/대상 부재 등 입력 오류(400).
        """
        row = self.db.fetch_one("SELECT * FROM vocab_candidates WHERE id = ?", (candidate_id,))
        if row is None:
            raise KeyError(candidate_id)
        if str(row.get("status")) != "pending":
            raise ValueError(f"이미 처리된 후보입니다 (status={row.get('status')})")
        if action == "reject":
            self.db.execute(
                "UPDATE vocab_candidates SET status = 'rejected', decided_at = ? WHERE id = ?",
                (now_iso(), candidate_id),
            )
            return {"candidate": self._serialize_candidate(self._require_candidate(candidate_id))}
        clean_synonyms = list(
            dict.fromkeys([_clean_label(s) for s in (synonyms or []) if _clean_label(s)])
        )[:MAX_SYNONYMS_PER_TOPIC]
        if action == "merge":
            topic = self._merge_candidate(row, merge_into_id=merge_into_id, synonyms=clean_synonyms)
            self.db.execute(
                "UPDATE vocab_candidates SET status = 'merged', merged_into_id = ?, decided_at = ? "
                "WHERE id = ?",
                (topic["id"], now_iso(), candidate_id),
            )
        elif action == "approve":
            topic = self._approve_candidate(row, name_override=name_override, synonyms=clean_synonyms)
            self.db.execute(
                "UPDATE vocab_candidates SET status = 'approved', decided_at = ? WHERE id = ?",
                (now_iso(), candidate_id),
            )
        else:
            raise VocabValidationError(f"지원하지 않는 action입니다: {action}")
        self.invalidate()
        self._write_user_mirror()
        # 표본 문서 재태깅: 후보가 등장했던 문서를 dirty로 — 다음 보강에서 새 어휘로 수렴.
        self._mark_sample_docs_stale(row.get("sample_docs_json"))
        return {
            "candidate": self._serialize_candidate(self._require_candidate(candidate_id)),
            "topic": {key: value for key, value in topic.items() if not key.startswith("_")},
        }

    def _require_candidate(self, candidate_id: str) -> dict[str, Any]:
        row = self.db.fetch_one("SELECT * FROM vocab_candidates WHERE id = ?", (candidate_id,))
        return row or {}

    def _approve_candidate(
        self, row: dict[str, Any], *, name_override: str | None, synonyms: list[str]
    ) -> dict[str, Any]:
        name = _clean_label(name_override) or _clean_label(row.get("name"))
        key = normalize_topic_key(name)
        if not key:
            raise VocabValidationError("승인할 주제명이 비어 있습니다")
        index = self.key_index()
        collisions = [
            label
            for label in [name, *synonyms]
            if normalize_topic_key(label) in index
        ]
        if collisions:
            holders = {
                label: index[normalize_topic_key(label)]["name"] for label in collisions
            }
            raise VocabValidationError(
                "기존 어휘집 주제와 키가 충돌합니다: "
                + ", ".join(f"'{label}' → '{holder}'" for label, holder in holders.items())
            )
        topic_id = f"user-{hashlib.sha256(key.encode('utf-8')).hexdigest()[:10]}"
        timestamp = now_iso()
        existing = self.db.fetch_one("SELECT id FROM vocab_user_topics WHERE id = ?", (topic_id,))
        if existing is not None:
            raise VocabValidationError(f"동일 키의 사용자 주제가 이미 존재합니다 (id={topic_id})")
        payload = {
            "id": topic_id,
            "name": name,
            "synonyms_json": json.dumps(synonyms, ensure_ascii=False),
            "broader": None,
            "scope_note": "",
            "work_area_hint": "",
            "enabled": 1,
            "source_candidate_id": str(row.get("id") or ""),
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        self.db.insert("vocab_user_topics", payload)
        return {"id": topic_id, "name": name, "synonyms": synonyms, "layer": LAYER_USER}

    def _merge_candidate(
        self, row: dict[str, Any], *, merge_into_id: str | None, synonyms: list[str]
    ) -> dict[str, Any]:
        target_id = str(merge_into_id or "").strip()
        if not target_id:
            raise VocabValidationError("merge에는 merge_into_id가 필요합니다")
        target = next(
            (entry for entry in self.merged_topics() if entry["id"] == target_id), None
        )
        if target is None:
            raise VocabValidationError(f"병합 대상 주제를 찾을 수 없습니다: {target_id}")
        additions = list(dict.fromkeys([_clean_label(row.get("name")), *synonyms]))
        additions = [label for label in additions if label]
        timestamp = now_iso()
        existing = self.db.fetch_one(
            "SELECT * FROM vocab_user_topics WHERE id = ?", (target_id,)
        )
        if existing is not None:
            try:
                current = json.loads(str(existing.get("synonyms_json") or "[]"))
            except json.JSONDecodeError:
                current = []
            merged_synonyms = list(dict.fromkeys([*current, *additions]))
            self.db.execute(
                "UPDATE vocab_user_topics SET synonyms_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(merged_synonyms, ensure_ascii=False), timestamp, target_id),
            )
        else:
            # synonym-only 오버라이드 행(name='') — 하위 층 name/scope_note를 건드리지 않는다.
            self.db.insert(
                "vocab_user_topics",
                {
                    "id": target_id,
                    "name": "",
                    "synonyms_json": json.dumps(additions, ensure_ascii=False),
                    "broader": None,
                    "scope_note": "",
                    "work_area_hint": "",
                    "enabled": 1,
                    "source_candidate_id": str(row.get("id") or ""),
                    "created_at": timestamp,
                    "updated_at": timestamp,
                },
            )
        return {"id": target_id, "name": target["name"], "added_synonyms": additions}

    def _mark_sample_docs_stale(self, sample_docs_json: Any) -> int:
        try:
            samples = json.loads(str(sample_docs_json or "[]"))
        except json.JSONDecodeError:
            return 0
        doc_ids = [
            str(sample.get("doc_id"))
            for sample in samples
            if isinstance(sample, dict) and sample.get("doc_id")
        ]
        if not doc_ids:
            return 0
        placeholders = ", ".join("?" for _ in doc_ids)
        self.db.execute(
            f"UPDATE knowledge_wiki_docs SET summary_stale = 1, updated_at = ? "
            f"WHERE id IN ({placeholders})",
            (now_iso(), *doc_ids),
        )
        return len(doc_ids)

    def _write_user_mirror(self) -> None:
        """L3 미러 파일(<ws>/vocab/user-approved.json) — 이식성용. 실패는 조용히 무시.

        synonym-only 행(name='')은 병합 결과의 name으로 채워 팩 스키마(name 필수)를 지킨다.
        """
        merged_by_id = {entry["id"]: entry for entry in self.merged_topics(include_disabled=True)}
        topics = []
        for topic in self.load_user_topics():
            name = topic["name"] or (merged_by_id.get(topic["id"], {}).get("name") or "")
            topics.append(
                {
                    "id": topic["id"],
                    "name": name,
                    "synonyms": topic["synonyms"],
                    **({"broader": topic["broader"]} if topic.get("broader") else {}),
                    **({"scope_note": topic["scope_note"]} if topic.get("scope_note") else {}),
                    "enabled": bool(topic.get("enabled", True)),
                }
            )
        payload = {
            "schema_version": 1,
            "pack": {
                "name": "사용자 승인 확장",
                "publisher": "Gongmu",
                "version": now_iso()[:10],
                "scope": "user",
                "language": "ko",
                "description": "후보 큐 승인으로 편입된 L3 주제 (정본은 DB vocab_user_topics)",
                "created_at": now_iso()[:10],
            },
            "topics": topics,
        }
        try:
            self.vocab_dir.mkdir(parents=True, exist_ok=True)
            self.user_mirror_path.write_text(
                nfc(json.dumps(payload, ensure_ascii=False, indent=2)), encoding="utf-8"
            )
        except OSError:
            pass
