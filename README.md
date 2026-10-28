# node-agent
[![CI](https://github.com/ismetkoralay/node-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/ismetkoralay/node-agent/actions/workflows/ci.yml)

A TypeScript monorepo for building an LLM agent runtime on Node.js: a provider abstraction over local models served by Ollama, a tool-calling agent loop, and an HTTP API on top. It exists as a hands-on, end-to-end exercise in building an agent without a heavyweight framework, with every layer (types, provider, tools, loop, API, persistence, streaming) small enough to read.

The project is at an early stage. The monorepo scaffolding and tooling are in place, and the packages under `packages/` (`core`, `provider-ollama`, `tools`) are being built out step by step.

## Tech stack

In use today:

- Node.js 26 (see `.node-version`)
- TypeScript
- pnpm workspaces
- Biome (lint and format)
- Vitest
- GitHub Actions (lint, typecheck, test)
- Ollama as the model provider (`@node-agent/provider-ollama`)
- NestJS for the HTTP API (`apps/server`)

Planned, per the roadmap below:

- PostgreSQL with Drizzle for chat history

## Setup and commands

Requires Node.js 26 and pnpm 12 (the pinned version is declared in `package.json`).

```sh
pnpm install
pnpm lint        # biome check
pnpm typecheck   # tsc for the root and every workspace package
pnpm test        # vitest run
```

Other scripts: `pnpm format` (apply Biome fixes) and `pnpm test:watch`.

## Conventions

Message types in `@node-agent/core` keep OpenAI's snake_case field names (`tool_calls`, `tool_call_id`) because that shape goes to the database and the API unchanged; every other type we define uses camelCase (`finishReason`, `promptTokens`).

## Ollama provider

`@node-agent/provider-ollama` talks to Ollama's native `/api/chat` endpoint, not its OpenAI-compatible `/v1/chat/completions`. The compatible endpoint would make the translation below unnecessary; using the native API is a deliberate choice, to practise writing an adapter between two formats. The translation lives in `packages/provider-ollama/src/mapping.ts` as pure functions.

Tool calling differs between our (OpenAI-shaped) format and Ollama's in three places:

| | Our format | Ollama |
|---|---|---|
| Tool call `arguments` | JSON string | JSON object |
| Tool call `id` | always present | absent; the provider generates `call_<uuid>` |
| Tool result message | matched by `tool_call_id` | matched by tool name (`tool_name`) |

Because Ollama has no call ids, an id does not survive a round trip through it: the name and arguments do, and a fresh id is generated each time. Whether a model actually returns structured `tool_calls` depends on the model; `qwen2.5-coder` answered with the call as plain text in `content` in our manual test, while `llama3.2` returned `tool_calls`.

## Local LLM Call

To install ollama on local machine visit: https://ollama.com/download

Ensure that ollama is running. E.g. run ```ollama serve```

Then to install any model ollama supports to local(llama3.2 is used for tests):

```sh
ollama pull <model_name>
```

Copy `OLLAMA_BASE_URL` and `LLM_MODEL` from the .env.example file and paste them .env file on the root(create a new one if it doesn't exist).
Default values for them:
- OLLAMA_BASE_URL='http://localhost:11434'
- LLM_MODEL=llama3.2

After installation is done run:

```sh
pnpm hello "<message_here>"
```

- This command will trigger ollama call and afterwards the result will be visible on console.
- If the message is empty, it'll trigger ollama with a default message.


## Try it in the terminal

`pnpm chat` opens a REPL on top of the whole stack: `OllamaProvider`, an in-memory conversation, and the `get_current_time` and `calculator` tools. It uses the same `.env` values as `pnpm hello` (`OLLAMA_BASE_URL`, `LLM_MODEL`).

```sh
pnpm chat
```

Each answer is preceded by one line per tool call, `[tool] name(arguments) → result (time)`, and followed by the step count and token usage. The tool lines are printed after the run finishes, not while it is in progress.

- `/exit` (or Ctrl+D) leaves.
- Ctrl+C cancels the request in progress and keeps the session. A cancelled request is not added to the history. Ollama itself is not told to stop, so it may keep generating until it finishes.
- Whether the model calls a tool when it should depends on the model; small ones sometimes answer without a tool or call one unprompted.


## HTTP API

`apps/server` is a NestJS app that exposes conversations under `/v1/conversations`. Every error, whatever its source, is turned into one response shape by a single global filter:

```json
{ "error": { "code": "validation_error", "message": "Request validation failed", "requestId": "...", "details": [{ "path": "content", "message": "..." }] } }
```

`code` is a stable snake_case identifier, `requestId` equals the `x-request-id` response header and the `reqId` in the logs, and `details` is present only for `validation_error`. For 5xx responses (`provider_unavailable` is 502, `internal_error` is 500) the message is a fixed text; the real error, with its stack and cause, goes to the log only.

Only one message can run in a conversation at a time. A second message sent while a run is still in progress gets `409 conversation_busy`, so two runs never read the same stale history. This lock is an in-memory `Set` inside the server process, so it assumes a single server instance: with several instances it protects nothing. A shared lock (e.g. Redis) is left for a later step.

## Roadmap

Scope and progress for each step live in its issue.

1. [Monorepo skeleton](https://github.com/ismetkoralay/node-agent/issues/1)
2. [Core types and OllamaProvider](https://github.com/ismetkoralay/node-agent/issues/2)
3. [Tools and the agent loop](https://github.com/ismetkoralay/node-agent/issues/3)
4. [NestJS HTTP API](https://github.com/ismetkoralay/node-agent/issues/4)
5. [Persistent chat history](https://github.com/ismetkoralay/node-agent/issues/5)
6. [Streaming (SSE)](https://github.com/ismetkoralay/node-agent/issues/6)
7. [Parallel agents](https://github.com/ismetkoralay/node-agent/issues/7)
8. [Web UI and polish](https://github.com/ismetkoralay/node-agent/issues/8)
