package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		jobs, err := app.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		// Each dish takes a single spice, as in the original FAQ; empty means not spiced.
		jobs.Fields.Add(&core.TextField{Name: "spice", Max: 40})
		return app.Save(jobs)
	}, nil)
}
