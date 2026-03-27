// File browser + editor components — rendered inside wmlet, proxied by wsmanager

import { readdir, stat, readFile } from "node:fs/promises";
import { join, extname, basename, resolve, normalize } from "node:path";
import { createHighlighter, type Highlighter } from "shiki";
import { renderMermaid, type RenderOptions } from "beautiful-mermaid";

// ── Shiki highlighter (lazy singleton) ──

let _highlighter: Highlighter | null = null;

const SHIKI_LANGS = [
  "javascript", "typescript", "tsx", "jsx", "json", "css", "scss", "html",
  "sql", "python", "markdown", "xml", "rust", "java", "cpp", "c", "go",
  "php", "yaml", "ruby", "bash", "shell", "dockerfile", "toml", "diff",
  "clojure", "graphql", "http",
] as const;

async function getHighlighter(): Promise<Highlighter> {
  if (!_highlighter) {
    _highlighter = await createHighlighter({
      themes: ["github-light"],
      langs: [...SHIKI_LANGS],
    });
  }
  return _highlighter;
}

// ── Markdown rendering with Shiki code highlighting ──

const LANG_ALIASES: Record<string, string> = {
  js: "javascript", ts: "typescript", sh: "bash", zsh: "bash",
  yml: "yaml", py: "python", rb: "ruby", cs: "csharp",
  "c++": "cpp", "c#": "csharp", txt: "text", plain: "text",
  clj: "clojure", gql: "graphql",
};

function normalizeLang(lang: string): string {
  const l = lang.toLowerCase().trim();
  return LANG_ALIASES[l] || l;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Server-side Mermaid rendering ──

const MERMAID_THEME: RenderOptions = {
  bg: "#ffffff",
  fg: "#1f2937",
  line: "#6b7280",
  muted: "#9ca3af",
  surface: "#f9fafb",
  border: "#e5e7eb",
  font: "system-ui, sans-serif",
  transparent: true,
};

async function renderMermaidSvg(code: string): Promise<string> {
  try {
    const svg = await renderMermaid(code, MERMAID_THEME);
    return `<div class="my-4 flex justify-center">${svg}</div>`;
  } catch (e) {
    console.warn("[mermaid] render failed:", e);
    return `<pre class="text-sm text-red-600 bg-red-50 rounded-lg p-4 my-4"><code>${escapeHtml(code)}</code></pre>`;
  }
}

/**
 * Render markdown to HTML with:
 * - Shiki syntax highlighting for code blocks
 * - Server-side Mermaid diagram rendering (beautiful-mermaid → SVG)
 * - Tailwind prose typography
 */
export async function renderMarkdownPreview(md: string): Promise<string> {
  const hl = await getHighlighter();
  const loadedLangs = new Set(hl.getLoadedLanguages());

  // Use Bun.markdown for base HTML conversion
  const rawHtml: string = typeof (Bun as any).markdown === "function"
    ? (Bun as any).markdown(md)
    : (Bun as any).markdown.html
      ? (Bun as any).markdown.html(md)
      : md;

  // Collect mermaid blocks for async rendering
  const mermaidBlocks: { placeholder: string; code: string }[] = [];
  let idx = 0;

  // Post-process: highlight <pre><code class="language-*"> blocks
  let html = rawHtml.replace(
    /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g,
    (_match, lang: string, escaped: string) => {
      const normalized = normalizeLang(lang);
      // Decode HTML entities back to raw text for Shiki
      const raw = escaped
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&#x27;/g, "'");

      if (normalized === "mermaid") {
        const ph = `<!--MERMAID_${idx++}-->`;
        mermaidBlocks.push({ placeholder: ph, code: raw });
        return ph;
      }

      if (loadedLangs.has(normalized)) {
        try {
          return hl.codeToHtml(raw, { lang: normalized, theme: "github-light" });
        } catch {}
      }
      // Fallback: plain pre with styling
      return `<pre class="shiki github-light" style="background-color:#fff"><code>${escaped}</code></pre>`;
    }
  );

  // Render mermaid diagrams in parallel
  if (mermaidBlocks.length > 0) {
    const svgs = await Promise.all(mermaidBlocks.map(b => renderMermaidSvg(b.code)));
    for (let i = 0; i < mermaidBlocks.length; i++) {
      html = html.replace(mermaidBlocks[i].placeholder, svgs[i]);
    }
  }

  return html;
}

function extToShikiLang(name: string): string | null {
  const ext = extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
    ".json": "json", ".css": "css", ".scss": "scss", ".html": "html",
    ".sql": "sql", ".py": "python", ".md": "markdown",
    ".yaml": "yaml", ".yml": "yaml", ".xml": "xml", ".svg": "xml",
    ".go": "go", ".rs": "rust", ".rb": "ruby", ".java": "java",
    ".c": "c", ".h": "c", ".cpp": "cpp",
    ".sh": "bash", ".bash": "bash", ".zsh": "bash",
    ".dockerfile": "dockerfile", ".toml": "toml",
    ".diff": "diff", ".patch": "diff",
  };
  return map[ext] ?? null;
}

