// Renders the Pure-style fingerprint from data/network.json.
// Data shape: { fingerprint: [ { field, topics: [{ name, weight }, ...] }, ... ] }
(async function () {
  const grid = document.getElementById("fp-grid");
  if (!grid) return;

  try {
    const r = await fetch("data/network.json", { cache: "no-store" });
    if (!r.ok) throw new Error("network.json " + r.status);
    const data = await r.json();
    const fields = (data && data.fingerprint) || [];
    if (!fields.length) {
      grid.innerHTML = '<div class="fp-loading">Fingerprint not yet generated.</div>';
      return;
    }

    grid.innerHTML = fields.map(f => `
      <div class="fp-cat">
        <h3>${escapeHTML(f.field)}</h3>
        ${f.topics.map(t => `
          <div class="fp-row">
            <div class="topic">
              <span class="label">${escapeHTML(t.name)}</span>
              <div class="bar"><i style="width:${t.weight}%"></i></div>
            </div>
            <span class="pct">${t.weight}%</span>
          </div>
        `).join("")}
      </div>
    `).join("");
  } catch (err) {
    console.error("[fingerprint]", err);
    grid.innerHTML = '<div class="fp-loading">Failed to load fingerprint.</div>';
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
})();
