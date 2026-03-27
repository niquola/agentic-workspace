// Datastar SSE response helpers

export function mergeFragments(html: string, opts?: {
  selector?: string;
  mergeMode?: "morph" | "inner" | "outer" | "append" | "prepend" | "before" | "after" | "upsertAttributes";
}): string {
  let lines = `event: datastar-merge-fragments\n`;
  if (opts?.selector) lines += `data: selector ${opts.selector}\n`;
  if (opts?.mergeMode) lines += `data: mergeMode ${opts.mergeMode}\n`;
  for (const line of html.split("\n")) {
    lines += `data: fragments ${line}\n`;
  }
  lines += "\n";
  return lines;
}

export function mergeSignals(signals: Record<string, unknown>): string {
  return `event: datastar-merge-signals\ndata: signals ${JSON.stringify(signals)}\n\n`;
}

export function removeFragments(selector: string): string {
  return `event: datastar-remove-fragments\ndata: selector ${selector}\n\n`;
}

export function executeScript(script: string): string {
  let lines = `event: datastar-execute-script\ndata: autoRemove true\n`;
  for (const line of script.split("\n")) {
    lines += `data: script ${line}\n`;
  }
  lines += "\n";
  return lines;
}

export function sseResponse(...events: string[]): Response {
  return new Response(events.join(""), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
