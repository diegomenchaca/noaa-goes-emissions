/* ── Constants ─────────────────────────────────────────────── */
const YEARS      = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
const FRP_MIN    = 5;       // MW — cells below this are transparent
const FRP_MAX    = 90000;   // MW — color scale ceiling
const PLAY_SPEED = 1000;     // ms per year step
const TOPO_URL   = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const PAD        = 28;      // px padding around projected extent
const CELL_INSET = 0.06;    // ° inset on each edge → cells render at 88% size

// 11 Mountain + Pacific states — used to fit the initial western-US view
// (all FIPS within the data grid -125→-100°W, 32→49°N)
const WEST_FIPS = new Set([4, 6, 8, 16, 30, 32, 35, 41, 49, 53, 56]);
// AZ  CA  CO  ID  MT  NV  NM  OR  UT  WA  WY

/* ── State ─────────────────────────────────────────────────── */
let currentYear   = 2018;
let showFire      = true;
let showLST       = true;
let lstOpacity    = 0.20;
let isPlaying     = false;
let playTimer     = null;
let pinnedCell      = null;
let pinnedCellState = null;
let frpOpacity      = 1.00;
let opacityLinked   = true;
let tourStep        = null;   // null | 'year' | 'frp' | 'lst' | 'mini-frp' | 'mini-lst'
let dataStates      = null;   // populated in main()
let zoomTransform = d3.zoomIdentity;
let mouseDownXY   = null;
let statesFeature = null;
let stateCellsMap = new Map();
let zoomedState           = null;
let _sidebarTransitioning = false;
let _clearPinTimer        = null;

/* ── Color scales ───────────────────────────────────────────── */
const frpColor = d3.scaleSequentialLog()
  .domain([FRP_MIN, FRP_MAX])
  .interpolator(d3.interpolateYlOrRd)
  .clamp(true);

// Diverging: blue (cool anomaly) → white (0) → red (warm anomaly)
const lstColor = d3.scaleDiverging()
  .domain([-3, 0, 3])
  .interpolator(t => d3.interpolateRdBu(1 - t))
  .clamp(true);

/* ── Tour content ───────────────────────────────────────────── */
const TOUR_YEAR_DESCS = {
  2018: "2018 was one of California's most destructive wildfire years to that point. The Camp Fire (November) destroyed the town of Paradise in Butte County — the deadliest U.S. wildfire in a century — while the Mendocino Complex (July–September) became the then-largest fire in California history at ~459,000 acres. Fire activity concentrated heavily along the northern Sierra Nevada and Coast Ranges. Land surface temperatures ran 1–2 °C above the 7-year mean across the Central Valley and Great Basin, reflecting the hot, dry summer that primed fuel conditions before the catastrophic fall fire weather.",
  2019: "2019 offered a relative reprieve for California, aided by a wetter-than-average winter that kept fuel moisture elevated through midsummer — statewide acres burned were roughly 250,000, well below the decade average. The Kincade Fire (Sonoma County, October) and Walker Fire (Plumas County) were the most notable California events. The Pacific Northwest and Northern Rockies were comparatively more active. LST anomalies were mixed: the desert Southwest ran noticeably warm, while parts of the Pacific Coast and Great Basin stayed near or below their 7-year average, illustrating how year-to-year moisture variability shapes the spatial footprint of fire risk.",
  2020: "2020 was a historic and unprecedented year for western wildfire. California burned over 4.2 million acres — more than double any prior year in state history. The August Complex became the first California 'gigafire' (>1 million acres), joined by the SCU, LNU, and North complexes. Simultaneously, Colorado endured its two largest fires on record: the Cameron Peak (~208,000 acres) and East Troublesome (~193,000 acres). A powerful heat dome in mid-August drove Death Valley to 130 °F and generated broad, extreme LST anomalies — the dataset's most intense — across virtually the entire western U.S. Fire and heat reinforced each other: warm, dry surfaces lowered fuel moisture, and the fires themselves released additional heat into an already stressed atmosphere.",
  2021: "2021 is defined by two overlapping extremes. In late June, a once-in-a-millennium heat dome drove Portland, OR to 116 °F and Seattle, WA to 108 °F — 20–30 °F above normal — causing over 1,000 heat-related deaths across the Pacific Northwest and producing the dataset's most spatially concentrated LST anomalies. That same summer, California's Dixie Fire grew to ~963,000 acres, the largest single-origin fire in state history, while Oregon's Bootleg Fire (~400,000 acres) generated its own pyrocumulonimbus weather. The Caldor Fire threatened South Lake Tahoe in August. Together, these events illustrate how an extreme heat event in one season can directly precondition landscape-scale wildfire for months afterward.",
  2022: "2022 brought a partial reprieve from the most extreme fire years, though conditions remained significantly above pre-2018 baselines. California burned roughly 362,000 acres — the Mosquito Fire (Placer/El Dorado counties, ~76,000 acres) was the largest. Montana and Idaho showed above-average FRP despite lower totals elsewhere, with persistent mid-level fire signals across multiple cells suggesting widespread, distributed burning. LST anomalies were spatially heterogeneous: the Great Basin and desert Southwest remained warm (consistent with ongoing multi-year drought), while parts of the Pacific Coast trended closer to average — a La Niña signal that would intensify dramatically the following winter.",
  2023: "2023 was shaped as much by smoke as by fire within the data domain. Catastrophic wildfires across British Columbia and Alberta — the worst Canadian fire season on record — blanketed the northern and central U.S. in smoke for weeks, attenuating some satellite FRP retrievals. Within the western U.S., fire activity was moderate: the Smith River Complex (Del Norte County, CA, ~100,000 acres) and scattered Oregon and Washington events were the most prominent. California's fire season was suppressed by a record-wet winter driven by an emerging El Niño. LST anomalies reflected this moisture: some northern areas showed near-average or below-average surface temperatures, while the southern desert Southwest maintained its persistent warm signal.",
  2024: "2024 reasserted California as the dominant fire region. The Park Fire (Butte/Tehama counties, late July) grew to ~429,000 acres — the second-largest fire in California history — producing intense FRP signals across the northern Sierra Nevada. Southern California's Line Fire and Airport Fire added to the year's totals. New Mexico and Colorado saw above-average fire activity as well. LST anomalies continued the multi-year warming trend: much of the Great Basin, southern California, and desert Southwest ran 1–2 °C above the 7-year mean, which itself reflects a decade of warming — meaning the apparent anomalies in 2024 understate the absolute departure from longer historical baselines.",
};

const TOUR_FRP_CONTEXT = {
  2018: "FRP is a direct satellite measure of the heat released by active burning — higher values indicate more intense combustion, not necessarily larger area. The Camp Fire's extreme FRP in November reflects critically low fuel moisture after a dry summer, while the Mendocino Complex produced sustained high values over a longer burn window earlier in the season.",
  2019: "Despite the lower statewide totals, this region showed FRP signals elevated relative to its own multi-year baseline, reflecting the sensitivity of these ecosystems to late-summer drought even in relatively 'moderate' fire years — a reminder that the western baseline for fire activity has shifted upward.",
  2020: "This region produced some of the highest FRP values in the entire 2018–2024 dataset. The convergence of record heat, multi-year drought, and decades of accumulated fuel loads created conditions where fires burned simultaneously at extraordinary intensity across a massive geographic extent — a pattern without modern precedent.",
  2021: "The Dixie Fire's FRP signature was notable for its duration: sustained high-intensity burning over weeks, not days. The Bootleg Fire in Oregon was so energetic it generated pyrocumulonimbus clouds — a sign of near-explosive combustion that produces extreme FRP outliers and creates fire-driven weather that actively resists suppression.",
  2022: "The elevated FRP in the Northern Rockies this year reflected widespread, distributed burning — many cells showing moderate but persistent fire signals rather than a single catastrophic event. This pattern is characteristic of drought-driven range fires and is often associated with grass and shrub fuels that recover quickly but also ignite readily.",
  2023: "Canadian wildfire smoke may have slightly attenuated GOES FRP retrievals during peak smoke events, particularly in northern cells. The values here represent active burning within the CONUS data domain — entirely separate from the far-larger Canadian fire events occurring just north of the 49°N data boundary.",
  2024: "The Park Fire's FRP signature was spatially concentrated in the northern Sierra Nevada but reached extreme intensity during its rapid growth phase in late July. The desert Southwest also contributed notable FRP readings, with several Arizona and New Mexico cells surpassing the high-intensity threshold as drought conditions persisted through the summer.",
};

