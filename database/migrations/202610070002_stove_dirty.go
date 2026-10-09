package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		stoves, err := app.FindCollectionByNameOrId("player_stoves")
		if err != nil {
			return err
		}
		// Taking a dish to the counter or throwing it away leaves the stove dirty until the chef cleans it.
		stoves.Fields.Add(&core.BoolField{Name: "dirty"})
		return app.Save(stoves)
	}, nil)
}
