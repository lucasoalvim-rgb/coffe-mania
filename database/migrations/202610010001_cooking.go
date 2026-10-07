package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		stoves := core.NewBaseCollection("player_stoves")
		// Only custom authenticated routes may expose or mutate owned instances.
		stoves.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.NumberField{Name: "item_id", Required: true, OnlyInt: true},
			&core.NumberField{Name: "tx", Required: true, OnlyInt: true},
			&core.NumberField{Name: "ty", Required: true, OnlyInt: true},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		stoves.AddIndex("idx_player_stoves_location", true, "user, tx, ty", "")
		if err := app.Save(stoves); err != nil {
			return err
		}

		jobs := core.NewBaseCollection("stove_cooking")
		jobs.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "stove", CollectionId: stoves.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "recipe_id", Required: true, Max: 40},
			&core.DateField{Name: "started_at", Required: true},
			&core.DateField{Name: "ready_at", Required: true},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		// A finished dish keeps the stove occupied until a future collect action.
		jobs.AddIndex("idx_stove_cooking_stove", true, "stove", "")
		if err := app.Save(jobs); err != nil {
			return err
		}

		settings := app.Settings()
		settings.RateLimits.Rules = append(settings.RateLimits.Rules, core.RateLimitRule{
			Label: "/api/coffe/cooking/start", MaxRequests: 10, Duration: 60,
		})
		return app.Save(settings)
	}, nil)
}