const TOUR_LST_CONTEXT = {
  2018: "LST anomaly measures deviation from each cell's own 2018–2024 summer mean — a positive value means this location was warmer than its own multi-year average. The strongest anomalies in 2018 appeared in the Central Valley and Mojave Desert, where already-extreme summer temperatures ran even hotter, directly amplifying fire weather risk through the September–November window.",
  2019: "The desert Southwest's warm LST anomalies in 2019 stand out against an otherwise mixed national pattern. Persistent above-average surface heat in Arizona and New Mexico — even in a lower fire year — underscores that LST warming is not simply a byproduct of fire; it is also a precondition that increases ignition risk and accelerates fuel drying independently of precipitation.",
  2020: "The 2020 LST pattern is dominated by the August heat dome, which produced the most spatially coherent and intense positive anomalies in the dataset. The warm anomaly here is not just large — it is also historically unusual in its geographic extent: virtually the entire western U.S. simultaneously exceeded its own already-elevated 7-year average, a signature of a synoptic-scale atmospheric forcing event rather than local land-surface feedback.",
  2021: "The June 2021 Pacific Northwest heat dome produced the dataset's most extreme, spatially focused LST anomalies — concentrated in Washington, Oregon, and Idaho, where surface temperatures were 2–3 °C above a mean that already reflects a decade of warming. The event was attributed to anthropogenic climate change; statistical analyses suggest it would have been virtually impossible without it. The anomalies here directly preceded and intensified the fire season that followed.",
  2022: "The 2022 LST pattern reveals the persistence of the multi-year drought signal in the Great Basin and desert Southwest. Even without a major heat dome, Nevada, Utah, and Arizona continued running above their own 7-year averages — a consequence of depleted soil moisture and reduced evaporative cooling that keeps surface temperatures elevated across seasons, maintaining chronic fire-weather conditions.",
  2023: "The contrast between cooling in the northern Pacific states and persistent warmth in the southern desert Southwest in 2023 is one of the most instructive spatial patterns in the dataset. It shows how a single-year atmospheric forcing (a wet El Niño winter) can temporarily suppress LST anomalies in some regions while the longer-term drought and warming signal persists in others.",
  2024: "The 2024 LST anomalies, though moderate by 2020–2021 standards, are particularly significant in context: they represent above-average temperatures relative to a 7-year mean that already embeds the extreme warmth of 2020 and 2021. The persistent positive signal across the Great Basin and desert Southwest reflects a self-reinforcing feedback — dry soils reduce evaporative cooling, which elevates LST, which further dries soils — that is becoming the new baseline condition across these landscapes.",
};

/* ── DOM refs ──────────────────────────────────────────────── */
const mapArea    = document.getElementById("map-area");
const svgEl      = document.getElementById("map-svg");
const sidebar    = document.getElementById("sidebar");
const tooltip    = d3.select("#tooltip");
const yearLabel  = document.getElementById("year-label");
const yearStamp  = document.getElementById("year-stamp");
const yearSlider = document.getElementById("year-slider");
const playBtn    = document.getElementById("play-btn");

/* ── SVG scaffold ──────────────────────────────────────────── */
const svg      = d3.select(svgEl);
const defs     = svg.append("defs");
const mapGroup = svg.append("g").attr("id", "map-group");

/* ── Projection / path (built after data loads) ─────────────── */
let projection, pathGen;

/* ── Layer selections ───────────────────────────────────────── */
let lstPaths, firePaths, statePaths;

/* ── State hover ─────────────────────────────────────────────── */
let hoveredStateFeature = null;

/* ── Cell lookup: "swLat,swLon" → cell object ──────────────── */
const cellMap = {};

/* ── Zoom ───────────────────────────────────────────────────── */
const zoom = d3.zoom()
  .scaleExtent([1, 12])
  .on("zoom", ({ transform }) => {
    zoomTransform = transform;
    mapGroup.attr("transform", transform);
  });

/* ── Cell description helpers ───────────────────────────────── */
function describeFRP(frp) {
  if (frp < FRP_MIN) return "No significant fire detected in this cell for the selected year.";
  const formatted = frp >= 1000 ? `${(frp / 1000).toFixed(1)}k` : Math.round(frp);
  if (frp < 200)   return `An FRP of ${formatted} MW indicates low-intensity fire activity — likely small or smoldering burns.`;
  if (frp < 2000)  return `An FRP of ${formatted} MW reflects moderate wildfire activity — a notable burn event in the area.`;
  if (frp < 15000) return `An FRP of ${formatted} MW signals high-intensity wildfire — significant acreage likely burned.`;
  return `An FRP of ${formatted} MW represents an extreme fire event — among the most intense wildfire conditions in the dataset.`;
}

function describeLST(anom) {
  if (anom == null) return "No land surface temperature data is available for this cell and year.";
  const sign = anom > 0 ? "+" : "";
  const val  = `${sign}${anom.toFixed(1)}°C`;
  if (anom < -2)   return `A ${val} anomaly means surface temperatures were significantly below the 2018–2024 average — unusually cool conditions.`;
  if (anom < -0.5) return `A ${val} anomaly indicates slightly below-average surface temperatures for this location.`;
  if (anom <  0.5) return `A ${val} anomaly is near-average — surface temperatures were typical for this cell during the selected year.`;
  if (anom <  2)   return `A ${val} anomaly means the land surface ran warmer than average — elevated heat stress conditions.`;
  return `A ${val} anomaly signals significantly above-average surface temperatures — a strong heat anomaly that may increase fire risk.`;
}

