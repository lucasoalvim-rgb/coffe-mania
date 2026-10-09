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
		// A stored stove keeps its last tile here, so the tile cannot be unique per user: the live
		// position and the placement rules belong to player_inventory.
		stoves.RemoveIndex("idx_player_stoves_location")
		stoves.AddIndex("idx_player_stoves_location", false, "user, tx, ty", "")
		return app.Save(stoves)
	}, nil)
}
