"""Algolia search integration for asset discovery."""

from .algolia import (
    get_algolia_client,
    index_asset,
    update_asset_index,
    delete_asset_index,
    search_assets,
    build_searchable_content,
)

__all__ = [
    "get_algolia_client",
    "index_asset",
    "update_asset_index",
    "delete_asset_index",
    "search_assets",
    "build_searchable_content",
]
