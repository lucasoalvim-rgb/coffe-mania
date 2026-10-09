package gameruntime

import (
	"encoding/json"
	"strings"
	"time"

	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
	"github.com/google/uuid"
)

const servingDuration = 2 * time.Second
const emotionDuration = 6010 * time.Millisecond // NpcEmotion's animation, hold and fade.

type cookingJob struct {
	ID          string `json:"id"`
	RecipeID    string `json:"recipeId"`
	PreparingAt string `json:"preparingAt"`
	StartedAt   string `json:"startedAt"`
	ReadyAt     string `json:"readyAt"`
}

func (r *room) cookingJob(stoveID string) *cookingJob {
	var snapshot struct {
		Stoves []struct {
			ID      string      `json:"id"`
			Cooking *cookingJob `json:"cooking"`
		} `json:"stoves"`
	}
	if json.Unmarshal(r.world.Cooking, &snapshot) != nil {
		return nil
	}
	for _, stove := range snapshot.Stoves {
		if stove.ID == stoveID {
			return stove.Cooking
		}
	}
	return nil
}

func jobTime(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339Nano, strings.Replace(value, " ", "T", 1))
	return parsed
}

func (r *room) adjacentStove(a *entity, id string) (Unit, bool) {
	if a == nil || a.Move != nil || len(a.path) > 0 || a.ChairID != "" {
		return Unit{}, false
	}
	for _, u := range r.world.Units {
		item, ok := roomcatalog.ByID(u.ItemID)
		if !ok || !u.Placed || item.Kind != "stove" || u.StoveID != id {
			continue
		}
		for _, tile := range footprint(u) {
			if abs(a.X-tile.X)+abs(a.Y-tile.Y) == 1 {
				return u, true
			}
		}
	}
	return Unit{}, false
}

func (r *room) startStoveAction(a *entity, stove Unit, kind string, start time.Time, duration time.Duration) {
	// All supported cooking frames are diagonal views. Face the nearest burner tile.
	target := Tile{X: stove.X, Y: stove.Y}
	for _, tile := range footprint(stove) {
		if abs(a.X-tile.X)+abs(a.Y-tile.Y) == 1 {
			target = tile
			break
		}
	}
	a.Direction = direction(Tile{X: a.X, Y: a.Y}, target)
	a.State = kind
	a.Action = &gamewire.ActorAction{Kind: kind, StoveID: stove.StoveID, StartedAt: start.UnixMilli(), Duration: duration.Milliseconds()}
	a.due = time.UnixMilli(a.Action.StartedAt + a.Action.Duration)
}

func (r *room) startCookingAction(a *entity, stoveID string, now time.Time) {
	stove, ok := r.adjacentStove(a, stoveID)
	if !ok {
		return
	}
	start, duration := now, servingDuration
	if job := r.cookingJob(stoveID); job != nil {
		preparing, cooking := jobTime(job.PreparingAt), jobTime(job.StartedAt)
		if !preparing.IsZero() && cooking.After(preparing) {
			start, duration = preparing, cooking.Sub(preparing)
		}
	}
	r.startStoveAction(a, stove, "cooking", start, duration)
}

func (r *room) startServingAction(a *entity, stoveID string, now time.Time) string {
	stove, ok := r.adjacentStove(a, stoveID)
	if !ok {
		return "Aproxime seu personagem do fogão."
	}
	job := r.cookingJob(stoveID)
	if job == nil || jobTime(job.ReadyAt).IsZero() || now.Before(jobTime(job.ReadyAt)) {
		return "O prato ainda não está pronto."
	}
	if !r.counterAccepts(job.RecipeID) {
		return "Não há balcão livre para este prato."
	}
	r.startStoveAction(a, stove, "serving", now, servingDuration)
	return ""
}

// counterAccepts mirrors persistence: a dish goes to the counter that already holds its
// recipe, or to an empty counter.
func (r *room) counterAccepts(recipeID string) bool {
	held := map[string]string{}
	for _, food := range r.world.Foods {
		if food.Counter != "" {
			held[food.Counter] = food.Recipe
		}
	}
	for _, u := range r.world.Units {
		item, ok := roomcatalog.ByID(u.ItemID)
		if !ok || !u.Placed || item.Kind != "counter" {
			continue
		}
		if recipe, busy := held[u.ID]; !busy || recipe == recipeID {
			return true
		}
	}
	return false
}

// servingFood picks the counter dish with the most portions, spreading consumption.
// Dishes saved before counters existed are served first so they do not linger.
func (r *room) servingFood() int {
	best := -1
	for i, food := range r.world.Foods {
		if food.Counter == "" {
			return i
		}
		if best < 0 || food.Portions > r.world.Foods[best].Portions {
			best = i
		}
	}
	return best
}

func (r *room) startEmotion(a *entity, kind string, now time.Time) {
	if a.EmotionShown {
		return
	}
	a.EmotionShown = true
	a.Emotion = &gamewire.Emotion{ID: uuid.NewString(), Kind: kind, StartedAt: now.UnixMilli(), Duration: emotionDuration.Milliseconds()}
}
