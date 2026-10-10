package gameruntime

import (
	"context"
	"math/rand/v2"
	"time"

	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
)

// Customers per minute from <clientFrequency> in ripped/game-config.xml.txt. Each band
// starts at its popularity; the scale matches the engine's own rule (0.05 customer per
// minute per demand tenth, 6 per minute for a new restaurant). The level rows are read as
// an additive bonus where only the highest band reached applies; the file does not say.
var popularityFrequency = []struct{ popularity, perMinute int64 }{
	{5, 5}, {15, 7}, {25, 10}, {35, 13}, {45, 15}, {55, 16}, {65, 17}, {75, 19}, {85, 22}, {95, 25},
}
var levelFrequency = []struct {
	level     int
	perMinute int64
}{{10, 2}, {30, 3}}

func customersPerMinute(business gamewire.Business) int64 {
	perMinute := popularityFrequency[0].perMinute
	for _, band := range popularityFrequency {
		if business.Popularity >= band.popularity*10 {
			perMinute = band.perMinute
		}
	}
	bonus := int64(0)
	for _, band := range levelFrequency {
		if business.Level >= band.level {
			bonus = band.perMinute
		}
	}
	return perMinute + bonus
}

// A seated customer checks the counters every two seconds and gives up after 30 s.
// The engine's WAITING_FOR_FOOD_TIME (Customer.as, 120 s) covers a chef cooking the
// order; here nobody brings a dish to an empty counter, so a long wait only blocks the
// chair while newcomers leave unhappy. The value is a design choice, not from the sources.
const (
	customerFoodWait  = 30 * time.Second
	customerFoodCheck = 2 * time.Second
)

// nextFoodCheck keeps the two-second cadence from the previous check, so tick rounding
// does not stretch the wait; a check overdue after dormancy runs on the next tick.
func nextFoodCheck(previous, now time.Time) time.Time {
	next := previous.Add(customerFoodCheck)
	if next.Before(now) {
		return now
	}
	return next
}

// customerInterval spreads arrivals by up to 20% so customers do not march in lockstep.
func customerInterval(business gamewire.Business) time.Duration {
	base := time.Minute / time.Duration(customersPerMinute(business))
	return time.Duration(float64(base) * (0.8 + 0.4*rand.Float64()))
}

// customerCap keeps one customer looking for a seat beyond the chairs, so a full café
// still turns customers away (and loses popularity) instead of filling the floor.
func (r *room) customerCap() int {
	chairs := 0
	for _, u := range r.world.Units {
		if item, ok := roomcatalog.ByID(u.ItemID); ok && u.Placed && item.Kind == "chair" {
			chairs++
		}
	}
	return min(r.manager.options.MaxNPCs, chairs+1)
}

// judge records a leaving customer's verdict once. Served customers already counted as
// satisfied when they ate; the rest leave unhappy and cost popularity.
func (r *room) judge(a *entity, now time.Time) {
	if a.Judged {
		return
	}
	a.Judged = true
	if a.Ate {
		return
	}
	r.startEmotion(a, "dissatisfied", now)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if business, err := r.manager.store.Dissatisfied(ctx, r.id); err == nil {
		r.business = business
	}
}

// Developer commands for customers. Removed customers leave no verdict.
func (r *room) spawnCustomers(count int, now time.Time) {
	for range count {
		r.spawnNPC(now)
	}
	r.spawnAt = now.Add(customerInterval(r.business))
}

func (r *room) clearCustomers() {
	removed := []string{}
	for id, a := range r.actors {
		if a.Kind != "npc" {
			continue
		}
		r.releaseSeat(a)
		delete(r.actors, id)
		r.unindexActor(id)
		removed = append(removed, id)
	}
	if len(removed) > 0 {
		r.broadcast(gamewire.Event{Type: "actors", Removed: removed}, "")
	}
}

// Customers that cannot move escalate on their own: after npcGhostAfter without a single
// step they walk through the others; after npcGiveUpAfter they leave. Only furniture can
// trap them for that long (a boxed-in chair or a sealed corner), and the room is not
// theirs to rearrange.
const (
	npcGhostAfter  = 3 * time.Second
	npcGiveUpAfter = 20 * time.Second
)

func (r *room) noteStuck(a *entity, now time.Time) {
	if a.Kind == "npc" && a.stuckSince.IsZero() {
		a.stuckSince = now
	}
}

func (r *room) mayGhost(a *entity, now time.Time) bool {
	return a.Kind == "npc" && !a.stuckSince.IsZero() && now.Sub(a.stuckSince) >= npcGhostAfter
}

func (r *room) gaveUp(a *entity, now time.Time) bool {
	return !a.stuckSince.IsZero() && now.Sub(a.stuckSince) >= npcGiveUpAfter
}

// reachableTiles floods the floor from a tile through furniture only, with the same
// corner rule as findPath, so wandering never targets a tile the customer cannot reach.
func (r *room) reachableTiles(start Tile) map[Tile]bool {
	seen := map[Tile]bool{start: true}
	queue := []Tile{start}
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		for _, d := range neighbours {
			t := Tile{X: n.X + d.X, Y: n.Y + d.Y}
			if seen[t] || !r.grid.walkable(t) {
				continue
			}
			if d.X != 0 && d.Y != 0 && !r.grid.walkable(Tile{X: n.X + d.X, Y: n.Y}) && !r.grid.walkable(Tile{X: n.X, Y: n.Y + d.Y}) {
				continue
			}
			seen[t] = true
			queue = append(queue, t)
		}
	}
	return seen
}
