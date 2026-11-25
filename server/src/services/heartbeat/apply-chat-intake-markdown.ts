import { buildPaperclipTaskMarkdown as buildBase } from "./task-markdown.js";
import { chatIntakePromptLines } from "./chat-intake-prompt.js";
import type { ChatIntakeReport } from "../chat-intake-report.js";

export type ChatIntakeMarkdownInput = Parameters<typeof buildBase>[0] & {
  chatIntakeReport?: ChatIntakeReport | null;
};

/** Inserts the platform-resolved file-card report after the Chat mode header. */
export function buildPaperclipTaskMarkdown(input: ChatIntakeMarkdownInput) {
  const markdown = buildBase(input);
  if (!markdown || !input.issue?.conversationAgentId) return markdown;
  const extra = chatIntakePromptLines(input.chatIntakeReport).join("\n");
  if (!extra) return markdown;
  return markdown.replace("Chat mode directive:\n", `Chat mode directive:\n${extra}\n`);
}
