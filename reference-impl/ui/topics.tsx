import type { Actor } from "../auth.ts";
import type { TopicSummary } from "../protocol.ts";
import { Page } from "./layout.tsx";

export type AgentInfo = { id: string; name: string; description: string };

interface Props {
  actor: Actor | null;
  oauthEnabled: boolean;
  wsName: string;
  topics: TopicSummary[];
  agents: AgentInfo[];
}

export function TopicsPage({ actor, oauthEnabled, wsName, topics, agents }: Props): string {
  return Page({
    actor,
    oauthEnabled,
    children: (
      <div class="p-6 max-w-3xl mx-auto">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <a href="/ui" class="text-gray-400 hover:text-gray-600 text-sm">&larr;</a>
            <h2 class="text-xl font-bold">{wsName}</h2>
          </div>
          <CreateTopicForm wsName={wsName} agents={agents} />
        </div>
        {agents.length > 0 && (
          <div class="mb-4 flex flex-wrap gap-2">
            {agents.map(a => (
              <span class="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2.5 py-1"
                    title={a.description}>
                <svg class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0 1 12 2v5h4a1 1 0 0 1 .82 1.573l-7 10A1 1 0 0 1 8 18v-5H4a1 1 0 0 1-.82-1.573l7-10a1 1 0 0 1 1.12-.381Z" clip-rule="evenodd" /></svg>
                {a.name}
              </span>
            ))}
          </div>
        )}
        <div id="tp-list">
          <TopicList wsName={wsName} topics={topics} />
        </div>
      </div>
    ),
  });
}

function CreateTopicForm({ wsName, agents }: { wsName: string; agents: AgentInfo[] }): string {
  return (
    <form hx-post={`/htmx/${encodeURIComponent(wsName)}/topics`}
          hx-target="#tp-list" hx-swap="innerHTML"
          class="flex gap-2 items-center">
      <input name="name" placeholder="topic name" required
        class="border rounded px-2 py-1 text-sm" />
      {agents.length > 0 && (
        <select name="agent" class="border rounded px-2 py-1 text-sm text-gray-700">
          {agents.map(a => (
            <option value={a.id}>{a.name}</option>
          ))}
        </select>
      )}
      <button type="submit"
        class="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-500">
        Create
        <span class="htmx-indicator spinner ml-1"></span>
      </button>
    </form>
  );
}

export function TopicList({ wsName, topics }: { wsName: string; topics: TopicSummary[] }): string {
  if (topics.length === 0) {
    return <p class="text-gray-400 py-8 text-center">No topics. Create one above.</p>;
  }
  return (
    <div>
      {topics.map(tp => (
        <a href={`/ui/${encodeURIComponent(wsName)}/${encodeURIComponent(tp.name)}`}
           class="block p-3 mb-2 bg-white rounded-lg border hover:border-indigo-300 transition">
          <div class="flex items-center justify-between">
            <span class="font-medium">{tp.name}</span>
            <div class="flex items-center gap-2 text-xs">
              {tp.activeRun
                ? <span class="text-indigo-600"><span class="spinner"></span> running</span>
                : null}
              {(tp.queuedCount ?? 0) > 0
                ? <span class="text-yellow-700">{tp.queuedCount} queued</span>
                : null}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
