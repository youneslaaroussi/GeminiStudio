"""
Generate hand-drawn style architecture diagrams using Mermaid.
Run with: python scripts/generate_diagrams.py
Requires: npm install -g @mermaid-js/mermaid-cli
"""

import subprocess
import os

os.makedirs("assets", exist_ok=True)

# Mermaid config for hand-drawn look
config = """{
  "theme": "default",
  "look": "handDrawn",
  "themeVariables": {
    "fontFamily": "Virgil, Segoe UI, sans-serif",
    "primaryColor": "#E8F0FE",
    "primaryTextColor": "#202124",
    "primaryBorderColor": "#4285F4",
    "lineColor": "#5F6368",
    "secondaryColor": "#FEF7E0",
    "tertiaryColor": "#E6F4EA"
  }
}"""

with open("assets/mermaid-config.json", "w") as f:
    f.write(config)


# Diagram 1: Infrastructure
infra = """
flowchart TB
    subgraph ai["AI Services"]
        gemini["fa:fa-brain Gemini 3"]
        video["fa:fa-eye Video Intelligence"]
        gen["fa:fa-palette Veo / Imagen / Chirp"]
    end

    subgraph data["Data Layer"]
        gcs["fa:fa-box Cloud Storage"]
        firestore["fa:fa-database Firestore"]
    end

    subgraph events["Events & Queue"]
        pubsub["fa:fa-broadcast-tower Pub/Sub"]
        redis["fa:fa-server Redis"]
    end

    gemini --> video
    gemini --> gen
    gemini -.-> firestore
    video --> gcs
    gen --> gcs
    redis --> pubsub
"""

# Diagram 2: Request Flow
flow = """
flowchart LR
    user(("fa:fa-user User"))

    subgraph input["Input"]
        web["fa:fa-globe Web App"]
        tg["fa:fa-paper-plane Telegram"]
    end

    subgraph reason["Reasoning Layer"]
        agent["fa:fa-brain Gemini 3 Agent"]
    end

    subgraph exec["Execution Layer"]
        tools["fa:fa-tools 15+ Tools"]
    end

    subgraph render["Renderer"]
        mc["fa:fa-film Motion Canvas"]
    end

    video(("fa:fa-video Video"))

    user --> web & tg
    web & tg -->|"intent"| agent
    agent -->|"orchestrate"| tools
    tools -->|"timeline"| mc
    mc -->|"export"| video
    video -.->|"ready!"| user
"""

# Diagram 3: Asset Pipeline
pipeline = """
flowchart LR
    upload(("fa:fa-upload Upload"))

    subgraph storage["Storage"]
        gcs["fa:fa-cloud GCS"]
    end

    subgraph intel["Video Intelligence API"]
        shots["fa:fa-cut Shots"]
        labels["fa:fa-tags Labels"]
        speech["fa:fa-microphone Speech"]
    end

    subgraph understand["Understanding"]
        gemini["fa:fa-brain Gemini Analysis"]
    end

    subgraph index["Index"]
        library["fa:fa-book Asset Library"]
    end

    upload --> gcs
    gcs --> shots & labels & speech
    shots & labels & speech --> gemini
    gemini --> library
"""

diagrams = [
    ("infra_diagram", infra),
    ("flow_diagram", flow),
    ("asset_pipeline_diagram", pipeline),
]

for name, content in diagrams:
    mmd_file = f"assets/{name}.mmd"
    png_file = f"assets/{name}.png"

    with open(mmd_file, "w") as f:
        f.write(content)

    # Render with mermaid-cli
    result = subprocess.run([
        "mmdc",
        "-i", mmd_file,
        "-o", png_file,
        "-c", "assets/mermaid-config.json",
        "-b", "white",
        "-s", "2",  # scale for crisp output
    ], capture_output=True, text=True)

    if result.returncode == 0:
        print(f"✓ {png_file}")
        os.remove(mmd_file)  # cleanup
    else:
        print(f"✗ {name}: {result.stderr}")

os.remove("assets/mermaid-config.json")
print("\nDone! Hand-drawn diagrams with Font Awesome icons.")
