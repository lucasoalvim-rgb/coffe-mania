package migrations

import (
	"database/sql"
	"errors"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"os"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			collection = core.NewAuthCollection("users")
		}
		collection.ListRule = types.Pointer("id = @request.auth.id")
		collection.ViewRule = types.Pointer("id = @request.auth.id")
		collection.CreateRule = nil
		collection.UpdateRule = nil
		collection.DeleteRule = nil
		collection.ManageRule = nil
		// Users are provisioned by trusted administration; public mutations are disabled.
		collection.Fields.Add(&core.TextField{Name: "name", Max: 100})
		collection.Fields.GetByName("password").(*core.PasswordField).Min = 6
		collection.PasswordAuth.Enabled = true
		collection.PasswordAuth.IdentityFields = []string{"email"}
		collection.AuthToken.Duration = 7 * 24 * 60 * 60
		if err := app.Save(collection); err != nil {
			return err
		}
		settings := app.Settings()
		settings.RateLimits.Enabled = true
		settings.RateLimits.Rules = append([]core.RateLimitRule{{
			Label: "/api/coffe/session/login", MaxRequests: 20, Duration: 60,
		}}, settings.RateLimits.Rules...)
		if err := app.Save(settings); err != nil {
			return err
		}
		// The demo account is opt-in and only applies when a fresh database is migrated.
		if os.Getenv("COFFE_DEV_SEED") != "true" {
			return nil
		}
		if _, err := app.FindAuthRecordByEmail("users", "test@local.mail"); err == nil {
			return nil
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		record := core.NewRecord(collection)
		record.SetEmail("test@local.mail")
		record.SetPassword("123456")
		record.Set("name", "Desenvolvedor")
		record.SetVerified(true)
		return app.Save(record)
	}, nil)
}
