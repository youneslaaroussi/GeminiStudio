# Modular system prompts

The agent's system prompt is built from the `.txt` files in this directory, in the order defined in `__init__.py` (`PROMPT_SECTION_ORDER`).

## Sections

| File | Purpose |
|------|---------|
| `base.txt` | Identity, absolute rules (no questions, one tool per response). |
| `render_and_defaults.txt` | Render immediately, format/quality defaults. |
| `timeline_layers.txt` | Layer order, title cards, transitions. |
| `motion_canvas.txt` | Motion Canvas TSX for createComponent/editComponent: signals, refs, tweening, components, primitives, geographic path data (d3-geo). |
| `video_iteration.txt` | Preview → review → final render workflow. |
| `video_effects.txt` | Digest clip then apply effect (e.g. segmentation). |
| `narrative.txt` | Vlog/story from raw clips: createEditPlan first, then execute; metadata, transcript, shots, offset/duration, search. |
| `chapters_and_titles.txt` | Title cards and chapter cards (text clips). |
| `music_mood.txt` | Choose music mood from narrative. |
| `examples.txt` | Right vs wrong behavior examples. |

## Editing

- Edit or add `.txt` files; use `# Section title` at the top for readability (included in prompt).
- To change order or add a section: update `PROMPT_SECTION_ORDER` in `prompts/__init__.py`.
- Sections are joined with `\n\n`. Keep each file focused and concise.

## Override

If `SYSTEM_PROMPT` is set in the environment (or in `.env`), that value is used instead of the composed prompt. Use this to test a single custom prompt without changing files.
