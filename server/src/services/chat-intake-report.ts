/**
 * Harness-owned resolution of "what I just reported" / "this" when a person
 * asks chat to file a card. The conversation issue holds every screenshot in
 * that chat; list_task_attachments returns all of them. Filing from a
 * space-wide attachment is how an unrelated magic-link screenshot was
 * filed instead of the same-thread report.
 */

export type ChatIntakeAttachment = {
  id: string;
  filename: string | null;
};

export type ChatIntakeComment = {
  id: string;
  authorType: "user" | "agent" | "system";
  authorUserId: string | null;
  body: string;
  createdAt: string;
  replyToCommentId?: string | null;
  attachments?: ChatIntakeAttachment[];
};

export type ChatIntakeReportSource = "reply_to" | "latest_same_author_report";

export type ChatIntakeReport = {
  commentId: string;
  authorUserId: string | null;
  body: string;
  createdAt: string;
  source: ChatIntakeReportSource;
  attachments: ChatIntakeAttachment[];
};

export const CHAT_INTAKE_CREATE_TASK_DENIAL =
  "Post the proposed card title and a one-line summary as a comment in this conversation before create_task. That comment must include the same title you then pass to create_task.";

const FILE_CARD_NAME = /\b(card|ticket|issue)\b/;
const FILE_CARD_ACTION = /\b(file|filed|filing|write up|write-up|open|create|make)\b/;
const FILE_CARD_PRIOR =
  /\b(what i just reported|what i reported|what i just said|what i said|this|that report|the report)\b/;
const ACK_OR_COMMAND =
  /^(?:cancel(?:\s+[a-z]{2,}-\d+)?|please cancel(?:\s+[a-z]{2,}-\d+)?|thanks|thank you|thx|ok|okay|yes|yep|no|nope|got it)[.!]?\s*$/i;

function normalizeBody(body: string): string {
  return body.trim().toLowerCase().replace(/['\u2019]/g, "'");
}

export function isFileCardRequest(body: string): boolean {
  const text = normalizeBody(body);
  if (!text) return false;
  return FILE_CARD_NAME.test(text) && FILE_CARD_ACTION.test(text) && FILE_CARD_PRIOR.test(text);
}

export function isAckOrCommand(body: string): boolean {
  return ACK_OR_COMMAND.test(body.trim());
}

export function isReportComment(comment: ChatIntakeComment): boolean {
  if (comment.authorType !== "user") return false;
  const body = comment.body.trim();
  if (isFileCardRequest(body)) return false;
  if (body === "/new") return false;
  const hasAttachments = Boolean(comment.attachments?.length);
  if (isAckOrCommand(body) && !hasAttachments) return false;
  return body.length > 0 || hasAttachments;
}

export function findLatestFileCardRequest(comments: ChatIntakeComment[]): ChatIntakeComment | null {
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const comment = comments[i];
    if (comment.authorType === "user" && isFileCardRequest(comment.body)) return comment;
  }
  return null;
}

function commentOrder(left: ChatIntakeComment, right: ChatIntakeComment): number {
  if (left.createdAt < right.createdAt) return -1;
  if (left.createdAt > right.createdAt) return 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function isBeforeRequest(comment: ChatIntakeComment, request: ChatIntakeComment): boolean {
  return commentOrder(comment, request) < 0;
}

function toReport(comment: ChatIntakeComment, source: ChatIntakeReportSource): ChatIntakeReport {
  return {
    commentId: comment.id,
    authorUserId: comment.authorUserId,
    body: comment.body,
    createdAt: comment.createdAt,
    source,
    attachments: comment.attachments ?? [],
  };
}

/**
 * Resolve the report a file-card request refers to. Reply-to wins. Otherwise
 * the requester's latest report in this conversation, skipping acks/commands.
 * Never prefers a screenshot merely because it is attached somewhere on the issue.
 */
export function resolveChatIntakeReport(input: {
  comments: ChatIntakeComment[];
  requestComment: ChatIntakeComment;
}): ChatIntakeReport | null {
  const ordered = [...input.comments].sort(commentOrder);
  const beforeRequest = ordered.filter((comment) => isBeforeRequest(comment, input.requestComment));

  const replyToId = input.requestComment.replyToCommentId;
  if (replyToId) {
    const target = ordered.find((comment) => comment.id === replyToId);
    if (target && target.authorType === "user") return toReport(target, "reply_to");
  }

  const authorUserId = input.requestComment.authorUserId;
  for (let i = beforeRequest.length - 1; i >= 0; i -= 1) {
    const comment = beforeRequest[i];
    if (!isReportComment(comment)) continue;
    if (authorUserId && comment.authorUserId !== authorUserId) continue;
    return toReport(comment, "latest_same_author_report");
  }
  return null;
}

/** Every screenshot on the conversation, in comment order — the space-wide trap. */
export function listConversationScreenshots(comments: ChatIntakeComment[]): ChatIntakeAttachment[] {
  return comments.flatMap((comment) => comment.attachments ?? []);
}

export function formatChatIntakeReportForWake(report: ChatIntakeReport): string {
  const longestBacktickRun = Math.max(
    2,
    ...Array.from(report.body.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestBacktickRun + 1);
  const lines = [
    'Use only this report when filing a card from "what I just reported" or "this". It is the message they replied to, or otherwise this person\'s latest report in this conversation. Do not pick a screenshot or file from list_task_attachments or from any other message.',
    `Source: ${report.source}`,
    `Comment id: ${JSON.stringify(report.commentId)}`,
    `Created at: ${report.createdAt}`,
    "Report body (quoted user data):",
    `${fence}text`,
    report.body,
    fence,
  ];
  if (report.attachments.length > 0) {
    lines.push("Attachments on this report only:");
    for (const attachment of report.attachments) {
      lines.push(`- ${JSON.stringify({ id: attachment.id, filename: attachment.filename })}`);
    }
  } else {
    lines.push("This report has no attachments. Do not attach or quote a screenshot from another message.");
  }
  return lines.join("\n");
}

export function formatIntakeTitleReadback(input: { title: string; summary: string }): string {
  return `Proposed title: ${input.title.trim()}\n${input.summary.trim()}`;
}

function commentContainsTitle(body: string, title: string): boolean {
  const needle = title.trim();
  if (needle.length < 8) return false;
  return body.includes(needle);
}

export function intakeTitleReadbackPosted(input: {
  comments: ChatIntakeComment[];
  requestCommentId: string;
  proposedTitle: string;
}): boolean {
  const ordered = [...input.comments].sort(commentOrder);
  const requestIndex = ordered.findIndex((comment) => comment.id === input.requestCommentId);
  if (requestIndex < 0) return false;
  return ordered.slice(requestIndex + 1).some(
    (comment) => comment.authorType === "agent" && commentContainsTitle(comment.body, input.proposedTitle),
  );
}

export function chatIntakeCreateTaskDenial(input: {
  comments: ChatIntakeComment[];
  proposedTitle: string;
}): string | null {
  const request = findLatestFileCardRequest(input.comments);
  if (!request) return null;
  if (intakeTitleReadbackPosted({
    comments: input.comments,
    requestCommentId: request.id,
    proposedTitle: input.proposedTitle,
  })) {
    return null;
  }
  return CHAT_INTAKE_CREATE_TASK_DENIAL;
}
