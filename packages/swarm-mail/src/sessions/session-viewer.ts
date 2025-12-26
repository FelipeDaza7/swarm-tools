import { readFileSync } from "node:fs";

/**
 * Options for viewing a session line
 */
export interface SessionViewerOpts {
  /** Absolute path to JSONL file */
  path: string;
  /** Target line number (1-indexed) */
  line?: number;
  /** Lines before/after to show (default: 3) */
  context?: number;
}

/**
 * Read a JSONL file and display a specific line with context
 * 
 * @param opts - Viewing options
 * @returns Formatted output matching CASS baseline format
 * @throws Error if file not found or line number out of range
 */
export function viewSessionLine(opts: SessionViewerOpts): string {
  const { path, line = 1, context = 3 } = opts;

  // Read entire file (small JSONL files, streaming is overkill)
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim() !== "");

  // Validate line number
  if (line < 1 || line > lines.length) {
    throw new Error(`Line number must be between 1 and ${lines.length}`);
  }

  // Calculate context window
  const startLine = Math.max(1, line - context);
  const endLine = Math.min(lines.length, line + context);

  // Format output to match CASS baseline
  const output: string[] = [];
  
  // Header
  output.push(`File: ${path}`);
  output.push(`Line: ${line}${context > 0 ? ` (context: ${context})` : ""}`);
  output.push("----------------------------------------");

  // Content lines with line numbers
  for (let i = startLine; i <= endLine; i++) {
    const isTarget = i === line;
    const prefix = isTarget ? ">" : " ";
    const lineNum = i.toString().padStart(5, " ");
    output.push(`${prefix}${lineNum} | ${lines[i - 1]}`);
  }

  output.push("----------------------------------------");

  return output.join("\n");
}
