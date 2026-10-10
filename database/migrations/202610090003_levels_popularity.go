package migrations

import (
	"coffe-mania/database/playerstate"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		foods, err := app.FindCollectionByNameOrId("room_food")
		if err != nil {
			return err
		}
		// XP still owed by the dish on the counter, paid portion by portion as customers eat.
		// Rows from before this rule already paid their XP when cooking started, so they keep 0.
		min := float64(0)
		foods.Fields.Add(&core.NumberField{Name: "experience", OnlyInt: true, Min: &min})
		if err := app.Save(foods); err != nil {
			return err
		}
		collection, err := app.FindCollectionByNameOrId(playerstate.Collection)
		if err != nil {
			return err
		}
		// The level table from game-config goes to 260; the field was capped at 150.
		maxLevel := float64(playerstate.MaxLevel())
		if field, ok := collection.Fields.GetByName("level").(*core.NumberField); ok {
			field.Max = &maxLevel
		}
		if err := app.Save(collection); err != nil {
			return err
		}
		states, err := app.FindAllRecords(playerstate.Collection)
		if err != nil {
			return err
		}
		for _, state := range states {
			playerstate.NormalizeProgress(state)
			if err := app.Save(state); err != nil {
				return err
			}
		}
		return nil
	}, nil)
}
