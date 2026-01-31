"""CloudConvert API client for general file conversion.

Supports any conversion type including:
- Image: HEIC → PNG/JPG, WebP, etc.
- Video: MOV → MP4, etc.
- Document: PDF, Office formats, etc.

API Reference: https://cloudconvert.com/api/v2
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from enum import Enum
from typing import Any

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

# CloudConvert API base URLs
API_BASE = "https://api.cloudconvert.com/v2"
SANDBOX_API_BASE = "https://sandbox.cloudconvert.com/v2"

# Timeouts
JOB_TIMEOUT_SECONDS = 300  # 5 minutes max for conversion
POLL_INTERVAL_SECONDS = 2


class ConversionJobStatus(str, Enum):
    """Status of a CloudConvert job."""
    WAITING = "waiting"
    PROCESSING = "processing"
    FINISHED = "finished"
    ERROR = "error"


@dataclass
class ConversionResult:
    """Result of a conversion job."""
    status: ConversionJobStatus
    job_id: str
    output_url: str | None = None
    output_filename: str | None = None
    error: str | None = None
    metadata: dict[str, Any] | None = None


def _get_api_base() -> str:
    """Get the API base URL based on settings."""
    settings = get_settings()
    return SANDBOX_API_BASE if settings.cloudconvert_sandbox else API_BASE


def _get_headers() -> dict[str, str]:
    """Get API headers with authorization."""
    settings = get_settings()
    if not settings.cloudconvert_api_key:
        raise ValueError("CLOUDCONVERT_API_KEY not configured")
    return {
        "Authorization": f"Bearer {settings.cloudconvert_api_key}",
        "Content-Type": "application/json",
    }


async def create_conversion_job(
    input_url: str,
    input_format: str,
    output_format: str,
    *,
    filename: str | None = None,
    options: dict[str, Any] | None = None,
) -> str:
    """
    Create a CloudConvert conversion job.
    
    This creates a job with:
    1. Import/url task - fetch the input file
    2. Convert task - convert to target format
    3. Export/url task - generate download URL
    
    Args:
        input_url: URL of the input file (signed GCS URL works)
        input_format: Input format (e.g., "heic", "mov")
        output_format: Output format (e.g., "png", "mp4")
        filename: Optional output filename
        options: Additional conversion options (width, height, quality, etc.)
    
    Returns:
        Job ID from CloudConvert
    """
    api_base = _get_api_base()
    headers = _get_headers()
    
    # Build the job with tasks
    convert_options: dict[str, Any] = {
        "input": "import-file",
        "input_format": input_format.lower(),
        "output_format": output_format.lower(),
    }
    
    if filename:
        convert_options["filename"] = filename
    
    # Merge additional options (width, height, quality, strip metadata, etc.)
    if options:
        convert_options.update(options)
    
    job_payload = {
        "tasks": {
            "import-file": {
                "operation": "import/url",
                "url": input_url,
            },
            "convert-file": {
                "operation": "convert",
                **convert_options,
            },
            "export-file": {
                "operation": "export/url",
                "input": "convert-file",
            },
        },
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{api_base}/jobs",
            headers=headers,
            json=job_payload,
            timeout=60.0,
        )
        
        if response.status_code not in (200, 201):
            error_detail = response.text
            try:
                error_json = response.json()
                error_detail = error_json.get("message", error_detail)
            except Exception:
                pass
            raise RuntimeError(f"CloudConvert API error ({response.status_code}): {error_detail}")
        
        data = response.json()
        job_id = data.get("data", {}).get("id")
        
        if not job_id:
            raise RuntimeError("CloudConvert did not return a job ID")
        
        logger.info(f"Created CloudConvert job {job_id}: {input_format} → {output_format}")
        return job_id


async def get_job_status(job_id: str) -> ConversionResult:
    """
    Get the status of a CloudConvert job.
    
    Returns:
        ConversionResult with current status and output URL if finished
    """
    api_base = _get_api_base()
    headers = _get_headers()
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{api_base}/jobs/{job_id}",
            headers=headers,
            timeout=30.0,
        )
        
        if response.status_code != 200:
            raise RuntimeError(f"Failed to get job status: {response.text}")
        
        data = response.json().get("data", {})
        status_str = data.get("status", "waiting")
        
        # Map CloudConvert status to our enum
        status_map = {
            "waiting": ConversionJobStatus.WAITING,
            "processing": ConversionJobStatus.PROCESSING,
            "finished": ConversionJobStatus.FINISHED,
            "error": ConversionJobStatus.ERROR,
        }
        status = status_map.get(status_str, ConversionJobStatus.WAITING)
        
        result = ConversionResult(
            status=status,
            job_id=job_id,
            metadata=data,
        )
        
        # If finished, extract output URL from export task
        if status == ConversionJobStatus.FINISHED:
            tasks = data.get("tasks", [])
            for task in tasks:
                if task.get("operation") == "export/url" and task.get("status") == "finished":
                    result_data = task.get("result", {})
                    files = result_data.get("files", [])
                    if files:
                        result.output_url = files[0].get("url")
                        result.output_filename = files[0].get("filename")
                    break
        
        # If error, extract error message
        if status == ConversionJobStatus.ERROR:
            tasks = data.get("tasks", [])
            for task in tasks:
                if task.get("status") == "error":
                    result.error = task.get("message", "Unknown conversion error")
                    break
        
        return result


async def wait_for_job(
    job_id: str,
    timeout: float = JOB_TIMEOUT_SECONDS,
    poll_interval: float = POLL_INTERVAL_SECONDS,
) -> ConversionResult:
    """
    Wait for a CloudConvert job to complete.
    
    Args:
        job_id: The job ID to wait for
        timeout: Maximum time to wait in seconds
        poll_interval: Time between status checks
    
    Returns:
        ConversionResult with final status
    """
    start_time = time.time()
    
    while True:
        elapsed = time.time() - start_time
        if elapsed >= timeout:
            return ConversionResult(
                status=ConversionJobStatus.ERROR,
                job_id=job_id,
                error=f"Conversion timed out after {timeout}s",
            )
        
        result = await get_job_status(job_id)
        
        if result.status in (ConversionJobStatus.FINISHED, ConversionJobStatus.ERROR):
            return result
        
        logger.debug(f"CloudConvert job {job_id} is {result.status.value}, waiting... ({elapsed:.0f}s)")
        await asyncio.sleep(poll_interval)


async def convert_file(
    input_url: str,
    input_format: str,
    output_format: str,
    *,
    filename: str | None = None,
    options: dict[str, Any] | None = None,
    timeout: float = JOB_TIMEOUT_SECONDS,
) -> ConversionResult:
    """
    Convert a file and wait for completion.
    
    This is a convenience function that creates a job and waits for it.
    
    Args:
        input_url: URL of the input file
        input_format: Input format (e.g., "heic")
        output_format: Output format (e.g., "png")
        filename: Optional output filename
        options: Additional conversion options
        timeout: Maximum time to wait
    
    Returns:
        ConversionResult with output URL if successful
    """
    job_id = await create_conversion_job(
        input_url=input_url,
        input_format=input_format,
        output_format=output_format,
        filename=filename,
        options=options,
    )
    
    return await wait_for_job(job_id, timeout=timeout)
