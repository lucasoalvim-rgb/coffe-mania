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
		// Optional for compatibility with jobs created before the two-phase timer.
		jobs.Fields.Add(&core.DateField{Name: "preparing_at"})
		return app.Save(jobs)
	}, nil)
}
