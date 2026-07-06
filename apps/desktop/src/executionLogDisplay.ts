import type { ExecutionLogItem } from "./api";
import { describeExecutionFeature, EXECUTION_ACTION_LABELS } from "./shared/labels";

const STATUS_LABELS: Record<string, string> = {
  success: "성공",
  succeeded: "성공",
  completed: "완료",
  failed: "실패",
  pending: "대기 중",
  pending_approval: "승인 대기",
  applied: "적용됨",
  rolled_back: "되돌림 완료",
  canceled: "취소됨",
  partial: "부분 완료",
};

export type ExecutionLogDisplay = {
  title: string;
  subtitle: string;
  statusLabel: string;
  detail: string;
};

export function buildExecutionLogDisplay(log: ExecutionLogItem): ExecutionLogDisplay {
  const title = EXECUTION_ACTION_LABELS[log.action] ?? `기타 작업(${describeExecutionFeature(log.feature)})`;
  const statusLabel = STATUS_LABELS[log.status] ?? "기타 상태";
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
    subtitle: `처리 결과: ${statusLabel}`,
    statusLabel,
    detail: outputError || "상세 입력과 출력은 상세보기에서 확인할 수 있습니다.",
  };
}