/* ── State description ──────────────────────────────────────── */
const STATE_AVG_DESCS = {
  "Arizona":        "Arizona's fire season typically peaks in May–June before the summer monsoon arrives, with the central highlands, Mogollon Rim, and sky island ranges generating the most consistent activity. Desert lowland surfaces routinely run above the regional mean, making LST anomalies here among the most persistent in the dataset.",
  "California":     "California's wildfire season historically spans June through November, concentrated in the Sierra Nevada foothills, Coast Ranges, and Southern California chaparral, with dry offshore Diablo and Santa Ana winds driving the most destructive events. Interior valleys and the Central Valley floor consistently record the state's warmest LST anomalies during late summer.",
  "Colorado":       "Colorado's fire season centers on the Front Range foothills, western slope canyons, and San Juan Mountains, peaking from May through July before monsoon moisture arrives from the south. Drought years see fire extend into fall, while the strongest LST anomalies typically appear in the lower-elevation shrublands and eastern plains.",
  "Idaho":          "Idaho experiences persistent fire activity in the central mountains and Snake River Plain, where fuel suppression over decades has accumulated heavy loads in sagebrush and mixed-conifer forests. LST anomalies are strongly tied to late-spring snowpack — low-snowpack years produce warmer, drier summers with substantially elevated fire risk.",
  "Montana":        "Montana's fire activity concentrates in the Rocky Mountain Front, the Bitterroot Valley, and forested drainages along the Continental Divide, with peak season running July through September. Above-average LST anomalies in the northern plains and eastern foothills tend to coincide with summers of reduced precipitation and early snowmelt.",
  "Nevada":         "Nevada is predominantly Great Basin desert shrubland, where invasive cheatgrass has fundamentally changed the fire regime by creating continuous fuel beds across landscapes that historically burned infrequently. LST anomalies are among the most persistent in the dataset, as scarce soil moisture allows surface temperatures to track air temperatures closely with minimal evaporative cooling.",
  "New Mexico":     "New Mexico's fire season peaks in May–June before the North American Monsoon arrives in July and dramatically reduces ignition risk for the remainder of summer. The highest fire radiative power values typically come from the Jemez Mountains, Mogollon Rim, and Sacramento Mountains, where dense ponderosa pine forests interact with drought-driven fuel drying.",
  "Oregon":         "Oregon's fire regime divides sharply between the wet west slope of the Cascades and the dry high-desert east, with large fire years driven by late-season heat and wind events that push fire across the Cascades into fuels not adapted to frequent burning. LST anomalies in the eastern high desert are shaped by atmospheric blocking patterns that suppress the onshore marine airflow that normally moderates summer temperatures.",
  "Utah":           "Utah's fire activity is broadly distributed across the Colorado Plateau, Wasatch Front foothills, and Great Basin shrublands, with peak season running June through September. Cheatgrass invasion is steadily transforming the fire regime of the state's lowland basin regions, while higher-elevation forests remain sensitive to multi-year drought cycles.",
  "Washington":     "Washington's fire activity concentrates in the Okanogan Highlands and the rain-shadow ponderosa pine and sagebrush landscape east of the Cascades, where dry summers increasingly override the cool maritime influence. Extreme fire years are tightly coupled to Pacific blocking events that suppress onshore cooling and can push LST anomalies sharply above average for extended periods.",
  "Wyoming":        "Wyoming's fires occur primarily in the Greater Yellowstone Ecosystem, the Wind River Range, and the sagebrush steppe of the Big Horn Basin, with fire activity generally lower in absolute terms than Pacific states. Multi-year drought cycles can dramatically amplify risk, particularly in the state's high-elevation lodgepole pine forests where stand-replacing fires have long been part of the natural regime.",
  "North Dakota":   "The western North Dakota badlands included in this dataset see limited fire activity, primarily in the dry shortgrass and sagebrush terrain of the Little Missouri Badlands during drought years.",
  "South Dakota":   "The western South Dakota portion of this dataset spans the Black Hills ponderosa pine forest and surrounding badlands, where fire activity increases markedly during dry spring and early summer conditions.",
  "Nebraska":       "The western Nebraska Panhandle included here is semi-arid sandhill and mixed-grass rangeland where wildfire is episodic, driven largely by winter-spring precipitation that sets fuel loads for the following fire season.",
  "Kansas":         "The western Kansas High Plains included in this dataset are predominantly shortgrass prairie and cropland, with limited but periodic fire activity that intensifies during drought-driven years of above-average fine fuel accumulation.",
  "Oklahoma":       "The western Oklahoma Panhandle included here is open shortgrass and mixed-grass prairie where fire historically spread rapidly under southerly winds; wildfire risk tracks winter-spring precipitation closely.",
  "Texas":          "The Trans-Pecos rangeland and Chihuahuan Desert of far west Texas included in this dataset experience episodic fire driven by above-average winter rains that produce grass fuel loads, followed by spring drought and persistent wind.",
};

const PARTIAL_100W = new Set([
  "North Dakota", "South Dakota", "Nebraska", "Kansas", "Oklahoma", "Texas"
]);
const PARTIAL_32N = new Set(["Arizona", "New Mexico", "Texas"]);

function describeState(stateFeature, year, withContext = false) {
  if (!stateFeature) return "";
  const name       = stateFeature.properties.name;
  const sc         = stateCellsMap.get(stateFeature) ?? [];
  const fireCells  = sc.filter(c => (c.fire[year]?.frp ?? 0) >= FRP_MIN);
  const totalFRP   = d3.sum(fireCells, c => c.fire[year]?.frp ?? 0);
  const lstVals    = sc.map(c => c.lst[year]?.anomaly).filter(v => v != null);
  const avgLST     = lstVals.length ? d3.mean(lstVals) : null;

  let text = `In ${year}, ${name}`;
  if (fireCells.length === 0) {
    text += " had no significant fire detections";
  } else {
    const frpStr = totalFRP >= 1000
      ? `${(totalFRP / 1000).toFixed(0)}k MW`
      : `${Math.round(totalFRP)} MW`;
    text += ` had ${fireCells.length} active fire cell${fireCells.length > 1 ? "s" : ""} with ${frpStr} total intensity`;
  }

  if (avgLST != null) {
    const sign   = avgLST > 0 ? "+" : "";
    const lstStr = `${sign}${avgLST.toFixed(1)}°C`;
    if (Math.abs(avgLST) < 0.3) {
      text += ` and near-average surface temperatures (${lstStr}).`;
    } else if (avgLST > 0) {
      text += ` and surface temperatures ${lstStr} above the 7-year average.`;
    } else {
      text += ` and surface temperatures ${lstStr} below the 7-year average.`;
    }
  } else {
    text += ".";
  }
  const bounds = [];
  if (PARTIAL_100W.has(name)) bounds.push("west of the 100°W meridian");
  if (PARTIAL_32N.has(name))  bounds.push("north of 32°N");
  if (bounds.length) {
    text += ` (Data covers only the portion of this state ${bounds.join(" and ")}.)`;
  }
  if (withContext && STATE_AVG_DESCS[name]) {
    text = STATE_AVG_DESCS[name] + "\n\n" + text;
  }
  return text;
}

function updateStateDesc(stateFeature) {
  const el = document.getElementById("state-desc");
  if (!el) return;
  const effective   = zoomedState ?? pinnedCellState ?? stateFeature;
  const withContext = effective != null && effective === zoomedState;
  if (!effective) { el.textContent = ""; return; }
  const desc = describeState(effective, currentYear, withContext);
  if (withContext && STATE_AVG_DESCS[effective.properties?.name]) {
    const [avg, yearly] = desc.split("\n\n");
    el.innerHTML = "";
    const p1 = document.createElement("p");
    p1.style.marginBottom = "0.6em";
    p1.textContent = avg;
    const p2 = document.createElement("p");
    p2.textContent = yearly;
    el.append(p1, p2);
  } else {
    el.textContent = desc;
  }
}

/* ── Tour helpers ───────────────────────────────────────────── */
function findBestFRPTarget(year) {
  let bestState = null, bestTotal = 0;
  statesFeature.features.forEach(f => {
    const cells = stateCellsMap.get(f) ?? [];
    const total = d3.sum(cells, c => c.fire[year]?.frp ?? 0);
    if (total > bestTotal) { bestTotal = total; bestState = f; }
  });
  const sc = stateCellsMap.get(bestState) ?? [];
  const bestCell = sc.reduce((a, c) =>
    (c.fire[year]?.frp ?? 0) > (a?.fire[year]?.frp ?? 0) ? c : a, null);
  return { state: bestState, cell: bestCell };
}

function findBestLSTTarget(year) {
  let bestState = null, bestAvg = -Infinity;
  statesFeature.features.forEach(f => {
    const cells = stateCellsMap.get(f) ?? [];
    const vals  = cells.map(c => c.lst[year]?.anomaly).filter(v => v != null);
    if (!vals.length) return;
    const avg = d3.mean(vals);
    if (avg > bestAvg) { bestAvg = avg; bestState = f; }
  });
  const sc = stateCellsMap.get(bestState) ?? [];
  const bestCell = sc.reduce((a, c) => {
    const va = Math.abs(c.lst[year]?.anomaly ?? 0);
    const vb = Math.abs(a?.lst[year]?.anomaly ?? 0);
    return va > vb ? c : a;
  }, null);
  return { state: bestState, cell: bestCell };
}

