import { useState } from "react";
import { IdSchema, endpoints } from "@quire/contracts";
import { Button } from "../../../ui";
import { editorValue } from "../shared";
import type { AssistantState } from "./use-assistant";

export function AssistantConversation({ state }: { readonly state: AssistantState }) {
  const [conversationId, setConversationId] = useState("");
  return <details><summary>Conversation privacy</summary>
    <p>{state.conversation ? `Shared project conversation ${state.conversation.id} · version ${state.conversation.version}`
      : "Private session · shared conversation not enabled"}</p>
    <div className="qa-assistant__row">
      <Button disabled={state.busy || !state.online || state.conversation !== null}
        onClick={() => void state.execute(async () => {
          state.setConversation(editorValue(await state.client.call(endpoints.aiConversationCreate, {
            params: state.params, query: {}, headers: state.headers, body: { shared: true },
          }, state.signal)));
          state.setNotice("Shared project conversation created");
        })}>Create shared conversation</Button>
      <Button disabled={state.busy || !state.online} onClick={() => void state.execute(async () => {
        editorValue(await state.client.call(endpoints.aiSessionClear, {
          params: state.params, query: {}, headers: state.headers, body: { branch: state.workspace.scope.branch },
        }, state.signal));
        if (state.run?.mode === "ask" && state.run.conversationId === null) state.updateRun(null);
        state.setNotice("Private session chat cleared; Agent audit records remain");
      })}>Clear private session</Button>
      {state.conversation && <Button variant="danger" disabled={state.busy || !state.online}
        onClick={() => void state.execute(async () => {
          if (!state.conversation) return;
          const latest = editorValue(await state.client.call(endpoints.aiConversationGet, {
            params: { ...state.params, id: state.conversation.id }, query: {}, body: undefined, headers: state.headers,
          }, state.signal));
          editorValue(await state.client.call(endpoints.aiConversationDelete, {
            params: { ...state.params, id: latest.id }, query: {}, headers: state.headers, body: { expectedVersion: latest.version },
          }, state.signal));
          state.setConversation(null);
          state.setNotice("Shared chat cleared; Agent audit records remain");
        })}>Clear shared chat</Button>}
    </div>
    <form onSubmit={event => { event.preventDefault(); void state.execute(async () => {
      state.setConversation(editorValue(await state.client.call(endpoints.aiConversationGet, {
        params: { ...state.params, id: IdSchema.parse(conversationId) }, query: {}, body: undefined, headers: state.headers,
      }, state.signal)));
      state.setNotice("Shared conversation opened");
    }); }}>
      <label>Existing shared conversation ID<input value={conversationId} onChange={event => setConversationId(event.target.value)} /></label>
      <Button type="submit" disabled={state.busy || !state.online || !conversationId.trim()}>Open shared conversation</Button>
    </form>
  </details>;
}
