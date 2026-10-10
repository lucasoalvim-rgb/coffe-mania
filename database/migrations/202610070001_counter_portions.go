package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		foods, err := app.FindCollectionByNameOrId("room_food")
		if err != nil {
			return err
		}
		// A counter keeps one recipe with N portions; serving the same recipe adds to it.
		// Rows created before counters have no counter and count as a single portion.
		min := 0.0
		foods.Fields.Add(
			&core.TextField{Name: "counter", Max: 40},
			&core.NumberField{Name: "portions", OnlyInt: true, Min: &min},
		)
		return app.Save(foods)
	}, nil)
}
