"""Search API routes for asset discovery."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ...config import get_settings
from ...pipeline.store import get_pipeline_state
from ...search.algolia import (
    configure_index,
    index_asset,
    search_assets,
    build_searchable_content,
)
from ...storage.firestore import get_asset, list_assets

logger = logging.getLogger(__name__)

router = APIRouter()


class SearchRequest(BaseModel):
    """Request body for search."""

    query: str = Field(..., description="Search query string")
    type: str | None = Field(default=None, description="Filter by asset type (video, audio, image, other)")
    limit: int = Field(default=20, ge=1, le=100, description="Max results to return")
    offset: int = Field(default=0, ge=0, description="Pagination offset")


class SearchHit(BaseModel):
    """A single search result."""

    id: str
    userId: str | None = None
    projectId: str | None = None
    name: str
    fileName: str | None = None
    type: str
    mimeType: str | None = None
    size: int | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    description: str | None = None
    labels: list[str] = []
    uploadedAt: str | None = None
    updatedAt: str | None = None
    highlights: dict[str, str | None] = {}
    # signedUrl will be populated by the caller if needed
    signedUrl: str | None = None


class SearchResponse(BaseModel):
    """Response from search endpoint."""

    hits: list[SearchHit]
    total: int
    query: str
    page: int = 0
    totalPages: int = 0
    processingTimeMs: int = 0
    error: str | None = None


@router.post("/search", response_model=SearchResponse)
async def search_all_assets(body: SearchRequest):
    """
    Search assets across all users and projects.
    
    This is an admin/internal endpoint. For user-scoped search, use the
    user/project-specific endpoint.
    """
    settings = get_settings()
    
    if not settings.algolia_enabled:
        raise HTTPException(
            status_code=503,
            detail="Search is not configured. Set ALGOLIA_APP_ID and ALGOLIA_ADMIN_API_KEY.",
        )
    
    results = await search_assets(
        query=body.query,
        asset_type=body.type,
        limit=body.limit,
        offset=body.offset,
        settings=settings,
    )
    
    return SearchResponse(**results)


@router.post("/{user_id}/search", response_model=SearchResponse)
async def search_user_assets(
    user_id: str,
    body: SearchRequest,
):
    """
    Search assets for a specific user across all their projects.
    """
    settings = get_settings()
    
    if not settings.algolia_enabled:
        raise HTTPException(
            status_code=503,
            detail="Search is not configured. Set ALGOLIA_APP_ID and ALGOLIA_ADMIN_API_KEY.",
        )
    
    results = await search_assets(
        query=body.query,
        user_id=user_id,
        asset_type=body.type,
        limit=body.limit,
        offset=body.offset,
        settings=settings,
    )
    
    return SearchResponse(**results)


@router.post("/{user_id}/{project_id}/search", response_model=SearchResponse)
async def search_project_assets(
    user_id: str,
    project_id: str,
    body: SearchRequest,
):
    """
    Search assets within a specific project.
    
    Searches across:
    - Asset filename
    - AI-generated description
    - Gemini analysis content
    - Transcription text
    - Detected labels/entities
    """
    settings = get_settings()
    
    if not settings.algolia_enabled:
        raise HTTPException(
            status_code=503,
            detail="Search is not configured. Set ALGOLIA_APP_ID and ALGOLIA_ADMIN_API_KEY.",
        )
    
    results = await search_assets(
        query=body.query,
        user_id=user_id,
        project_id=project_id,
        asset_type=body.type,
        limit=body.limit,
        offset=body.offset,
        settings=settings,
    )
    
    return SearchResponse(**results)


@router.get("/{user_id}/{project_id}/search", response_model=SearchResponse)
async def search_project_assets_get(
    user_id: str,
    project_id: str,
    q: str = Query(..., description="Search query string"),
    type: str | None = Query(default=None, description="Filter by asset type"),
    limit: int = Query(default=20, ge=1, le=100, description="Max results"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
):
    """
    Search assets within a specific project (GET endpoint for convenience).
    """
    settings = get_settings()
    
    if not settings.algolia_enabled:
        raise HTTPException(
            status_code=503,
            detail="Search is not configured. Set ALGOLIA_APP_ID and ALGOLIA_ADMIN_API_KEY.",
        )
    
    results = await search_assets(
        query=q,
        user_id=user_id,
        project_id=project_id,
        asset_type=type,
        limit=limit,
        offset=offset,
        settings=settings,
    )
    
    return SearchResponse(**results)


class ReindexResponse(BaseModel):
    """Response from reindex endpoint."""

    indexed: int
    failed: int
    message: str


@router.post("/{user_id}/{project_id}/reindex", response_model=ReindexResponse)
async def reindex_project_assets(user_id: str, project_id: str):
    """
    Reindex all assets in a project.
    
    Use this to rebuild the search index after enabling Algolia or if
    the index gets out of sync.
    """
    settings = get_settings()
    
    if not settings.algolia_enabled:
        raise HTTPException(
            status_code=503,
            detail="Search is not configured. Set ALGOLIA_APP_ID and ALGOLIA_ADMIN_API_KEY.",
        )
    
    # Get all assets
    assets = await asyncio.to_thread(list_assets, user_id, project_id, settings)
    
    indexed = 0
    failed = 0
    
    for asset in assets:
        try:
            # Get pipeline state for rich content
            pipeline_state = await get_pipeline_state(
                user_id, project_id, asset["id"], settings
            )
            
            success = await index_asset(
                user_id=user_id,
                project_id=project_id,
                asset_data=asset,
                pipeline_state=pipeline_state,
                settings=settings,
            )
            
            if success:
                indexed += 1
            else:
                failed += 1
                
        except Exception as e:
            logger.error(f"Failed to index asset {asset.get('id')}: {e}")
            failed += 1
    
    return ReindexResponse(
        indexed=indexed,
        failed=failed,
        message=f"Reindexed {indexed} assets, {failed} failed",
    )


@router.post("/configure-index")
async def configure_search_index():
    """
    Configure Algolia index settings.
    
    Call this once after setting up Algolia to configure:
    - Searchable attributes
    - Filterable attributes for multi-tenancy
    - Ranking configuration
    """
    settings = get_settings()
    
    if not settings.algolia_enabled:
        raise HTTPException(
            status_code=503,
            detail="Search is not configured. Set ALGOLIA_APP_ID and ALGOLIA_ADMIN_API_KEY.",
        )
    
    success = await configure_index(settings)
    
    if success:
        return {"status": "success", "message": "Index configured successfully"}
    else:
        raise HTTPException(status_code=500, detail="Failed to configure index")
