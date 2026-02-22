# Plan: Embedded LLM Integration for DartForge

## Context
DartForge is a Tauri v2 MUD client. We want to embed an LLM directly into the app (no external dependencies) so users can:
- Ask contextual questions about their game session (`/ai what should I do?`)
- Generate triggers from natural language (`/ai trigger alert me when someone says my name`)
- Generate aliases from natural language (`/ai alias make "aa" attack and kill a target`)

The LLM runs in-process via llama.cpp Rust bindings. Model files (~1GB GGUF) download from HuggingFace on first use. Completely free, fully offline after download.

**User preferences:**
- AI responses appear in a **dedicated AI panel** (pinnable, like Chat/Skills)
- Generated triggers/aliases **open in the editor for review** before saving

---

## Phase 1: Rust LLM Module

### New file: `src-tauri/src/llm.rs`

**State:**
```rust
pub struct LlmState {
    model: Mutex<Option<LlamaModel>>,
    downloading: AtomicBool,
}
```

**Tauri commands:**

| Command | Signature | Purpose |
|---|---|---|
| `ai_model_status` | `() -> { downloaded: bool, loaded: bool }` | Check model state |
| `ai_download_model` | `(url: String)` | Stream-download GGUF, emit `ai:download-progress` events |
| `ai_load_model` | `()` | Load model into RAM |
| `ai_unload_model` | `()` | Free model from RAM |
| `ai_infer` | `(system: String, prompt: String) -> String` | Run inference, emit `ai:token` events for streaming, return full response |

**Model download:** Uses `reqwest` with streaming to download from HuggingFace. Emits `ai:download-progress { bytes, total }` events. Saves to `{data_dir}/models/model.gguf`.

**Inference:** Spawns on a blocking thread (llama.cpp is CPU-bound). Streams tokens via `ai:token { text }` events. Sends `ai:done` when complete.

### Modify: `src-tauri/Cargo.toml`
- Add `llama-cpp-2` (llama.cpp Rust bindings)
- Add `reqwest = { version = "0.12", features = ["stream"] }`

### Modify: `src-tauri/src/lib.rs`
- Add `mod llm;`
- Add `LlmState` to `.manage()`
- Register 5 new commands in `generate_handler![]`

---

## Phase 2: Frontend AI Context & Hook

### New file: `src/contexts/AiContext.tsx`

**State:**
```typescript
interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  type: 'chat' | 'trigger' | 'alias';  // What kind of query
}

interface AiState {
  enabled: boolean;
  modelDownloaded: boolean;
  modelLoaded: boolean;
  downloading: boolean;
  downloadProgress: number;  // 0-100
  inferring: boolean;
  messages: AiMessage[];     // Conversation history for the panel
}
```

**Methods:**
```typescript
setEnabled(v: boolean): void;
downloadModel(): Promise<void>;
loadModel(): Promise<void>;
unloadModel(): void;
ask(question: string, terminalContext: string[]): Promise<void>;
generateTrigger(description: string): Promise<Partial<Trigger> | null>;
generateAlias(description: string): Promise<Partial<Alias> | null>;
clearHistory(): void;
```

**System prompts** (hardcoded constants):

1. **Gameplay advisor:**
   ```
   You are a concise advisor for DartMUD, a text-based RPG with permadeath, hex-based maps,
   and numberless combat. You can see recent game output below. Answer in 2-3 sentences max.
   Only comment on what you can observe — do not invent game mechanics.
   ```

2. **Trigger generator:**
   ```
   Generate a MUD client trigger as JSON. Output ONLY the JSON object, no explanation.
   Fields: { "pattern": string, "matchMode": "substring"|"exact"|"regex",
   "body": string, "group": string, "cooldownMs": number, "gag": boolean,
   "highlight": string|null, "soundAlert": boolean }
   Body syntax: $0=matched text, $1-$9=regex groups, $line=full line, $me=character name.
   Use ; to separate multiple commands. #delay <ms> for pauses. #echo <text> for local output.
   ```

3. **Alias generator:**
   ```
   Generate a MUD client alias as JSON. Output ONLY the JSON object, no explanation.
   Fields: { "pattern": string, "matchMode": "exact"|"prefix"|"regex",
   "body": string, "group": string }
   Body syntax: $1-$9=positional args, $*=all args, $-=all but last, $!=last arg,
   $me=character name, $opposite1-9=reverse direction.
   Use ; to separate multiple commands. #delay <ms> for pauses. #echo <text> for local output.
   ```

---

## Phase 3: AI Panel

### New file: `src/components/AiPanel.tsx`

A pinnable panel (follows `ChatPanel` patterns, uses `PinnablePanelProps`) showing:
- Conversation history (user questions + AI responses)
- Loading indicator during inference
- Model status indicator (not downloaded / downloading / loaded / unloaded)
- "Download model" button when model not present
- Clear history button

Messages rendered with role-based styling:
- User messages: right-aligned or prefixed with `>`
- AI responses: left-aligned with cyan accent (matching app theme)
- Trigger/alias generation results: show a preview of the generated JSON with a "Open in editor" button

### Panel registration

