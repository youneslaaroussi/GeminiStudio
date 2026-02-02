# Gemini Studio

<div align="center">

![Gemini Studio Logo](app/public/gemini-logo.png)


### The Execution Layer for Agentic Video

**Generative AI solved pixel generation. We're solving video production.**

**The deterministic engine that gives AI agents the hands to edit video.**

*Built for the [Gemini 3 Hackathon](https://gemini3.devpost.com)*

![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white)
![Gemini 3 Pro](https://img.shields.io/badge/Gemini_3-Pro-4285F4?logo=google&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-Agent-00ff88)
![Motion Canvas](https://img.shields.io/badge/Motion_Canvas-Renderer-f59e0b)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![License](https://img.shields.io/badge/License-Elastic%202.0-yellowgreen)

![Architecture](assets/Architecture_Diagram.png)

</div>

---

> **The Bet:** In 2 years, manual video editing will be obsolete for 90% of use cases. The bottleneck isn't AI models—it's the lack of infrastructure that lets agents *actually edit*. We're building that missing layer.

---

## Demo & submission

| Item | Link |
|------|------|
| **Live demo** | https://www.geminivideo.studio/ |
| **Repository** | https://github.com/youneslaaroussi/geministudio |

---

## Table of Contents

- [The Problem](#the-problem-ai-can-generate-pixels-but-it-cant-produce-video)
- [The Solution](#the-solution-an-execution-layer-for-ai-agents)
- [Why This Changes Everything](#why-this-changes-everything)
- [Gemini 3 Pro: The Reasoning Layer](#gemini-3-pro-the-reasoning-layer)
- [Architecture](#components)
- [How the Execution Layer Works](#how-the-execution-layer-works)
- [Tech Stack](#tech-stack)
- [Setup](#setup)
- [License](#license)

---

## The Problem: AI Can Generate Pixels, But It Can't *Produce* Video

**Veo solved generation. But it didn't solve production.**

A raw AI-generated clip is not a finished video. It has no narrative structure, no pacing, no intent. The bottleneck isn't the model—it's the lack of a rendering engine that can translate an agent's text-based intent into a frame-perfect video edit.

We're moving from **"Tools for Editors"** (e.g. Premiere Pro) to **"Directors for Agents."**

---

## The Solution: An Execution Layer for AI Agents

**Gemini Studio is the infrastructure that gives AI agents hands.**

We built the deterministic engine that allows an agent to:
- **Ingest** raw footage (screen recordings, generated clips, uploads)
- **Understand** semantic intent ("zoom in on the error", "cut to the reaction")
- **Execute** the edit programmatically—frame-perfect, no human in the loop

This isn't a chatbot wrapper. The agent has **real agency**: it calls the renderer, manipulates the timeline, triggers Veo 3/Nano Banana Pro/Lyria/Chirp generation, and proactively notifies you when your video is ready. Gemini 3 Pro becomes the **reasoning layer** for the entire production stack.

**The result:** Video creation transforms from a manual craft into a scalable API call.

---

## Why This Changes Everything

### Vibe Editing
Describe the *feeling* you want. "Make it punchy." "Slow it down for drama." "Add energy to this section." The agent understands vibes and translates them into concrete editing decisions—cuts, zooms, pacing, transitions.

### The Cursor for Video Editing
Just like Cursor revolutionized coding by letting AI agents write alongside you, Gemini Studio lets AI agents *edit alongside you*. Same project. Same timeline. Human and agent, co-directing in real-time.

### Git-Style Branching for Video
Your timeline is version-controlled. The cloud agent edits on a branch. You review the changes. Merge what you like, discard what you don't. Split timelines, experiment freely, sync seamlessly.

| Feature | What It Enables |
|---------|-----------------|
| **Vibe Editing** | Intent-based editing ("make it cinematic") |
| **Real-time Sync** | Agent edits appear live in your timeline |
| **Branching** | Non-destructive experimentation |
| **Merge/Split** | Combine agent work with your own edits |

This isn't automation. This is **collaboration between human directors and AI agents.**

---

## Gemini 3 Pro: The Reasoning Layer

Gemini 3 Pro isn't just integrated—it's the brain that makes agentic video possible. We leverage its state-of-the-art reasoning and native multimodal understanding to power every layer of the stack.

**Agent Brain (LangGraph + Gemini 3 Pro)**
Every interaction flows through Gemini 3 Pro. It reasons over project state, decides which tools to invoke, and orchestrates the entire editing pipeline. We use dynamic `thinking_level` to balance reasoning depth with response latency. Without Gemini 3 Pro's reasoning and tool use, there is no execution layer—only a traditional UI waiting for human input.

**Multimodal Understanding (1M Token Context Window)**
The agent doesn't just receive text—it *sees* and *hears*. Gemini 3 Pro can comprehend video, images, and audio natively through its 1 million token context window. We use the `media_resolution` parameter to optimize token usage while maintaining fidelity for scene detection, object recognition, and transcription.

**Asset Intelligence Pipeline**
Every uploaded asset goes through Gemini 3 Pro's multimodal analysis:
- **Scene Detection** — Automatic boundary identification using native video understanding
- **Object Recognition** — Context-aware detection throughout the video
- **Speech Transcription** — Full audio-to-text with word-level timestamps
- **Semantic Understanding** — High-level analysis ("what's happening here?")

The agent doesn't just know *that* you have a video—it knows *what's in it*, frame by frame. This is how "find the moment where I click the submit button" actually works.

![Asset Pipeline](assets/asset_pipeline_diagram.png)

**Generative Pipeline (Veo 3, Nano Banana Pro, Lyria, Chirp)**
The agent doesn't just edit existing footage—it creates. Need b-roll? Veo 3. Need a thumbnail? Nano Banana Pro. Need background music? Lyria. Need narration? Chirp TTS. These aren't add-ons; they're first-class tools the agent invokes autonomously based on narrative intent.

**The Stack:**
| Layer | Role |
|-------|------|
| **Gemini 3 Pro** | Reasoning + tool orchestration + multimodal understanding |
| **Files API** | Media upload and processing |
| **Veo 3 / Nano Banana Pro / Lyria / Chirp** | Generative media creation |
| **Motion Canvas** | Deterministic frame-perfect rendering |

This is the full loop: **ingest → perceive → reason → generate → render.**

---

## Components

| Component           | Tech                         | Port (default) | README                    |
|--------------------|------------------------------|----------------|---------------------------|
| **app**            | Next.js                      | 3000           | [app/README.md](app/README.md) |
| **langgraph_server** | FastAPI, LangGraph, Gemini   | 8000           | [langgraph_server/README.md](langgraph_server/README.md) |
| **Telegram agent** | Same LangGraph server, webhook | —              | [langgraph_server/README.md](langgraph_server/README.md#chat-providers) |
| **asset-service**  | FastAPI, GCS, Firestore      | 8081           | [asset-service/README.md](asset-service/README.md) |
| **renderer**       | Express, BullMQ, Puppeteer, FFmpeg | 4000    | [renderer/README.md](renderer/README.md) |
| **scene**          | Motion Canvas, Vite          | (build only)   | — |
| **video-effects-service** | FastAPI, Replicate | —        | [video-effects-service/README.md](video-effects-service/README.md) |
| **billing-service** | NestJS, Firebase             | —              | [billing-service/README.md](billing-service/README.md) |

---

## How the Execution Layer Works

![Request Flow](assets/flow_diagram.png)

**1. Agent Receives Intent** — User speaks naturally (web or Telegram). The Gemini 3 Pro agent parses the request and plans the execution.

**2. Tools Execute Autonomously** — The agent invokes 15+ tools: timeline manipulation, asset search, Veo generation, image creation, TTS. Each tool is a deterministic operation the agent controls.

**3. Renderer Produces Output** — Motion Canvas renders the final video headlessly—pixel-perfect, production-ready. Pub/Sub events notify the agent on completion.

**4. Agent Closes the Loop** — "Your video is ready." The agent proactively informs the user. No polling. No waiting. Full autonomy.

---

## Autonomous Video Production: The Agent Can Watch Its Own Work

**This is the moat.** Gemini Studio is the first platform where an AI agent can autonomously iterate on video edits without human intervention.

### The Iteration Loop

<div align="center">
<img src="assets/iteration_diagram.png" alt="Agent Iteration Loop" height="500" />
</div>

### Why This Matters

**Traditional AI video tools:** Generate → Done. No feedback loop. No iteration.

**Gemini Studio:** Generate → Watch → Critique → Adjust → Repeat → Deliver.

The agent has:
- **Eyes** (Gemini multimodal can analyze video content)
- **Hands** (18 tools for timeline manipulation)
- **Judgment** (can evaluate pacing, cuts, transitions)
- **Memory** (maintains context across iterations)

This is the difference between a tool that produces output and an agent that produces *quality* output.

### Render Quality Controls

The agent intelligently chooses render settings based on intent:

| Mode | Settings | Use Case |
|------|----------|----------|
| **Preview** | `quality='low'`, `fps=15`, `range=[start,end]` | Fast iteration, reviewing segments |
| **Draft** | `quality='web'`, full timeline | Near-final review |
| **Production** | `quality='studio'`, full timeline | Final delivery |

---

## Tech stack

![Infrastructure](assets/infra_diagram.png)

| Category     | Technology              | Purpose |
|-------------|--------------------------|---------|
| Frontend    | Next.js, React           | Web app, timeline editor, chat UI |
| Agent       | LangGraph, Gemini        | Conversational agent, tools |
| Render      | Motion Canvas, Puppeteer | Headless video composition |
| Queue       | BullMQ, Redis            | Render job queue |
| Backend     | FastAPI (Python)         | LangGraph server, asset service, video-effects-service |
| Storage     | GCS, Firestore           | Assets, metadata, projects |
| Events      | Google Cloud Pub/Sub     | Render completion, pipeline events |
| Auth        | Firebase                 | Auth, projects, chat sessions |
| Monorepo    | pnpm workspaces          | app, scene, renderer, shared |

The codebase is a pnpm monorepo with TypeScript (app, scene, renderer) and Python (langgraph_server, asset-service, video-effects-service). The LangGraph server and asset service include tests; the agent and tools are typed and documented for maintainability.

---

## Setup

### Prerequisites

- **Node.js** 20+, **pnpm** 9 (`corepack enable pnpm`)
- **Python** 3.11+ (e.g. `uv` or `pip`)
- **Redis** (for the renderer queue)
- **Google Cloud** – GCS, optional Pub/Sub, Firebase
- **Chrome or Chromium** (for the renderer)

### Install

```bash
git clone https://github.com/youneslaaroussi/geministudio
cd geministudio
pnpm install
pnpm --filter @gemini-studio/scene run build
pnpm --filter @gemini-studio/renderer run build:headless
```

### Environment

Copy the example env file for each service you run; set API keys and URLs. Details are in each service’s README.

| Service        | Config |
|----------------|--------|
| App            | `app/env.template` → `app/.env.local` |
| LangGraph      | `langgraph_server/.env.example` → `langgraph_server/.env` |
| Renderer       | `REDIS_URL` (and optional Pub/Sub) in `renderer/` |
| Asset service  | `asset-service/.env.example` → `asset-service/.env` |

### Run locally

1. Start **Redis**.
2. In separate terminals, start each service:

   **Terminal 1 – Renderer**
   ```bash
   pnpm --filter @gemini-studio/renderer dev
   ```

   **Terminal 2 – LangGraph**
   ```bash
   cd langgraph_server && uv run uvicorn langgraph_server.main:app --reload --port 8000
   ```

   **Terminal 3 – Asset service**
   ```bash
   cd asset-service && uv run python -m asset_service
   ```

   **Terminal 4 – App**
   ```bash
   pnpm --filter app dev
   ```

3. Open **http://localhost:3000**. If the LangGraph server is elsewhere, set `NEXT_PUBLIC_LANGGRAPH_URL` in the app env.

---

## Repository structure

```
GeminiStudio/
├── app/                    # Next.js app (editor, chat, assets UI)
├── scene/                  # Motion Canvas project (Vite)
├── renderer/               # Render service (Express, BullMQ, headless bundle)
├── langgraph_server/       # LangGraph agent (FastAPI, Gemini 3, tools)
├── asset-service/          # Asset upload & pipeline (Gemini analysis, GCS, Firestore)
├── video-effects-service/  # Video effects (FastAPI, Replicate)
├── billing-service/        # Credits & billing (NestJS)
├── shared/                 # Shared tool manifest (shared/tools/manifest.json)
├── deploy/                 # Terraform, Caddy, docker-compose
├── package.json            # Root pnpm workspace
├── pnpm-workspace.yaml
└── README.md               # This file
```

**Key areas:**

| Area          | Path |
|---------------|------|
| Agent & tools | `langgraph_server/agent.py`, `langgraph_server/tools/` |
| Tool manifest | `shared/tools/manifest.json` |
| Renderer      | `renderer/` |
| Scene         | `scene/` |
| App           | `app/app/` |

Each service has its own README for setup and deployment.

---

## License

**Elastic License 2.0 (ELv2)** – See [LICENSE](LICENSE).

You may use, copy, distribute, and make derivative works of the software. You may **not** offer it to third parties as a hosted or managed service (i.e. you cannot run “Gemini Studio as a service” for others). You must keep license and copyright notices intact and pass these terms on to anyone who receives the software from you.
