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
    subgraph ai["Gemini 3 Pro"]
        gemini["fa:fa-brain Reasoning Layer"]
        vision["fa:fa-eye Multimodal Understanding"]
        gen["fa:fa-palette Veo 3 / Nano Banana Pro / Lyria / Chirp"]
    end

    subgraph data["Data Layer"]
        gcs["fa:fa-box Cloud Storage"]
        firestore["fa:fa-database Firestore"]
    end

    subgraph events["Events & Queue"]
        pubsub["fa:fa-broadcast-tower Pub/Sub"]
        redis["fa:fa-server Redis"]
    end

    gemini --> vision
    gemini --> gen
    gemini -.-> firestore
    vision --> gcs
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
        agent["fa:fa-brain Gemini 3 Pro"]
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

# Diagram 3: Asset Pipeline - emphasizing Gemini 3's native multimodal
pipeline = """
flowchart LR
    upload(("fa:fa-upload Upload"))

    subgraph storage["Storage"]
        gcs["fa:fa-cloud GCS"]
    end

    subgraph context["1M Token Context Window"]
        media["fa:fa-photo-video Video / Images / Audio"]
    end

    subgraph gemini["Gemini 3 Pro Multimodal"]
        understanding["fa:fa-brain Native Understanding"]
    end

    subgraph index["Index"]
        library["fa:fa-book Searchable Assets"]
    end

    upload --> gcs
    gcs --> media
    media -->|"media_resolution"| understanding
    understanding --> library
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
print("\nDone! Diagrams use official Gemini 3 terminology.")