// ── Types ──

export type FileEntry = { name: string; path: string; isDir: boolean; size: number };

// ── Helpers ──

export async function listDir(workdir: string, subpath: string): Promise<FileEntry[]> {
  const fullPath = join(workdir, subpath);
  const entries = await readdir(fullPath, { withFileTypes: true });
  const result: FileEntry[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const fp = join(subpath, e.name);
    const isDir = e.isDirectory();
    let size = 0;
    if (!isDir) {
      try { size = (await stat(join(workdir, fp))).size; } catch {}
    }
    result.push({ name: e.name, path: fp, isDir, size });
  }
  result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".txt", ".csv",
  ".html", ".css", ".scss",
  ".sql", ".sh", ".bash", ".zsh",
  ".py", ".go", ".rs", ".rb", ".java", ".c", ".h", ".cpp",
  ".env", ".gitignore", ".dockerignore",
  ".xml", ".svg", ".lock",
]);

export function isTextFile(name: string): boolean {
  if (!name.includes(".")) {
    const lc = name.toLowerCase();
    return ["makefile", "dockerfile", "readme", "license", "changelog"].includes(lc);
  }
  return TEXT_EXTS.has(extname(name).toLowerCase());
}

function extToLang(name: string): string | null {
  const ext = extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "javascript", ".tsx": "javascript", ".js": "javascript", ".jsx": "javascript",
    ".json": "json", ".css": "css", ".scss": "css", ".html": "html",
    ".sql": "sql", ".py": "python", ".md": "markdown",
    ".yaml": "yaml", ".yml": "yaml", ".xml": "xml", ".svg": "xml",
    ".go": "go", ".rs": "rust", ".rb": "ruby", ".java": "java",
    ".c": "cpp", ".h": "cpp", ".cpp": "cpp",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  };
  return map[ext] ?? null;
}

// Map file extension to CodeMirror language package name on esm.sh
function extToCmLang(name: string): string | null {
  const ext = extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "javascript", ".tsx": "javascript", ".js": "javascript", ".jsx": "javascript",
    ".json": "json", ".css": "css", ".scss": "css",
    ".html": "html", ".xml": "xml", ".svg": "xml",
    ".sql": "sql", ".py": "python", ".md": "markdown",
    ".yaml": "yaml", ".yml": "yaml",
    ".go": "go", ".rs": "rust", ".java": "java",
    ".c": "cpp", ".h": "cpp", ".cpp": "cpp",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".rb": "ruby", ".php": "php",
  };
  return map[ext] ?? null;
}

// ── Icons ──

const folderIcon = `<svg class="w-4 h-4 text-yellow-500 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Z"/></svg>`;
const fileIcon = `<svg class="w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" clip-rule="evenodd"/></svg>`;

// ── Components ──

