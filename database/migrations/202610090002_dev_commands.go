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
		collection := core.NewBaseCollection("dev_commands")
		// Private receipts make retries safe even across room-service restarts.
		collection.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "request_id", Required: true, Max: 64},
			&core.TextField{Name: "command", Required: true, Max: 2048},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		collection.AddIndex("idx_dev_commands_user_request", true, "user,request_id", "")
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("dev_commands")
		if err != nil {
			return err
		}
		return app.Delete(collection)
	})
}
