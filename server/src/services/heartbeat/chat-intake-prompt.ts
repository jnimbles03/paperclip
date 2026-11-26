import { CHAT_INTAKE_FILE_CARD_DIRECTIVE, formatChatIntakeReportForWake, type ChatIntakeReport } from "../chat-intake-report.js";

export function chatIntakePromptLines(report: ChatIntakeReport | null | undefined): string[] {
  const lines = [CHAT_INTAKE_FILE_CARD_DIRECTIVE];
  if (report) {
    lines.push("", "Chat intake report (platform-resolved):", formatChatIntakeReportForWake(report));
  }
  return lines;
}
