package main

import (
	"errors"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Spices used on a stove, paid with caféGranas. Effects come from the original blog
// (2010-07-13): Tomilho Acelerador −1 h, Tomilho Ultrarrápido −6 h, Condimento Instantâneo
// ready at once, Sálvia Salvadora recovers a spoiled dish. Prices are not in the sources;
// these follow the reference clone.
type spice struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Granas   int64  `json:"granas"`
	Effect   string `json:"effect"`
	Shortcut int64  `json:"shortcutSeconds,omitempty"`
}

var spices = []spice{
	{ID: "thyme", Name: "Tomilho Acelerador", Granas: 1, Effect: "speed", Shortcut: 3600},
	{ID: "thyme_ultra", Name: "Tomilho Ultrarrápido", Granas: 3, Effect: "speed", Shortcut: 6 * 3600},
	{ID: "instant", Name: "Condimento Instantâneo", Granas: 5, Effect: "instant"},
	{ID: "sage", Name: "Sálvia Salvadora", Granas: 1, Effect: "recover"},
}

var errUnknownSpice = errors.New("Tempero inválido.")
var errAlreadySpiced = errors.New("Este prato já foi temperado.")
var errSpiceNotUsable = errors.New("Este tempero não serve para o prato neste momento.")
var errNoCash = errors.New("caféGranas insuficientes.")

func spiceByID(id string) (spice, bool) {
	for _, s := range spices {
		if s.ID == id {
			return s, true
		}
	}
	return spice{}, false
}

// spiceDish applies one spice to the dish on a stove and charges its caféGranas.
func spiceDish(app core.App, userID, stoveID, spiceID string, now types.DateTime) error {
	chosen, ok := spiceByID(spiceID)
	if !ok {
		return errUnknownSpice
	}
	return app.RunInTransaction(func(tx core.App) error {
		stove, err := tx.FindRecordById("player_stoves", stoveID)
		if err != nil || stove.GetString("user") != userID {
			return errStoveNotOwned
		}
		job, err := tx.FindFirstRecordByData("stove_cooking", "stove", stoveID)
		if err != nil || job.GetString("user") != userID {
			return errCookingCannotCancel
		}
		if job.GetString("spice") != "" {
			return errAlreadySpiced
		}
		ready, spoils := job.GetDateTime("ready_at").Time(), jobSpoilsAt(job).Time()
		at := now.Time()
		var shift time.Duration
		switch chosen.Effect {
		case "speed", "instant":
			if !at.Before(ready) {
				return errSpiceNotUsable
			}
			shift = ready.Sub(at)
			if chosen.Effect == "speed" {
				shift = min(shift, time.Duration(chosen.Shortcut)*time.Second)
			}
		case "recover":
			if at.Before(spoils) {
				return errSpiceNotUsable
			}
			// The dish is ready again from now, with a fresh validity window.
			shift = ready.Sub(at)
		}
		state, err := tx.FindFirstRecordByData("player_state", "user", userID)
		if err != nil {
			return err
		}
		if state.GetInt64("cash") < chosen.Granas {
			return errNoCash
		}
		state.Set("cash", state.GetInt64("cash")-chosen.Granas)
		if err := tx.Save(state); err != nil {
			return err
		}
		for _, field := range []string{"preparing_at", "started_at", "ready_at"} {
			if value := job.GetDateTime(field); !value.IsZero() {
				job.Set(field, value.Add(-shift))
			}
		}
		job.Set("spice", chosen.ID)
		return tx.Save(job)
	})
}
