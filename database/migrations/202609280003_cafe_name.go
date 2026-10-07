package migrations

import (
	"coffe-mania/database/playerstate"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId(playerstate.Collection)
		if err != nil {
			return err
		}
		collection.Fields.Add(&core.TextField{
			Name: "cafe_name", Required: true, Max: 80,
			Help: "Nome do café exibido abaixo da satisfação na barra do jogo.",
		})
		if err := app.Save(collection); err != nil {
			return err
		}
		// Backfill only the new empty field. Existing balances, timestamps and
		// any previously supplied names are preserved; this migration runs once.
		_, err = app.DB().NewQuery("UPDATE player_state SET cafe_name = {:name} WHERE cafe_name = ''").
			Bind(dbx.Params{"name": playerstate.DefaultCafeName}).Execute()
		return err
	}, nil)
}
