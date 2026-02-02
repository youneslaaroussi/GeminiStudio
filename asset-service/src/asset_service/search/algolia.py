"""Algolia search client and indexing operations."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from algoliasearch.search.client import SearchClientSync
from algoliasearch.search.config import SearchConfig
from algoliasearch.http.hosts import Host, HostsCollection, CallType

from ..config import Settings, get_settings

logger = logging.getLogger(__name__)

_client: SearchClientSync | None = None


def get_algolia_client(settings: Settings | None = None) -> SearchClientSync | None:
    """Get Algolia client. Returns None if Algolia is not configured."""
    global _client
    
    settings = settings or get_settings()
    
    if not settings.algolia_enabled:
        return None
    
    if _client is not None:
        return _client
    
    # Create custom config with proper hosts
    config = SearchConfig(
        app_id=settings.algolia_app_id,
        api_key=settings.algolia_admin_api_key,
    )
    
    # Configure hosts - use -dsn suffix for all operations
    app_id = settings.algolia_app_id
    config.hosts = HostsCollection(
        hosts=[
            Host(url=f"{app_id}-dsn.algolia.net", accept=CallType.READ | CallType.WRITE),
        ]
    )
    
    _client = SearchClientSync(config=config)
    return _client


def _get_index_name(user_id: str, project_id: str, settings: Settings) -> str:
    """Get the Algolia index name for a user/project."""
    # Use a single index with user/project as filterable attributes for multi-tenancy
    return f"{settings.algolia_index_prefix}_assets"


def build_searchable_content(
    asset_data: dict[str, Any],
    pipeline_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Build searchable content from asset data and optional pipeline state.
    
    Combines:
    - Asset metadata (name, type, dimensions, duration)
    - AI-generated description
    - Gemini analysis text
    - Transcription text
    - Labels/entities from video intelligence
    
    Returns a dict ready for Algolia indexing.
    """
    # Extract pipeline step metadata
    gemini_analysis = ""
    transcript = ""
    labels: list[str] = []
    
    if pipeline_state:
        steps = pipeline_state.get("steps", [])
        for step in steps:
            step_id = step.get("id", "")
            metadata = step.get("metadata", {})
            
            if step_id == "gemini-analysis":
                gemini_analysis = metadata.get("analysis", "")
            elif step_id == "transcription":
                transcript = metadata.get("transcript", "")
            elif step_id == "label-detection":
                # Extract label names from segment labels
                segment_labels = metadata.get("segmentLabels", [])
                for label in segment_labels:
                    entity = label.get("entity", {})
                    if entity.get("description"):
                        labels.append(entity["description"])
    
    # Combine all text for full-text search
    searchable_parts = [
        asset_data.get("name", ""),
        asset_data.get("description", ""),
        asset_data.get("notes", ""),
        gemini_analysis,
        transcript,
    ]
    searchable_text = " ".join(filter(None, searchable_parts))
    
    # Build the indexable document
    now = datetime.utcnow().isoformat() + "Z"
    
    return {
        "objectID": asset_data.get("id"),
        "userId": asset_data.get("userId"),
        "projectId": asset_data.get("projectId"),
        "name": asset_data.get("name", ""),
        "fileName": asset_data.get("fileName", ""),
        "type": asset_data.get("type", "other"),
        "mimeType": asset_data.get("mimeType", ""),
        "size": asset_data.get("size", 0),
        "width": asset_data.get("width"),
        "height": asset_data.get("height"),
        "duration": asset_data.get("duration"),
        "description": asset_data.get("description", ""),
        "notes": asset_data.get("notes", ""),
        "geminiAnalysis": gemini_analysis[:5000] if gemini_analysis else "",  # Truncate long analysis
        "transcript": transcript[:5000] if transcript else "",  # Truncate long transcripts
        "labels": labels[:100],  # Limit labels
        "searchableText": searchable_text[:10000],  # Combined text for search
        "uploadedAt": asset_data.get("uploadedAt", now),
        "updatedAt": asset_data.get("updatedAt", now),
        "indexedAt": now,
    }


