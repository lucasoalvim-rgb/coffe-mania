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
		rooms, err := app.FindCollectionByNameOrId("player_rooms")
		if err != nil {
			return err
		}
		rooms.Fields.Add(&core.BoolField{Name: "active"}, &core.NumberField{Name: "human_count", OnlyInt: true}, &core.DateField{Name: "last_active"})
		if err = app.Save(rooms); err != nil {
			return err
		}
		for _, name := range []string{"room_npcs", "room_food"} {
			c := core.NewBaseCollection(name)
			c.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
			c.AddIndex("idx_"+name+"_owner", false, "user", "")
			if name == "room_npcs" {
				c.Fields.Add(&core.TextField{Name: "npc_id", Required: true, Max: 80}, &core.JSONField{Name: "state", Required: true, MaxSize: 65536})
				c.AddIndex("idx_room_npc_identity", true, "npc_id", "")
			} else {
				c.Fields.Add(&core.TextField{Name: "recipe_id", Required: true}, &core.TextField{Name: "job_id", Required: true}, &core.AutodateField{Name: "created", OnCreate: true})
				c.AddIndex("idx_room_food_job", true, "job_id", "")
			}
			if err = app.Save(c); err != nil {
				return err
			}
		}
		return nil
	}, nil)
}