function generateFRPDesc(year, state, cell) {
  const name  = state?.properties?.name ?? "the region";
  const cells = stateCellsMap.get(state) ?? [];
  const fired = cells.filter(c => (c.fire[year]?.frp ?? 0) >= FRP_MIN);
  const total = d3.sum(fired, c => c.fire[year].frp);
  const fmt   = v => v >= 1000 ? `${(v / 1000).toFixed(0)}k MW` : `${Math.round(v)} MW`;
  const peak  = cell?.fire[year]?.frp ?? 0;
  return `${name} recorded the most intense fire activity in the western U.S. in ${year} — `
    + `${fired.length} active fire cell${fired.length !== 1 ? "s" : ""} totaling ${fmt(total)}, `
    + `with a peak cell reaching ${fmt(peak)}. `
    + (TOUR_FRP_CONTEXT[year] ?? "");
}

function generateLSTDesc(year, state, cell) {
  const name  = state?.properties?.name ?? "the region";
  const cells = stateCellsMap.get(state) ?? [];
  const vals  = cells.map(c => c.lst[year]?.anomaly).filter(v => v != null);
  const avg   = vals.length ? d3.mean(vals) : null;
  const max   = vals.length ? d3.max(vals)  : null;
  const fmt   = v => `${v > 0 ? "+" : ""}${v.toFixed(1)} °C`;
  return `${name} showed the most extreme land surface temperature anomaly in ${year} — `
    + (avg != null ? `averaging ${fmt(avg)} above the 7-year mean` : "no LST data available")
    + (max != null ? `, peaking at ${fmt(max)} in individual cells. ` : ". ")
    + (TOUR_LST_CONTEXT[year] ?? "");
}

/* ── Mini-tour helpers (state-scoped) ───────────────────────── */
function stateHasFire(state, year) {
  const sc = stateCellsMap.get(state) ?? [];
  return sc.some(c => (c.fire[year]?.frp ?? 0) >= FRP_MIN);
}

// Returns the next year >= fromYear (inclusive) where state has fire, or null if none.
function nextFireYear(state, fromYear) {
  return YEARS.find(yr => yr >= fromYear && stateHasFire(state, yr)) ?? null;
}

function findBestFRPCellInState(state, year) {
  const sc = stateCellsMap.get(state) ?? [];
  return sc.reduce((a, c) =>
    (c.fire[year]?.frp ?? 0) > (a?.fire[year]?.frp ?? 0) ? c : a, null);
}

function findBestLSTCellInState(state, year) {
  const sc = stateCellsMap.get(state) ?? [];
  return sc.reduce((a, c) => {
    const va = Math.abs(c.lst[year]?.anomaly ?? 0);
    const vb = Math.abs(a?.lst[year]?.anomaly ?? 0);
    return va > vb ? c : a;
  }, null);
}

function generateMiniFRPDesc(state, cell, year) {
  if (!cell || (cell.fire[year]?.frp ?? 0) < FRP_MIN) {
    return `No significant fire activity was detected in ${state?.properties?.name ?? "this state"} during ${year}.`;
  }
  const frp  = cell.fire[year].frp;
  const lat  = (cell.lat + 0.5).toFixed(0);
  const lon  = Math.abs(cell.lon + 0.5).toFixed(0);
  const name = state?.properties?.name ?? "this state";
  const fmt  = v => v >= 1000 ? `${(v / 1000).toFixed(1)}k MW` : `${Math.round(v)} MW`;
  return `The most intense fire cell in ${name} in ${year} was near ${lat}°N, ${lon}°W — ${fmt(frp)} FRP. ${describeFRP(frp)}`;
}

function generateMiniLSTDesc(state, cell, year) {
  const name = state?.properties?.name ?? "this state";
  if (!cell) return `No land surface temperature data is available for ${name} in ${year}.`;
  const anom = cell.lst[year]?.anomaly;
  if (anom == null) return `No land surface temperature data is available for ${name} in ${year}.`;
  const lat  = (cell.lat + 0.5).toFixed(0);
  const lon  = Math.abs(cell.lon + 0.5).toFixed(0);
  const sign = anom > 0 ? "+" : "";
  return `The strongest surface temperature anomaly in ${name} in ${year} was near ${lat}°N, ${lon}°W — ${sign}${anom.toFixed(1)}°C vs. the 7-year mean. ${describeLST(anom)}`;
}

function showTourDesc(text) {
  const el = document.getElementById("tour-desc");
  if (!el) return;
  el.textContent = text;
  el.style.display = "block";
}

function hideTourDesc() {
  const el = document.getElementById("tour-desc");
  if (el) el.style.display = "none";
}

function updateOpacitySliders() {
  const frpEl = document.getElementById("frp-opacity");
  const lstEl = document.getElementById("lst-opacity");
  if (frpEl) frpEl.value = Math.round(frpOpacity * 100);
  if (lstEl) lstEl.value = Math.round(lstOpacity * 100);
}