async def index_asset(
    user_id: str,
    project_id: str,
    asset_data: dict[str, Any],
    pipeline_state: dict[str, Any] | None = None,
    settings: Settings | None = None,
) -> bool:
    """
    Index an asset in Algolia.
    
    Args:
        user_id: User ID (for multi-tenancy filtering)
        project_id: Project ID
        asset_data: Asset data from Firestore
        pipeline_state: Optional pipeline state with analysis/transcript
        settings: Optional settings override
        
    Returns:
        True if indexed successfully, False otherwise
    """
    settings = settings or get_settings()
    client = get_algolia_client(settings)
    
    if not client:
        logger.debug("Algolia not configured, skipping indexing")
        return False
    
    try:
        # Add user/project IDs to asset data for building searchable content
        enriched_data = {
            **asset_data,
            "userId": user_id,
            "projectId": project_id,
        }
        
        record = build_searchable_content(enriched_data, pipeline_state)
        index_name = _get_index_name(user_id, project_id, settings)
        
        # Run blocking Algolia call in thread pool
        def _save():
            return client.save_object(index_name=index_name, body=record)
        
        await asyncio.to_thread(_save)
        
        logger.info(f"Indexed asset {asset_data.get('id')} to Algolia")
        return True
        
    except Exception as e:
        logger.error(f"Failed to index asset to Algolia: {e}")
        return False


async def update_asset_index(
    user_id: str,
    project_id: str,
    asset_id: str,
    updates: dict[str, Any],
    settings: Settings | None = None,
) -> bool:
    """
    Update an asset in Algolia index.
    
    Args:
        user_id: User ID
        project_id: Project ID  
        asset_id: Asset ID
        updates: Fields to update
        settings: Optional settings override
        
    Returns:
        True if updated successfully, False otherwise
    """
    settings = settings or get_settings()
    client = get_algolia_client(settings)
    
    if not client:
        logger.debug("Algolia not configured, skipping update")
        return False
    
    try:
        index_name = _get_index_name(user_id, project_id, settings)
        
        # Partial update with objectID
        partial_update = {
            "objectID": asset_id,
            **updates,
            "updatedAt": datetime.utcnow().isoformat() + "Z",
        }
        
        def _update():
            return client.partial_update_object(
                index_name=index_name,
                object_id=asset_id,
                attributes_to_update=partial_update,
                create_if_not_exists=False,
            )
        
        await asyncio.to_thread(_update)
        
        logger.info(f"Updated asset {asset_id} in Algolia")
        return True
        
    except Exception as e:
        logger.error(f"Failed to update asset in Algolia: {e}")
        return False


async def delete_asset_index(
    user_id: str,
    project_id: str,
    asset_id: str,
    settings: Settings | None = None,
) -> bool:
    """
    Delete an asset from Algolia index.
    
    Args:
        user_id: User ID
        project_id: Project ID
        asset_id: Asset ID
        settings: Optional settings override
        
    Returns:
        True if deleted successfully, False otherwise
    """
    settings = settings or get_settings()
    client = get_algolia_client(settings)
    
    if not client:
        logger.debug("Algolia not configured, skipping delete")
        return False
    
    try:
        index_name = _get_index_name(user_id, project_id, settings)
        
        def _delete():
            return client.delete_object(index_name=index_name, object_id=asset_id)
        
        await asyncio.to_thread(_delete)
        
        logger.info(f"Deleted asset {asset_id} from Algolia")
        return True
        
    except Exception as e:
        logger.error(f"Failed to delete asset from Algolia: {e}")
        return False