export function FileSidebar({ files, currentPath, basePath, uiBase }: {
  files: FileEntry[];
  currentPath: string;
  basePath: string;
  uiBase?: string;
}): string {
  const parentPath = currentPath ? currentPath.split("/").slice(0, -1).join("/") : "";
  const target = "#acc-files"; // accordion swaps into itself
  const baseParam = `&base=${encodeURIComponent(basePath)}` + (uiBase ? `&ui=${encodeURIComponent(uiBase)}` : "");
  const dirUrl = (p: string) => `${basePath}/?path=${encodeURIComponent(p)}${baseParam}`;
  const fileUrl = (p: string) => `${basePath}/${encodeURIComponent(p)}?base=${encodeURIComponent(basePath)}` + (uiBase ? `&ui=${encodeURIComponent(uiBase)}` : "");
  const pushUrl = (filePath: string, tab?: string) => uiBase ? `${uiBase}?file=${encodeURIComponent(filePath)}${tab ? `&tab=${tab}` : ""}` : false;
  return (
    <div id="file-tree" class="py-1">
      {/* New file dialog */}
      <dialog id="dlg-file" class="w-80">
        <form class="p-4"
              onsubmit={`event.preventDefault(); var inp=this.querySelector('input[name=path]'); var p=inp.value.trim(); if(!p) return; var prefix=${JSON.stringify(currentPath ? currentPath + "/" : "")}; var dlg=this.closest('dialog'); fetch('${basePath}/'+encodeURIComponent(prefix+p),{method:'PUT',body:''}).then(function(){dlg.close(); inp.value=''; htmx.ajax('GET','${dirUrl(currentPath)}','${target}')})`}>
          <h3 class="text-sm font-bold mb-3">New File</h3>
          <input name="path" placeholder="filename.ts" required autofocus
            class="w-full border rounded px-3 py-2 text-sm mb-3" />
          <div class="flex justify-end gap-2">
            <button type="button" onclick="this.closest('dialog').close()"
              class="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            <button type="submit"
              class="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-500">Create</button>
          </div>
        </form>
      </dialog>

      {currentPath && (
        <a class="flex items-center gap-2 px-3 py-1 text-sm text-gray-500 hover:bg-gray-50 cursor-pointer"
          hx-get={dirUrl(parentPath)}
          hx-target={target} hx-swap="innerHTML">
          <span class="w-4 h-4 text-center shrink-0">..</span>
          <span>Parent directory</span>
        </a>
      )}
      {files.map(f =>
        f.isDir ? (
          <a class="flex items-center gap-2 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
            hx-get={dirUrl(f.path)}
            hx-target={target} hx-swap="innerHTML">
            <span dangerouslySetInnerHTML={{ __html: folderIcon }} />
            <span class="truncate">{f.name}</span>
          </a>
        ) : (
          <a class="flex items-center gap-2 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer group"
            hx-get={fileUrl(f.path)}
            hx-target="#file-content" hx-swap="innerHTML"
            hx-push-url={pushUrl(f.path) || "false"}
            hx-on-htmx-after-request="var fc=document.getElementById('file-content'); fc.className='flex-1 flex flex-col overflow-hidden'; var tp=document.getElementById('topic-pane'); if(tp) tp.className='hidden'; var w=document.getElementById('welcome'); if(w) w.className='hidden'">
            <span dangerouslySetInnerHTML={{ __html: fileIcon }} />
            <span class="truncate flex-1">{f.name}</span>
            <span class="text-xs text-gray-400 hidden group-hover:inline">{formatSize(f.size)}</span>
          </a>
        )
      )}
      {files.length === 0 && (
        <p class="px-3 py-2 text-sm text-gray-400">Empty directory</p>
      )}
    </div>
  );
}