function tourAdvance() {
  if (tourStep === null) {
    // Always start from 2018 regardless of current year
    clearPin();
    frpOpacity = 1.00; lstOpacity = 0.20;
    updateOpacitySliders();
    setYear(2018, false);

    if (zoomedState) {
      // ── Mini tour: state already zoomed ──────────────────────
      const firstYear = nextFireYear(zoomedState, 2018);
      if (!firstYear) {
        // State has no fire in any year — nothing to tour
        hideTourDesc();
        playBtn.textContent = "▶ Start Tour"; playBtn.classList.remove("tour-end");
        return;
      }
      setYear(firstYear, false);
      tourStep = 'mini-frp';
      frpOpacity = 1.00; lstOpacity = 0.20;
      updateOpacitySliders();
      const frpCell = findBestFRPCellInState(zoomedState, firstYear);
      if (frpCell) pinCell(frpCell);
      showTourDesc(generateMiniFRPDesc(zoomedState, frpCell, firstYear));
      playBtn.textContent = "Next ▶"; playBtn.classList.remove("tour-end");
      return;
    }
    // ── Global tour: expand sidebar, show year description ────
    tourStep = 'year';
    showTourDesc(TOUR_YEAR_DESCS[2018] ?? "");
    playBtn.textContent = "Next ▶"; playBtn.classList.remove("tour-end");
    if (!sidebar.classList.contains("zoomed")) {
      _sidebarTransitioning = true;
      sidebar.classList.add("zoomed");
      sidebar.addEventListener("transitionend", () => {
        _sidebarTransitioning = false;
      }, { once: true });
    }
    return;
  }

  // ── Mini tour steps ───────────────────────────────────────────
  if (tourStep === 'mini-frp') {
    tourStep = 'mini-lst';
    frpOpacity = 0.20; lstOpacity = 1.00;
    updateOpacitySliders();
    const cell = findBestLSTCellInState(zoomedState, currentYear);
    if (cell) pinCell(cell);
    setYear(currentYear, false);
    showTourDesc(generateMiniLSTDesc(zoomedState, cell, currentYear));
    if (!nextFireYear(zoomedState, currentYear + 1)) playBtn.textContent = "End"; playBtn.classList.add("tour-end");
    return;
  }

  if (tourStep === 'mini-lst') {
    clearPin();
    frpOpacity = 1.00; lstOpacity = 0.20;
    updateOpacitySliders();
    const nextYear = nextFireYear(zoomedState, currentYear + 1);
    if (!nextYear) {
      // No more years with fire — end mini tour, stay zoomed
      tourStep = null;
      hideTourDesc();
      setYear(currentYear, false);
      playBtn.textContent = "▶ Start Tour"; playBtn.classList.remove("tour-end");
    } else {
      setYear(nextYear, true);
      tourStep = 'mini-frp';
      frpOpacity = 1.00; lstOpacity = 0.20;
      updateOpacitySliders();
      const cell = findBestFRPCellInState(zoomedState, nextYear);
      if (cell) pinCell(cell);
      showTourDesc(generateMiniFRPDesc(zoomedState, cell, nextYear));
      playBtn.textContent = "Next ▶"; playBtn.classList.remove("tour-end");
    }
    return;
  }

  if (tourStep === 'year') {
    // Zoom to FRP hotspot — sidebar already expanded, smooth zoom
    tourStep = 'frp';
    const { state, cell } = findBestFRPTarget(currentYear);
    if (state) zoomToFeature(state);
    if (cell)  pinCell(cell);
    showTourDesc(generateFRPDesc(currentYear, state, cell));
    return;
  }

  if (tourStep === 'frp') {
    // Zoom to LST hotspot — sidebar already expanded, smooth zoom
    tourStep = 'lst';
    const { state, cell } = findBestLSTTarget(currentYear);
    if (state) zoomToFeature(state);
    if (cell)  pinCell(cell);
    frpOpacity = 0.20;
    lstOpacity = 1.00;
    setYear(currentYear, false);
    updateOpacitySliders();
    showTourDesc(generateLSTDesc(currentYear, state, cell));
    // Last year — signal that next click ends the tour
    if (YEARS.indexOf(currentYear) === YEARS.length - 1) {
      playBtn.textContent = "End"; playBtn.classList.add("tour-end");
    }
    return;
  }

  if (tourStep === 'lst') {
    // Smooth zoom out; defer year change until zoom completes
    clearPin();
    zoomedState = null;
    statePaths.classed("state-dim",    false);
    statePaths.classed("state-zoomed", false);
    updateStateDesc(null);
    svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity);

    frpOpacity = 1.00;
    lstOpacity = 0.20;
    updateOpacitySliders();

    playBtn.disabled = true;
    const idx = YEARS.indexOf(currentYear);
    setTimeout(() => {
      playBtn.disabled = false;
      if (idx < YEARS.length - 1) {
        setYear(YEARS[idx + 1], true);
        tourStep = 'year';
        showTourDesc(TOUR_YEAR_DESCS[YEARS[idx + 1]] ?? "");
        playBtn.textContent = "Next ▶"; playBtn.classList.remove("tour-end");
      } else {
        // Last year — end tour, collapse sidebar, return to idle
        tourStep = null;
        hideTourDesc();
        frpOpacity = 1.00;
        lstOpacity = 0.20;
        setYear(currentYear, false);
        updateOpacitySliders();
        playBtn.textContent = "▶ Start Tour"; playBtn.classList.remove("tour-end");
        _sidebarTransitioning = true;
        sidebar.classList.remove("zoomed");
        sidebar.addEventListener("transitionend", () => {
          _sidebarTransitioning = false;
        }, { once: true });
      }
    }, 650);
  }
}

/* ── Year update ────────────────────────────────────────────── */
function setYear(yr, animate = true) {
  currentYear = yr;
  yearLabel.textContent = yr;
  yearStamp.textContent = yr;
  yearSlider.value = yr;

  const dur = animate ? 600 : 0;
  const t   = d3.transition().duration(dur).ease(d3.easeQuadInOut);

  firePaths.transition(t)
    .attr("fill", d => {
      if (!showFire) return "none";
      const frp = d.properties.fire[yr]?.frp ?? 0;
      return frp >= FRP_MIN ? frpColor(frp) : "none";
    })
    .attr("fill-opacity", d => {
      if (!showFire) return 0;
      const frp = d.properties.fire[yr]?.frp ?? 0;
      return frp >= FRP_MIN ? frpOpacity : 0;
    });

  lstPaths.transition(t)
    .attr("fill", d => {
      const anom = d.properties.lst[yr]?.anomaly;
      return anom != null ? lstColor(anom) : "none";
    })
    .attr("fill-opacity", d => {
      if (!showLST) return 0;
      const anom = d.properties.lst[yr]?.anomaly;
      return anom != null ? lstOpacity : 0;
    });

  if (pinnedCell) renderSparkline(pinnedCell, yr);
  updateStateDesc(hoveredStateFeature);
}

/* ── Play / pause ──────────────────────────────────────────── */
function startPlay() {
  isPlaying = true;
  playBtn.textContent = "⏸ Pause";
  playBtn.classList.add("playing");
  function step() {
    const idx  = YEARS.indexOf(currentYear);
    const next = (idx + 1) % YEARS.length;
    setYear(YEARS[next]);
    if (next === YEARS.length - 1) {
      playTimer = setTimeout(stopPlay, PLAY_SPEED);
    } else {
      playTimer = setTimeout(step, PLAY_SPEED);
    }
  }
  playTimer = setTimeout(step, PLAY_SPEED);
}

function stopPlay() {
  isPlaying = false;
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  playBtn.textContent = "▶ Start Tour"; playBtn.classList.remove("tour-end");
  playBtn.classList.remove("playing");
}

/* ── Zoom helpers ───────────────────────────────────────────── */
function _applyZoomToState(feature, duration = 750) {
  const r  = mapArea.getBoundingClientRect();
  const [[x0, y0], [x1, y1]] = pathGen.bounds(feature);
  const k  = Math.min(10, 0.85 / Math.max((x1 - x0) / r.width, (y1 - y0) / r.height));
  const tx = r.width  / 2 - k * (x0 + x1) / 2;
  const ty = r.height / 2 - k * (y0 + y1) / 2;
  const t  = d3.zoomIdentity.translate(tx, ty).scale(k);
  (duration > 0 ? svg.transition().duration(duration) : svg).call(zoom.transform, t);
}

function zoomToFeature(feature) {
  zoomedState = feature;
  updateStateDesc(null);
  statePaths.classed("state-dim",    d => d !== feature);
  statePaths.classed("state-zoomed", d => d === feature);
  if (pinnedCell) renderSparkline(pinnedCell, currentYear);

  if (sidebar.classList.contains("zoomed")) {
    // Sidebar already expanded — no CSS transition fires, just re-zoom
    _applyZoomToState(feature, 750);
  } else {
    _sidebarTransitioning = true;
    sidebar.classList.add("zoomed");
    _applyZoomToState(feature, 750);
    sidebar.addEventListener("transitionend", () => {
      _sidebarTransitioning = false;
      _applyZoomToState(feature, 0);
    }, { once: true });
  }
}

function resetZoom() {
  if (tourStep && tourStep.startsWith("mini-")) {
    tourStep = null;
    hideTourDesc();
    clearPin();
    frpOpacity = 1.00; lstOpacity = 0.20;
    updateOpacitySliders();
    playBtn.textContent = "▶ Start Tour"; playBtn.classList.remove("tour-end");
  }
  zoomedState = null;
  statePaths.classed("state-dim",    false);
  statePaths.classed("state-zoomed", false);
  updateStateDesc(hoveredStateFeature);
  if (pinnedCell) renderSparkline(pinnedCell, currentYear);

  // Start smooth zoom-out before sidebar collapses so it runs uninterrupted
  svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);

  _sidebarTransitioning = true;
  sidebar.classList.remove("zoomed");
  sidebar.addEventListener("transitionend", () => {
    _sidebarTransitioning = false;
  }, { once: true });
}

/* ── Pin / clear sparkline ──────────────────────────────────── */
function pinCell(cell) {
  pinnedCell = cell;
  pinnedCellState = stateAt([cell.lon + 0.5, cell.lat + 0.5]);
  firePaths.classed("pinned", d =>
    d.properties.lat === cell.lat && d.properties.lon === cell.lon);
  d3.select("#cell-hint").style("display", "none");
  renderSparkline(cell, currentYear);
  updateStateDesc(hoveredStateFeature);
}