async def search_assets(
    query: str,
    user_id: str | None = None,
    project_id: str | None = None,
    asset_type: str | None = None,
    limit: int = 20,
    offset: int = 0,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """
    Search assets using Algolia.
    
    Args:
        query: Search query string
        user_id: Filter by user ID (required for security)
        project_id: Optional filter by project ID
        asset_type: Optional filter by asset type (video, audio, image, other)
        limit: Max results to return (default 20)
        offset: Pagination offset
        settings: Optional settings override
        
    Returns:
        Dict with hits, total count, and pagination info
    """
    settings = settings or get_settings()
    client = get_algolia_client(settings)
    
    if not client:
        return {
            "hits": [],
            "total": 0,
            "query": query,
            "error": "Search not configured",
        }
    
    try:
        index_name = _get_index_name(user_id or "", project_id or "", settings)
        
        # Build filter string for multi-tenancy security
        filters = []
        if user_id:
            filters.append(f"userId:{user_id}")
        if project_id:
            filters.append(f"projectId:{project_id}")
        if asset_type:
            filters.append(f"type:{asset_type}")
        
        filter_str = " AND ".join(filters) if filters else ""
        
        # Build search params
        search_params = {
            "query": query,
            "hitsPerPage": limit,
            "page": offset // limit if limit > 0 else 0,
            "attributesToRetrieve": [
                "objectID",
                "userId",
                "projectId",
                "name",
                "fileName",
                "type",
                "mimeType",
                "size",
                "width",
                "height",
                "duration",
                "description",
                "labels",
                "uploadedAt",
                "updatedAt",
            ],
            "attributesToHighlight": [
                "name",
                "description",
                "searchableText",
            ],
        }
        
        if filter_str:
            search_params["filters"] = filter_str
        
        # Run search in thread pool - v4 API uses search() with requests array
        def _search():
            return client.search_single_index(
                index_name=index_name,
                search_params=search_params,
            )
        
        results = await asyncio.to_thread(_search)
        
        # Transform hits to consistent format
        hits = []
        result_hits = results.hits if hasattr(results, 'hits') else results.get("hits", [])
        for hit in result_hits:
            # Convert hit to dict if it's an object
            hit_dict = hit.to_dict() if hasattr(hit, 'to_dict') else (hit if isinstance(hit, dict) else {})
            
            # Get highlight snippets
            highlight = hit_dict.get("_highlightResult", {})
            
            hits.append({
                "id": hit_dict.get("objectID"),
                "userId": hit_dict.get("userId"),
                "projectId": hit_dict.get("projectId"),
                "name": hit_dict.get("name"),
                "fileName": hit_dict.get("fileName"),
                "type": hit_dict.get("type"),
                "mimeType": hit_dict.get("mimeType"),
                "size": hit_dict.get("size"),
                "width": hit_dict.get("width"),
                "height": hit_dict.get("height"),
                "duration": hit_dict.get("duration"),
                "description": hit_dict.get("description"),
                "labels": hit_dict.get("labels", []),
                "uploadedAt": hit_dict.get("uploadedAt"),
                "updatedAt": hit_dict.get("updatedAt"),
                # Include highlighted snippets for UI
                "highlights": {
                    "name": highlight.get("name", {}).get("value"),
                    "description": highlight.get("description", {}).get("value"),
                    "searchableText": highlight.get("searchableText", {}).get("value"),
                },
            })
        
        # Handle results as object or dict
        nb_hits = results.nb_hits if hasattr(results, 'nb_hits') else results.get("nbHits", 0)
        page = results.page if hasattr(results, 'page') else results.get("page", 0)
        nb_pages = results.nb_pages if hasattr(results, 'nb_pages') else results.get("nbPages", 0)
        processing_time = results.processing_time_ms if hasattr(results, 'processing_time_ms') else results.get("processingTimeMS", 0)
        
        return {
            "hits": hits,
            "total": nb_hits,
            "query": query,
            "page": page,
            "totalPages": nb_pages,
            "processingTimeMs": processing_time,
        }
        
    except Exception as e:
        logger.error(f"Algolia search failed: {e}")
        return {
            "hits": [],
            "total": 0,
            "query": query,
            "error": str(e),
        }


async def configure_index(settings: Settings | None = None) -> bool:
    """
    Configure Algolia index settings (call once during setup).
    
    Sets up:
    - Searchable attributes
    - Filterable attributes for multi-tenancy
    - Ranking configuration
    
    Returns:
        True if configured successfully
    """
    settings = settings or get_settings()
    client = get_algolia_client(settings)
    
    if not client:
        logger.warning("Algolia not configured")
        return False
    
    try:
        index_name = f"{settings.algolia_index_prefix}_assets"
        
        index_settings = {
            # Searchable attributes in order of importance
            "searchableAttributes": [
                "name",
                "description",
                "notes",
                "labels",
                "transcript",
                "geminiAnalysis",
                "searchableText",
            ],
            # Attributes for filtering (multi-tenancy security)
            "attributesForFaceting": [
                "filterOnly(userId)",
                "filterOnly(projectId)",
                "searchable(type)",
                "searchable(labels)",
            ],
            # Ranking
            "ranking": [
                "typo",
                "geo",
                "words",
                "filters",
                "proximity",
                "attribute",
                "exact",
                "custom",
            ],
            # Custom ranking by recency
            "customRanking": [
                "desc(uploadedAt)",
            ],
            # Highlight settings
            "highlightPreTag": "<mark>",
            "highlightPostTag": "</mark>",
        }
        
        def _set_settings():
            return client.set_settings(index_name=index_name, index_settings=index_settings)
        
        await asyncio.to_thread(_set_settings)
        
        logger.info(f"Configured Algolia index: {index_name}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to configure Algolia index: {e}")
        return False
