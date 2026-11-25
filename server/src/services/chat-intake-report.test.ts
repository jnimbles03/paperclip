import { describe, expect, it } from "vitest";
import {
  CHAT_INTAKE_CREATE_TASK_DENIAL,
  CHAT_INTAKE_FILE_CARD_DIRECTIVE,
  chatIntakeCreateTaskDenial,
  findLatestFileCardRequest,
  formatChatIntakeReportForWake,
  formatIntakeTitleReadback,
  intakeTitleReadbackPosted,
  isFileCardRequest,
  listConversationScreenshots,
  resolveChatIntakeReport,
  type ChatIntakeComment,
} from "./chat-intake-report.js";

const CHRIS = "chris-uat";
const OTHER = "other-space-member";

function comment(
  partial: Omit<ChatIntakeComment, "authorType"> & { authorType?: ChatIntakeComment["authorType"] },
): ChatIntakeComment {
  return { authorType: "user", attachments: [], ...partial };
}

/** 11/25 ~2:56 AM AZ UAT thread that produced a card from the wrong screenshot. */
function uatAfterHoursThread(options?: { replyToAfterHours?: boolean }): ChatIntakeComment[] {
  const afterHoursId = "c-after-hours";
  return [
    comment({
      id: "c-magic-link-old",
      authorUserId: OTHER,
      createdAt: "2026-11-23T18:12:00.000Z",
      body: "Biggie magic-link login SMS never arrived.",
      attachments: [{ id: "att-magic-link", filename: "biggie-magic-link-login.png" }],
    }),
    comment({
      id: afterHoursId,
      authorUserId: CHRIS,
      createdAt: "2026-11-25T09:52:00.000Z",
      body: "Bookie offered an after-hours slot and treated a past date as available. Availability reasoning is wrong once the window has closed.",
      attachments: [{ id: "att-after-hours", filename: "after-hours-availability.png" }],
    }),
    comment({
      id: "c-later-magic-link-screenshot",
      authorUserId: OTHER,
      createdAt: "2026-11-25T09:54:00.000Z",
      body: "screenshot of the login text",
      attachments: [{ id: "att-magic-link-newer", filename: "biggie-magic-link-login-again.png" }],
    }),
    comment({
      id: "c-cancel",
      authorUserId: CHRIS,
      createdAt: "2026-11-25T09:55:00.000Z",
      body: "cancel RUN-12",
    }),
    comment({
      id: "c-file-card",
      authorUserId: CHRIS,
      createdAt: "2026-11-25T09:56:00.000Z",
      body: "write up a new card with what I just reported",
      replyToCommentId: options?.replyToAfterHours ? afterHoursId : null,
    }),
  ];
}

describe("chat intake report resolution", () => {
  it("tells chat to file from the resolved report and read the title back first", () => {
    expect(CHAT_INTAKE_FILE_CARD_DIRECTIVE).toContain("file only the platform-resolved Chat intake report");
    expect(CHAT_INTAKE_FILE_CARD_DIRECTIVE).toContain("never a file chosen from list_task_attachments");
    expect(CHAT_INTAKE_FILE_CARD_DIRECTIVE).toContain("post the proposed title and a one-line summary as a comment in this conversation");
    expect(CHAT_INTAKE_FILE_CARD_DIRECTIVE).toContain("create_task is refused until that comment exists and contains the same title");
  });

  it("recognizes a file-card request that points at the report just made", () => {
    expect(isFileCardRequest("write up a new card with what I just reported")).toBe(true);
    expect(isFileCardRequest("file this as a ticket")).toBe(true);
    expect(isFileCardRequest("create a task for the website")).toBe(false);
    expect(isFileCardRequest("thanks")).toBe(false);
  });

  it("replay: files Chris's after-hours report, not a space-wide magic-link screenshot", () => {
    const comments = uatAfterHoursThread();
    const request = findLatestFileCardRequest(comments);
    expect(request?.body).toMatch(/what I just reported/i);

    const report = resolveChatIntakeReport({ comments, requestComment: request! });
    expect(report).not.toBeNull();
    expect(report!.commentId).toBe("c-after-hours");
    expect(report!.source).toBe("latest_same_author_report");
    expect(report!.body).toMatch(/after-hours/i);
    expect(report!.body).toMatch(/past date/i);
    expect(report!.body).not.toMatch(/magic.?link/i);
    expect(report!.attachments.map((attachment) => attachment.filename)).toEqual([
      "after-hours-availability.png",
    ]);

    const spaceWide = listConversationScreenshots(comments);
    expect(spaceWide.map((attachment) => attachment.filename)).toContain("biggie-magic-link-login.png");
    expect(spaceWide.map((attachment) => attachment.filename)).toContain("biggie-magic-link-login-again.png");
    const newestScreenshot = spaceWide.at(-1);
    expect(newestScreenshot?.filename).toBe("biggie-magic-link-login-again.png");
    expect(report!.attachments).not.toContainEqual(newestScreenshot);

    const wake = formatChatIntakeReportForWake(report!);
    expect(wake).toMatch(/after-hours/i);
    expect(wake).toContain("after-hours-availability.png");
    expect(wake).not.toMatch(/magic.?link/i);
    expect(wake).toContain("Do not pick a screenshot or file from list_task_attachments");
  });

  it("uses the replied-to message even when a later screenshot exists", () => {
    const comments = uatAfterHoursThread({ replyToAfterHours: true });
    const report = resolveChatIntakeReport({
      comments,
      requestComment: findLatestFileCardRequest(comments)!,
    });
    expect(report?.source).toBe("reply_to");
    expect(report?.commentId).toBe("c-after-hours");
  });

  it("skips cancel/ack commands when walking back to the latest same-author report", () => {
    const comments = uatAfterHoursThread();
    const report = resolveChatIntakeReport({
      comments,
      requestComment: findLatestFileCardRequest(comments)!,
    });
    expect(report?.commentId).toBe("c-after-hours");
    expect(report?.commentId).not.toBe("c-cancel");
  });
});

describe("chat intake title readback", () => {
  const title = "After-hours availability treats a past date as bookable";
  const summary = "Bookie offered a closed-hours slot using past-date reasoning.";

  it("refuses create_task until the proposed title is posted", () => {
    const comments = uatAfterHoursThread();
    expect(chatIntakeCreateTaskDenial({ comments, proposedTitle: title })).toBe(
      CHAT_INTAKE_CREATE_TASK_DENIAL,
    );
    expect(intakeTitleReadbackPosted({
      comments,
      requestCommentId: "c-file-card",
      proposedTitle: title,
    })).toBe(false);

    const withReadback = [
      ...comments,
      comment({
        id: "c-readback",
        authorType: "agent",
        authorUserId: null,
        createdAt: "2026-11-25T09:56:30.000Z",
        body: formatIntakeTitleReadback({ title, summary }),
      }),
    ];
    expect(intakeTitleReadbackPosted({
      comments: withReadback,
      requestCommentId: "c-file-card",
      proposedTitle: title,
    })).toBe(true);
    expect(chatIntakeCreateTaskDenial({ comments: withReadback, proposedTitle: title })).toBeNull();
  });

  it("does not treat an ordinary create_task request as a file-card intake", () => {
    const comments = [
      comment({
        id: "c-website",
        authorUserId: CHRIS,
        createdAt: "2026-11-25T10:00:00.000Z",
        body: "Create a task for the marketing site refresh.",
      }),
    ];
    expect(findLatestFileCardRequest(comments)).toBeNull();
    expect(chatIntakeCreateTaskDenial({ comments, proposedTitle: "Marketing site refresh" })).toBeNull();
  });
});
