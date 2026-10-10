package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/recipecatalog"
	"coffe-mania/shared/roomcatalog"

	"github.com/google/uuid"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Developer tools exist only when the server opts in (the dev launcher does); the client
// toggle in Settings merely shows the panel.
func devToolsEnabled() bool { return os.Getenv("COFFE_DEV_TOOLS") == "true" }

type devCommand struct {
	RequestID string   `json:"requestId"`
	Command   string   `json:"command"`
	StoveID   string   `json:"stoveId,omitempty"`
	CounterID string   `json:"counterId,omitempty"`
	RecipeID  string   `json:"recipeId,omitempty"`
	Resource  string   `json:"resource,omitempty"`
	Mode      string   `json:"mode,omitempty"`
	Value     *float64 `json:"value,omitempty"`
}

type devSnapshot struct {
	PlayerState playerstate.Snapshot `json:"playerState"`
	Cooking     cookingSnapshot      `json:"cooking"`
	World       gamewire.World       `json:"world"`
	MaxLevel    int                  `json:"maxLevel"`
}

type devError struct {
	status  int
	message string
}

func (e *devError) Error() string     { return e.message }
func invalidDev(message string) error { return &devError{400, message} }

// Room-only commands change customers, which live in the room service; persistence only
// records their receipt.
var devRoomCommands = map[string]bool{"spawn_customers": true, "clear_customers": true}

func decodeDevCommand(reader io.Reader) (devCommand, error) {
	var command devCommand
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&command) != nil || decoder.Decode(new(any)) != io.EOF {
		return command, invalidDev("Pedido inválido.")
	}
	if _, err := uuid.Parse(command.RequestID); err != nil {
		return command, invalidDev("Identificador inválido.")
	}
	if command.Value != nil && (math.IsNaN(*command.Value) || math.IsInf(*command.Value, 0) || math.Abs(*command.Value) > 1e9) {
		return command, invalidDev("Valor inválido (limite de um bilhão por comando).")
	}
	only := func(stove, counter, recipe, resource, value bool) bool {
		return (stove || command.StoveID == "") && (counter || command.CounterID == "") && (recipe || command.RecipeID == "") &&
			(resource || command.Resource == "" && command.Mode == "") && (value || command.Value == nil)
	}
	switch command.Command {
	case "resource":
		if !only(false, false, false, true, true) || command.Value == nil || (command.Mode != "set" && command.Mode != "add") {
			return command, invalidDev("Informe recurso, valor e operação.")
		}
	case "finish", "spoil", "clean", "dirty", "empty":
		if !only(true, false, false, false, false) {
			return command, invalidDev("Pedido de fogão inválido.")
		}
	case "clear_counters":
		if !only(false, true, false, false, false) {
			return command, invalidDev("Pedido de balcão inválido.")
		}
	case "add_food":
		if !only(false, false, true, false, true) || command.RecipeID == "" || command.Value != nil && (*command.Value < 1 || *command.Value > 100000 || *command.Value != math.Trunc(*command.Value)) {
			return command, invalidDev("Informe a receita e de 1 a 100.000 porções.")
		}
	case "spawn_customers":
		if !only(false, false, false, false, true) || command.Value == nil || *command.Value < 1 || *command.Value > 10 || *command.Value != math.Trunc(*command.Value) {
			return command, invalidDev("Informe de 1 a 10 clientes.")
		}
	case "refill", "clear_customers":
		if !only(false, false, false, false, false) {
			return command, invalidDev("Pedido inválido.")
		}
	default:
		return command, invalidDev("Comando de desenvolvimento desconhecido.")
	}
	return command, nil
}

func snapshotDev(app core.App, user string) (devSnapshot, error) {
	state, err := playerstate.GetOrCreate(app, user)
	if err != nil {
		return devSnapshot{}, err
	}
	world, err := publicWorld(app, user)
	if err != nil {
		return devSnapshot{}, err
	}
	var cooking cookingSnapshot
	if err := json.Unmarshal(world.Cooking, &cooking); err != nil {
		return devSnapshot{}, err
	}
	return devSnapshot{PlayerState: playerstate.View(state), Cooking: cooking, World: world, MaxLevel: playerstate.MaxLevel()}, nil
}

