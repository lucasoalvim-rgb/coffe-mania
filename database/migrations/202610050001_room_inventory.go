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
		for _, name := range []string{"player_rooms", "player_inventory", "room_operations"} {
			collection := core.NewBaseCollection(name)
			// All reads and writes go through cookie-authenticated, owner-scoped routes.
			collection.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
			collection.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
			switch name {
			case "player_rooms":
				for _, field := range []string{"revision", "tiles_x", "tiles_y"} {
					collection.Fields.Add(&core.NumberField{Name: field, OnlyInt: true})
				}
				collection.AddIndex("idx_rooms_owner", true, "user", "")
			case "player_inventory":
				for _, field := range []string{"item_id", "tx", "ty", "rotation"} {
					collection.Fields.Add(&core.NumberField{Name: field, OnlyInt: true})
				}
				collection.Fields.Add(&core.BoolField{Name: "placed"}, &core.TextField{Name: "layer", Required: true}, &core.TextField{Name: "stove_id"})
				collection.AddIndex("idx_inventory_owner", false, "user", "")
				collection.AddIndex("idx_inventory_position", true, "user, layer, tx, ty", "placed = true")
			case "room_operations":
				collection.Fields.Add(&core.TextField{Name: "request_key", Required: true, Max: 80}, &core.TextField{Name: "payload", Required: true, Max: 2048})
				collection.AddIndex("idx_room_operation_key", true, "user, request_key", "")
			}
			if err := app.Save(collection); err != nil {
				return err
			}
		}
		return nil
	}, nil)
}
