/* Pure-style collaboration map — D3 + world-atlas topojson
   Dots sized by approximate co-author count per country.
   Data is an honest approximation derived from publication co-authors
   and lab member affiliations; not auto-synced. */

(async function buildCollabMap() {
  const svg = document.querySelector("#collab-map-svg");
  if (!svg || !window.d3 || !window.topojson) return;

  const wrap = svg.parentElement;
  const W = wrap.clientWidth || 900;
  const H = Math.max(360, Math.round(W * 0.45));

  const d3svg = d3.select(svg)
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("width", "100%")
    .attr("height", H);

  const projection = d3.geoNaturalEarth1()
    .scale(W / 6.3)
    .translate([W / 2, H / 1.85]);
  const path = d3.geoPath(projection);

  let world;
  try {
    world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
  } catch (e) {
    console.error("[collab-map] failed to load topology:", e);
    svg.outerHTML = '<p style="padding:40px;text-align:center;color:#888;">Map could not be loaded.</p>';
    return;
  }
  const countries = topojson.feature(world, world.objects.countries);

  // Land
  d3svg.append("g").attr("class", "land")
    .selectAll("path")
    .data(countries.features)
    .join("path")
      .attr("d", path)
      .attr("fill", "#cfd3d7")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.4);

  // Collaboration data — derived from publication co-author affiliations
  // and lab member nationalities. Not auto-synced.
  const collabs = [
    { country: "China",         coords: [110, 33],   papers: 18 },
    { country: "United States", coords: [-96, 40],   papers: 9  },
    { country: "Thailand",      coords: [101, 14],   papers: 5  },
    { country: "Vietnam",       coords: [108, 14.5], papers: 3  }
  ];
  const home = { country: "Republic of Korea", coords: [127.7, 36.5] };

  // Tooltip
  const tip = d3.select(wrap)
    .append("div")
    .attr("class", "collab-tip")
    .style("opacity", 0);

  // Dot scale
  const rScale = d3.scaleSqrt()
    .domain([1, 20])
    .range([7, 22]);

  // Collaboration dots
  d3svg.append("g").attr("class", "dots")
    .selectAll("circle")
    .data(collabs)
    .join("circle")
      .attr("cx", d => projection(d.coords)[0])
      .attr("cy", d => projection(d.coords)[1])
      .attr("r", d => rScale(d.papers))
      .attr("fill", "#1976D2")
      .attr("fill-opacity", 0.72)
      .attr("stroke", "#0d47a1")
      .attr("stroke-width", 1)
      .style("cursor", "pointer")
      .on("mouseenter", function(_, d) {
        d3.select(this).attr("fill-opacity", 0.95).attr("stroke-width", 1.5);
        tip.html(`<strong>${d.country}</strong><br>${d.papers} co-authored papers`)
           .style("opacity", 1);
      })
      .on("mousemove", function(e) {
        const rect = wrap.getBoundingClientRect();
        tip.style("left", (e.clientX - rect.left + 12) + "px")
           .style("top",  (e.clientY - rect.top  + 12) + "px");
      })
      .on("mouseleave", function() {
        d3.select(this).attr("fill-opacity", 0.72).attr("stroke-width", 1);
        tip.style("opacity", 0);
      });

  // Home pin (Inha University, Korea)
  const [hx, hy] = projection(home.coords);
  const homeG = d3svg.append("g")
    .attr("class", "home-pin")
    .attr("transform", `translate(${hx},${hy})`)
    .style("cursor", "pointer");
  homeG.append("path")
    .attr("d", "M 0 0 L -6 -14 A 6 6 0 1 1 6 -14 Z")
    .attr("fill", "#1d1d1d");
  homeG.append("circle")
    .attr("cy", -16)
    .attr("r", 2.2)
    .attr("fill", "#fff");
  homeG
    .on("mouseenter", function(e) {
      tip.html(`<strong>${home.country}</strong><br>Home — Inha University`)
         .style("opacity", 1);
    })
    .on("mousemove", function(e) {
      const rect = wrap.getBoundingClientRect();
      tip.style("left", (e.clientX - rect.left + 12) + "px")
         .style("top",  (e.clientY - rect.top  + 12) + "px");
    })
    .on("mouseleave", function() {
      tip.style("opacity", 0);
    });
})();
