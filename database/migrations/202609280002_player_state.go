package migrations

import (
	"coffe-mania/database/playerstate"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		collection := core.NewBaseCollection(playerstate.Collection)
		collection.ListRule = types.Pointer("@request.auth.id != '' && user = @request.auth.id")
		collection.ViewRule = types.Pointer("@request.auth.id != '' && user = @request.auth.id")
		// Players may read their own snapshot but cannot grant themselves currency.
		collection.CreateRule = nil
		collection.UpdateRule = nil
		collection.DeleteRule = nil
		collection.Fields.Add(&core.RelationField{
			Name: "user", CollectionId: users.Id, Required: true,
			MaxSelect: 1, CascadeDelete: true,
		})
		collection.AddIndex("idx_player_state_user", true, "user", "")
		for _, name := range []string{
			"cash", "gold", "level", "experience_current", "experience_max",
			"energy_current", "energy_max", "crates_current", "crates_max",
			"satisfaction_current_tenths", "satisfaction_max_tenths",
		} {
			min, max := float64(0), float64(9007199254740991) // JS safe-integer ceiling.
			if name == "level" {
				min, max = 1, 150
			} else if name == "experience_max" || name == "energy_max" || name == "crates_max" || name == "satisfaction_max_tenths" {
				min = 1
			}
			collection.Fields.Add(&core.NumberField{Name: name, OnlyInt: true, Min: &min, Max: &max})
		}
		collection.Fields.Add(
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		if err := app.Save(collection); err != nil {
			return err
		}
		// Paginate the backfill, so introducing this collection never loads all
		// accounts into memory. Later accounts are provisioned on first game entry.
		for offset := 0; ; offset += 200 {
			players, err := app.FindRecordsByFilter("users", "", "id", 200, offset)
			if err != nil {
				return err
			}
			for _, player := range players {
				if err := app.Save(playerstate.NewRecord(collection, player.Id)); err != nil {
					return err
				}
			}
			if len(players) < 200 {
				return nil
			}
		}
	}, nil)
}
