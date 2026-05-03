# AGENTS.md

## Project Structure

- `website` is the frontend project.
- `backend` is the TypeScript/Node backend project.
- This project is an AI coding workspace/control panel for managing local workspaces, Codex/Cursor-style sessions, and realtime agent output.

## Working Rules

- When the request is about UI, pages, styles, frontend state, or browser behavior, work in `website`.
- When the request is about APIs, services, workspace management, sessions, agent process control, realtime streams, persistence, jobs, auth, or server behavior, work in `backend`.
- Keep frontend and backend changes scoped to the relevant project unless the task explicitly requires integration work across both.
- For backend changes, use TypeScript/Node patterns. Prefer structured SDK integration when available, and use CLI wrappers only when an SDK is unavailable or insufficient.
- For backend realtime agent output, prefer WebSocket or SSE with typed event payloads.
- Keep shared frontend/backend data shapes explicit and stable, especially `Workspace`, `Session`, and agent event types.
- For frontend changes, follow the existing frontend framework and styling patterns, and run the relevant build or lint checks when practical.
