/* Network app — Pure-style co-authorship explorer.
   Loads data/network.json, drives 4 sub-tabs (Visualization / Map / Profiles / Research units).
   All interactivity is filter-driven; state lives in the `S` object. */

(function () {
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const S = {
    data: null,
    yearStart: 2000,
    yearEnd: new Date().getFullYear(),
    minPapers: 1,
    showInternal: true,
    showExternal: true,
    showCounts: false,
    activePane: "vis",
    layout: "force",
    sort: { profiles: "papers", units: "papers", desc: true },
    sim: null,
    zoom: null,
  };

  const SELF_ID = "https://openalex.org/A5042254280";
  const SELF_NAME = "Su-Geun Yang";

  // ─── BOOT ─────────────────────────────────────
  init();

  async function init() {
    try {
      const r = await fetch("data/network.json", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      S.data = await r.json();
    } catch (e) {
      $("#net-totals").textContent = "(network data not yet generated — run sync_network.py)";
      console.warn("[network] data load failed", e);
      return;
    }

    const d = S.data;
    $("#net-totals").textContent = `(${d.totals.co_authors} co-authors · ${d.totals.institutions} institutions · ${d.totals.countries} countries)`;
    $("#net-fetched").textContent = (d.fetched_at || "").slice(0, 10);

    // Year range bounds from papers
    const years = d.papers.map(p => p.year).filter(Boolean);
    const yMin = Math.min(...years);
    const yMax = Math.max(...years);
    S.yearStart = yMin;
    S.yearEnd   = yMax;

    fillYearSelects(yMin, yMax);
    bindFilterEvents();
    bindSubtabEvents();
    bindVisToolbar();
    bindTableSorts();

    renderAll();
  }

  // ─── FILTERS ──────────────────────────────────
  function fillYearSelects(yMin, yMax) {
    const ys = $("#f-year-start");
    const ye = $("#f-year-end");
    for (let y = yMin; y <= yMax; y++) {
      ys.insertAdjacentHTML("beforeend", `<option value="${y}">${y}</option>`);
      ye.insertAdjacentHTML("beforeend", `<option value="${y}">${y}</option>`);
    }
    ys.value = yMin;
    ye.value = yMax;

    const maxPapers = Math.max(1, ...S.data.co_authors.map(c => c.papers));
    const slider = $("#f-min");
    slider.max = Math.min(maxPapers, 50);
  }

  function bindFilterEvents() {
    $("#f-year-start").addEventListener("change", e => { S.yearStart = +e.target.value; renderAll(); });
    $("#f-year-end").addEventListener("change",   e => { S.yearEnd   = +e.target.value; renderAll(); });
    $("#f-min").addEventListener("input", e => {
      S.minPapers = +e.target.value;
      $("#f-min-val").textContent = S.minPapers;
      renderAll();
    });
    $("#f-internal").addEventListener("change", e => { S.showInternal = e.target.checked; renderAll(); });
    $("#f-external").addEventListener("change", e => { S.showExternal = e.target.checked; renderAll(); });
    $("#f-reset").addEventListener("click", () => {
      S.yearStart = +$("#f-year-start").firstElementChild.value;
      S.yearEnd   = +$("#f-year-end").lastElementChild.value;
      S.minPapers = 1;
      S.showInternal = true;
      S.showExternal = true;
      $("#f-year-start").value = S.yearStart;
      $("#f-year-end").value   = S.yearEnd;
      $("#f-min").value = 1;
      $("#f-min-val").textContent = 1;
      $("#f-internal").checked = true;
      $("#f-external").checked = true;
      renderAll();
    });
  }

  // ─── SUB-TABS ─────────────────────────────────
  function bindSubtabEvents() {
    $$(".net-subtab").forEach(btn => {
      btn.addEventListener("click", () => {
        S.activePane = btn.dataset.pane;
        $$(".net-subtab").forEach(b => b.classList.toggle("active", b === btn));
        $$(".net-pane").forEach(p => p.classList.toggle("active", p.id === "pane-" + S.activePane));
        if (S.activePane === "vis" && S.sim) S.sim.alpha(0.3).restart();
      });
    });
  }

  // ─── DATA SHAPING ─────────────────────────────
  function filteredCoAuthors() {
    return S.data.co_authors.filter(c => {
      if (c.papers < S.minPapers) return false;
      if (!S.showInternal && !c.is_external) return false;
      if (!S.showExternal &&  c.is_external) return false;
      // Year range — co-author must have at least one year in window
      if (c.last_year  && c.last_year  < S.yearStart) return false;
      if (c.first_year && c.first_year > S.yearEnd)   return false;
      return true;
    });
  }

  function filteredPapers() {
    return S.data.papers.filter(p => {
      if (!p.year) return false;
      if (p.year < S.yearStart || p.year > S.yearEnd) return false;
      return true;
    });
  }

  function filteredInstitutions() {
    return S.data.institutions.filter(i => {
      if (i.papers < S.minPapers) return false;
      if (!S.showInternal && !i.is_external) return false;
      if (!S.showExternal &&  i.is_external) return false;
      return true;
    });
  }

  // ─── RENDER ALL ───────────────────────────────
  function renderAll() {
    renderVisualization();
    renderMap();
    renderProfiles();
    renderUnits();
  }

  // ─── VISUALIZATION ────────────────────────────
  function renderVisualization() {
    const co = filteredCoAuthors();
    const empty = $(".vis-empty");
    if (!co.length) {
      empty.hidden = false;
      d3.select("#vis-svg").selectAll("*").remove();
      return;
    }
    empty.hidden = true;

    const stage = $(".vis-stage");
    const W = stage.clientWidth || 800;
    const H = stage.clientHeight || 540;

    const svg = d3.select("#vis-svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("width", "100%")
      .attr("height", H);

    svg.selectAll("*").remove();

    const root = svg.append("g").attr("class", "graph-root");

    // Zoom
    S.zoom = d3.zoom()
      .scaleExtent([0.4, 4])
      .on("zoom", e => root.attr("transform", e.transform));
    svg.call(S.zoom);

    // Build node + edge sets
    const ids = new Set(co.map(c => c.id));
    const nodes = [
      { id: SELF_ID, name: SELF_NAME, papers: S.data.totals.works, kind: "self" }
    ];
    co.forEach(c => nodes.push({
      id: c.id,
      name: shortName(c.name),
      fullName: c.name,
      papers: c.papers,
      kind: c.is_external ? "external" : "internal"
    }));

    const edgeWeights = new Map();
    const addEdge = (a, b, w = 1) => {
      if (a === b) return;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeWeights.set(k, (edgeWeights.get(k) || 0) + w);
    };

    co.forEach(c => addEdge(SELF_ID, c.id, c.papers));

    const papers = filteredPapers();
    papers.forEach(p => {
      const inSet = p.co_author_ids.filter(id => ids.has(id));
      for (let i = 0; i < inSet.length; i++) {
        for (let j = i + 1; j < inSet.length; j++) addEdge(inSet[i], inSet[j]);
      }
    });

    const links = [...edgeWeights.entries()].map(([k, w]) => {
      const [s, t] = k.split("|");
      return { source: s, target: t, weight: w };
    });

    const rScale = d3.scaleSqrt()
      .domain([1, Math.max(2, ...co.map(c => c.papers))])
      .range([6, 22]);

    // Colors
    const colorOf = n =>
      n.kind === "self"     ? "#b9131e" :
      n.kind === "external" ? "#1976D2" :
                              "#2E7D32";

    // Edges
    const link = root.append("g").attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
        .attr("stroke", "#9aa3a8")
        .attr("stroke-opacity", d => d.weight === 1 ? 0.18 : 0.45)
        .attr("stroke-width", d => Math.min(0.6 + Math.sqrt(d.weight) * 0.6, 4));

    const linkLabel = root.append("g").attr("class", "link-labels")
      .selectAll("text")
      .data(links.filter(d => d.weight >= 2))
      .join("text")
        .text(d => d.weight)
        .attr("font-size", 10)
        .attr("fill", "#555")
        .attr("text-anchor", "middle")
        .style("display", S.showCounts ? null : "none");

    // Nodes
    const node = root.append("g").attr("class", "nodes")
      .selectAll("g")
      .data(nodes, d => d.id)
      .join("g")
        .attr("class", d => "node " + d.kind)
        .style("cursor", "grab")
        .call(d3.drag()
          .on("start", dragStart)
          .on("drag", dragMove)
          .on("end", dragEnd));

    node.append("circle")
      .attr("r", d => d.kind === "self" ? 24 : rScale(d.papers))
      .attr("fill", colorOf)
      .attr("fill-opacity", 0.85)
      .attr("stroke", colorOf)
      .attr("stroke-width", 1.5);

    node.append("text")
      .text(d => d.name)
      .attr("font-size", d => d.kind === "self" ? 13 : 10)
      .attr("font-weight", d => d.kind === "self" ? 700 : 500)
      .attr("text-anchor", "middle")
      .attr("dy", d => (d.kind === "self" ? 28 : rScale(d.papers) + 10))
      .attr("fill", "#1d1d1d")
      .attr("paint-order", "stroke")
      .attr("stroke", "#fff")
      .attr("stroke-width", 3);

    const tip = d3.select(".vis-tip");
    node.on("mouseenter", (e, d) => {
      tip.html(`<strong>${d.fullName || d.name}</strong><br>${d.papers} co-authored papers`)
         .style("opacity", 1);
    }).on("mousemove", e => {
      const rect = stage.getBoundingClientRect();
      tip.style("left", (e.clientX - rect.left + 12) + "px")
         .style("top",  (e.clientY - rect.top  + 12) + "px");
    }).on("mouseleave", () => tip.style("opacity", 0));

    // Simulation
    if (S.sim) S.sim.stop();

    if (S.layout === "circle") {
      const others = nodes.filter(n => n.kind !== "self");
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 60;
      others.forEach((n, i) => {
        n.x = cx + r * Math.cos(2 * Math.PI * i / others.length);
        n.y = cy + r * Math.sin(2 * Math.PI * i / others.length);
        n.fx = n.x; n.fy = n.y;
      });
      const self = nodes.find(n => n.kind === "self");
      self.x = cx; self.y = cy; self.fx = cx; self.fy = cy;
      tickPositions();
    } else {
      nodes.forEach(n => { n.fx = null; n.fy = null; });
      const self = nodes.find(n => n.kind === "self");
      self.fx = W / 2; self.fy = H / 2;

      S.sim = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(d => 80 + 20 / d.weight).strength(0.4))
        .force("charge", d3.forceManyBody().strength(d => d.kind === "self" ? -800 : -120))
        .force("center", d3.forceCenter(W / 2, H / 2).strength(0.05))
        .force("collide", d3.forceCollide().radius(d => (d.kind === "self" ? 28 : rScale(d.papers) + 6)))
        .on("tick", tickPositions);
    }

    function tickPositions() {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      linkLabel.attr("x", d => (d.source.x + d.target.x) / 2)
               .attr("y", d => (d.source.y + d.target.y) / 2);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    }

    function dragStart(e, d) {
      if (!e.active && S.sim) S.sim.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    }
    function dragMove(e, d) { d.fx = e.x; d.fy = e.y; }
    function dragEnd(e, d) {
      if (!e.active && S.sim) S.sim.alphaTarget(0);
      if (d.kind !== "self") { d.fx = null; d.fy = null; }
    }
  }

  function bindVisToolbar() {
    $$(".vis-btn").forEach(b => {
      b.addEventListener("click", () => {
        if (b.dataset.layout)  { S.layout = b.dataset.layout; renderVisualization(); }
        if (b.dataset.zoom)    {
          const svg = d3.select("#vis-svg");
          if (b.dataset.zoom === "in")    svg.transition().duration(300).call(S.zoom.scaleBy, 1.4);
          if (b.dataset.zoom === "out")   svg.transition().duration(300).call(S.zoom.scaleBy, 0.7);
          if (b.dataset.zoom === "reset") svg.transition().duration(300).call(S.zoom.transform, d3.zoomIdentity);
        }
        if (b.dataset.action === "play" && S.sim) S.sim.alpha(0.7).restart();
      });
    });
    $("#vis-show-counts").addEventListener("change", e => {
      S.showCounts = e.target.checked;
      d3.select("#vis-svg").selectAll(".link-labels text").style("display", S.showCounts ? null : "none");
    });
    $("#vis-show-anyway").addEventListener("click", () => {
      S.minPapers = 1;
      $("#f-min").value = 1;
      $("#f-min-val").textContent = 1;
      renderAll();
    });
  }

  // ─── MAP ──────────────────────────────────────
  let mapBuilt = false;
  let mapWorld = null;

  async function renderMap() {
    const svg = $("#net-map-svg");
    if (!svg) return;
    const wrap = svg.parentElement;
    const W = wrap.clientWidth || 900;
    const H = Math.max(380, Math.round(W * 0.5));

    if (!mapWorld) {
      try {
        mapWorld = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
      } catch (e) {
        wrap.innerHTML = '<p style="padding:40px;text-align:center;color:#888;">Map could not be loaded.</p>';
        return;
      }
    }

    const d3svg = d3.select(svg)
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .attr("width", "100%")
      .attr("height", H);
    d3svg.selectAll("*").remove();

    const projection = d3.geoNaturalEarth1()
      .scale(W / 6.3)
      .translate([W / 2, H / 1.85]);
    const path = d3.geoPath(projection);

    const countries = topojson.feature(mapWorld, mapWorld.objects.countries);

    d3svg.append("g").selectAll("path")
      .data(countries.features).join("path")
        .attr("d", path)
        .attr("fill", "#cfd3d7")
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.4);

    // Build country counts from filtered institutions
    const insts = filteredInstitutions();
    const counts = {};
    insts.forEach(i => {
      if (!i.country) return;
      counts[i.country] = (counts[i.country] || 0) + i.papers;
    });

    // Find centroid for each country code present in data
    const codeToCentroid = {};
    countries.features.forEach(f => {
      const iso = ISO_NUM_TO_ALPHA2[f.id];
      if (!iso) return;
      const c = d3.geoCentroid(f);
      codeToCentroid[iso] = c;
    });

    const points = Object.entries(counts)
      .map(([code, papers]) => ({ code, papers, coord: codeToCentroid[code] }))
      .filter(p => p.coord);

    const maxP = Math.max(1, ...points.map(p => p.papers));
    const r = d3.scaleSqrt().domain([1, maxP]).range([5, 22]);

    const tip = (function () {
      let t = wrap.querySelector(".collab-tip");
      if (!t) {
        t = document.createElement("div");
        t.className = "collab-tip";
        wrap.appendChild(t);
      }
      return d3.select(t);
    })();

    d3svg.append("g").selectAll("circle")
      .data(points).join("circle")
        .attr("cx", d => projection(d.coord)[0])
        .attr("cy", d => projection(d.coord)[1])
        .attr("r",  d => r(d.papers))
        .attr("fill", "#1976D2")
        .attr("fill-opacity", 0.72)
        .attr("stroke", "#0d47a1")
        .attr("stroke-width", 1)
        .style("cursor", "pointer")
        .on("mouseenter", function (e, d) {
          d3.select(this).attr("fill-opacity", 0.95);
          tip.html(`<strong>${countryName(d.code)}</strong><br>${d.papers} co-authored papers`)
             .style("opacity", 1);
        })
        .on("mousemove", e => {
          const rect = wrap.getBoundingClientRect();
          tip.style("left", (e.clientX - rect.left + 12) + "px")
             .style("top",  (e.clientY - rect.top  + 12) + "px");
        })
        .on("mouseleave", function () {
          d3.select(this).attr("fill-opacity", 0.72);
          tip.style("opacity", 0);
        });

    // Home pin (Korea)
    const krCoord = codeToCentroid["KR"] || [127.7, 36.5];
    const [hx, hy] = projection(krCoord);
    const homeG = d3svg.append("g").attr("transform", `translate(${hx},${hy})`);
    homeG.append("path")
      .attr("d", "M 0 0 L -6 -14 A 6 6 0 1 1 6 -14 Z")
      .attr("fill", "#1d1d1d");
    homeG.append("circle").attr("cy", -16).attr("r", 2.2).attr("fill", "#fff");
  }

  // ─── PROFILES TABLE ──────────────────────────
  function renderProfiles() {
    const tbody = $("#profiles-table tbody");
    const co = filteredCoAuthors();
    const sortKey = S.sort.profiles;
    const desc = S.sort.desc;
    co.sort((a, b) => {
      let va, vb;
      switch (sortKey) {
        case "name":     va = a.name; vb = b.name; break;
        case "external": va = a.is_external ? 1 : 0; vb = b.is_external ? 1 : 0; break;
        case "papers":   va = a.papers; vb = b.papers; break;
        case "years":    va = a.last_year || 0; vb = b.last_year || 0; break;
        default: return 0;
      }
      if (typeof va === "string") return desc ? vb.localeCompare(va) : va.localeCompare(vb);
      return desc ? vb - va : va - vb;
    });

    tbody.innerHTML = co.map(c => {
      const insts = c.institution_ids
        .map(id => S.data.institutions.find(i => i.id === id))
        .filter(Boolean)
        .map(i => i.name)
        .slice(0, 2)
        .join("; ");
      const flag = c.is_external ? '<span class="tag external">External</span>' : '<span class="tag internal">Internal</span>';
      const orcid = c.orcid ? ` <a href="${c.orcid}" target="_blank" rel="noopener" class="orcid-link" title="ORCID">iD</a>` : "";
      const yr = c.first_year && c.last_year
        ? (c.first_year === c.last_year ? c.first_year : `${c.first_year}–${c.last_year}`)
        : "—";
      return `
        <tr>
          <td><strong>${c.name}</strong>${orcid}</td>
          <td>${insts || "—"} ${flag}</td>
          <td class="num">${c.papers}</td>
          <td class="num">${yr}</td>
        </tr>`;
    }).join("");
    $("#profiles-note").textContent = `${co.length} co-author${co.length === 1 ? "" : "s"} match the current filters.`;
  }

  // ─── RESEARCH UNITS TABLE ────────────────────
  function renderUnits() {
    const tbody = $("#units-table tbody");
    const insts = filteredInstitutions();
    const sortKey = S.sort.units;
    const desc = S.sort.desc;
    insts.sort((a, b) => {
      let va, vb;
      switch (sortKey) {
        case "name":     va = a.name; vb = b.name; break;
        case "country":  va = a.country; vb = b.country; break;
        case "papers":   va = a.papers; vb = b.papers; break;
        case "external": va = a.is_external ? 1 : 0; vb = b.is_external ? 1 : 0; break;
        default: return 0;
      }
      if (typeof va === "string") return desc ? (vb || "").localeCompare(va || "") : (va || "").localeCompare(vb || "");
      return desc ? vb - va : va - vb;
    });

    tbody.innerHTML = insts.map(i => `
      <tr>
        <td><strong>${i.name}</strong></td>
        <td>${countryName(i.country) || "—"}</td>
        <td class="num">${i.papers}</td>
        <td>${i.is_external ? '<span class="tag external">External</span>' : '<span class="tag internal">Internal</span>'}</td>
      </tr>
    `).join("");
    $("#units-note").textContent = `${insts.length} institution${insts.length === 1 ? "" : "s"} match the current filters.`;
  }

  function bindTableSorts() {
    $$("#profiles-table th[data-sort]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (S.sort.profiles === key) S.sort.desc = !S.sort.desc;
        else { S.sort.profiles = key; S.sort.desc = true; }
        renderProfiles();
      });
    });
    $$("#units-table th[data-sort]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (S.sort.units === key) S.sort.desc = !S.sort.desc;
        else { S.sort.units = key; S.sort.desc = true; }
        renderUnits();
      });
    });
  }

  // ─── HELPERS ─────────────────────────────────
  const _regionNames = (typeof Intl !== "undefined" && Intl.DisplayNames)
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

  function countryName(code) {
    if (!code) return "";
    if (_regionNames) {
      try { return _regionNames.of(code) || code; } catch { /* fall through */ }
    }
    return code;
  }

  function shortName(name) {
    if (!name) return "";
    const parts = name.split(/[\s,]+/).filter(Boolean);
    if (parts.length === 1) return parts[0];
    // OpenAlex usually returns "First Last"; show last name as label
    return parts[parts.length - 1];
  }

  // Minimal ISO 3166 numeric → alpha-2 mapping for world-atlas data,
  // plus alpha-2 → display name (the most common collaborators).
  const ISO_NUM_TO_ALPHA2 = {
    "004":"AF","008":"AL","012":"DZ","020":"AD","024":"AO","028":"AG","032":"AR","036":"AU","040":"AT","044":"BS",
    "048":"BH","050":"BD","051":"AM","052":"BB","056":"BE","060":"BM","064":"BT","068":"BO","070":"BA","072":"BW",
    "076":"BR","084":"BZ","086":"IO","090":"SB","092":"VG","096":"BN","100":"BG","104":"MM","108":"BI","112":"BY",
    "116":"KH","120":"CM","124":"CA","132":"CV","136":"KY","140":"CF","144":"LK","148":"TD","152":"CL","156":"CN",
    "158":"TW","162":"CX","166":"CC","170":"CO","174":"KM","178":"CG","180":"CD","184":"CK","188":"CR","191":"HR",
    "192":"CU","196":"CY","203":"CZ","204":"BJ","208":"DK","212":"DM","214":"DO","218":"EC","222":"SV","226":"GQ",
    "231":"ET","232":"ER","233":"EE","234":"FO","238":"FK","242":"FJ","246":"FI","250":"FR","254":"GF","258":"PF",
    "260":"TF","262":"DJ","266":"GA","268":"GE","270":"GM","275":"PS","276":"DE","288":"GH","292":"GI","296":"KI",
    "300":"GR","304":"GL","308":"GD","312":"GP","316":"GU","320":"GT","324":"GN","328":"GY","332":"HT","340":"HN",
    "344":"HK","348":"HU","352":"IS","356":"IN","360":"ID","364":"IR","368":"IQ","372":"IE","376":"IL","380":"IT",
    "384":"CI","388":"JM","392":"JP","398":"KZ","400":"JO","404":"KE","408":"KP","410":"KR","414":"KW","417":"KG",
    "418":"LA","422":"LB","426":"LS","428":"LV","430":"LR","434":"LY","438":"LI","440":"LT","442":"LU","446":"MO",
    "450":"MG","454":"MW","458":"MY","462":"MV","466":"ML","470":"MT","478":"MR","480":"MU","484":"MX","492":"MC",
    "496":"MN","498":"MD","499":"ME","504":"MA","508":"MZ","512":"OM","516":"NA","520":"NR","524":"NP","528":"NL",
    "540":"NC","548":"VU","554":"NZ","558":"NI","562":"NE","566":"NG","578":"NO","580":"MP","583":"FM","584":"MH",
    "585":"PW","586":"PK","591":"PA","598":"PG","600":"PY","604":"PE","608":"PH","616":"PL","620":"PT","624":"GW",
    "626":"TL","630":"PR","634":"QA","642":"RO","643":"RU","646":"RW","662":"LC","670":"VC","678":"ST","682":"SA",
    "686":"SN","688":"RS","690":"SC","694":"SL","702":"SG","703":"SK","704":"VN","705":"SI","706":"SO","710":"ZA",
    "716":"ZW","724":"ES","728":"SS","729":"SD","732":"EH","740":"SR","748":"SZ","752":"SE","756":"CH","760":"SY",
    "762":"TJ","764":"TH","768":"TG","776":"TO","780":"TT","784":"AE","788":"TN","792":"TR","795":"TM","798":"TV",
    "800":"UG","804":"UA","807":"MK","818":"EG","826":"GB","834":"TZ","840":"US","850":"VI","854":"BF","858":"UY",
    "860":"UZ","862":"VE","876":"WF","882":"WS","887":"YE","894":"ZM"
  };
})();
