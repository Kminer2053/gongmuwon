import {
  useEffect,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  createWorkSession,
  fetchKnowledgeCardByUid,
  rebuildLocalFileIndex,
  runWorkSessionTurn,
  runWorkSessionTurnStream,
  searchLocalFiles,
  updateWorkSession,
  deleteWorkSessionFileLink,
  mergeWorkspaceSnapshot,
  uploadWorkSessionAttachments,
  type KnowledgeCardByUidResult,
  type WorkSessionAttachmentItem,
  type WorkSessionFileLinkItem,
  type WorkSessionMessageCitation,
  type WorkSessionMessageItem,
  type WorkSessionTurnResult,
  type WorkSessionItem,
  analyzeWorkSessionPersonalization,
  resetWorkSessionContext,
} from "../api";
import { getVisibleMessageText } from "../chatMessageDisplay";
import { copyTextToClipboard, openExternalTarget } from "../runtime";
import {
  createDraftAttachmentId,
  displayTitleForFile,
  fileNameFromPath,
  formatClipboardImageName,
  formatLatencyBadge,
} from "../shared/format";
import { describeMessageStatus, describeReasoningEffort, splitFailedAssistantMessage } from "../shared/labels";
import { renderMarkdownContent } from "../shared/markdown";
import { AssetIcon, EmptyState, LlmSetupNotice, SectionCard } from "../shared/primitives";
import { CHAT_EXAMPLE_TIPS, dailyTipIndex } from "../shared/tips";
import { useAppStore, type ChatAttachmentDraft } from "../store";
import "../styles/chat-screen.css";

