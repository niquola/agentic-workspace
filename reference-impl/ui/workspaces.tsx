import type { Actor } from "../auth.ts";
import type { WorkspaceSummary } from "../protocol.ts";
import { Page } from "./layout.tsx";

interface Props {
  actor: Actor | null;
  oauthEnabled: boolean;
  workspaces: (WorkspaceSummary & { owner?: { id: string; displayName: string } })[];
}

export function WorkspacesPage({ actor, oauthEnabled, workspaces }: Props): string {
  return Page({
    actor,
    oauthEnabled,
    children: (
      <div class="p-6 max-w-3xl mx-auto">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold">Workspaces</h2>
          <button onclick="document.getElementById('dlg-create-ws').showModal()"
            class="bg-indigo-600 text-white px-4 py-1.5 rounded text-sm hover:bg-indigo-500">
            + New workspace
          </button>
        </div>
        <CreateDialog />
        <div id="ws-list">
          <WorkspaceList workspaces={workspaces} />
        </div>
      </div>
    ),
  });
}

function CreateDialog(): string {
  return (
    <dialog id="dlg-create-ws" class="w-96">
      <form class="p-5"
            hx-post="/htmx/workspaces" hx-target="#ws-list" hx-swap="innerHTML"
            hx-disabled-elt="find button[type=submit]"
            hx-on-htmx-after-request="if(event.detail.successful) { document.getElementById('dlg-create-ws').close(); this.reset(); }">
        <h3 class="text-base font-bold mb-4">New Workspace</h3>

        <label class="block text-xs font-medium text-gray-600 mb-1">Name</label>
        <input name="name" placeholder="my-project" required autofocus
          class="w-full border rounded px-3 py-2 text-sm mb-3" />

        <label class="block text-xs font-medium text-gray-600 mb-1">Mode</label>
        <div class="flex gap-4 mb-3">
          <label class="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" name="mode" value="docker" checked
              onchange="document.getElementById('workdir-field').classList.add('hidden')" />
            <span>Docker</span>
            <span class="text-xs text-gray-400">(isolated container)</span>
          </label>
          <label class="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" name="mode" value="local"
              onchange="document.getElementById('workdir-field').classList.remove('hidden')" />
            <span>Local</span>
            <span class="text-xs text-gray-400">(host folder)</span>
          </label>
        </div>

        <div id="workdir-field" class="hidden mb-3">
          <label class="block text-xs font-medium text-gray-600 mb-1">Working directory <span class="text-gray-400 font-normal">(optional)</span></label>
          <input name="workdir" id="workdir-input" placeholder="default: data/workspaces/<name>/"
            class="w-full border rounded px-3 py-2 text-sm font-mono" />
        </div>

        <div class="flex justify-end gap-2 mt-4 pt-3 border-t">
          <button type="button" onclick="this.closest('dialog').close()"
            class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          <button type="submit"
            class="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50">
            <span class="htmx-indicator spinner mr-1"></span>
            Create
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function WorkspaceList({ workspaces }: { workspaces: Props["workspaces"] }): string {
  if (workspaces.length === 0) {
    return <p class="text-gray-400 py-8 text-center">No workspaces yet. Create one above.</p>;
  }
  return (
    <div>
      {workspaces.map(ws => (
        <a href={`/ui/${encodeURIComponent(ws.name)}`}
           class="block p-3 mb-2 bg-white rounded-lg border hover:border-indigo-300 transition">
          <div class="flex items-center justify-between">
            <span class="font-medium">{ws.name}</span>
            <div class="flex items-center gap-2">
              {ws.owner
                ? <span class="text-xs text-gray-500">{ws.owner.displayName}</span>
                : null}
              <StatusBadge status={ws.status} />
            </div>
          </div>
          <div class="text-xs text-gray-400 mt-1">{ws.id}</div>
        </a>
      ))}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }): string {
  return (
    <div class="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2 flex items-center justify-between">
      <span>{message}</span>
      <button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-600 ml-2">&times;</button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): string {
  const cls = status === "running"
    ? "bg-green-100 text-green-700"
    : "bg-yellow-100 text-yellow-700";
  return <span class={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{status}</span>;
}
