# Codex Review Control

Codex Review Control is a local AI coding workspace and review control panel. It uses the OpenAI Codex SDK as the primary agent runtime and adds review-focused workflow features around local code changes, agent sessions, realtime output, and line-by-line change inspection.

The project is built on a simple principle: AI-generated code should not be fully trusted by default. Instead of treating an agent run as a black box or accepting its output automatically, Codex Review Control tracks sessions, captures changed files, keeps review notes, and provides a UI for inspecting every meaningful code change before accepting or continuing the work.

## Core Purpose

- Run Codex SDK sessions against local workspaces.
- Manage multiple projects and agent sessions from a single control panel.
- Stream agent output in realtime while a task is running.
- Snapshot workspace changes before and after agent turns.
- Review modified files, explanations, and notes in an audit-friendly interface.
- Strengthen human review of AI-generated code at the line level.
- Support Codex CLI, Cursor Agent, and terminal-style sessions alongside the Codex SDK path.

## Why Codex SDK

The backend integrates `@openai/codex-sdk` to run structured Codex sessions directly from the application. This makes it possible to keep agent execution, model options, sandbox mode, session state, and event handling inside the project rather than relying only on an external command-line wrapper.

Codex SDK sessions are used as the enhanced review path, with support for:

- Structured agent events.
- Workspace-aware execution.
- Configurable model and reasoning effort.
- Ask/research flows before applying work.
- Attachment handling for image-assisted coding tasks.
- Change explanations for reviewed files.

## Project Structure

- `website` contains the React/Vite frontend control panel.
- `backend` contains the TypeScript/Node backend, API routes, WebSocket streams, Codex SDK integration, workspace persistence, and review data storage.

## Local Development

Install dependencies in the frontend and backend projects, then run the development scripts from the project root or from each package directly.

```bash
npm run dev
```

Windows PowerShell users can run:

```powershell
npm run dev:win
```

`dev:win` now streams backend/website logs in the same terminal with service prefixes, making startup diagnostics easier on Windows.

If backend startup reports missing `workspace-client` under `.prisma`, run:

```powershell
cd backend
pnpm run db:generate
```

Useful root scripts:

```bash
npm run dev:website
npm run dev:backend
npm run dev:win
npm run build
npm run start
```

## Status

This repository is an active local control panel for AI coding and code review workflows. The main focus is using Codex SDK sessions to improve visibility, reviewability, and control over automated code changes, with an explicit bias toward careful human review of every line the AI modifies.
