"""Pipeline steps - import to register with the registry."""

from . import metadata
from . import upload
from . import image_convert
from . import thumbnail
from . import frame_sampling
from . import waveform
from . import audio_extract
from . import shot_detection
from . import label_detection
from . import person_detection
from . import face_detection
from . import transcription
from . import gemini_analysis
from . import description

__all__ = [
    "metadata",
    "upload",
    "image_convert",
    "thumbnail",
    "frame_sampling",
    "waveform",
    "audio_extract",
    "shot_detection",
    "label_detection",
    "person_detection",
    "face_detection",
    "transcription",
    "gemini_analysis",
    "description",
]
