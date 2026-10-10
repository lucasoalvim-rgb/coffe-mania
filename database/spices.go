package main

import (
	"database/sql"
	"errors"
	"time"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/recipecatalog"
	"github.com/pocketbase/dbx"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Comprar debita caféGranas e guarda uma unidade privada; aplicar consome essa unidade.
// Efeitos e preços registram suas fontes no catálogo enviado pelo servidor.
type spice struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Granas       int64  `json:"granas"`
	Effect       string `json:"effect"`
	Shortcut     int64  `json:"shortcutSeconds,omitempty"`
	BonusPercent int    `json:"bonusPercent,omitempty"`
	Source       string `json:"source"`
}

var spices = []spice{
	{ID: "salt", Name: "Sal Turbinado", Granas: 1, Effect: "portions", BonusPercent: 6, Source: "Efeito: painel Temperos fornecido pelo responsável. Preço: balanceamento escolhido pelo responsável em 2026-10-09."},
	{ID: "pepper", Name: "Pimenta Poderosa", Granas: 2, Effect: "portions", BonusPercent: 12, Source: "Efeito: painel Temperos fornecido pelo responsável. Preço: balanceamento escolhido pelo responsável em 2026-10-09."},
	{ID: "thyme", Name: "Tomilho Acelerador", Granas: 1, Effect: "speed", Shortcut: 3600, Source: "Efeito: referência histórica de 2010-07-13 e painel fornecido. Preço: balanceamento preexistente do projeto."},
	{ID: "thyme_ultra", Name: "Tomilho Ultrarrápido", Granas: 3, Effect: "speed", Shortcut: 6 * 3600, Source: "Efeito: referência histórica de 2010-07-13 e painel fornecido. Preço: balanceamento preexistente do projeto."},
	{ID: "instant", Name: "Condimento Instantâneo", Granas: 5, Effect: "instant", Source: "Efeito: painel Temperos fornecido. Preço: balanceamento preexistente do projeto."},
	{ID: "sage", Name: "Sálvia Salvadora", Granas: 1, Effect: "recover", Source: "Efeito: painel Temperos fornecido. Preço: balanceamento preexistente do projeto."},
}

var errUnknownSpice = errors.New("Tempero inválido.")
var errAlreadySpiced = errors.New("Este prato já foi temperado.")
var errSpiceNotUsable = errors.New("Este tempero não serve para o prato neste momento.")
var errNoCash = errors.New("caféGranas insuficientes.")
var errNoSpice = errors.New("Você não tem este tempero no estoque.")
var errSpicePurchaseConflict = errors.New("Este pedido já foi usado para outro tempero.")
var errSpiceStockLimit = errors.New("O estoque deste tempero está cheio.")

const maxSpiceStock = 999999

func spiceInventory(state *core.Record) (map[string]int64, error) {
	stock := map[string]int64{}
	if err := state.UnmarshalJSONField("spice_inventory", &stock); err != nil {
		return nil, err
	}
	if stock == nil {
		stock = map[string]int64{}
	}
	return stock, nil
}

// Débito, unidade e recibo são atômicos. Repetir a mesma chave não compra novamente.
func purchaseSpice(app core.App, userID, spiceID, requestKey string) error {
	chosen, ok := spiceByID(spiceID)
	if !ok {
		return errUnknownSpice
	}
	if requestKey == "" || len(requestKey) > 80 {
		return errSpicePurchaseConflict
	}
	return app.RunInTransaction(func(tx core.App) error {
		receipt, err := tx.FindFirstRecordByFilter("spice_purchases", "user={:user} && request_key={:key}", dbx.Params{"user": userID, "key": requestKey})
		if err == nil {
			if receipt.GetString("spice") != spiceID {
				return errSpicePurchaseConflict
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		state, err := tx.FindFirstRecordByData(playerstate.Collection, "user", userID)
		if err != nil {
			return err
		}
		stock, err := spiceInventory(state)
		if err != nil {
			return err
		}
		if stock[spiceID] >= maxSpiceStock {
			return errSpiceStockLimit
		}
		if state.GetInt64("cash") < chosen.Granas {
			return errNoCash
		}
		stock[spiceID]++
		state.Set("cash", state.GetInt64("cash")-chosen.Granas)
		state.Set("spice_inventory", stock)
		if err := tx.Save(state); err != nil {
			return err
		}
		collection, err := tx.FindCollectionByNameOrId("spice_purchases")
		if err != nil {
			return err
		}
		receipt = core.NewRecord(collection)
		receipt.Load(map[string]any{"user": userID, "request_key": requestKey, "spice": spiceID})
		return tx.Save(receipt)
	})
}

func spiceByID(id string) (spice, bool) {
	for _, s := range spices {
		if s.ID == id {
			return s, true
		}
	}
	return spice{}, false
}

// Aplicar consome uma unidade privada e altera o prato na mesma transação.
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
		unit, inventoryErr := tx.FindFirstRecordByData("player_inventory", "stove_id", stoveID)
		if inventoryErr == nil && !unit.GetBool("placed") {
			return errStoveNotOwned
		}
		if inventoryErr != nil && !errors.Is(inventoryErr, sql.ErrNoRows) {
			return inventoryErr
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
		case "portions":
			if !at.Before(spoils) {
				return errSpiceNotUsable
			}
			recipe, ok := recipecatalog.ByID(job.GetString("recipe_id"))
			if !ok {
				return errUnknownRecipe
			}
			// Porções são inteiras: preserva a parte inteira do bônus, sem arredondar para cima.
			job.Set("bonus_portions", recipe.Portions*chosen.BonusPercent/100)
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
		stock, err := spiceInventory(state)
		if err != nil {
			return err
		}
		if stock[chosen.ID] <= 0 {
			return errNoSpice
		}
		stock[chosen.ID]--
		state.Set("spice_inventory", stock)
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