function clearPin() {
  pinnedCell = null;
  pinnedCellState = null;
  firePaths.classed("pinned", false);
  d3.select("#cell-hint").style("display", "block");
  d3.select("#sparkline-wrap").html("");
  d3.select("#cell-desc-wrap").html("");
  updateStateDesc(hoveredStateFeature);
}

/* ── Geography from event ────────────────────────────────────── */
function geoFromEvent(event) {
  const [mx, my] = d3.pointer(event, svgEl);
  const [gx, gy] = zoomTransform.invert([mx, my]);
  return projection.invert([gx, gy]);  // [lon, lat] or null
}

/* ── Cell under event (grid lookup) ─────────────────────────── */
function cellFromEvent(event) {
  const geo = geoFromEvent(event);
  if (!geo) return null;
  const [lon, lat] = geo;
  return cellMap[`${Math.floor(lat)},${Math.floor(lon)}`] ?? null;
}

/* ── State under a geographic point ─────────────────────────── */
function stateAt(lonLat) {
  if (!statesFeature || !lonLat) return null;
  return statesFeature.features.find(f => d3.geoContains(f, lonLat)) ?? null;
}

/* ── Drag vs click ───────────────────────────────────────────── */
function wasDrag(event) {
  if (!mouseDownXY) return false;
  const dx = event.clientX - mouseDownXY[0];
  const dy = event.clientY - mouseDownXY[1];
  return Math.sqrt(dx * dx + dy * dy) > 4;
}

/* ── Sparkline ─────────────────────────────────────────────── */
function renderSparkline(cellData, activeYr) {
  const wrap = d3.select("#sparkline-wrap");
  wrap.html("");

  const lat = (cellData.lat + 0.5).toFixed(0);
  const lon = Math.abs(cellData.lon + 0.5).toFixed(0);
  wrap.append("div").attr("class", "spark-cell-loc")
    .text(`${lat}°N  ${lon}°W`);

  const W = zoomedState ? 460 : 260;
  const H = zoomedState ? 190 : 124;
  const m = { top: 14, right: 36, bottom: 20, left: 44 };
  const w = W - m.left - m.right;
  const h = H - m.top - m.bottom;

  const sv = wrap.append("svg").attr("width", W).attr("height", H);
  const g  = sv.append("g").attr("transform", `translate(${m.left},${m.top})`);

  const frpVals = YEARS.map(yr => cellData.fire[yr]?.frp ?? 0);
  const lstVals = YEARS.map(yr => cellData.lst[yr]?.anomaly ?? null);

  const xSc = d3.scaleBand().domain(YEARS).range([0, w]).padding(0.22);
  const yF  = d3.scaleLinear()
    .domain([0, d3.max(frpVals) * 1.15 || 100])
    .range([h, 0]).nice();

  const validL = lstVals.filter(v => v !== null);
  const lExt   = d3.extent(validL.length ? validL : [-1, 1]);
  const pad     = Math.max(0.5, (lExt[1] - lExt[0]) * 0.25);
  const yL      = d3.scaleLinear()
    .domain([lExt[0] - pad, lExt[1] + pad]).range([h, 0]).nice();

  g.append("line")
    .attr("x1", 0).attr("x2", w)
    .attr("y1", yL(0)).attr("y2", yL(0))
    .attr("stroke", "#3a4155").attr("stroke-width", 1)
    .attr("stroke-dasharray", "3 3");

  g.selectAll(".spark-bar").data(YEARS).join("rect")
    .attr("class", "spark-bar")
    .attr("x",      yr => xSc(yr))
    .attr("y",      yr => yF(cellData.fire[yr]?.frp ?? 0))
    .attr("width",  xSc.bandwidth())
    .attr("height", yr => h - yF(cellData.fire[yr]?.frp ?? 0))
    .attr("fill",   yr => yr === activeYr ? "#ff8c42" : "#e05c2f")
    .attr("opacity",yr => yr === activeYr ? 1 : 0.6)
    .attr("rx", 1.5);

  const pts = YEARS.map((yr, i) => ({ yr, val: lstVals[i] })).filter(d => d.val != null);
  if (pts.length >= 2) {
    g.append("path")
      .datum(pts)
      .attr("fill", "none")
      .attr("stroke", "#4fa3e0")
      .attr("stroke-width", 2)
      .attr("d", d3.line()
        .x(d => xSc(d.yr) + xSc.bandwidth() / 2)
        .y(d => yL(d.val))
        .curve(d3.curveMonotoneX));

    g.selectAll(".spark-dot").data(pts).join("circle")
      .attr("class", "spark-dot")
      .attr("cx",  d => xSc(d.yr) + xSc.bandwidth() / 2)
      .attr("cy",  d => yL(d.val))
      .attr("r",   d => d.yr === activeYr ? 4 : 2.5)
      .attr("fill", "#4fa3e0")
      .attr("stroke", d => d.yr === activeYr ? "#fff" : "none")
      .attr("stroke-width", 1.5);
  }

  const styleAxis = ax => {
    ax.selectAll(".domain").attr("stroke", "#3a4155");
    ax.selectAll(".tick line").attr("stroke", "#3a4155");
    ax.selectAll(".tick text").attr("fill", "#8b949e").attr("font-size", "10px");
  };

  styleAxis(g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(xSc).tickFormat(d => String(d).slice(2)).tickSize(3)));

  styleAxis(g.append("g")
    .call(d3.axisLeft(yF).ticks(3)
      .tickFormat(d => d >= 1000 ? `${(d / 1000).toFixed(0)}k` : d)
      .tickSize(3)));

  styleAxis(g.append("g").attr("transform", `translate(${w},0)`)
    .call(d3.axisRight(yL).ticks(3)
      .tickFormat(d => `${d > 0 ? "+" : ""}${d.toFixed(1)}`)
      .tickSize(3)));

  g.append("text").attr("class", "spark-axis-l")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -m.left + 10)
    .attr("text-anchor", "middle").text("FRP (MW)");

  g.append("text").attr("class", "spark-axis-r")
    .attr("transform", "rotate(90)")
    .attr("x", h / 2).attr("y", -(w + m.right - 4))
    .attr("text-anchor", "middle").text("LST Δ°C");

  // Binned descriptions below chart
  const descWrap = d3.select("#cell-desc-wrap");
  descWrap.html("");
  const frp  = cellData.fire[activeYr]?.frp ?? 0;
  const anom = cellData.lst[activeYr]?.anomaly ?? null;
  descWrap.append("p").attr("class", "cell-desc-text").text(describeFRP(frp));
  descWrap.append("p").attr("class", "cell-desc-text").text(describeLST(anom));
}

