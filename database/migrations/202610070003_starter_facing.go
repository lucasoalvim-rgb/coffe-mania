package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		// The starter stove and counter now have distinct front and back art. Units still in their
		// starter tile with the old starter rotation turn to face the dining room; moved ones are kept.
		rows, err := app.FindRecordsByFilter("player_inventory",
			"placed=true && rotation=3 && ((item_id=3070000 && tx=6 && ty=2) || (item_id=3020069 && tx=7 && ty=3))", "", 0, 0)
		if err != nil {
			return err
		}
		touched := map[string]bool{}
		for _, unit := range rows {
			unit.Set("rotation", 1)
			if err := app.Save(unit); err != nil {
				return err
			}
			touched[unit.GetString("user")] = true
		}
		for user := range touched {
			if _, err := app.DB().NewQuery("UPDATE player_rooms SET revision = revision + 1 WHERE user = {:user}").Bind(dbx.Params{"user": user}).Execute(); err != nil {
				return err
			}
		}
		return nil
	}, nil)
}
