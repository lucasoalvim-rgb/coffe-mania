package migrations

import (
	"coffe-mania/database/playerstate"
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
			Name: "appearance", Max: 4096,
			Help: "Visual do jogador em JSON versionado: IDs das peças, cor da pele e do cabelo. Vazio usa o visual padrão.",
		})
		// The existing write rules stay locked: players save only through the dedicated endpoint.
		return app.Save(collection)
	}, nil)
}