/* ── Legends ───────────────────────────────────────────────── */
function buildLegends() {
  (function fireLegend() {
    const W = 210, H = 40;
    const m = { top: 16, right: 6, bottom: 14, left: 6 };
    const w = W - m.left - m.right;
    const sv = d3.select("#fire-legend").attr("width", W).attr("height", H);
    const g  = sv.append("g").attr("transform", `translate(${m.left},${m.top})`);

    g.append("text").attr("class", "leg-title").attr("y", -6).text("Fire FRP (MW)");

    const grad = defs.append("linearGradient").attr("id", "fire-grad");
    d3.range(0, 1.02, 0.04).forEach(t =>
      grad.append("stop").attr("offset", `${t * 100}%`)
        .attr("stop-color", frpColor(FRP_MIN * Math.pow(FRP_MAX / FRP_MIN, t))));

    g.append("rect").attr("width", w).attr("height", 8)
      .attr("fill", "url(#fire-grad)").attr("rx", 2);

    const sc = d3.scaleLog().domain([FRP_MIN, FRP_MAX]).range([0, w]);
    [50, 500, 5000, 50000].forEach(v =>
      g.append("text").attr("class", "leg-tick")
        .attr("x", sc(v)).attr("y", 18).attr("text-anchor", "middle")
        .text(v >= 1000 ? `${v / 1000}k` : v));
  })();

  (function lstLegend() {
    const W = 220, H = 40;
    const m = { top: 16, right: 6, bottom: 14, left: 6 };
    const w = W - m.left - m.right;
    const sv = d3.select("#lst-legend").attr("width", W).attr("height", H);
    const g  = sv.append("g").attr("transform", `translate(${m.left},${m.top})`);

    g.append("text").attr("class", "leg-title").attr("y", -6)
      .text("LST Anomaly vs. 2018–2024 mean (°C)");

    const grad = defs.append("linearGradient").attr("id", "lst-grad");
    d3.range(0, 1.02, 0.04).forEach(t =>
      grad.append("stop").attr("offset", `${t * 100}%`)
        .attr("stop-color", lstColor(-3 + t * 6)));

    g.append("rect").attr("width", w).attr("height", 8)
      .attr("fill", "url(#lst-grad)").attr("rx", 2);

    [[-3, "−3"], [-1.5, "−1.5"], [0, "0"], [1.5, "+1.5"], [3, "+3"]].forEach(([v, lbl]) =>
      g.append("text").attr("class", "leg-tick")
        .attr("x", (v + 3) / 6 * w).attr("y", 18).attr("text-anchor", "middle")
        .text(lbl));
  })();
}

