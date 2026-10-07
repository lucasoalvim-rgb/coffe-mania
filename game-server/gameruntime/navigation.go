package gameruntime

import (
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
	"container/heap"
)

type Tile = gamewire.Tile
type Unit = gamewire.Unit
type grid struct {
	width, height int
	objects       map[Tile][]Unit
	blocked       map[Tile]bool
	doors         map[Tile]bool
}

func footprint(u Unit) []Tile {
	item, ok := roomcatalog.ByID(u.ItemID)
	if !ok {
		return nil
	}
	sx, sy := item.SizeX, item.SizeY
	if u.Rotation%2 == 1 {
		sx, sy = sy, sx
	}
	if item.Kind == "door" {
		sx, sy = 1, 1
	}
	result := make([]Tile, 0, sx*sy)
	for y := 0; y < sy; y++ {
		for x := 0; x < sx; x++ {
			result = append(result, Tile{X: u.X + x, Y: u.Y + y})
		}
	}
	return result
}
func newGrid(w gamewire.World) *grid {
	g := &grid{w.TilesX, w.TilesY, map[Tile][]Unit{}, map[Tile]bool{}, map[Tile]bool{}}
	for _, u := range w.Units {
		g.add(u)
	}
	return g
}
func (g *grid) add(u Unit) {
	if !u.Placed {
		return
	}
	item, ok := roomcatalog.ByID(u.ItemID)
	if !ok {
		return
	}
	if item.Type < 2 {
		return
	}
	for _, t := range footprint(u) {
		g.objects[t] = append(g.objects[t], u)
		if item.Kind != "door" {
			g.blocked[t] = true
		}
	}
	if item.Kind == "door" {
		g.doors[Tile{X: u.X, Y: u.Y}] = true
		g.doors[opening(u)] = true
	}
}

// Furniture edits touch their footprint; they do not scan the map for every step.
func (g *grid) remove(u Unit) {
	item, _ := roomcatalog.ByID(u.ItemID)
	for _, t := range footprint(u) {
		list := g.objects[t]
		next := list[:0]
		for _, v := range list {
			if v.ID != u.ID {
				next = append(next, v)
			}
		}
		if len(next) == 0 {
			delete(g.objects, t)
		} else {
			g.objects[t] = next
		}
		delete(g.blocked, t)
		for _, v := range next {
			it, _ := roomcatalog.ByID(v.ItemID)
			if it.Kind != "door" {
				g.blocked[t] = true
			}
		}
	}
	if item.Kind == "door" {
		delete(g.doors, Tile{X: u.X, Y: u.Y})
		delete(g.doors, opening(u))
	}
}
func opening(u Unit) Tile {
	if u.Rotation%2 == 0 {
		return Tile{X: 0, Y: u.Y}
	}
	return Tile{X: u.X, Y: 0}
}
func (g *grid) inside(t Tile) bool { return t.X >= 0 && t.Y >= 0 && t.X < g.width && t.Y < g.height }
func (g *grid) walkable(t Tile) bool {
	return g.inside(t) && (g.doors[t] || (t.X > 0 && t.Y > 0 && !g.blocked[t]))
}
func (g *grid) door() (Unit, bool) {
	for _, list := range g.objects {
		for _, u := range list {
			it, _ := roomcatalog.ByID(u.ItemID)
			if it.Kind == "door" {
				return u, true
			}
		}
	}
	return Unit{}, false
}

type pathNode struct {
	tile        Tile
	cost, score int
}
type pathHeap []pathNode

func (h pathHeap) Len() int           { return len(h) }
func (h pathHeap) Less(i, j int) bool { return h[i].score < h[j].score }
func (h pathHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pathHeap) Push(x any)        { *h = append(*h, x.(pathNode)) }
func (h *pathHeap) Pop() any          { old := *h; x := old[len(old)-1]; *h = old[:len(old)-1]; return x }
func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

var neighbours = []Tile{{X: 1, Y: 0}, {X: 0, Y: 1}, {X: -1, Y: 0}, {X: 0, Y: -1}, {X: 1, Y: 1}, {X: -1, Y: 1}, {X: 1, Y: -1}, {X: -1, Y: -1}}

func findPath(start, dest Tile, walk func(Tile) bool, max int) []Tile {
	if start == dest {
		return []Tile{}
	}
	if !walk(dest) {
		return nil
	}
	heuristic := func(t Tile) int { dx, dy := abs(t.X-dest.X), abs(t.Y-dest.Y); return 10*(dx+dy) - 6*min(dx, dy) }
	open := &pathHeap{{start, 0, heuristic(start)}}
	heap.Init(open)
	costs := map[Tile]int{start: 0}
	parents := map[Tile]Tile{}
	for visited := 0; open.Len() > 0 && visited < max; visited++ {
		n := heap.Pop(open).(pathNode)
		if costs[n.tile] != n.cost {
			continue
		}
		if n.tile == dest {
			path := []Tile{}
			for t := dest; t != start; t = parents[t] {
				path = append(path, t)
			}
			for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
				path[i], path[j] = path[j], path[i]
			}
			return path
		}
		for _, d := range neighbours {
			t := Tile{X: n.tile.X + d.X, Y: n.tile.Y + d.Y}
			if !walk(t) {
				continue
			}
			step := 10
			if d.X != 0 && d.Y != 0 {
				if !walk(Tile{X: n.tile.X + d.X, Y: n.tile.Y}) && !walk(Tile{X: n.tile.X, Y: n.tile.Y + d.Y}) {
					continue
				}
				step = 14
			}
			c := n.cost + step
			if old, ok := costs[t]; ok && old <= c {
				continue
			}
			costs[t] = c
			parents[t] = n.tile
			heap.Push(open, pathNode{t, c, c + heuristic(t)})
		}
	}
	return nil
}
func direction(from, to Tile) int {
	dx, dy := to.X-from.X, to.Y-from.Y
	// Avatar direction is determined by projected screen deltas, matching iso.ts.
	sx, sy := dx-dy, dx+dy
	switch {
	case sx > 0 && sy == 0:
		return 2
	case sx > 0 && sy > 0:
		return 1
	case sx == 0 && sy > 0:
		return 0
	case sx < 0 && sy > 0:
		return 7
	case sx < 0 && sy == 0:
		return 6
	case sx < 0 && sy < 0:
		return 5
	case sx == 0 && sy < 0:
		return 4
	default:
		return 3
	}
}
