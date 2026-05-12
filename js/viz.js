/* ── Constants ─────────────────────────────────────────────── */
const YEARS      = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
const FRP_MIN    = 5;       // MW — cells below this are transparent
const FRP_MAX    = 90000;   // MW — color scale ceiling
const PLAY_SPEED = 1600;    // ms per year step
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
let pinnedCell    = null;
let zoomTransform = d3.zoomIdentity;
let mouseDownXY   = null;
let statesFeature = null;
let stateCellsMap = new Map();
let zoomedState          = null;
let _sidebarTransitioning = false;

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
function describeState(stateFeature, year) {
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
  return text;
}

function updateStateDesc(stateFeature) {
  const el = document.getElementById("state-desc");
  if (!el) return;
  // When zoomed into a state, lock the description to that state regardless of hover
  const effective = zoomedState ?? stateFeature;
  el.textContent = effective ? describeState(effective, currentYear) : "";
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
      return frp >= FRP_MIN ? 0.88 : 0;
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
  playBtn.textContent = "▶ Play";
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
  statePaths.classed("state-dim", d => d !== feature);
  if (pinnedCell) renderSparkline(pinnedCell, currentYear);

  _sidebarTransitioning = true;
  sidebar.classList.add("zoomed");

  // Zoom starts immediately with current (pre-expansion) map dims
  _applyZoomToState(feature, 750);

  // After sidebar finishes expanding, snap-correct centering for new dims
  sidebar.addEventListener("transitionend", () => {
    _sidebarTransitioning = false;
    _applyZoomToState(feature, 0);
  }, { once: true });
}

function resetZoom() {
  zoomedState = null;
  statePaths.classed("state-dim", false);
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
  firePaths.classed("pinned", d =>
    d.properties.lat === cell.lat && d.properties.lon === cell.lon);
  d3.select("#cell-hint").style("display", "none");
  renderSparkline(cell, currentYear);
}

function clearPin() {
  pinnedCell = null;
  firePaths.classed("pinned", false);
  d3.select("#cell-hint").style("display", "block");
  d3.select("#sparkline-wrap").html("");
  d3.select("#cell-desc-wrap").html("");
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

  const W = zoomedState ? 340 : 260;
  const H = zoomedState ? 158 : 124;
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
  const dataStates = new Set(
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
      .attr("class", "state-border")
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
    if (cell) { pinCell(cell); return; }

    clearPin();
  });

  // Double-click: zoom to western state only; if already zoomed, reset
  svg.on("dblclick", event => {
    event.preventDefault();
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
  playBtn.addEventListener("click", () => isPlaying ? stopPlay() : startPlay());

  yearSlider.addEventListener("input", function() {
    stopPlay();
    setYear(+this.value, false);
  });

  document.getElementById("fire-toggle").addEventListener("change", function() {
    showFire = this.checked;
    setYear(currentYear, false);
  });

  document.getElementById("lst-toggle").addEventListener("change", function() {
    showLST = this.checked;
    setYear(currentYear, false);
  });

  document.getElementById("lst-opacity").addEventListener("input", function() {
    lstOpacity = +this.value / 100;
    setYear(currentYear, false);
  });

  // Layer label hover → popup description
  document.querySelectorAll("[data-tip]").forEach(el => {
    el.addEventListener("mouseenter", e => {
      tooltip.style("display", "block")
        .style("left", `${e.clientX + 15}px`)
        .style("top",  `${e.clientY - 12}px`)
        .html(`<div class="tip-muted" style="max-width:230px;line-height:1.55">${el.dataset.tip}</div>`);
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
