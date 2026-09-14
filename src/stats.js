// Rolling time-series of world metrics for the dashboard charts.
// Each series is a plain array capped at `maxPoints` (oldest dropped).
// Also keeps a per-species population history for the Muller plot.

const SERIES = [
  'population', 'food', 'carrion', 'maxGen', 'avgGen', 'diversity',
  'births', 'deaths', 'avgEaten', 'avgDiet', 'avgSpeed', 'avgEnergy',
  'carnivores', 'herbivores', 'scavengers', 'species', 'avgConns', 'avgHidden', 'avgAddedConns',
];

export class Stats {
  constructor(maxPoints = 320) {
    this.maxPoints = maxPoints;
    this.ticks = [];
    this.series = {};
    for (const k of SERIES) this.series[k] = [];
    this.last = null;
    this._lastBirths = 0;
    this._lastDeaths = 0;
    this.historyTicks = [];
    this.fullSpeciesHistory = new Map();
    this.fullSpeciesMeta = new Map();
    this.speciesHistory = new Map(); // id -> count[] (aligned with this.ticks)
    this.speciesMeta = new Map(); // id -> {parent, color, peak, birthTick}
  }

  sample(world) {
    const raw = world.metrics();
    const m = { ...raw, births: raw.birthsTotal - this._lastBirths, deaths: raw.deathsTotal - this._lastDeaths };
    this._lastBirths = raw.birthsTotal;
    this._lastDeaths = raw.deathsTotal;
    this.last = m;
    this.ticks.push(m.tick);
    for (const k of SERIES) this.series[k].push(m[k]);

    // per-species population row for this sample
    const n = this.ticks.length;
    for (const sp of world.species.values()) {
      // only begin tracking a species while it is alive; keep tracking once started
      if (!sp.alive && !this.speciesHistory.has(sp.id)) continue;
      let arr = this.speciesHistory.get(sp.id);
      if (!arr) { arr = new Array(n - 1).fill(0); this.speciesHistory.set(sp.id, arr); }
      arr.push(sp.count);
      this.speciesMeta.set(sp.id, { parent: sp.parent, color: sp.color, peak: sp.peak, birthTick: sp.birthTick });
    }

    if (this.ticks.length > this.maxPoints) {
      this.ticks.shift();
      for (const k of SERIES) this.series[k].shift();
      for (const [id, arr] of this.speciesHistory) {
        arr.shift();
        if (arr.every((v) => v === 0)) { this.speciesHistory.delete(id); this.speciesMeta.delete(id); }
      }
    }
    this.historyTicks.push(m.tick);
    for (const sp of world.species.values()) {
      let row = this.fullSpeciesHistory.get(sp.id);
      if (!row) { row = new Array(this.historyTicks.length - 1).fill(0); this.fullSpeciesHistory.set(sp.id, row); }
      row.push(sp.count);
      this.fullSpeciesMeta.set(sp.id, { parent: sp.parent, color: sp.color, peak: sp.peak, birthTick: sp.birthTick });
    }
    // Decimate stored observations, not the simulation. Keep the origin and latest
    // endpoint; timestamps preserve nonuniform spacing. This is not every birth.
    if (this.historyTicks.length > 640) {
      const keep = this.historyTicks.map((_,i)=>i).filter(i => i % 2 === 0 || i === this.historyTicks.length - 1);
      this.historyTicks = keep.map(i => this.historyTicks[i]);
      for (const [id, row] of this.fullSpeciesHistory) this.fullSpeciesHistory.set(id, keep.map(i => row[i]));
    }
    return m;
  }

  reset() {
    this.ticks.length = 0;
    for (const k of SERIES) this.series[k].length = 0;
    this.speciesHistory.clear();
    this.speciesMeta.clear();
    this.last = null;
    this._lastBirths = 0; this._lastDeaths = 0;
    this.historyTicks.length = 0;
    this.fullSpeciesHistory.clear(); this.fullSpeciesMeta.clear();
  }

  toJSON() {
    return { ticks:this.ticks, series:this.series, last:this.last,
      speciesHistory:[...this.speciesHistory], speciesMeta:[...this.speciesMeta],
      historyTicks:this.historyTicks, fullSpeciesHistory:[...this.fullSpeciesHistory], fullSpeciesMeta:[...this.fullSpeciesMeta],
      lastBirths:this._lastBirths, lastDeaths:this._lastDeaths };
  }

  fromJSON(s) {
    this.reset();
    if (!s) return;
    this.ticks = s.ticks || []; this.series = s.series || this.series; this.last = s.last || null;
    this.speciesHistory = new Map(s.speciesHistory || []); this.speciesMeta = new Map(s.speciesMeta || []);
    this.historyTicks = s.historyTicks || []; this.fullSpeciesHistory = new Map(s.fullSpeciesHistory || []); this.fullSpeciesMeta = new Map(s.fullSpeciesMeta || []);
    this._lastBirths = s.lastBirths || 0; this._lastDeaths = s.lastDeaths || 0;
  }
}

export { SERIES };
