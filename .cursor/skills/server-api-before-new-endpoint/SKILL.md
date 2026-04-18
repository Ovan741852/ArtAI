---
name: server-api-before-new-endpoint
description: >-
  Ensures new ArtAI server HTTP endpoints are not duplicated. Before adding or
  designing a route, reads server/docs/API.md and compares method/path/purpose
  with existing documented APIs. Use when implementing new REST routes,
  Express handlers, civitai/comfy/catalog endpoints, or when the user mentions
  new server APIs or server/docs/API.md.
---

# Server API — check catalog before new endpoints

## When this applies

Use this skill whenever you are about to add, rename, or split an **HTTP API** on the ArtAI server (Express routes, new `GET`/`POST` paths, proxy endpoints, etc.).

## Required first step

1. **Read** [`server/docs/API.md`](../../../server/docs/API.md) (project root: `server/docs/API.md`).
2. **Decide** whether the behavior already exists under another method/path or section (系統、ComfyUI、本機 Checkpoint、Civitai、Ollama、Demo).
3. **If something fits**: prefer extending or reusing it; explain to the user what overlaps and avoid parallel endpoints that do the same job.
4. **If it is genuinely new**: proceed with implementation and **update `server/docs/API.md` in the same change** (see project rule `server-api-documentation`).

## Quick grep fallback

If `API.md` might be stale relative to code, also search route registration (e.g. `createApp`, `server/src/routes`) for similar paths or keywords before finalizing a new path.
