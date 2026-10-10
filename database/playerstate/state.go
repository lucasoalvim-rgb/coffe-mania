// Package playerstate owns the persisted HUD snapshot. Percentages and emotion
// frames are presentation data and deliberately aren't stored in SQLite.
package playerstate

import (
	"database/sql"
	"errors"

	"coffe-mania/database/appearance"

	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
)

const Collection = "player_state"
const DefaultCafeName = "Coffe Mania"

type Resource struct {
	Current float64 `json:"current"`
	Maximum float64 `json:"maximum"`
	// Minimum is where the bar starts; experience is cumulative, so its bar starts at
	// the current level's requirement.
	Minimum float64 `json:"minimum,omitempty"`
}

type Snapshot struct {
	SpiceInventory map[string]int64 `json:"spiceInventory"`
	Appearance     string           `json:"appearance"`
	CafeName       string           `json:"cafeName"`
	Cash           int64            `json:"cash"`
	Gold           int64            `json:"gold"`
	Level          int              `json:"level"`
	Experience     Resource         `json:"experience"`
	Energy         Resource         `json:"energy"`
	Crates         Resource         `json:"crates"`
	Satisfaction   Resource         `json:"satisfaction"`
}

// Initial resources for newly provisioned players.
func NewRecord(collection *core.Collection, userID string) *core.Record {
	record := core.NewRecord(collection)
	record.Load(map[string]any{
		"cafe_name": DefaultCafeName,
		"user":      userID, "cash": 1000, "gold": 100, "level": 1,
		"experience_current": 0, "experience_max": RequiredXP(2),
		"energy_current": 50, "energy_max": 50,
		"crates_current": 4, "crates_max": 4,
		"satisfaction_current_tenths": DefaultPopularityTenths, "satisfaction_max_tenths": MaxPopularityTenths,
	})
	return record
}

func View(record *core.Record) Snapshot {
	stock := map[string]int64{}
	_ = record.UnmarshalJSONField("spice_inventory", &stock)
	if stock == nil {
		stock = map[string]int64{}
	}
	resource := func(current, maximum string, divisor float64) Resource {
		return Resource{Current: record.GetFloat(current) / divisor, Maximum: record.GetFloat(maximum) / divisor}
	}
	experience := resource("experience_current", "experience_max", 1)
	level := record.GetInt("level")
	experience.Minimum = float64(RequiredXP(min(level, MaxLevel()-1)))
	return Snapshot{
		SpiceInventory: stock,
		Appearance:     record.GetString("appearance"),
		CafeName:       record.GetString("cafe_name"),
		Cash:           record.GetInt64("cash"), Gold: record.GetInt64("gold"), Level: record.GetInt("level"),
		Experience:   experience,
		Energy:       resource("energy_current", "energy_max", 1),
		Crates:       resource("crates_current", "crates_max", 1),
		Satisfaction: resource("satisfaction_current_tenths", "satisfaction_max_tenths", 10),
	}
}

// Existing players cost one indexed lookup; new accounts are provisioned once.
// Recheck inside the transaction so simultaneous tabs cannot create duplicates.
func GetOrCreate(app core.App, userID string) (*core.Record, error) {
	record, err := app.FindFirstRecordByData(Collection, "user", userID)
	if err == nil || !errors.Is(err, sql.ErrNoRows) {
		return record, err
	}
	err = app.RunInTransaction(func(txApp core.App) error {
		record, err = txApp.FindFirstRecordByData(Collection, "user", userID)
		if err == nil || !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		collection, err := txApp.FindCollectionByNameOrId(Collection)
		if err != nil {
			return err
		}
		record = NewRecord(collection, userID)
		return txApp.Save(record)
	})
	return record, err
}

// Field validation enforces integers/nonnegative values; these cross-field
// constraints also apply to trusted server code and dashboard edits.
func RegisterValidation(app core.App) {
	app.OnRecordValidate(Collection).BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		problems := validation.Errors{}
		if e.Record.GetFloat("energy_max") <= 0 {
			problems["energy_max"] = validation.NewError("invalid_energy_capacity", "A capacidade de energia deve ser positiva.")
		}
		if value := e.Record.GetString("appearance"); value != "" {
			if _, err := appearance.Validate(value); err != nil {
				problems["appearance"] = validation.NewError("invalid_appearance", "Visual inválido.")
			}
		}
		// Energy can exceed its normal capacity after grants/events. Its field
		// still enforces a nonnegative safe integer; other resources retain their caps.
		for _, pair := range [][2]string{
			{"experience_current", "experience_max"},
			{"crates_current", "crates_max"},
			{"satisfaction_current_tenths", "satisfaction_max_tenths"},
		} {
			if e.Record.GetFloat(pair[0]) > e.Record.GetFloat(pair[1]) {
				problems[pair[0]] = validation.NewError("current_exceeds_maximum", "O valor atual não pode superar o máximo.")
			}
		}
		if len(problems) > 0 {
			return problems
		}
		return nil
	})
}