/* ── Main ──────────────────────────────────────────────────── */
async function main() {
  const [payload, usTopo] = await Promise.all([
    d3.json("data/cells.json"),
    d3.json(TOPO_URL),
  ]);

  // Filter cells to western US grid below 49th parallel
  const cells = payload.cells.filter(d => d.lat < 49);
  cells.forEach(d => { cellMap[`${d.lat},${d.lon}`] = d; });

  // CONUS only: keep 48 contiguous states + DC (FIPS 1–56), exclude AK (2) and HI (15)
  const conusGeo = usTopo.objects.states.geometries.filter(g => {
    const id = +g.id;
    return id >= 1 && id <= 56 && id !== 2 && id !== 15;
  });
  const statesObj  = { ...usTopo.objects.states, geometries: conusGeo };
  statesFeature    = topojson.feature(usTopo, statesObj);
  const nation     = topojson.merge(usTopo, conusGeo);

  // Western states geometry — used to fit the initial view to the data region
  const westGeo    = conusGeo.filter(g => WEST_FIPS.has(+g.id));
  const westNation = topojson.merge(usTopo, westGeo);

  // Fit Albers to the 11 western states
  const rect = mapArea.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);

  projection = d3.geoAlbers()
    .fitExtent([[PAD, PAD], [W - PAD, H - PAD]], westNation);
  pathGen = d3.geoPath().projection(projection);

  // Restrict panning to the western-US bounding box + buffer
  const [[bx0, by0], [bx1, by1]] = pathGen.bounds(westNation);
  const panBuf = 60;
  zoom.translateExtent([
    [bx0 - panBuf, by0 - panBuf],
    [bx1 + panBuf, by1 + panBuf],
  ]);

  // Precompute which cells belong to each state (for state descriptions)
  statesFeature.features.forEach(f => stateCellsMap.set(f, []));
  cells.forEach(cell => {
    const center = [cell.lon + 0.5, cell.lat + 0.5];
    const sf = statesFeature.features.find(f => d3.geoContains(f, center));
    if (sf) stateCellsMap.get(sf).push(cell);
  });

  // States that have ≥1 data cell — the only states that are hoverable / zoomable
  dataStates = new Set(
    statesFeature.features.filter(f => (stateCellsMap.get(f) ?? []).length > 0)
  );

  // ── Base map ───────────────────────────────────────────────
  mapGroup.append("path").datum({ type: "Sphere" })
    .attr("class", "ocean-bg").attr("d", pathGen);

  mapGroup.append("path").datum(nation)
    .attr("class", "land-bg").attr("d", pathGen);

  // ── GeoJSON features for 1°×1° cells (inset by CELL_INSET) ──
  // Winding: SW → NW → NE → SE (CCW in spherical coords — required by D3
  // geoPath; the counter-intuitive SW→SE→NE→NW order is CW in spherical
  // due to negative longitudes, causing the "fills entire world" bug).
  const S = CELL_INSET;
  const cellFeatures = cells.map(d => ({
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [d.lon     + S, d.lat     + S],
        [d.lon     + S, d.lat + 1 - S],
        [d.lon + 1 - S, d.lat + 1 - S],
        [d.lon + 1 - S, d.lat     + S],
        [d.lon     + S, d.lat     + S],
      ]],
    },
    properties: d,
  }));

  // ── LST layer (below fire, above land fill) ────────────────
  lstPaths = mapGroup.append("g").attr("id", "lst-group")
    .attr("pointer-events", "none")
    .selectAll(".lst-cell")
    .data(cellFeatures)
    .join("path")
      .attr("class", "lst-cell")
      .attr("d", pathGen)
      .attr("stroke", "none")
      .attr("fill", "none")
      .attr("fill-opacity", 0);

  // ── Fire layer (above LST, below ocean mask) ───────────────
  firePaths = mapGroup.append("g").attr("id", "fire-group")
    .attr("pointer-events", "none")
    .selectAll(".fire-cell")
    .data(cellFeatures)
    .join("path")
      .attr("class", "fire-cell")
      .attr("d", pathGen)
      .attr("fill", "none")
      .attr("fill-opacity", 0);

  // ── Ocean mask — clips cells to land (evenodd: sphere – nation) ──
  const oceanMask = mapGroup.append("path")
    .attr("class", "ocean-mask")
    .attr("fill", "#050c18")
    .attr("fill-rule", "evenodd")
    .attr("stroke", "none")
    .attr("pointer-events", "none")
    .attr("d", pathGen({ type: "Sphere" }) + " " + pathGen(nation));

  // ── State borders (above ocean mask) ──────────────────────
  statePaths = mapGroup.append("g").attr("class", "states")
    .attr("pointer-events", "none")
    .selectAll("path")
    .data(statesFeature.features)
    .join("path")
      .attr("class", d => `state-border${dataStates.has(d) ? " state-has-data" : ""}`)
      .attr("d", pathGen);

  // ── Zoom ──────────────────────────────────────────────────
  svg.call(zoom);
  svg.on("dblclick.zoom", null);  // we handle dblclick ourselves

  // ── SVG-level interaction ─────────────────────────────────
  svg.on("mousedown.dragdetect", event => {
    mouseDownXY = [event.clientX, event.clientY];
  });

  svg.on("mousemove", event => {
    const cell = cellFromEvent(event);
    const geo  = geoFromEvent(event);

    // ── State hover highlight ──────────────────────────────
    if (geo) {
      const [lon, lat] = geo;
      if (!hoveredStateFeature || !d3.geoContains(hoveredStateFeature, [lon, lat])) {
        const prev      = hoveredStateFeature;
        const candidate = statesFeature.features.find(
          f => d3.geoContains(f, [lon, lat])
        ) ?? null;
        // Only highlight states that have data cells
        hoveredStateFeature = candidate && dataStates.has(candidate) ? candidate : null;
        statePaths.classed("state-hover", d => d === hoveredStateFeature);
        if (hoveredStateFeature !== prev) updateStateDesc(hoveredStateFeature);
      }
    }

    // ── Tooltip ────────────────────────────────────────────
    if (!cell) { tooltip.style("display", "none"); return; }

    const frp   = cell.fire[currentYear]?.frp ?? 0;
    const count = cell.fire[currentYear]?.count ?? 0;
    const anom  = cell.lst[currentYear]?.anomaly;
    const latC  = (cell.lat + 0.5).toFixed(0);
    const lonC  = Math.abs(cell.lon + 0.5).toFixed(0);
    const anomStr = anom != null
      ? `${anom > 0 ? "+" : ""}${anom.toFixed(1)} °C`
      : "No data";
    const anomCls = anom == null ? "tip-muted"
      : anom >  0.3 ? "tip-warm"
      : anom < -0.3 ? "tip-cool"
      : "tip-muted";
    const stateName = hoveredStateFeature?.properties?.name ?? "";

    tooltip.style("display", "block")
      .style("left", `${event.clientX + 15}px`)
      .style("top",  `${event.clientY - 12}px`)
      .html(`
        <div class="tip-title">${latC}°N &nbsp; ${lonC}°W</div>
        ${stateName ? `<div class="tip-muted">${stateName}</div>` : ""}
        <div class="tip-frp">FRP: ${frp >= 1 ? d3.format(",.0f")(frp) + " MW" : "—"}</div>
        ${frp >= 1 ? `<div class="tip-muted">Fire pixels: ${count}</div>` : ""}
        <div>LST: <span class="${anomCls}">${anomStr}</span></div>
      `);
  });

  svg.on("mouseleave", () => {
    tooltip.style("display", "none");
    hoveredStateFeature = null;
    statePaths.classed("state-hover", false);
    updateStateDesc(null);
  });

  // Single click: pin sparkline; when zoomed, clicking a different state navigates to it
  svg.on("click", event => {
    if (wasDrag(event)) return;

    // State-navigation check runs first so it wins over cell-pinning
    if (zoomedState) {
      const state = stateAt(geoFromEvent(event));
      if (state && dataStates.has(state) && state !== zoomedState) {
        zoomToFeature(state);
        return;
      }
    }

    const cell = cellFromEvent(event);
    if (cell) {
      clearTimeout(_clearPinTimer);
      if (pinnedCell && pinnedCell.lat === cell.lat && pinnedCell.lon === cell.lon) {
        // Defer so a dblclick on the same cell can cancel this and zoom instead
        _clearPinTimer = setTimeout(() => { _clearPinTimer = null; clearPin(); }, 250);
      } else {
        pinCell(cell);
      }
      return;
    }

    clearTimeout(_clearPinTimer);
    clearPin();
  });

  // Double-click: zoom to western state only; if already zoomed, reset
  svg.on("dblclick", event => {
    event.preventDefault();
    clearTimeout(_clearPinTimer);
    _clearPinTimer = null;
    if (zoomTransform.k > 1.5) {
      resetZoom();
      return;
    }
    const cell   = cellFromEvent(event);
    const lonLat = cell
      ? [cell.lon + 0.5, cell.lat + 0.5]
      : geoFromEvent(event);
    const state  = stateAt(lonLat);
    // Only zoom into states that have data cells
    if (state && dataStates.has(state)) {
      zoomToFeature(state);
    }
  });

  // ── Sidebar controls ──────────────────────────────────────
  playBtn.addEventListener("click", tourAdvance);

  yearSlider.addEventListener("input", function() {
    const yr = +this.value;
    if (tourStep !== null) {
      playBtn.disabled = false;
      clearPin();
      frpOpacity = 1.00;
      lstOpacity = 0.20;
      updateOpacitySliders();
      if (tourStep.startsWith("mini-")) {
        // Mini tour: keep zoomed state, reset to FRP step for selected year
        setYear(yr, false);
        tourStep = 'mini-frp';
        frpOpacity = 1.00; lstOpacity = 0.20;
        updateOpacitySliders();
        const cell = findBestFRPCellInState(zoomedState, yr);
        if (cell) pinCell(cell);
        showTourDesc(generateMiniFRPDesc(zoomedState, cell, yr));
        playBtn.textContent = "Next ▶"; playBtn.classList.remove("tour-end");
      } else {
        // Global tour: cancel zoom, reset view
        if (zoomedState) {
          zoomedState = null;
          statePaths.classed("state-dim",    false);
          statePaths.classed("state-zoomed", false);
          svg.call(zoom.transform, d3.zoomIdentity);
        }
        setYear(yr, false);
        tourStep = 'year';
        showTourDesc(TOUR_YEAR_DESCS[yr] ?? "");
        playBtn.textContent = "Next ▶"; playBtn.classList.remove("tour-end");
      }
    } else {
      setYear(yr, false);
    }
  });

  document.getElementById("fire-toggle").addEventListener("change", function() {
    showFire = this.checked;
    setYear(currentYear, false);
  });

  document.getElementById("lst-toggle").addEventListener("change", function() {
    showLST = this.checked;
    setYear(currentYear, false);
  });

  document.getElementById("frp-opacity").addEventListener("input", function() {
    frpOpacity = +this.value / 100;
    if (opacityLinked) {
      lstOpacity = Math.min(1, Math.max(0.2, 1.2 - frpOpacity));
      document.getElementById("lst-opacity").value = Math.round(lstOpacity * 100);
    }
    setYear(currentYear, false);
  });

  document.getElementById("lst-opacity").addEventListener("input", function() {
    lstOpacity = +this.value / 100;
    if (opacityLinked) {
      frpOpacity = Math.min(1, Math.max(0.2, 1.2 - lstOpacity));
      document.getElementById("frp-opacity").value = Math.round(frpOpacity * 100);
    }
    setYear(currentYear, false);
  });

  document.getElementById("opacity-lock").addEventListener("click", function() {
    opacityLinked = !opacityLinked;
    this.textContent = opacityLinked ? "🔒" : "🔓";
    this.classList.toggle("locked", opacityLinked);
  });

  // Layer label hover → popup description
  document.querySelectorAll("[data-tip]").forEach(el => {
    el.addEventListener("mouseenter", e => {
      tooltip.style("display", "block")
        .style("left", `${e.clientX + 15}px`)
        .style("top",  `${e.clientY - 12}px`)
        .html(`<div class="tip-muted" style="max-width:230px;line-height:1.55;font-size:0.88rem">${el.dataset.tip}</div>`);
    });
    el.addEventListener("mousemove", e => {
      tooltip.style("left", `${e.clientX + 15}px`)
        .style("top",  `${e.clientY - 12}px`);
    });
    el.addEventListener("mouseleave", () => tooltip.style("display", "none"));
  });

  // ── Initial render ────────────────────────────────────────
  buildLegends();
  setYear(2018, false);

  // ── Resize ────────────────────────────────────────────────
  new ResizeObserver(() => {
    const r  = mapArea.getBoundingClientRect();
    const nW = r.width, nH = r.height;
    svgEl.setAttribute("viewBox", `0 0 ${nW} ${nH}`);

    // Skip projection rebuild while sidebar is CSS-transitioning; the transitionend
    // handlers in zoomToFeature / resetZoom will reapply the correct zoom after.
    if (_sidebarTransitioning) return;

    projection = d3.geoAlbers()
      .fitExtent([[PAD, PAD], [nW - PAD, nH - PAD]], westNation);
    pathGen = d3.geoPath().projection(projection);
    mapGroup.selectAll("path").attr("d", pathGen);
    oceanMask.attr("d", pathGen({ type: "Sphere" }) + " " + pathGen(nation));

    const [[rx0, ry0], [rx1, ry1]] = pathGen.bounds(westNation);
    zoom.translateExtent([
      [rx0 - panBuf, ry0 - panBuf],
      [rx1 + panBuf, ry1 + panBuf],
    ]);

    if (zoomedState) {
      _applyZoomToState(zoomedState, 0);
    } else {
      zoomTransform = d3.zoomIdentity;
      svg.call(zoom.transform, d3.zoomIdentity);
    }
  }).observe(mapArea);
}

main().catch(console.error);