Add `'ai'` to:
- `Panel` type in `src/types/index.ts` — add to the union
- `PinnablePanel` type — add `'ai'` so it can be docked
- `Toolbar.tsx` — add AI icon button (brain icon, accent `#8be9fd`)
- `App.tsx` — add slideout panel rendering + pinned region support
- `PinnedRegion.tsx` — handle `'ai'` panel rendering

---

## Phase 4: Command Interception

### Modify: `src/App.tsx` — `handleSend()`

Add interception before alias expansion:

```typescript
const handleSend = useCallback(async (rawInput: string) => {
  // AI command interception
  if (rawInput.startsWith('/ai ')) {
    const query = rawInput.slice(4).trim();
    if (query.startsWith('trigger ')) {
      const desc = query.slice(8);
      const result = await aiContext.generateTrigger(desc);
      if (result) openTriggerEditor(result);  // Pre-fill editor
    } else if (query.startsWith('alias ')) {
      const desc = query.slice(6);
      const result = await aiContext.generateAlias(desc);
      if (result) openAliasEditor(result);  // Pre-fill editor
    } else {
      const context = getTerminalHistory(terminalRef.current, 100);
      await aiContext.ask(query, context);
    }
    setActivePanel('ai');  // Show AI panel with response
    return;
  }
  // ... existing alias expansion + send logic
}, [sendCommand]);
```

### Terminal context extraction

New utility function to read last N lines from xterm buffer:
```typescript
function getTerminalHistory(term: XTerm | null, lines: number): string[] {
  if (!term) return [];
  const buf = term.buffer.active;
  const start = Math.max(0, buf.cursorY + buf.baseY - lines);
  const result: string[] = [];
  for (let i = start; i <= buf.cursorY + buf.baseY; i++) {
    const line = buf.getLine(i);
    if (line) result.push(line.translateToString(true));  // true = trim trailing whitespace
  }
  return result;
}
```

Add this to `src/lib/terminalUtils.ts` (where `smartWrite` already lives).

---

## Phase 5: Settings & Migration

### Modify: `src/lib/settingsMigrations.ts`
- Bump `CURRENT_VERSION` to 12
- Add migration v11→v12:
  ```typescript
  (data) => {
    if (!('aiEnabled' in data)) data.aiEnabled = false;
    return data;
  }
  ```

### Modify: `src/types/index.ts`
- Add `'ai'` to `Panel` union type
- Add `'ai'` to `PinnablePanel` union type

---

## Phase 6: Trigger/Alias Editor Pre-fill

### Modify: `src/components/TriggerPanel.tsx`
- Accept optional `initialTrigger?: Partial<Trigger>` prop
- When set, open editor pre-filled with those values

### Modify: `src/components/AliasPanel.tsx`
- Accept optional `initialAlias?: Partial<Alias>` prop
- When set, open editor pre-filled with those values

### Wire up in `App.tsx`
- Track `pendingAiTrigger` / `pendingAiAlias` state
- When AI generates one, set the state and switch to the appropriate panel
- Pass as `initialTrigger` / `initialAlias` prop, clear after editor opens

---

## Files Summary

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `llama-cpp-2`, `reqwest` |
| `src-tauri/src/lib.rs` | Add `mod llm`, manage `LlmState`, register 5 commands |
| `src-tauri/src/llm.rs` | **NEW** — Model download, load/unload, inference |
| `src/contexts/AiContext.tsx` | **NEW** — AI state, inference methods, system prompts |
| `src/components/AiPanel.tsx` | **NEW** — Pinnable AI conversation panel |
| `src/App.tsx` | `/ai` command interception, AI panel registration, editor pre-fill wiring |
| `src/components/Toolbar.tsx` | AI toggle button (brain icon) |
| `src/components/icons.tsx` | Add `BrainIcon` |
| `src/lib/terminalUtils.ts` | Add `getTerminalHistory()` |
| `src/lib/settingsMigrations.ts` | v11→v12 migration |
| `src/types/index.ts` | Add `'ai'` to Panel/PinnablePanel types |
| `src/components/TriggerPanel.tsx` | Accept `initialTrigger` prop for pre-fill |
| `src/components/AliasPanel.tsx` | Accept `initialAlias` prop for pre-fill |
| `src/main.tsx` | Wrap with `AiProvider` |

## Default Model
**Qwen2.5-1.5B-Instruct** (Q4_K_M quantization, ~1GB)
- Good at structured output / JSON generation
- Small enough for CPU inference (~15-30 tok/s)
- GGUF hosted on HuggingFace (direct download, no API key)

## Verification
1. `npm run tauri dev` — verify llama-cpp-2 compiles with the Tauri app
2. Open AI panel → shows "Download model" prompt → click download → progress bar → completes
3. Model loads into memory → panel shows "Ready"
4. Type `/ai hello` → AI panel opens, shows response
5. Type `/ai trigger heal me when I see "bleeding"` → Trigger panel opens with pre-filled editor
6. Type `/ai alias make "aa" attack and kill target` → Alias panel opens with pre-filled editor
7. Disable AI → model unloads, memory freed
8. Re-enable → model reloads from disk (no re-download)
