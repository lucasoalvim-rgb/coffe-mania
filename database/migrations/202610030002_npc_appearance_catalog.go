package migrations

import (
	"coffe-mania/database/npcappearance"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection := core.NewBaseCollection(npcappearance.Collection)
		// All REST collection rules stay locked. Players receive a compact snapshot
		// through the cookie-authenticated game route; only admins edit eligibility.
		min, max := float64(1), float64(9007199254740991)
		collection.Fields.Add(
			&core.NumberField{Name: "item_id", Required: true, OnlyInt: true, Min: &min, Max: &max},
			&core.TextField{Name: "name", Required: true, Max: 128},
			&core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{"item", "skin_colour", "hair_colour"}},
			&core.TextField{Name: "slot", Required: true, Max: 64},
			&core.TextField{Name: "colour", Max: 7, Pattern: `^#[0-9a-fA-F]{6}$`},
			&core.BoolField{Name: "enabled", Help: "Permitir esta peça/cor nos visuais aleatórios dos NPCs."},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		collection.AddIndex("idx_npc_appearance_item", true, "item_id", "")
		if err := app.Save(collection); err != nil {
			return err
		}
		entries, err := npcappearance.Entries()
		if err != nil {
			return err
		}
		for _, entry := range entries {
			record := core.NewRecord(collection)
			record.Set("item_id", entry.ItemID)
			record.Set("name", entry.Name)
			record.Set("kind", entry.Kind)
			record.Set("slot", entry.Slot)
			record.Set("colour", entry.Colour)
			record.Set("enabled", true)
			if err := app.Save(record); err != nil {
				return err
			}
		}
		return nil
	}, nil)
}
