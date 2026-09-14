// Uniform spatial hash for fast neighbour queries on a toroidal world.
// Rebuilt every tick (O(n)); queries visit only nearby cells and wrap at edges.
// Stores integer ids; the caller maps ids back to entities and computes the
// true wrapped distance to filter candidates.

export class SpatialGrid {
  constructor(width, height, cellSize) {
    this.width = width;
    this.height = height;
    this.cell = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  }

  clear() {
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i].length = 0;
  }

  _index(x, y) {
    let cx = Math.floor(x / this.cell) % this.cols;
    let cy = Math.floor(y / this.cell) % this.rows;
    if (cx < 0) cx += this.cols;
    if (cy < 0) cy += this.rows;
    return cy * this.cols + cx;
  }

  insert(id, x, y) {
    this.buckets[this._index(x, y)].push(id);
  }

  /**
   * Invoke cb(id) for every entity in cells overlapping the radius around (x,y),
   * with toroidal wrap. cb receives candidate ids — verify the real distance
   * yourself.
   */
  queryRadius(x, y, r, cb) {
    const { cols, rows, cell } = this;
    const reach = Math.ceil(r / cell);
    let ccx = Math.floor(x / cell);
    let ccy = Math.floor(y / cell);
    // If the reach spans the whole grid, just scan everything once.
    if (reach * 2 + 1 >= cols || reach * 2 + 1 >= rows) {
      for (let i = 0; i < this.buckets.length; i++) {
        const b = this.buckets[i];
        for (let k = 0; k < b.length; k++) cb(b[k]);
      }
      return;
    }
    for (let dy = -reach; dy <= reach; dy++) {
      let gy = (ccy + dy) % rows;
      if (gy < 0) gy += rows;
      const rowBase = gy * cols;
      for (let dx = -reach; dx <= reach; dx++) {
        let gx = (ccx + dx) % cols;
        if (gx < 0) gx += cols;
        const b = this.buckets[rowBase + gx];
        for (let k = 0; k < b.length; k++) cb(b[k]);
      }
    }
  }
}
