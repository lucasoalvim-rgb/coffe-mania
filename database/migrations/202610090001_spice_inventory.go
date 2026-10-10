package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		state, err := app.FindCollectionByNameOrId("player_state")
		if err != nil {
			return err
		}
		// Estoque privado acompanha o snapshot/SSE existente, sem novas gravações do runtime.
		state.Fields.Add(&core.JSONField{Name: "spice_inventory", MaxSize: 1024})
		if err := app.Save(state); err != nil {
			return err
		}
		jobs, err := app.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		min := float64(0)
		jobs.Fields.Add(&core.NumberField{Name: "bonus_portions", OnlyInt: true, Min: &min})
		if err := app.Save(jobs); err != nil {
			return err
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		purchases := core.NewBaseCollection("spice_purchases")
		// As APIs genéricas permanecem fechadas; apenas a rota autenticada compra unidades.
		purchases.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "request_key", Required: true, Max: 80},
			&core.TextField{Name: "spice", Required: true, Max: 40},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		purchases.AddIndex("idx_spice_purchase_key", true, "user, request_key", "")
		return app.Save(purchases)
	}, nil)
}
