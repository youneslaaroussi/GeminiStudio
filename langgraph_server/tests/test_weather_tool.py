"""Tests for the weather tool."""

from __future__ import annotations

import pytest

from langgraph_server.tools.weather_tool import lookup_weather_snapshot


class TestLookupWeatherSnapshot:
    """Tests for lookup_weather_snapshot tool."""

    def test_returns_data_for_valid_city(self):
        """Should return weather data for supported cities."""
        result = lookup_weather_snapshot.invoke({"location": "San Francisco"})
        
        assert "location" in result
        assert "conditions" in result
        assert "temperature_c" in result
        assert "humidity" in result

    def test_case_insensitive_lookup(self):
        """Should handle case-insensitive city names."""
        result1 = lookup_weather_snapshot.invoke({"location": "san francisco"})
        result2 = lookup_weather_snapshot.invoke({"location": "SAN FRANCISCO"})
        result3 = lookup_weather_snapshot.invoke({"location": "San Francisco"})
        
        assert result1["temperature_c"] == result2["temperature_c"] == result3["temperature_c"]

    def test_strips_whitespace(self):
        """Should strip whitespace from location."""
        result = lookup_weather_snapshot.invoke({"location": "  Tokyo  "})
        
        assert result["location"] == "Tokyo"

    def test_raises_for_unknown_city(self):
        """Should raise ValueError for unsupported cities."""
        with pytest.raises(ValueError) as exc_info:
            lookup_weather_snapshot.invoke({"location": "Unknown City"})
        
        assert "unavailable" in str(exc_info.value).lower()
        assert "Supported locations" in str(exc_info.value)

    def test_supported_cities(self):
        """Should support the documented cities."""
        supported = ["San Francisco", "New York", "London", "Tokyo"]
        
        for city in supported:
            result = lookup_weather_snapshot.invoke({"location": city})
            assert result["location"] == city

    def test_temperature_is_number(self):
        """Temperature should be a numeric value."""
        result = lookup_weather_snapshot.invoke({"location": "Tokyo"})
        
        assert isinstance(result["temperature_c"], (int, float))

    def test_humidity_is_fraction(self):
        """Humidity should be a fraction between 0 and 1."""
        result = lookup_weather_snapshot.invoke({"location": "London"})
        
        assert 0 <= result["humidity"] <= 1
