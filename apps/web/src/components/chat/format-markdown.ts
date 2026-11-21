export function formatMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      '<pre class="my-2 rounded-md bg-muted-foreground/10 p-3 overflow-x-auto"><code class="text-xs font-mono">' +
        code.trim() +
        "</code></pre>",
    );
    return `\x00CB${idx}\x00`;
  });

  const inlineCodes: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(
      '<code class="rounded bg-muted-foreground/10 px-1.5 py-0.5 text-xs font-mono">' +
        code +
        "</code>",
    );
    return `\x00IC${idx}\x00`;
  });

  html = html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\n/g, "<br>");

  html = html.replace(/\x00IC(\d+)\x00/g, (_m, idx) => inlineCodes[+idx]);
  html = html.replace(/\x00CB(\d+)\x00/g, (_m, idx) => codeBlocks[+idx]);

  return html;
}
