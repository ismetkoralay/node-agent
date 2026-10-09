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

Planned, per the roadmap below:

- NestJS for the HTTP API
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
