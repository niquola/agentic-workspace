import type { Actor } from "../auth.ts";

interface LayoutProps {
  title?: string;
  actor?: Actor | null;
  oauthEnabled?: boolean;
  children: string;
}

export function Layout({ title, actor, oauthEnabled, children }: LayoutProps): string {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title || "Agentic Workspace"}</title>
        <script src="/js/htmx.min.js" defer></script>
        <script src="/js/marked.min.js" defer></script>
        <script type="module" src="/js/datastar.js"></script>
        <link rel="stylesheet" href="/styles/main.css" />
      </head>
      <body class="bg-gray-50 text-gray-900 h-screen flex flex-col" hx-boost="true">
        <Header actor={actor} oauthEnabled={oauthEnabled} />
        <main id="app" class="flex-1 overflow-hidden">
          {children}
        </main>
      </body>
    </html>
  );
}

function Header({ actor, oauthEnabled }: { actor?: Actor | null; oauthEnabled?: boolean }): string {
  return (
    <header class="bg-indigo-600 text-white px-4 py-2 flex items-center gap-4 shrink-0">
      <a href="/ui" class="text-lg font-semibold hover:text-indigo-100">Agentic Workspace</a>
      <nav id="breadcrumbs" class="text-indigo-200 text-sm"></nav>
      <div class="ml-auto flex items-center gap-2">
        {actor
          ? <>
              <span class="text-xs text-indigo-200">{actor.displayName}</span>
              <a href="/oauth/logout" hx-boost="false" class="text-xs bg-indigo-500 hover:bg-indigo-400 px-2 py-1 rounded">Logout</a>
            </>
          : oauthEnabled
            ? <a href="/oauth/login" class="text-xs bg-indigo-500 hover:bg-indigo-400 px-2 py-1 rounded">Login</a>
            : null
        }
      </div>
    </header>
  );
}

export function Page({ actor, oauthEnabled, children }: LayoutProps): string {
  return "<!DOCTYPE html>\n" + Layout({ actor, oauthEnabled, children });
}
