"""Pipeline steps - import to register with the registry."""

from . import metadata
from . import upload
from . import shot_detection
from . import label_detection
from . import person_detection
from . import face_detection
from . import transcription
from . import gemini_analysis

__all__ = [
    "metadata",
    "upload",
    "shot_detection",
    "label_detection",
    "person_detection",
    "face_detection",
    "transcription",
    "gemini_analysis",
]
