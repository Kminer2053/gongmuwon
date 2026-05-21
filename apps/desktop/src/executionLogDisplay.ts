import type { ExecutionLogItem } from "./api";

const ACTION_LABELS: Record<string, string> = {
  "documents.content_base.created": "콘텐츠 베이스 생성",
  "documents.finalize.requested": "최종 저장 요청",
  "documents.finalize.applied": "최종 저장 적용",
  "knowledge.source.registered": "지식 소스 폴더 등록",
  "knowledge.source.scanned": "지식 소스 폴더 스캔",
  "knowledge.ingest.job.run": "GraphRAG 인덱싱 실행",
  "file_org.proposals.created": "파일정리 제안 생성",
  "file_org.apply.requested": "파일정리 적용 요청",
  "file_org.apply.committed": "파일정리 적용",
  "file_org.rollback.completed": "파일정리 되돌리기",
  "anything.launch.requested": "Anything 실행 요청",
  "anything.launch.applied": "Anything 실행 적용",
  "anything.launch.imported": "Anything 결과 가져오기",
  "reference_set.created": "참고자료 묶음 생성",
  "work_session.created": "업무 세션 생성",
  "work_session.updated": "업무 세션 갱신",
  "work_session.turn.failed": "업무대화 응답 실패",
  "work_session.attachments.created": "업무대화 파일 첨부",
  "work_session.file_links.created": "세션 관련 파일 연결",
  "work_session.file_link.deleted": "세션 관련 파일 연결 해제",
  "settings.updated": "환경설정 저장",
  "settings.llm.test.completed": "LLM 연결 테스트 성공",
  "settings.llm.test.failed": "LLM 연결 테스트 실패",
  "schedule.created": "일정 생성",
  "approval_ticket.decided": "승인 결정",
};

const STATUS_LABELS: Record<string, string> = {
  success: "성공",
  completed: "완료",
  failed: "실패",
  pending: "대기 중",
  pending_approval: "승인 대기",
  applied: "적용됨",
  rolled_back: "되돌림 완료",
};

export type ExecutionLogDisplay = {
  title: string;
  subtitle: string;
  statusLabel: string;
  detail: string;
};

export function buildExecutionLogDisplay(log: ExecutionLogItem): ExecutionLogDisplay {
  const title = ACTION_LABELS[log.action] ?? log.action;
  const statusLabel = STATUS_LABELS[log.status] ?? log.status;
  const outputError = typeof log.outputs?.error === "string" ? log.outputs.error : "";

  if (log.action === "work_session.turn.failed") {
    return {
      title,
      subtitle: "LLM 응답 생성에 실패했습니다.",
      statusLabel,
      detail: outputError || "모델 설정, API 응답 형식, 네트워크 또는 CORS 상태를 확인하세요.",
    };
  }

  if (log.action === "settings.updated") {
    return {
      title,
      subtitle: "환경설정이 저장되었습니다.",
      statusLabel,
      detail: "모델, 임베딩, 작업공간 관련 설정 변경이 반영되었습니다.",
    };
  }

  if (log.action === "settings.llm.test.completed") {
    return {
      title,
      subtitle: "모델 연결 테스트가 성공했습니다.",
      statusLabel,
      detail: typeof log.outputs?.model === "string" ? `모델: ${log.outputs.model}` : "모델 연결이 확인되었습니다.",
    };
  }

  if (log.action === "settings.llm.test.failed") {
    return {
      title,
      subtitle: "모델 연결 테스트가 실패했습니다.",
      statusLabel,
      detail: outputError || "모델 서버 주소, API 키, 응답 형식을 확인하세요.",
    };
  }

  return {
    title,
    subtitle: `${title} 작업이 ${statusLabel} 상태로 기록되었습니다.`,
    statusLabel,
    detail: outputError || "상세 입력과 출력은 상세보기에서 확인할 수 있습니다.",
  };
}