export function ChatScreen() {
  const {
    activeTemplateKey,
    chatAttachmentInputRef,
    chatAttachmentPreviews,
    chatAttachments,
    chatDetailsButtonRef,
    chatDetailsOpen,
    chatDetailsPanelRef,
    chatDraft,
    chatFileLinkModalOpen,
    chatImagePreviewOpen,
    chatModelOverride,
    chatReasoningEffort,
    chatRetryPayloads,
    chatThreadRef,
    closeChatFileLinkModal,
    connectLocalFileToSession,
    error,
    handleAction,
    isLlmConfigured,
    localFileIndexLoading,
    localFileQuery,
    localFileSearchLoading,
    localFileSearchResult,
    openResponseContextDetail,
    pushToast,
    refreshDeferredSnapshot,
    refreshSessionFileLinks,
    refreshShellSnapshot,
    revealContextSection,
    selectedScheduleId,
    selectedSession,
    selectedSessionContextEvidence,
    selectedSessionFileLinks,
    selectedSessionId,
    selectedSessionMessages,
    selectedSessionSchedule,
    setActiveMenu,
    setAuthoringFormatKey,
    setAuthoringInstruction,
    setAuthoringTab,
    setChatAttachmentPreviews,
    setChatAttachments,
    setChatDetailsOpen,
    setChatDraft,
    setChatFileLinkModalOpen,
    setChatImagePreviewOpen,
    setChatModelOverride,
    setChatReasoningEffort,
    setChatRetryPayloads,
    setChatReturnContext,
    setDocumentForm,
    setDocumentSourceMode,
    setDocumentSourceSessionId,
    setError,
    setLocalFileIndexLoading,
    setLocalFileIndexResult,
    setLocalFileQuery,
    setLocalFileSearchLoading,
    setLocalFileSearchResult,
    setNotice,
    setSelectedScheduleId,
    setSelectedSessionId,
    setSessionContextSummaries,
    setSessionMessages,
    setSnapshot,
    snapshot,
  } = useAppStore();

  // D-04: 파일 연결 모달 검색 입력 포커스용.
  const fileLinkSearchInputRef = useRef<HTMLInputElement | null>(null);

  // W6: 입력 대기 안내에서 예시를 넣은 뒤 바로 이어 쓸 수 있게 입력창에 포커스를 준다.
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!chatFileLinkModalOpen) {
      return;
    }

    fileLinkSearchInputRef.current?.focus();

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeChatFileLinkModal();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
    // closeChatFileLinkModal은 store 렌더마다 새로 만들어지는 핸들러라 의존성에서 제외한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatFileLinkModalOpen]);

  async function copyCitationPath(filePath: string) {
    try {
      await copyTextToClipboard(filePath);
      pushToast("info", "출처 경로를 복사했습니다.");
    } catch (error) {
      console.warn("failed to copy citation path", error);
      pushToast("error", "출처 경로 복사에 실패했습니다.");
    }
  }

  /**
   * W7 §5.5/§5.6: 인용 칩 [원본 열기] — 원본 우선, 원본이 이동/삭제됐으면 지식카드 폴백.
   * doc_uid가 없는 구버전 인용은 현행 동작(원본 바로 열기)을 그대로 유지한다.
   */
  async function openCitationOriginal(citation: WorkSessionMessageCitation) {
    const docUid = citation.doc_uid ?? null;
    if (!docUid) {
      void openExternalTarget(citation.file_path);
      return;
    }

    // 사전 존재 확인: 서버가 관리하는 문서 상태(active/missing)를 먼저 조회한다.
    // 조회 자체가 실패하면(구버전 서버 등) 원본 열기 시도로 폴백한다.
    let card: KnowledgeCardByUidResult | null = null;
    try {
      card = await fetchKnowledgeCardByUid(docUid);
    } catch (lookupError) {
      console.warn("failed to look up knowledge card by doc_uid", lookupError);
      card = null;
    }

    if (!card || card.status !== "missing") {
      try {
        await openExternalTarget(citation.file_path);
        return;
      } catch (openError) {
        // 원본 열기 실패 — 아래 지식카드 폴백으로 이어간다.
        console.warn("failed to open citation original", openError);
      }
    }

    if (card?.exists && card.card_path) {
      try {
        await openExternalTarget(card.card_path);
        pushToast("info", "원본이 이동/삭제되어 지식카드를 엽니다.");
        return;
      } catch (cardOpenError) {
        console.warn("failed to open knowledge card fallback", cardOpenError);
      }
    }

    pushToast("error", "원본과 지식카드를 찾을 수 없습니다.");
  }

  function appendChatAttachments(files: FileList | File[] | null) {
    if (!files || files.length === 0) {
      return;
    }
    const nextDrafts = Array.from(files).map((file) => ({
      id: createDraftAttachmentId(),
      file,
    }));
    setChatAttachments((current) => [...current, ...nextDrafts]);
    if (chatAttachmentInputRef.current) {
      chatAttachmentInputRef.current.value = "";
    }
  }

  function handleChatComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageFiles = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    const stampedFiles = imageFiles.map(
      (file) => new File([file], formatClipboardImageName(), { type: file.type || "image/png" }),
    );
    appendChatAttachments(stampedFiles);
  }

  function handleChatComposerDragOver(event: DragEvent<HTMLFormElement>) {
    if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
      event.preventDefault();
    }
  }

  function handleChatComposerDrop(event: DragEvent<HTMLFormElement>) {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) {
      return;
    }
    event.preventDefault();
    appendChatAttachments(files);
  }

  function removeChatAttachment(attachmentId: string) {
    setChatAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    setChatAttachmentPreviews((current) => current.filter((preview) => preview.attachmentId !== attachmentId));
    if (chatImagePreviewOpen?.attachmentId === attachmentId) {
      setChatImagePreviewOpen(null);
    }
  }
  async function streamAssistantReply(
    sessionId: string,
    assistantMessage: WorkSessionMessageItem,
    userMessage: WorkSessionMessageItem,
  ) {
    const fullText = assistantMessage.text;
    const chunkSize = Math.max(4, Math.ceil(fullText.length / 18));

    setSessionMessages((current) => ({
      ...current,
      [sessionId]: [
        ...(current[sessionId] ?? []).filter(
          (message) =>
            !message.id.startsWith(`${sessionId}-user-`) && !message.id.startsWith(`${sessionId}-assistant-`),
        ),
        userMessage,
        {
          ...assistantMessage,
          text: "",
          status: assistantMessage.status === "failed" ? "failed" : "streaming",
        },
      ],
    }));

    if (!fullText || assistantMessage.status === "failed") {
      setSessionMessages((current) => ({
        ...current,
        [sessionId]: [
          ...(current[sessionId] ?? []).filter((message) => message.id !== assistantMessage.id),
          assistantMessage,
        ],
      }));
      return;
    }

    const isJsdom =
      typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");
    if (isJsdom) {
      setSessionMessages((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).map((message) =>
          message.id === assistantMessage.id ? assistantMessage : message,
        ),
      }));
      return;
    }

    await new Promise<void>((resolve) => {
      let offset = 0;
      const tick = () => {
        offset = Math.min(fullText.length, offset + chunkSize);
        const nextText = fullText.slice(0, offset);
        setSessionMessages((current) => ({
          ...current,
          [sessionId]: (current[sessionId] ?? []).map((message) =>
            message.id === assistantMessage.id
              ? {
                  ...assistantMessage,
                  text: nextText,
                  status: offset < fullText.length ? "streaming" : assistantMessage.status,
                }
              : message,
          ),
        }));
        if (offset < fullText.length) {
          window.setTimeout(tick, 18);
          return;
        }
        resolve();
      };
      tick();
    });
  }


  function openRelatedFileSearch() {
    if (!selectedSession) {
      return;
    }
    // D-04: 파일찾기 화면이 삭제되어 세션 파일 연결은 채팅 내 파일연결 모달로 대체된다.
    setChatFileLinkModalOpen(true);
  }

  // D-04: 파일 연결 모달 — 파일명 색인 검색 실행 (Enter/검색 버튼).
  async function runLocalFileSearch() {
    const query = localFileQuery.trim();
    if (!query) {
      pushToast("info", "검색어를 입력해 주세요.");
      return;
    }
    setLocalFileSearchLoading(true);
    try {
      const result = await searchLocalFiles(query);
      setLocalFileSearchResult(result);
    } catch (searchError) {
      console.warn("failed to search local files", searchError);
      setLocalFileSearchResult(null);
      pushToast("error", "파일 검색에 실패했습니다. 업무 엔진 연결 상태를 확인해 주세요.");
    } finally {
      setLocalFileSearchLoading(false);
    }
  }

  // D-04: 파일명 인덱스 갱신 보조 버튼.
  async function rebuildFileNameIndex() {
    setLocalFileIndexLoading(true);
    try {
      const result = await rebuildLocalFileIndex();
      setLocalFileIndexResult(result);
      pushToast("info", `파일명 색인을 갱신했습니다. (색인 ${result.indexed_count}건)`);
    } catch (indexError) {
      console.warn("failed to rebuild local file index", indexError);
      pushToast("error", "파일명 색인 갱신에 실패했습니다.");
    } finally {
      setLocalFileIndexLoading(false);
    }
  }

  // J-01: 첫 실행 빈 상태에서 바로 새 세션을 만들어 대화를 시작한다.
  async function createFirstWorkSession() {
    const created = await handleAction(
      () => createWorkSession({ title: "새 업무 세션", schedule_id: null }),
      "업무대화 세션을 만들었습니다.",
      { refresh: "none" },
    );
    if (created) {
      setSnapshot((current) => ({
        ...current,
        workSessions: [created, ...current.workSessions.filter((session) => session.id !== created.id)],
      }));
      setSelectedSessionId(created.id);
      revealContextSection("context");
    }
  }

  async function removeSessionFileLink(link: WorkSessionFileLinkItem) {
    if (!selectedSession) {
      return;
    }
    const deleted = await handleAction(
      () => deleteWorkSessionFileLink(selectedSession.id, link.id),
      "세션 연결 파일을 제거했습니다.",
      { revealSection: "context", refresh: "none" },
    );
    if (deleted) {
      await refreshSessionFileLinks(selectedSession.id);
    }
  }

  async function analyzeSelectedSessionForLearning() {
    if (!selectedSession) {
      return;
    }
    const analyzed = await handleAction(
      () => analyzeWorkSessionPersonalization(selectedSession.id),
      "현재 세션을 지식위키에 바로 반영했습니다.",
      { revealSection: "logs", refresh: "none" },
    );
    if (analyzed) {
      void refreshDeferredSnapshot("knowledge");
      void refreshDeferredSnapshot("logs");
    }
  }

  async function resetSelectedSessionContext() {
    if (!selectedSession) {
      return;
    }
    const sessionId = selectedSession.id;
    try {
      await resetWorkSessionContext(sessionId);
      setSessionContextSummaries((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      pushToast("info", "응답 맥락을 초기화했습니다.");
    } catch {
      pushToast("error", "응답 맥락 초기화에 실패했습니다.");
    }
  }

  async function submitCurrentChatDraft() {
    if (!selectedSession || (!chatDraft.trim() && chatAttachments.length === 0)) {
      return;
    }

    const messageText = chatDraft.trim() || "첨부 파일 전달";
    const attachmentDrafts = chatAttachments;

    setChatDraft("");
    setChatAttachments([]);
    setChatAttachmentPreviews([]);
    if (chatAttachmentInputRef.current) {
      chatAttachmentInputRef.current.value = "";
    }

    await runChatTurn(selectedSession, messageText, attachmentDrafts, []);
  }

  async function retryFailedChatTurn(failedMessageId: string) {
    const payload = chatRetryPayloads[failedMessageId];
    if (!payload) {
      return;
    }
    const session = snapshot.workSessions.find((item) => item.id === payload.sessionId);
    if (!session) {
      setError("다시 시도할 업무대화 세션을 찾지 못했습니다.");
      return;
    }

    setChatRetryPayloads((current) => {
      const next = { ...current };
      delete next[failedMessageId];
      return next;
    });
    // 실패한 낙관적 메시지 쌍을 지우고 같은 내용으로 다시 보낸다.
    setSessionMessages((current) => ({
      ...current,
      [payload.sessionId]: (current[payload.sessionId] ?? []).filter(
        (message) => message.id !== failedMessageId && message.id !== payload.optimisticUserMessageId,
      ),
    }));
    // 실패 시 입력창에 복원해 둔 초안이 그대로면 재전송과 겹치지 않도록 비운다.
    setChatDraft((current) => (current.trim() === payload.text.trim() ? "" : current));
    if (payload.attachmentDrafts.length > 0) {
      const draftIds = new Set(payload.attachmentDrafts.map((draft) => draft.id));
      setChatAttachments((current) => current.filter((draft) => !draftIds.has(draft.id)));
    }

    await runChatTurn(session, payload.text, payload.attachmentDrafts, payload.uploadedItems);
  }

  async function runChatTurn(
    session: WorkSessionItem,
    messageText: string,
    attachmentDrafts: ChatAttachmentDraft[],
    preUploadedItems: WorkSessionAttachmentItem[],
  ) {
    const pendingFiles = attachmentDrafts.map((attachment) => attachment.file);
    const optimisticAttachments: WorkSessionAttachmentItem[] =
      preUploadedItems.length > 0
        ? preUploadedItems
        : pendingFiles.map((file, index) => ({
            id: `${session.id}-upload-${Date.now()}-${index}`,
            session_id: session.id,
            message_id: null,
            file_name: file.name,
            mime_type: file.type || null,
            stored_path: file.name,
            size_bytes: file.size,
            text_excerpt: null,
            created_at: new Date().toISOString(),
          }));
    const optimisticUserMessage: WorkSessionMessageItem = {
      id: `${session.id}-user-${Date.now()}`,
      session_id: session.id,
      role: "user",
      text: messageText,
      message_type: "chat",
      status: "completed",
      attachments: optimisticAttachments,
      created_at: new Date().toISOString(),
    };
    const optimisticAssistantMessage: WorkSessionMessageItem = {
      id: `${session.id}-assistant-${Date.now()}`,
      session_id: session.id,
      role: "assistant",
      text: "응답을 준비하는 중입니다.",
      message_type: "chat",
      status: "pending",
      provider: snapshot.settings?.defaults.llm_provider ?? null,
      model: snapshot.settings?.defaults.llm_model ?? null,
      created_at: new Date().toISOString(),
    };

    setSessionMessages((current) => ({
      ...current,
      [session.id]: [
        ...(current[session.id] ?? []),
        optimisticUserMessage,
        optimisticAssistantMessage,
      ],
    }));

    setNotice("업무대화 요청을 보내고 있습니다.");

    let uploadedItems: WorkSessionAttachmentItem[] = preUploadedItems;
    try {
      if (uploadedItems.length === 0 && pendingFiles.length > 0) {
        uploadedItems = (await uploadWorkSessionAttachments(session.id, pendingFiles)).items;
      }
      let usedStreaming = false;
      let streamedAssistantId = optimisticAssistantMessage.id;
      let streamedText = "";
      let result: WorkSessionTurnResult;
      try {
        result = await runWorkSessionTurnStream(
          session.id,
          {
            text: messageText,
            attachment_ids: uploadedItems.map((item) => item.id),
            model_override: chatModelOverride.trim() || undefined,
            reasoning_effort: chatReasoningEffort,
          },
          {
            onUserMessage: (message) => {
              setSessionMessages((current) => ({
                ...current,
                [session.id]: (current[session.id] ?? []).map((item) =>
                  item.id === optimisticUserMessage.id
                    ? { ...message, attachments: message.attachments ?? uploadedItems }
                    : item,
                ),
              }));
            },
            onAssistantMessage: (message) => {
              streamedAssistantId = message.id;
              setSessionMessages((current) => ({
                ...current,
                [session.id]: (current[session.id] ?? []).map((item) =>
                  item.id === optimisticAssistantMessage.id
                    ? { ...message, text: "", status: "streaming" }
                    : item,
                ),
              }));
            },
            onDelta: (delta) => {
              streamedText += delta.text;
              setSessionMessages((current) => ({
                ...current,
                [session.id]: (current[session.id] ?? []).map((item) =>
                  item.id === streamedAssistantId || item.id === optimisticAssistantMessage.id
                    ? {
                        ...item,
                        id: streamedAssistantId,
                        text: streamedText,
                        status: "streaming",
                      }
                    : item,
                ),
              }));
            },
          },
        );
        usedStreaming = true;
      } catch (streamError) {
        if (!(streamError instanceof Error) || !streamError.message.startsWith("404")) {
          throw streamError;
        }
        result = await runWorkSessionTurn(session.id, {
          text: messageText,
          attachment_ids: uploadedItems.map((item) => item.id),
          model_override: chatModelOverride.trim() || undefined,
          reasoning_effort: chatReasoningEffort,
        });
      }
      if (result.context_summary) {
        setSessionContextSummaries((current) => ({
          ...current,
          [session.id]: result.context_summary!,
        }));
      }
      if (result.work_job) {
        revealContextSection("jobs");
        setSnapshot((current) =>
          mergeWorkspaceSnapshot(current, {
            workJobs: [result.work_job!, ...(current.workJobs ?? []).filter((job) => job.id !== result.work_job!.id)],
          }),
        );
        await refreshShellSnapshot({ silent: true });
      }
      const nextUserMessage = {
        ...result.user_message,
        attachments: result.user_message.attachments ?? uploadedItems,
      };

      if (usedStreaming) {
        setSessionMessages((current) => ({
          ...current,
          [session.id]: [
            ...(current[session.id] ?? []).filter(
              (message) =>
                ![
                  optimisticUserMessage.id,
                  optimisticAssistantMessage.id,
                  result.user_message.id,
                  result.assistant_message.id,
                ].includes(message.id),
            ),
            nextUserMessage,
            {
              ...result.assistant_message,
              latency_ms: result.assistant_message.latency_ms ?? result.duration_ms ?? null,
            },
          ],
        }));
      } else {
        await streamAssistantReply(
          session.id,
          {
            ...result.assistant_message,
            latency_ms: result.assistant_message.latency_ms ?? result.duration_ms ?? null,
          },
          nextUserMessage,
        );
      }

      if (result.assistant_message.status === "failed") {
        // J-03: 서버가 실패 메시지를 정상 응답으로 돌려주는 경로(스트리밍 포함)에서도
        // 입력을 복원하고 [다시 시도]가 가능해야 한다.
        setChatDraft((current) => (current.trim() ? current : messageText));
        setChatRetryPayloads((current) => ({
          ...current,
          [result.assistant_message.id]: {
            sessionId: session.id,
            text: messageText,
            attachmentDrafts: [],
            uploadedItems,
            optimisticUserMessageId: result.user_message.id,
          },
        }));
        setNotice("LLM 응답 생성에 실패했습니다. 설정과 연결 상태를 확인해주세요.");
        // C-09: 실패 흐름은 사용자가 원인을 바로 볼 수 있게 패널을 강제로 연다.
        revealContextSection(result.work_job ? "jobs" : "logs", { force: true });
        return;
      }

      if (result.work_job?.status === "blocked") {
        setNotice("앞선 업무대화 응답이 진행 중입니다. 우측 작업 진행에서 상태를 확인해 주세요.");
      } else {
        setNotice("업무대화 응답이 세션에 기록되었습니다.");
      }
    } catch (messageError) {
      console.warn("failed to run work session turn", messageError);
      setSessionMessages((current) => ({
        ...current,
        [session.id]: (current[session.id] ?? []).map((message) =>
          message.id === optimisticAssistantMessage.id
            ? {
                ...optimisticAssistantMessage,
                status: "failed",
                text:
                  messageError instanceof Error
                    ? `응답을 완료하지 못했습니다.\n\n${messageError.message}`
                    : "응답을 완료하지 못했습니다. 연결 상태를 다시 확인해 주세요.",
              }
            : message,
        ),
      }));
      // J-03: 실패해도 입력이 사라지지 않도록 본문과 첨부 초안을 입력창에 복원한다.
      setChatDraft((current) => (current.trim() ? current : messageText));
      const uploadSucceeded = uploadedItems.length > 0 || pendingFiles.length === 0;
      if (!uploadSucceeded) {
        setChatAttachments((current) => (current.length > 0 ? current : attachmentDrafts));
      }
      setChatRetryPayloads((current) => ({
        ...current,
        [optimisticAssistantMessage.id]: {
          sessionId: session.id,
          text: messageText,
          // 업로드가 이미 성공한 첨부는 id를 재사용하고, 실패했으면 초안으로 되살린다.
          attachmentDrafts: uploadSucceeded ? [] : attachmentDrafts,
          uploadedItems: uploadSucceeded ? uploadedItems : [],
          optimisticUserMessageId: optimisticUserMessage.id,
        },
      }));
      setError(messageError instanceof Error ? messageError.message : "업무대화 요청에 실패했습니다.");
      // C-09: 실패 흐름은 사용자가 원인을 바로 볼 수 있게 패널을 강제로 연다.
      revealContextSection("logs", { force: true });
    }
  }

  function submitChatDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitCurrentChatDraft();
  }

  function handleChatComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitCurrentChatDraft();
    }
  }

  async function linkSelectedSessionToSchedule() {
    if (!selectedSessionId || !selectedScheduleId) {
      return;
    }

    const updated = await handleAction(
      () =>
        updateWorkSession(selectedSessionId, {
          schedule_id: selectedScheduleId,
        }),
      "현재 세션을 일정에 연결했습니다.",
      { refresh: "none" },
    );
    if (updated) {
      setSnapshot((current) => ({
        ...current,
        workSessions: current.workSessions.map((session) => (session.id === updated.id ? updated : session)),
      }));
      revealContextSection("context");
    }
  }






  function continueSelectedSessionToDocuments() {
    if (!selectedSession) {
      setNotice("문서작성으로 이어갈 업무대화 세션을 먼저 선택하세요.");
      return;
    }
    setDocumentSourceMode("session");
    setDocumentSourceSessionId(selectedSession.id);
    setDocumentForm((current) => ({
      ...current,
      title: `${selectedSession.title} 문서`,
      purpose: "업무대화 세션 기반 정리",
      outline: `${selectedSession.title} 대화 내용을 바탕으로 문서를 작성합니다.`,
      template_key: current.template_key || activeTemplateKey,
      document_format: "onePageReport",
    }));
    setAuthoringFormatKey("onePageReport");
    setAuthoringInstruction((current) =>
      current.trim() ? current : `${selectedSession.title} 대화 내용을 바탕으로 문서를 작성합니다.`,
    );
    setAuthoringTab("references");
    // W5-2: 문서작성으로 넘어가도 "대화로 돌아가기" 칩으로 바로 복귀할 수 있게 출발 컨텍스트를 남긴다.
    setChatReturnContext({
      sessionId: selectedSession.id,
      title: selectedSession.title,
      from: "documents",
    });
    setActiveMenu("documents");
    revealContextSection("context");
    setNotice("현재 업무대화 세션을 문서작성 입력으로 연결했습니다.");
  }

  // D-04: 파일 연결 모달. 툴바 [파일 연결]로 연다.
  function renderFileLinkModal() {
    if (!chatFileLinkModalOpen || !selectedSession) {
      return null;
    }

    const linkedPathSet = new Set(selectedSessionFileLinks.map((link) => link.file_path));
    const searchDisabledReason = localFileSearchLoading
      ? "검색이 진행 중입니다"
      : !localFileQuery.trim()
        ? "검색어를 먼저 입력해 주세요"
        : undefined;

    return (
      <div
        className="chat-file-link-backdrop"
        data-testid="chat-file-link-modal-backdrop"
        onClick={closeChatFileLinkModal}
      >
        <div
          className="chat-file-link-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="세션 파일 연결"
          data-testid="chat-file-link-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="chat-file-link-dialog__header">
            <div>
              <strong>파일 연결</strong>
              <p className="subtle-text">연결된 파일을 확인·해제하고, 파일명 색인에서 검색해 새로 연결합니다.</p>
            </div>
            <button
              type="button"
              className="icon-button icon-button--sm"
              aria-label="파일 연결 닫기"
              title="파일 연결 닫기 (Esc)"
              onClick={closeChatFileLinkModal}
            >
              <AssetIcon src="/icons/action/close.svg" />
            </button>
          </div>

          {/* W5-3: 연결된 파일 목록 — 통합 버튼에서 바로 열람·해제할 수 있는 섹션 */}
          <section className="chat-file-link-dialog__linked" data-testid="chat-file-link-linked-list">
            <strong className="chat-file-link-dialog__section-title" data-testid="chat-file-link-count">
              연결된 파일 {selectedSessionFileLinks.length}개
            </strong>
            {selectedSessionFileLinks.length === 0 ? (
              <p className="subtle-text">아직 연결된 파일이 없습니다. 아래에서 검색해 연결하세요.</p>
            ) : (
              selectedSessionFileLinks.map((link) => {
                // W6: 파서가 남긴 깨진 제목(서식 보일러플레이트·표 셀 나열)은 파일명으로 보정한다.
                const linkTitle = displayTitleForFile(link.label, link.file_path);
                return (
                  <article key={link.id} className="chat-file-link-dialog__row" data-testid={`chat-file-link-row-${link.id}`}>
                    <div className="chat-file-link-dialog__row-main">
                      <strong>{linkTitle}</strong>
                      <p>{link.file_path}</p>
                    </div>
                    <div className="inline-actions chat-file-link-dialog__row-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        aria-label={`${linkTitle} 열기`}
                        title="연결된 파일 원본 열기"
                        onClick={() => void openExternalTarget(link.file_path)}
                      >
                        열기
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        data-testid={`chat-file-link-remove-${link.id}`}
                        aria-label={`${linkTitle} 연결 해제`}
                        title="이 세션과의 연결만 해제합니다 (파일은 삭제되지 않음)"
                        onClick={() => void removeSessionFileLink(link)}
                      >
                        연결 해제
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </section>

          <strong className="chat-file-link-dialog__section-title">파일 검색해 연결</strong>
          <form
            className="chat-file-link-dialog__search"
            onSubmit={(event) => {
              event.preventDefault();
              void runLocalFileSearch();
            }}
          >
            <input
              ref={fileLinkSearchInputRef}
              data-testid="chat-file-link-search-input"
              aria-label="연결할 파일 검색어"
              value={localFileQuery}
              onChange={(event) => setLocalFileQuery(event.target.value)}
              placeholder="파일명이나 키워드를 입력하고 Enter"
            />
            <button
              type="submit"
              disabled={localFileSearchLoading || !localFileQuery.trim()}
              title={searchDisabledReason ?? "파일명 색인에서 검색"}
            >
              {localFileSearchLoading ? "검색 중..." : "검색"}
            </button>
            <button
              type="button"
              className="button-secondary"
              data-testid="chat-file-link-rebuild-index"
              disabled={localFileIndexLoading}
              title={
                localFileIndexLoading
                  ? "파일명 색인 갱신이 진행 중입니다"
                  : "찾는 파일이 없으면 파일명 색인을 다시 만듭니다"
              }
              onClick={() => void rebuildFileNameIndex()}
            >
              {localFileIndexLoading ? "갱신 중..." : "파일명 인덱스 갱신"}
            </button>
          </form>

          <div className="chat-file-link-dialog__results" data-testid="chat-file-link-results">
            {localFileSearchLoading ? <p className="subtle-text">검색 중입니다...</p> : null}
            {!localFileSearchLoading && !localFileSearchResult ? (
              <EmptyState
                title="연결할 파일을 검색하세요."
                body="검색 결과에서 [연결]을 누르면 현재 세션에 바로 연결됩니다."
              />
            ) : null}
            {!localFileSearchLoading && localFileSearchResult && localFileSearchResult.items.length === 0 ? (
              <EmptyState
                title="검색 결과가 없습니다."
                body="다른 검색어를 입력하거나 파일명 인덱스를 갱신해 보세요."
              />
            ) : null}
            {!localFileSearchLoading && localFileSearchResult
              ? localFileSearchResult.items.map((hit) => {
                  // W6: 검색 결과 행 제목도 동일하게 보정 — 깨진 파싱 제목 대신 파일명을 보여준다.
                  const hitTitle = displayTitleForFile(hit.file.title, hit.file.file_path);
                  const alreadyLinked = linkedPathSet.has(hit.file.file_path);
                  return (
                    <article key={hit.file.id} className="chat-file-link-dialog__row">
                      <div className="chat-file-link-dialog__row-main">
                        <strong>{hitTitle}</strong>
                        <p>{hit.file.file_path}</p>
                        {hit.file.text_excerpt ? (
                          <p className="chat-file-link-dialog__excerpt">{hit.file.text_excerpt}</p>
                        ) : null}
                      </div>
                      {alreadyLinked ? (
                        <span className="pill pill--soft" data-testid="chat-file-link-linked">
                          연결됨
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => void connectLocalFileToSession(hit)}
                        >
                          연결
                        </button>
                      )}
                    </article>
                  );
                })
              : null}
          </div>

        </div>
      </div>
    );
  }

  function renderChatSection() {
    const activeChatModel =
      chatModelOverride.trim() || snapshot.settings?.defaults.llm_model || "현재 활성 모델";
    // W6: 입력 대기 안내 — 입력창이 비어 있고 응답 생성 중이 아닐 때만 예시 문구를 권한다.
    // LLM 미설정이면 J-02 안내(LlmSetupNotice)가 이미 떠 있으므로 겹치지 않게 숨긴다.
    const isTurnInFlight = selectedSessionMessages.some(
      (message) => message.status === "pending" || message.status === "streaming",
    );
    const composerHintTip =
      CHAT_EXAMPLE_TIPS.length > 0
        ? CHAT_EXAMPLE_TIPS[dailyTipIndex(CHAT_EXAMPLE_TIPS.length)]
        : null;
    const showComposerHint =
      isLlmConfigured &&
      !isTurnInFlight &&
      chatDraft.length === 0 &&
      chatAttachments.length === 0 &&
      composerHintTip?.chatExample != null;
    const scheduleActionLabel = selectedSession?.schedule_id
      ? "연결 일정 열기"
      : selectedScheduleId
        ? "선택 일정과 연결"
        : "일정 열기";
    return (
      <>
        <SectionCard
          title={selectedSession ? selectedSession.title : "세션을 선택하세요"}
          className="chat-panel-card"
          testId="chat-panel-card"
        >
          {selectedSession ? (
            <div className="chat-workspace" data-testid="chat-workspace">
              <div className="chat-thread" data-testid="chat-thread-shell" ref={chatThreadRef}>
                {selectedSessionMessages.length === 0 ? (
                  <EmptyState
                    title="아직 대화가 없습니다."
                    body="입력창에 요청이나 메모를 남기면 이 세션의 대화가 쌓입니다."
                  />
                ) : (
                  selectedSessionMessages.map((message) => (
                    <article
                      key={message.id}
                      className={`chat-message ${
                        message.role === "assistant" ? "chat-message--assistant" : "chat-message--user"
                      }`}
                      data-testid="chat-thread-message"
                    >
                      <div className="chat-message__meta">
                        {message.role === "assistant" ? (
                          <span className="chat-message__eyebrow">Assistant</span>
                        ) : null}
                        <div className="chat-message__meta-pills">
                          {message.status === "failed" ? (
                            <span className="pill pill--danger" data-testid={`message-failed-${message.id}`}>
                              실패
                            </span>
                          ) : (
                            <>
                              {describeMessageStatus(message.status) && !formatLatencyBadge(message.latency_ms) ? (
                                <span className="pill pill--soft">{describeMessageStatus(message.status)}</span>
                              ) : null}
                              {message.role === "assistant" && formatLatencyBadge(message.latency_ms) ? (
                                <span className="pill pill--soft" data-testid={`message-latency-${message.id}`}>
                                  {formatLatencyBadge(message.latency_ms)}
                                </span>
                              ) : null}
                            </>
                          )}
                        {message.role === "user" ? <span className="chat-message__eyebrow">You</span> : null}
                      </div>
                      </div>
                      {message.role === "assistant" && (message.provider || message.model) ? (
                        <p className="subtle-text chat-message__provider">
                          {[message.provider, message.model].filter(Boolean).join(" / ")}
                        </p>
                      ) : null}
                      {message.role === "assistant" ? (
                        message.status === "failed" ? (
                          (() => {
                            const failed = splitFailedAssistantMessage(message.text);
                            return (
                              <div className="chat-message__failed" data-testid={`chat-failed-body-${message.id}`}>
                                <p>{failed.summary}</p>
                                {failed.detail ? (
                                  <details className="chat-message__error-details">
                                    <summary>상세 정보</summary>
                                    <pre>{failed.detail}</pre>
                                  </details>
                                ) : null}
                                <div className="inline-actions">
                                  <button
                                    type="button"
                                    className="button-secondary"
                                    onClick={() => setActiveMenu("settings")}
                                  >
                                    환경설정으로 이동
                                  </button>
                                  {chatRetryPayloads[message.id] ? (
                                    <button
                                      type="button"
                                      className="button-secondary button-with-icon"
                                      data-testid={`chat-retry-${message.id}`}
                                      aria-label="다시 시도"
                                      title="같은 내용으로 다시 요청"
                                      onClick={() => void retryFailedChatTurn(message.id)}
                                    >
                                      <AssetIcon src="/icons/action/rebuild.svg" />
                                      다시 시도
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <div className="chat-markdown">
                            {renderMarkdownContent(getVisibleMessageText(message), (target) => {
                              void openExternalTarget(target);
                            })}
                          </div>
                        )
                      ) : (
                        <div className="chat-user-bubble">
                          <p>{getVisibleMessageText(message)}</p>
                        </div>
                      )}
                      {message.role === "assistant" &&
                      message.status !== "failed" &&
                      (message.citations?.length ?? 0) > 0 ? (
                        <div className="chat-citations" data-testid={`chat-citations-${message.id}`}>
                          <span className="chat-citations__label">출처</span>
                          {(message.citations ?? []).map((citation, citationIndex) => {
                            const citationTitle = displayTitleForFile(citation.title, citation.file_path);
                            return (
                              <span
                                key={`${message.id}-citation-${citationIndex}`}
                                className="chat-citation-chip"
                                title={citation.file_path}
                              >
                                <span className="chat-citation-chip__title">{citationTitle}</span>
                                <button
                                  type="button"
                                  className="icon-button icon-button--sm"
                                  aria-label={`${citationTitle} 원본 열기`}
                                  title={
                                    citation.doc_uid
                                      ? "원본 열기 (원본이 없으면 지식카드로 대신 엽니다)"
                                      : "원본 열기"
                                  }
                                  onClick={() => void openCitationOriginal(citation)}
                                >
                                  <AssetIcon src="/icons/action/folder-open.svg" />
                                </button>
                                <button
                                  type="button"
                                  className="icon-button icon-button--sm"
                                  aria-label={`${citationTitle} 경로 복사`}
                                  title="경로 복사"
                                  onClick={() => void copyCitationPath(citation.file_path)}
                                >
                                  <AssetIcon src="/icons/action/copy.svg" />
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                      {message.attachments?.length ? (
                        <ul className="chat-attachment-list">
                          {message.attachments.map((attachment) => (
                            <li key={attachment.id}>
                              <span>{attachment.file_name}</span>
                              <span className="subtle-text">{attachment.size_bytes} bytes</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))
                )}
              </div>

              <div className="chat-session-toolbar">
                <label className="select-field chat-session-toolbar__schedule">
                  연결 일정
                  <select value={selectedScheduleId} onChange={(event) => setSelectedScheduleId(event.target.value)}>
                    <option value="">선택 안 함</option>
                    {snapshot.schedules.map((schedule) => (
                      <option key={schedule.id} value={schedule.id}>
                        {schedule.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="chat-session-toolbar__actions">
                  <button
                    type="button"
                    className="icon-button"
                    data-testid={selectedSession.schedule_id ? "open-selected-session-schedule" : undefined}
                    aria-label={scheduleActionLabel}
                    title={scheduleActionLabel}
                    onClick={() => {
                      // W5-2: 일정 화면으로 넘어가면 상단 복귀 칩으로 이 대화에 바로 돌아올 수 있게 한다.
                      const rememberChatOrigin = () =>
                        setChatReturnContext({
                          sessionId: selectedSession.id,
                          title: selectedSession.title,
                          from: "schedule",
                        });
                      if (selectedSession.schedule_id && selectedSessionSchedule) {
                        setSelectedScheduleId(selectedSessionSchedule.id);
                        rememberChatOrigin();
                        setActiveMenu("schedule");
                        return;
                      }
                      if (selectedScheduleId) {
                        void linkSelectedSessionToSchedule();
                        return;
                      }
                      rememberChatOrigin();
                      setActiveMenu("schedule");
                    }}
                  >
                    <AssetIcon src="/icons/action/calendar-link.svg" />
                  </button>
                  {/* W5-3: [파일 연결]과 [연결 파일 보기]를 한 버튼으로 통합 — 클릭하면 목록·해제·검색을 한 모달에서 처리 */}
                  <button
                    type="button"
                    className="icon-button"
                    data-testid="chat-file-links-button"
                    aria-label="파일 연결"
                    title={
                      selectedSessionFileLinks.length > 0
                        ? `파일 연결 — 연결 파일 ${selectedSessionFileLinks.length}개 보기·해제`
                        : "파일 연결"
                    }
                    onClick={openRelatedFileSearch}
                  >
                    <AssetIcon src="/icons/action/link.svg" />
                    {selectedSessionFileLinks.length > 0 ? (
                      <span className="icon-button__badge" data-testid="chat-file-links-badge">
                        {selectedSessionFileLinks.length}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="문서작성으로 이어가기"
                    title="문서작성으로 이어가기"
                    onClick={continueSelectedSessionToDocuments}
                  >
                    <AssetIcon src="/icons/action/doc-forward.svg" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="이 세션 지식 반영"
                    title="이 세션 지식 반영"
                    onClick={() => void analyzeSelectedSessionForLearning()}
                  >
                    <AssetIcon src="/icons/action/knowledge.svg" />
                  </button>
                </div>
              </div>

              {selectedSessionContextEvidence.length > 0 ? (
                <div className="chat-context-evidence" data-testid="chat-context-evidence">
                  <span className="chat-context-evidence__label">최근 응답 맥락</span>
                  <button
                    type="button"
                    className="chat-context-evidence__reset"
                    title="이 세션에 쌓인 응답 맥락(요약)을 초기화합니다."
                    aria-label="응답 맥락 초기화"
                    onClick={() => void resetSelectedSessionContext()}
                  >
                    <AssetIcon src="/icons/action/rebuild.svg" />
                  </button>
                  {selectedSessionContextEvidence.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="pill pill--soft chat-context-evidence__pill"
                      onClick={() => openResponseContextDetail(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}

              {!isLlmConfigured ? (
                <LlmSetupNotice onOpenSettings={() => setActiveMenu("settings")} />
              ) : null}

              {showComposerHint && composerHintTip ? (
                <div className="chat-composer-hint" data-testid="chat-composer-hint" role="note">
                  <span className="chat-composer-hint__label">이렇게 말해보세요</span>
                  <button
                    type="button"
                    className="chat-composer-hint__example"
                    data-testid="chat-composer-hint-example"
                    title="클릭하면 입력창에 예시 문구만 채워집니다 (전송되지 않음)"
                    onClick={() => {
                      setChatDraft(composerHintTip.chatExample!);
                      composerTextareaRef.current?.focus();
                    }}
                  >
                    &ldquo;{composerHintTip.chatExample}&rdquo;
                  </button>
                </div>
              ) : null}

              <form
                className="chat-composer"
                data-testid="chat-composer-form"
                onSubmit={submitChatDraft}
                onDragOver={handleChatComposerDragOver}
                onDrop={handleChatComposerDrop}
              >
                {chatAttachmentPreviews.length ? (
                  <div className="chat-composer__preview-strip">
                    {chatAttachmentPreviews.map((preview) => (
                      <figure key={preview.key} className="chat-composer__preview-card">
                        <button
                          type="button"
                          className="chat-composer__preview-open"
                          aria-label={`${preview.name} 크게 보기`}
                          onClick={() => setChatImagePreviewOpen(preview)}
                        >
                          <img src={preview.url} alt={`${preview.name} 미리보기`} />
                        </button>
                        <button
                          type="button"
                          className="chat-composer__preview-remove"
                          aria-label={`${preview.name} 제거`}
                          title={`${preview.name} 제거`}
                          onClick={() => removeChatAttachment(preview.attachmentId)}
                        >
                          <AssetIcon src="/icons/action/close.svg" />
                        </button>
                        <figcaption>{preview.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
                {chatAttachments.length ? (
                  <div className="chat-composer__attachment-list">
                    {chatAttachments.map((attachment) => (
                      <span key={attachment.id} className="pill pill--soft chat-composer__attachment-pill">
                        <span>{attachment.file.name}</span>
                        <button
                          type="button"
                          className="chat-composer__attachment-remove"
                          aria-label={`${attachment.file.name} 첨부 제거`}
                          title={`${attachment.file.name} 첨부 제거`}
                          onClick={() => removeChatAttachment(attachment.id)}
                        >
                          <AssetIcon src="/icons/action/close.svg" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="chat-composer__box">
                  <textarea
                    ref={composerTextareaRef}
                    aria-label="업무대화 입력"
                    data-testid="chat-composer-input"
                    rows={4}
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.target.value)}
                    onKeyDown={handleChatComposerKeyDown}
                    onPaste={handleChatComposerPaste}
                    placeholder="업무 요청이나 메모를 입력하세요. 예: 지식폴더에서 ○○ 근거 찾아줘"
                  />
                  <div className="chat-composer__actions">
                    <div className="chat-composer__left-actions">
                      <button
                        type="button"
                        className="icon-button icon-button--lg"
                        data-testid="chat-attachment-trigger"
                        aria-label="파일 첨부"
                        title="파일 첨부"
                        onClick={() => chatAttachmentInputRef.current?.click()}
                      >
                        <AssetIcon src="/icons/action/attach.svg" />
                      </button>
                      <input
                        ref={chatAttachmentInputRef}
                        data-testid="chat-attachment-input"
                        type="file"
                        multiple
                        hidden
                        onChange={(event) => appendChatAttachments(event.target.files)}
                      />
                      <button
                        type="button"
                        className={`icon-button icon-button--lg ${chatDetailsOpen ? "is-active" : ""}`}
                        ref={chatDetailsButtonRef}
                        aria-label="세부 설정"
                        title="세부 설정"
                        aria-expanded={chatDetailsOpen}
                        onClick={() => setChatDetailsOpen((current) => !current)}
                      >
                        <AssetIcon src="/icons/action/settings-sliders.svg" />
                      </button>
                    </div>
                    <div className="chat-composer__right-actions">
                      <button
                        type="submit"
                        className="icon-button icon-button--lg icon-button--accent"
                        data-testid="chat-composer-submit"
                        aria-label="보내기"
                        title="보내기 (Enter)"
                        disabled={!chatDraft.trim() && chatAttachments.length === 0}
                      >
                        <AssetIcon src="/icons/action/send-inverse.svg" />
                      </button>
                    </div>
                  </div>
                </div>
                {chatDetailsOpen ? (
                  <div
                    ref={chatDetailsPanelRef}
                    className="chat-composer__detail-popover"
                    role="dialog"
                    aria-label="채팅 세부 설정"
                  >
                    <label>
                      이번 응답 모델
                      <input
                        value={chatModelOverride}
                        onChange={(event) => setChatModelOverride(event.target.value)}
                        placeholder={snapshot.settings?.defaults.llm_model ?? "현재 활성 모델"}
                      />
                    </label>
                    <label className="select-field">
                      리즈닝 강도
                      <select
                        value={chatReasoningEffort}
                        onChange={(event) =>
                          setChatReasoningEffort(
                            event.target.value as "auto" | "minimal" | "low" | "medium" | "high",
                          )
                        }
                      >
                        <option value="auto">자동</option>
                        <option value="minimal">간단</option>
                        <option value="low">낮음</option>
                        <option value="medium">보통</option>
                        <option value="high">높음</option>
                      </select>
                    </label>
                    <p className="subtle-text">
                      현재 모델: {activeChatModel} / 리즈닝: {describeReasoningEffort(chatReasoningEffort)}
                    </p>
                  </div>
                ) : null}
              </form>
              {chatImagePreviewOpen ? (
                <div
                  className="chat-image-dialog-backdrop"
                  onClick={() => setChatImagePreviewOpen(null)}
                >
                  <div
                    className="chat-image-dialog"
                    role="dialog"
                    aria-label={`${chatImagePreviewOpen.name} 미리보기`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="chat-image-dialog__close"
                      aria-label="미리보기 닫기"
                      title="미리보기 닫기"
                      onClick={() => setChatImagePreviewOpen(null)}
                    >
                      <AssetIcon src="/icons/action/close.svg" />
                    </button>
                    <img src={chatImagePreviewOpen.url} alt={`${chatImagePreviewOpen.name} 미리보기`} />
                    <p>{chatImagePreviewOpen.name}</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state chat-empty-cta" data-testid="chat-empty-cta">
              <p className="empty-state__title chat-empty-cta__title">
                {snapshot.workSessions.length === 0
                  ? "아직 열린 업무대화 세션이 없습니다."
                  : "이어갈 업무대화 세션을 선택하세요."}
              </p>
              <p>새 세션을 만들면 바로 업무 요청이나 메모를 남길 수 있습니다.</p>
              <button
                type="button"
                data-testid="chat-create-session-cta"
                onClick={() => void createFirstWorkSession()}
              >
                새 세션 만들기
              </button>
            </div>
          )}
        </SectionCard>
        {renderFileLinkModal()}
      </>
    );
  }

  return renderChatSection();
}
