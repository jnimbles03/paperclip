import { describe, expect, it } from "vitest";
import { buildPaperclipTaskMarkdown } from "./apply-chat-intake-markdown.js";
import { CHAT_INTAKE_FILE_CARD_DIRECTIVE } from "../chat-intake-report.js";

describe("chat intake prompt injection", () => {
  const chat = { id: "chat", identifier: "UAT-1", title: "Chat", conversationAgentId: "bookie" };

  it("files the platform-resolved same-thread report, not a space-wide screenshot", () => {
    const markdown = buildPaperclipTaskMarkdown({
      issue: chat,
      chatIntakeReport: {
        commentId: "c-after-hours",
        authorUserId: "chris",
        createdAt: "2026-11-25T09:52:00.000Z",
        source: "latest_same_author_report",
        body: "Bookie offered an after-hours slot and treated a past date as available.",
        attachments: [{ id: "att-after-hours", filename: "after-hours-availability.png" }],
      },
    })!;
    expect(markdown).toContain("Chat intake report (platform-resolved):");
    expect(markdown).toContain("after-hours slot");
    expect(markdown).toContain("after-hours-availability.png");
    expect(markdown).toContain("Do not pick a screenshot or file from list_task_attachments");
    expect(markdown).not.toMatch(/magic.?link/i);
    expect(buildPaperclipTaskMarkdown({ issue: chat })).not.toContain("Chat intake report (platform-resolved):");
  });

  it("tells chat to file from the resolved report and read the title back first", () => {
    expect(CHAT_INTAKE_FILE_CARD_DIRECTIVE).toContain("file only the platform-resolved Chat intake report");
    const prompt = buildPaperclipTaskMarkdown({
      issue: { id: "chat", identifier: null, title: "Chat", workMode: "ask", conversationAgentId: "agent" },
    });
    expect(prompt).toContain("file only the platform-resolved Chat intake report");
    expect(prompt).toContain("never a file chosen from list_task_attachments");
    expect(prompt).toContain("post the proposed title and a one-line summary as a comment in this conversation");
    expect(prompt).toContain("create_task is refused until that comment exists and contains the same title");
  });
});