export async function FileContentView({ filePath, content, tab, basePath, uiBase }: {
  filePath: string;
  content: string;
  tab?: string;
  basePath: string;
  uiBase?: string;
}): Promise<string> {
  const name = basename(filePath);
  const ext = extname(name).toLowerCase();
  const isMd = ext === ".md";
  const isHtml = ext === ".html" || ext === ".htm";
  const activeTab = tab || (isMd ? "preview" : "code");
  const lines = content.split("\n").length;
  const cmLang = extToCmLang(name);
  const shikiLang = extToShikiLang(name);

  const tabCls = (t: string) => t === activeTab
    ? "px-2 py-0.5 text-xs font-medium text-indigo-700 bg-indigo-100 rounded"
    : "px-2 py-0.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer";

  const uiParam = uiBase ? `&ui=${encodeURIComponent(uiBase)}` : "";
  const baseQ = `base=${encodeURIComponent(basePath)}${uiParam}`;
  const fileUrl = `${basePath}/${encodeURIComponent(filePath)}?${baseQ}`;
  const tabPushUrl = (t: string) => uiBase ? `${uiBase}?file=${encodeURIComponent(filePath)}&tab=${t}` : undefined;

  const tabs: { id: string; label: string }[] = [];
  if (isMd) tabs.push({ id: "preview", label: "Preview" });
  if (isHtml) tabs.push({ id: "preview", label: "Preview" });
  tabs.push({ id: "code", label: "Code" });
  tabs.push({ id: "edit", label: "Edit" });

  // Server-side syntax highlighting via shiki
  let codeHtml = "";
  let mdHtml = "";

  if (activeTab === "code") {
    const hl = await getHighlighter();
    codeHtml = shikiLang
      ? hl.codeToHtml(content, { lang: shikiLang, theme: "github-light" })
      : hl.codeToHtml(content, { lang: "text", theme: "github-light" });
  } else if (activeTab === "preview" && isMd) {
    mdHtml = await renderMarkdownPreview(content);
  }

  const saveUrl = `${basePath}/${encodeURIComponent(filePath)}`;

  return (
    <div id="file-content-inner" class="flex flex-col flex-1 overflow-hidden">
      {/* Header with tabs + close */}
      <div class="border-b border-gray-200 bg-gray-50 shrink-0 px-4 py-1.5 flex items-center gap-2">
        <span class="text-sm font-medium text-gray-700 font-mono truncate">{filePath}</span>
        {tabs.map(t => (
          <button class={tabCls(t.id)}
            hx-get={`${fileUrl}&tab=${t.id}`} hx-target="#file-content" hx-swap="innerHTML"
            hx-push-url={tabPushUrl(t.id) || "false"}>
            {t.label}
          </button>
        ))}
        <span id="save-status" class="text-xs text-gray-400 hidden"></span>
        {activeTab === "edit" && (
          <label class="flex items-center gap-1 text-xs text-gray-400 cursor-pointer ml-2">
            <input type="checkbox" id="vim-toggle" class="w-3 h-3" />vim
          </label>
        )}
        <span class="flex-1"></span>
        <span class="text-xs text-gray-400 shrink-0">{lines} lines · {formatSize(content.length)}</span>
        <button onclick="var el=document.getElementById('file-content'); el.innerHTML=''; el.classList.add('hidden'); var w=document.getElementById('welcome'); if(w) w.classList.remove('hidden')"
          class="text-gray-400 hover:text-gray-600 ml-1">&times;</button>
      </div>

      {/* Vim status bar (shown only in edit mode with vim enabled) */}
      {activeTab === "edit" && (
        <div id="vim-status" class="hidden bg-gray-800 text-gray-300 text-xs px-3 py-0.5 font-mono shrink-0"></div>
      )}

      {/* Content area */}
      {activeTab === "preview" && isMd ? (
        <div class="flex-1 overflow-auto p-6">
          <div class={PROSE_CLASSES}
               dangerouslySetInnerHTML={{ __html: mdHtml }} />
        </div>
      ) : activeTab === "preview" && isHtml ? (
        <iframe srcdoc={content} class="flex-1 w-full border-0" sandbox="allow-scripts"></iframe>
      ) : activeTab === "code" ? (
        <div class="flex-1 overflow-auto text-sm bg-white [&_pre]:m-0 [&_pre]:rounded-none [&_pre]:p-4 [&_code]:text-xs"
             dangerouslySetInnerHTML={{ __html: codeHtml }} />
      ) : (
        <div id="cm-editor" class="flex-1 overflow-auto"></div>
      )}

      {activeTab === "edit" && (
        <script dangerouslySetInnerHTML={{ __html: cmEditorScript(saveUrl, cmLang, content) }} />
      )}
    </div>
  );
}

