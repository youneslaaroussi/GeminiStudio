from __future__ import annotations

from langchain_core.tools import tool

_WEATHER_DATA = {
    "san francisco": {"conditions": "Foggy", "temperature_c": 14, "humidity": 0.82},
    "new york": {"conditions": "Partly cloudy", "temperature_c": 21, "humidity": 0.68},
    "london": {"conditions": "Rain showers", "temperature_c": 17, "humidity": 0.75},
    "tokyo": {"conditions": "Sunny", "temperature_c": 27, "humidity": 0.58},
}


@tool
def lookup_weather_snapshot(location: str) -> dict:
    """Return a cached weather snapshot for supported cities.

    Args:
        location: City name to look up.

    Raises:
        ValueError: If the location is not in the cached dataset.
    """

    key = location.strip().lower()
    if key not in _WEATHER_DATA:
        supported = ", ".join(sorted(city.title() for city in _WEATHER_DATA))
        raise ValueError(
            f"Weather data for '{location}' is unavailable. Supported locations: {supported}"
        )
    return {"location": key.title(), **_WEATHER_DATA[key]}
