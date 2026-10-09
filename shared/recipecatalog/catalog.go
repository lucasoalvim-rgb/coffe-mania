// Package recipecatalog embeds the recipe book shared by persistence and the room service.
// The source of truth is game/public/assets/foods/<id>/recipe.json; npm run assets:room syncs it.
package recipecatalog

import (
	"embed"
	"encoding/json"
	"time"
)

//go:embed catalog.json
var files embed.FS

type Recipe struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Level           int    `json:"level"`
	DurationSeconds int64  `json:"durationSeconds"`
	Portions        int    `json:"portions"`
	ProfitGold      int64  `json:"profitGold"`
	CostGold        int64  `json:"costGold"`
	XP              int64  `json:"xp"`
	// Only book recipes may start a new dish; the others exist so saved jobs and portions still resolve.
	InBook bool `json:"inBook"`
}

func (r Recipe) Duration() time.Duration { return time.Duration(r.DurationSeconds) * time.Second }

var Recipes []Recipe

func init() {
	data, err := files.ReadFile("catalog.json")
	if err != nil {
		panic(err)
	}
	var catalog struct {
		Recipes []Recipe `json:"recipes"`
	}
	if err := json.Unmarshal(data, &catalog); err != nil {
		panic(err)
	}
	Recipes = catalog.Recipes
	seen := map[string]bool{}
	for _, r := range Recipes {
		if seen[r.ID] || r.ID == "" || len(r.ID) > 40 || r.Name == "" || r.Level < 1 || r.DurationSeconds < 1 || r.Portions < 1 ||
			r.ProfitGold < 0 || r.CostGold < 0 || r.XP < 0 {
			panic("invalid recipe catalogue")
		}
		seen[r.ID] = true
	}
}

func ByID(id string) (Recipe, bool) {
	for _, r := range Recipes {
		if r.ID == id {
			return r, true
		}
	}
	return Recipe{}, false
}

// Cookable reports whether the recipe book offers this recipe for a new dish.
func Cookable(id string) (Recipe, bool) {
	r, ok := ByID(id)
	return r, ok && r.InBook
}