function cmEditorScript(saveUrl: string, lang: string | null, content: string): string {
  return `
(async function() {
  var CDN = "https://esm.sh";

  // Import core CodeMirror
  var [cmView, cmState, cmLang, cmCmds, cmSearch, cmAutocomplete, cmLint] = await Promise.all([
    import(CDN + "/@codemirror/view"),
    import(CDN + "/@codemirror/state"),
    import(CDN + "/@codemirror/language"),
    import(CDN + "/@codemirror/commands"),
    import(CDN + "/@codemirror/search"),
    import(CDN + "/@codemirror/autocomplete"),
    import(CDN + "/@codemirror/lint"),
  ]);

  var { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
        drawSelection, dropCursor, rectangularSelection, highlightSpecialChars } = cmView;
  var { EditorState } = cmState;
  var { defaultHighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching,
        foldGutter, foldKeymap } = cmLang;
  var { defaultKeymap, history, historyKeymap, indentWithTab } = cmCmds;
  var { searchKeymap, highlightSelectionMatches } = cmSearch;
  var { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } = cmAutocomplete;
  var { lintKeymap } = cmLint;

  // Language support
  var langExt = [];
  var langName = ${JSON.stringify(lang)};
  if (langName) {
    try {
      // Map lang name to CM package and factory function
      var langPkg = langName === "json" ? "javascript" : langName;
      var langMod = await import(CDN + "/@codemirror/lang-" + langPkg);
      // Special case: json uses javascript({}) with jsx:false
      if (langName === "json") {
        langExt.push(langMod.javascript({ jsx: false }));
      } else if (langName === "javascript") {
        langExt.push(langMod.javascript({ jsx: true, typescript: true }));
      } else {
        // All other langs export a function matching their name
        var fn = langMod[langName];
        if (fn) langExt.push(fn());
      }
    } catch(e) { console.warn("lang load failed:", langName, e); }
  }

  // Light theme
  var theme = EditorView.theme({
    "&": { height: "100%", fontSize: "13px" },
    ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
    ".cm-gutters": { background: "#f9fafb", borderRight: "1px solid #e5e7eb" },
    ".cm-activeLineGutter": { background: "#eef2ff" },
    ".cm-activeLine": { background: "#f5f3ff40" },
    ".cm-cursor": { borderLeftColor: "#4f46e5" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { background: "#c7d2fe80" },
  });

  var saveUrl = ${JSON.stringify(saveUrl)};
  var statusEl = document.getElementById("save-status");
  var timer = null;

  function showStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = "text-xs " + cls;
    statusEl.classList.remove("hidden");
  }

  var saveExtension = EditorView.updateListener.of(function(update) {
    if (!update.docChanged) return;
    if (timer) clearTimeout(timer);
    showStatus("Modified", "text-xs text-yellow-500");
    timer = setTimeout(function() {
      var body = update.state.doc.toString();
      fetch(saveUrl, { method: "PUT", headers: {"Content-Type":"text/plain"}, body: body })
        .then(function(r) {
          showStatus(r.ok ? "Saved" : "Save failed", r.ok ? "text-xs text-green-500" : "text-xs text-red-500");
        })
        .catch(function() { showStatus("Save failed", "text-xs text-red-500"); });
    }, 1000);
  });

  var extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    theme,
    saveExtension,
    ...langExt,
  ];

  var container = document.getElementById("cm-editor");
  var view = new EditorView({
    state: EditorState.create({
      doc: ${JSON.stringify(content)},
      extensions: extensions,
    }),
    parent: container,
  });

  // Store view for vim toggle access
  window.__cmView = view;
  window.__cmExtensions = extensions;

  // Vim toggle
  var vimToggle = document.getElementById("vim-toggle");
  var vimStatusEl = document.getElementById("vim-status");
  var vimLoaded = false;
  var vimExt = null;

  // Restore vim preference
  if (localStorage.getItem("cm-vim") === "1") {
    vimToggle.checked = true;
    enableVim();
  }

  vimToggle.addEventListener("change", function() {
    localStorage.setItem("cm-vim", vimToggle.checked ? "1" : "0");
    if (vimToggle.checked) {
      enableVim();
    } else {
      disableVim();
    }
  });

  async function enableVim() {
    if (!vimLoaded) {
      try {
        var vimMod = await import(CDN + "/@replit/codemirror-vim@6");
        vimExt = vimMod.vim();
        vimLoaded = true;
      } catch(e) { console.warn("vim load failed:", e); return; }
    }
    view.dispatch({ effects: cmState.StateEffect.appendConfig.of(vimExt) });
    vimStatusEl.classList.remove("hidden");
    vimStatusEl.textContent = "-- NORMAL --";
  }

  function disableVim() {
    // Recreate editor without vim
    var doc = view.state.doc.toString();
    view.destroy();
    view = new EditorView({
      state: EditorState.create({ doc: doc, extensions: extensions }),
      parent: container,
    });
    window.__cmView = view;
    vimStatusEl.classList.add("hidden");
  }

  view.focus();
})();
`;
}

// ── Prose typography for markdown preview ──

const PROSE_CLASSES = "prose prose-sm sm:prose-base max-w-none md-preview";

export function FileWelcome(): string {
  return (
    <div class="flex items-center justify-center h-full text-gray-400">
      <div class="text-center">
        <p class="text-lg font-medium text-gray-500">Workspace files</p>
        <p class="text-sm mt-2">Select a file to view its contents</p>
      </div>
    </div>
  );
}