func registerDevRoutes(e *core.ServeEvent) {
	group := e.Router.Group("/api/coffe/dev")
	group.BindFunc(func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		if sessionRecord(r) == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		if !devToolsEnabled() {
			return r.ForbiddenError("O servidor não habilitou as ferramentas de desenvolvimento.", nil)
		}
		return r.Next()
	})
	group.GET("", func(r *core.RequestEvent) error {
		snapshot, err := snapshotDev(r.App, sessionRecord(r).Id)
		if err != nil {
			return r.InternalServerError("Não foi possível carregar o diagnóstico.", err)
		}
		return r.JSON(http.StatusOK, snapshot)
	})
	// Commands go through the room service, so its queue orders them with the room's
	// own actions and it can stop animations that the change invalidated.
	group.POST("/command", func(r *core.RequestEvent) error {
		if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
			return r.BadRequestError("Envie JSON.", nil)
		}
		command, err := decodeDevCommand(r.Request.Body)
		if err != nil {
			return r.BadRequestError(err.Error(), nil)
		}
		return proxyRoomOperation(r, sessionRecord(r).Id, "dev", command)
	}).Bind(apis.BodyLimit(2048)).BindFunc(func(r *core.RequestEvent) error {
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
}

// mutateDev applies a command once per request id; a retried acknowledgement replays the
// receipt instead of adding currency twice.
func mutateDev(app core.App, user string, command devCommand) error {
	if !devToolsEnabled() {
		return &devError{403, "Ferramentas de desenvolvimento desabilitadas no servidor."}
	}
	data, _ := json.Marshal(command)
	return app.RunInTransaction(func(tx core.App) error {
		receipt, err := tx.FindFirstRecordByFilter("dev_commands", "user={:user} && request_id={:key}", dbx.Params{"user": user, "key": command.RequestID})
		if err == nil {
			if receipt.GetString("command") != string(data) {
				return &devError{409, "Este identificador já foi usado em outro comando."}
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		switch {
		case command.Command == "resource" || command.Command == "refill":
			err = mutateDevResource(tx, user, command)
		case command.Command == "clear_counters":
			err = clearDevCounters(tx, user, command.CounterID)
		case command.Command == "add_food":
			err = addDevFood(tx, user, command)
		case devRoomCommands[command.Command]:
			err = nil // The room service applies it after the receipt is saved.
		default:
			err = mutateDevStoves(tx, user, command)
		}
		if err != nil {
			return err
		}
		collection, err := tx.FindCollectionByNameOrId("dev_commands")
		if err != nil {
			return err
		}
		receipt = core.NewRecord(collection)
		receipt.Load(map[string]any{"user": user, "request_id": command.RequestID, "command": string(data)})
		return tx.Save(receipt)
	})
}

// Energy may exceed its capacity, as with the original's eco-generators; the tool allows a
// generous margin above it for testing.
const devEnergyCeiling = 9999

func mutateDevResource(app core.App, user string, command devCommand) error {
	state, err := playerstate.GetOrCreate(app, user)
	if err != nil {
		return err
	}
	if command.Command == "refill" {
		state.Set("energy_current", state.GetInt64("energy_max"))
		state.Set("crates_current", state.GetInt64("crates_max"))
		playerstate.SetPopularity(state, playerstate.MaxPopularityTenths)
		return app.Save(state)
	}
	scale := 1.0
	if command.Resource == "satisfaction" {
		scale = 10
	}
	scaled := *command.Value * scale
	if math.Abs(scaled-math.Round(scaled)) > 0.000001 {
		return invalidDev("Use um valor inteiro; a popularidade admite uma casa decimal.")
	}
	value := int64(math.Round(scaled))
	result := func(current int64) int64 {
		if command.Mode == "add" {
			return current + value
		}
		return value
	}
	within := func(value, minimum, maximum int64) error {
		if value < minimum || value > maximum {
			return invalidDev("O valor resultante está fora dos limites do recurso.")
		}
		return nil
	}
	switch resource := command.Resource; {
	case resource == "cash" || resource == "gold":
		next := result(state.GetInt64(resource))
		if err := within(next, 0, 9007199254740991); err != nil {
			return err
		}
		state.Set(resource, next)
	case resource == "level":
		next := result(state.GetInt64("level"))
		if err := within(next, 1, int64(playerstate.MaxLevel())); err != nil {
			return err
		}
		playerstate.SetLevel(state, int(next))
	case resource == "experience" && command.Mode == "add":
		// Adding XP follows the game's rule, including level rewards, so the tool tests it.
		if value < 0 {
			playerstate.SetExperience(state, max(0, state.GetInt64("experience_current")+value))
		} else {
			playerstate.GrantExperience(state, value)
		}
	case resource == "experience":
		if err := within(value, 0, playerstate.RequiredXP(playerstate.MaxLevel())); err != nil {
			return err
		}
		playerstate.SetExperience(state, value)
	case resource == "satisfaction":
		next := result(state.GetInt64("satisfaction_current_tenths"))
		if err := within(next, playerstate.MinPopularityTenths, playerstate.MaxPopularityTenths); err != nil {
			return err
		}
		playerstate.SetPopularity(state, next)
	case resource == "energy" || resource == "crates":
		ceiling := state.GetInt64(resource + "_max")
		if resource == "energy" {
			ceiling = devEnergyCeiling
		}
		next := result(state.GetInt64(resource + "_current"))
		if err := within(next, 0, ceiling); err != nil {
			return err
		}
		state.Set(resource+"_current", next)
	case resource == "energy_max" || resource == "crates_max":
		next := result(state.GetInt64(resource))
		if err := within(next, 1, 9999); err != nil {
			return err
		}
		state.Set(resource, next)
		if resource == "crates_max" {
			state.Set("crates_current", min(state.GetInt64("crates_current"), next))
		}
	case strings.HasPrefix(resource, "spice:"):
		id := strings.TrimPrefix(resource, "spice:")
		if _, ok := spiceByID(id); !ok {
			return errUnknownSpice
		}
		inventory := playerstate.View(state).SpiceInventory
		next := result(inventory[id])
		if err := within(next, 0, 1000000); err != nil {
			return err
		}
		inventory[id] = next
		state.Set("spice_inventory", inventory)
	default:
		return invalidDev("Recurso desconhecido.")
	}
	return app.Save(state)
}

func mutateDevStoves(app core.App, user string, command devCommand) error {
	stoves, err := app.FindRecordsByFilter("player_stoves", "user={:user}", "", 0, 0, dbx.Params{"user": user})
	if err != nil {
		return err
	}
	found := command.StoveID == ""
	for _, stove := range stoves {
		if command.StoveID != "" && command.StoveID != stove.Id {
			continue
		}
		unit, err := app.FindFirstRecordByData("player_inventory", "stove_id", stove.Id)
		if err != nil || unit.GetString("user") != user || !unit.GetBool("placed") {
			continue
		}
		found = true
		job, err := app.FindFirstRecordByData("stove_cooking", "stove", stove.Id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if job != nil && job.GetString("user") != user {
			return errStoveNotOwned
		}
		switch command.Command {
		case "finish", "spoil":
			if job == nil {
				if command.StoveID != "" {
					return &devError{409, "Não há prato neste fogão."}
				}
				continue
			}
			recipe, ok := recipecatalog.ByID(job.GetString("recipe_id"))
			if !ok {
				return errUnknownRecipe
			}
			// Rewriting the timeline keeps every derived state (ready, spoiled) consistent.
			ready := types.NowDateTime().Add(-time.Second)
			if command.Command == "spoil" {
				ready = ready.Add(-recipe.Validity())
			}
			started := ready.Add(-recipe.Duration())
			job.Set("preparing_at", started.Add(-cookingPlacementDuration))
			job.Set("started_at", started)
			job.Set("ready_at", ready)
			if err := app.Save(job); err != nil {
				return err
			}
		case "clean", "dirty", "empty":
			if job != nil {
				if err := app.Delete(job); err != nil {
					return err
				}
			}
			if command.Command != "empty" {
				stove.Set("dirty", command.Command == "dirty")
			}
			if err := app.Save(stove); err != nil {
				return err
			}
		default:
			return invalidDev("Comando inválido.")
		}
	}
	if !found {
		return errStoveNotOwned
	}
	return nil
}

func clearDevCounters(app core.App, user, counter string) error {
	if counter != "" {
		unit, err := app.FindRecordById("player_inventory", counter)
		if err != nil || unit.GetString("user") != user || !unit.GetBool("placed") {
			return errRoomOwned
		}
		item, ok := roomcatalog.ByID(unit.GetInt("item_id"))
		if !ok || item.Kind != "counter" {
			return invalidDev("Selecione um balcão.")
		}
	}
	foods, err := app.FindRecordsByFilter("room_food", "user={:user}", "", 0, 0, dbx.Params{"user": user})
	if err != nil {
		return err
	}
	for _, food := range foods {
		if counter == "" || food.GetString("counter") == counter {
			if err := app.Delete(food); err != nil {
				return err
			}
		}
	}
	return nil
}

// addDevFood places portions on a counter as if the chef had served them, including the
// proportional XP they will pay, so customers, profit and XP can be tested without waiting.
func addDevFood(app core.App, user string, command devCommand) error {
	recipe, ok := recipecatalog.ByID(command.RecipeID)
	if !ok {
		return errUnknownRecipe
	}
	portions := int64(recipe.Portions)
	if command.Value != nil {
		portions = int64(*command.Value)
	}
	food, err := counterForDish(app, user, recipe.ID)
	if err != nil {
		return err
	}
	if food.IsNew() {
		// job_id is unique per served dish; a tool-made dish gets its own identity.
		food.Set("job_id", "dev:"+command.RequestID)
	}
	food.Set("portions", food.GetInt64("portions")+portions)
	food.Set("experience", food.GetInt64("experience")+recipe.XP*portions/int64(recipe.Portions))
	return app.Save(food)
}
