import { and, asc, eq, isNull } from "drizzle-orm";
import { assets, issueAttachments, issueComments, type Db } from "@paperclipai/db";
import { currentConversationCommentCondition } from "./agent-conversations.js";
import {
  findLatestFileCardRequest,
  resolveChatIntakeReport,
  type ChatIntakeAttachment,
  type ChatIntakeComment,
  type ChatIntakeReport,
} from "./chat-intake-report.js";

const COMMENT_PAGE = 200;

function commentAuthorType(
  authorType: string | null,
  authorUserId: string | null,
): ChatIntakeComment["authorType"] {
  if (authorType === "agent" || authorType === "system") return authorType;
  if (authorType === "user" || authorUserId) return "user";
  return "system";
}

/** Current-session conversation comments, oldest first, with their own attachments. */
export async function loadChatIntakeComments(
  db: Db,
  input: { companyId: string; issueId: string },
): Promise<ChatIntakeComment[]> {
  const rows = await db
    .select({
      id: issueComments.id,
      authorType: issueComments.authorType,
      authorUserId: issueComments.authorUserId,
      body: issueComments.body,
      createdAt: issueComments.createdAt,
    })
    .from(issueComments)
    .where(and(
      eq(issueComments.companyId, input.companyId),
      eq(issueComments.issueId, input.issueId),
      isNull(issueComments.deletedAt),
      currentConversationCommentCondition(),
    ))
    .orderBy(asc(issueComments.createdAt), asc(issueComments.id))
    .limit(COMMENT_PAGE);

  if (rows.length === 0) return [];

  const attachments = await db
    .select({
      id: issueAttachments.id,
      issueCommentId: issueAttachments.issueCommentId,
      filename: assets.originalFilename,
    })
    .from(issueAttachments)
    .innerJoin(assets, and(
      eq(assets.id, issueAttachments.assetId),
      eq(assets.companyId, input.companyId),
    ))
    .where(and(
      eq(issueAttachments.companyId, input.companyId),
      eq(issueAttachments.issueId, input.issueId),
    ));

  const byComment = new Map<string, ChatIntakeAttachment[]>();
  for (const attachment of attachments) {
    if (!attachment.issueCommentId) continue;
    const list = byComment.get(attachment.issueCommentId) ?? [];
    list.push({ id: attachment.id, filename: attachment.filename ?? null });
    byComment.set(attachment.issueCommentId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    authorType: commentAuthorType(row.authorType, row.authorUserId),
    authorUserId: row.authorUserId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    attachments: byComment.get(row.id) ?? [],
  }));
}

export async function resolveLoadedChatIntakeReport(
  db: Db,
  input: { companyId: string; issueId: string; requestCommentId?: string | null },
): Promise<ChatIntakeReport | null> {
  const comments = await loadChatIntakeComments(db, input);
  const request = (input.requestCommentId
    ? comments.find((comment) => comment.id === input.requestCommentId)
    : null) ?? findLatestFileCardRequest(comments);
  if (!request) return null;
  return resolveChatIntakeReport({ comments, requestComment: request });
}
