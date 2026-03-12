
const { getRoute } = require("../services/routeService");
const { getWeather } = require("../services/weatherService");
const { calculateCarbon } = require("../services/carbonService");

async function handleRouteRequest(req, res) {
  try {
    const { start, end, greenPreference = 0.5 } = req.body;
    // ensure value is between 0 and 1
    const preference = Math.max(0, Math.min(1, Number(greenPreference)));
    if (!start || !end) {
      return res.status(400).json({ error: "Start and end required" });
    }

    const modes = [
      { name: "car", profile: "driving-car" },
      { name: "bike", profile: "cycling-road" },
      { name: "walk", profile: "foot-walking" }
    ];

    //  Check weather once
    let weather = null;

    try {
      weather = await getWeather(start[1], start[0]);
    } catch (err) {
      console.warn("Weather API failed:", err.message);
    }
    let isRaining = false;

    if (weather?.weather?.length) {
      isRaining = weather.weather[0].main
        .toLowerCase()
        .includes("rain");
    }
    /* FrontEnd Send through POST AS JSON
    { "start": [-123.2620, 44.5646], "end": [-122.6765, 45.5231], "greenPreference":1 }
    */
    // Fetch routes in parallel
    const routePromises = modes.map(mode =>
      getRoute(mode.profile, start, end)
    );

    const responses = await Promise.allSettled(routePromises);
    const validResponses = responses
      .map((r, i) => r.status === "fulfilled" ? { data: r.value, mode: modes[i] } : null)
      .filter(Boolean);

    const results = validResponses.map(({ data, mode }) => {

      const feature = data.features[0];
      const summary = feature.properties.summary;
      const segments = feature.properties.segments;

      const distanceKm = summary.distance / 1000;
      const durationMin = summary.duration / 60;

      return {
        mode: mode.name,
        distance_km: Number(distanceKm.toFixed(2)),
        duration_min: Math.round(durationMin),
        carbon_kg: Number(calculateCarbon(mode.name, distanceKm).toFixed(3)),
        coordinates: feature.geometry.coordinates,
        segments,
        tags: []
      };

    });
    // If no results found
    if (results.length === 0) {
      return res.status(502).json({
        error: "No routes available from routing service"
      });
    }
    // Baseline routes

    const carRoute = results.find(r => r.mode === "car");

    const fastestRoute =
      results.reduce((a, b) =>
        a.duration_min < b.duration_min ? a : b
      );

    const fastestTime = fastestRoute.duration_min;

    // ---------------------------------------------------
    // Compute penalties + scores
    // ---------------------------------------------------

    results.forEach(route => {

      // Time penalty vs fastest route
      route.time_penalty =
        fastestTime > 0
          ? (route.duration_min - fastestTime) / fastestTime
          : 0;

      // Carbon ratio vs car baseline
      route.carbon_ratio =
        carRoute && carRoute.carbon_kg > 0
          ? route.carbon_kg / carRoute.carbon_kg
          : 0;

      // Final score
      route.score =
        (preference * route.carbon_ratio) +
        ((1 - preference) * route.time_penalty);

      // Carbon saved
      route.carbon_saved_kg =
        carRoute
          ? Math.max(0, carRoute.carbon_kg - route.carbon_kg)
          : 0;

      // UI Tags
      if (route.mode === fastestRoute.mode) {
        route.tags.push("fastest");
      }

      if (route.carbon_kg === 0) {
        route.tags.push("eco");
      }

      if (route.mode === "bike" && isRaining) {
        route.tags.push("avoid_weather");
      }

    });

    // Sort by score
    results.sort((a, b) => a.score - b.score);

    // Recommended route
    results[0].tags.push("recommended");

    const recommended = results[0].mode;

    // ---------------------------------------------------
    // Response
    // ---------------------------------------------------

    // res.json({
    //   recommended,
    //   routes: results
    // });
    res.json(results);
  } catch (error) {

    console.error(error.response?.data || error.message);

    res.status(500).json({
      error: "Route calculation failed"
    });

  }
}

module.exports = { handleRouteRequest };