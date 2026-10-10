package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/recipecatalog"
	"coffe-mania/shared/roomcatalog"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const starterStoveItemID = 3070000
const cookingPlacementDuration = 2 * time.Second

var errStoveOccupied = errors.New("Fogão ocupado.")
var errStoveNotOwned = errors.New("stove not owned")
var errDishNotReady = errors.New("O prato ainda não está pronto.")
var errCookingCannotCancel = errors.New("Não há prato neste fogão.")
var errUnknownRecipe = errors.New("unknown recipe")
var errNoCounter = errors.New("Não há balcão livre para este prato.")
var errStoveDirty = errors.New("Limpe o fogão antes de cozinhar.")
var errStoveClean = errors.New("O fogão já está limpo.")
var errDishSpoiled = errors.New("O prato estragou. Jogue-o fora para liberar o fogão.")

type cookingView struct {
	ID          string `json:"id"`
	RecipeID    string `json:"recipeId"`
	PreparingAt string `json:"preparingAt"`
	StartedAt   string `json:"startedAt"`
	ReadyAt     string `json:"readyAt"`
	// SpoilsAt ends the ready window; after it the dish can only be thrown away.
	SpoilsAt string `json:"spoilsAt"`
	Status   string `json:"status"`
	Spice    string `json:"spice,omitempty"`
}

type stoveView struct {
	ID      string       `json:"id"`
	ItemID  int          `json:"itemId"`
	TX      int          `json:"tx"`
	TY      int          `json:"ty"`
	Dirty   bool         `json:"dirty"`
	Cooking *cookingView `json:"cooking"`
}

type cookingSnapshot struct {
	ServerNow string      `json:"serverNow"`
	Stoves    []stoveView `json:"stoves"`
	Spices    []spice     `json:"spices"`
}

func ensureStarterStove(app core.App, userID string) error {
	return app.RunInTransaction(func(txApp core.App) error {
		_, err := txApp.FindFirstRecordByFilter("player_stoves", "user={:user} && item_id={:item}", dbx.Params{"user": userID, "item": starterStoveItemID})
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		collection, err := txApp.FindCollectionByNameOrId("player_stoves")
		if err != nil {
			return err
		}
		stove := core.NewRecord(collection)
		stove.Load(map[string]any{"user": userID, "item_id": starterStoveItemID, "tx": 6, "ty": 2})
		return txApp.Save(stove)
	})
}

func snapshotCooking(app core.App, userID string, now types.DateTime) (cookingSnapshot, error) {
	result := cookingSnapshot{ServerNow: now.String(), Stoves: []stoveView{}, Spices: spices}
	stoves, err := app.FindRecordsByFilter("player_stoves", "user={:user}", "created", 100, 0, dbx.Params{"user": userID})
	if err != nil {
		return result, err
	}
	for _, stove := range stoves {
		unit, inventoryErr := app.FindFirstRecordByData("player_inventory", "stove_id", stove.Id)
		if inventoryErr == nil && !unit.GetBool("placed") {
			continue
		}
		if inventoryErr != nil && !errors.Is(inventoryErr, sql.ErrNoRows) {
			return result, inventoryErr
		}
		view := stoveView{ID: stove.Id, ItemID: stove.GetInt("item_id"), TX: stove.GetInt("tx"), TY: stove.GetInt("ty"), Dirty: stove.GetBool("dirty")}
		job, err := app.FindFirstRecordByData("stove_cooking", "stove", stove.Id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return result, err
		}
		if err == nil {
			spoilsAt := jobSpoilsAt(job)
			status := "preparing"
			if !now.Before(spoilsAt) {
				status = "spoiled"
			} else if !now.Before(job.GetDateTime("ready_at")) {
				status = "ready"
			} else if !now.Before(job.GetDateTime("started_at")) {
				status = "cooking"
			}
			preparingAt := job.GetDateTime("preparing_at")
			if preparingAt.IsZero() {
				preparingAt = job.GetDateTime("started_at")
			}
			view.Cooking = &cookingView{
				ID: job.Id, RecipeID: job.GetString("recipe_id"),
				PreparingAt: preparingAt.String(),
				StartedAt:   job.GetDateTime("started_at").String(),
				ReadyAt:     job.GetDateTime("ready_at").String(),
				SpoilsAt:    spoilsAt.String(), Status: status, Spice: job.GetString("spice"),
			}
		}
		result.Stoves = append(result.Stoves, view)
	}
	return result, nil
}

func jobSpoilsAt(job *core.Record) types.DateTime {
	validity := recipecatalog.DefaultValidity(job.GetDateTime("ready_at").Time().Sub(job.GetDateTime("started_at").Time()))
	if recipe, ok := recipecatalog.ByID(job.GetString("recipe_id")); ok {
		validity = recipe.Validity()
	}
	return job.GetDateTime("ready_at").Add(validity)
}

// Starting a dish pays its cost and grants its XP immediately, as in the original game.
func startCooking(app core.App, userID, stoveID, recipeID string, now types.DateTime) error {
	recipe, ok := recipecatalog.Cookable(recipeID)
	if !ok {
		return errUnknownRecipe
	}
	return app.RunInTransaction(func(txApp core.App) error {
		stove, err := txApp.FindRecordById("player_stoves", stoveID)
		if err != nil || stove.GetString("user") != userID {
			return errStoveNotOwned
		}
		if stove.GetInt("item_id") != starterStoveItemID {
			return errStoveNotOwned
		}
		if stove.GetBool("dirty") {
			return errStoveDirty
		}
		unit, inventoryErr := txApp.FindFirstRecordByData("player_inventory", "stove_id", stove.Id)
		if inventoryErr == nil && !unit.GetBool("placed") {
			return errStoveNotOwned
		}
		if inventoryErr != nil && !errors.Is(inventoryErr, sql.ErrNoRows) {
			return inventoryErr
		}
		_, err = txApp.FindFirstRecordByData("stove_cooking", "stove", stoveID)
		if err == nil {
			return errStoveOccupied
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		state, err := txApp.FindFirstRecordByData(playerstate.Collection, "user", userID)
		if err != nil {
			return err
		}
		if state.GetInt64("gold") < recipe.CostGold {
			return errRoomGold
		}
		state.Set("gold", state.GetInt64("gold")-recipe.CostGold)
		// The recipe's XP goes with the dish to the counter and is paid as customers eat it.
		if err := txApp.Save(state); err != nil {
			return err
		}
		collection, err := txApp.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		job := core.NewRecord(collection)
		job.Load(map[string]any{
			"user": userID, "stove": stoveID, "recipe_id": recipe.ID,
			"preparing_at": now,
			"started_at":   now.Add(cookingPlacementDuration),
			"ready_at":     now.Add(cookingPlacementDuration + recipe.Duration()),
		})
		return txApp.Save(job)
	})
}

func serveCooking(app core.App, userID, stoveID string, now types.DateTime) error {
	return app.RunInTransaction(func(txApp core.App) error {
		stove, err := txApp.FindRecordById("player_stoves", stoveID)
		if err != nil || stove.GetString("user") != userID {
			return errStoveNotOwned
		}
		job, err := txApp.FindFirstRecordByData("stove_cooking", "stove", stoveID)
		if errors.Is(err, sql.ErrNoRows) {
			return errDishNotReady
		}
		if err != nil {
			return err
		}
		if job.GetString("user") != userID || now.Before(job.GetDateTime("ready_at")) {
			return errDishNotReady
		}
		if !now.Before(jobSpoilsAt(job)) {
			return errDishSpoiled
		}
		recipeID := job.GetString("recipe_id")
		portions := 1
		var experience int64
		if recipe, ok := recipecatalog.ByID(recipeID); ok {
			portions, experience = recipe.Portions, recipe.XP
		}
		// Spice bonus portions dilute the dish's XP; they never add to the book's total.
		portions += max(0, job.GetInt("bonus_portions"))
		food, err := counterForDish(txApp, userID, recipeID)
		if err != nil {
			return err
		}
		food.Set("portions", food.GetInt("portions")+portions)
		food.Set("experience", food.GetInt64("experience")+experience)
		if food.IsNew() {
			food.Set("job_id", job.Id)
		}
		if err = txApp.Save(food); err != nil {
			return err
		}
		stove.Set("dirty", true)
		if err = txApp.Save(stove); err != nil {
			return err
		}
		return txApp.Delete(job)
	})
}

// counterForDish returns the counter row that receives a finished dish: the counter that
// already holds this recipe (portions accumulate), otherwise a new row on an empty counter.
func counterForDish(txApp core.App, userID, recipeID string) (*core.Record, error) {
	units, err := txApp.FindRecordsByFilter("player_inventory", "user={:user} && placed=true", "id", 0, 0, dbx.Params{"user": userID})
	if err != nil {
		return nil, err
	}
	foods, err := txApp.FindRecordsByFilter("room_food", "user={:user} && counter!=''", "created", 0, 0, dbx.Params{"user": userID})
	if err != nil {
		return nil, err
	}
	byCounter := map[string]*core.Record{}
	for _, food := range foods {
		byCounter[food.GetString("counter")] = food
	}
	var empty string
	for _, unit := range units {
		if item, ok := roomcatalog.ByID(unit.GetInt("item_id")); !ok || item.Kind != "counter" {
			continue
		}
		if food := byCounter[unit.Id]; food != nil {
			if food.GetString("recipe_id") == recipeID {
				return food, nil
			}
		} else if empty == "" {
			empty = unit.Id
		}
	}
	if empty == "" {
		return nil, errNoCounter
	}
	collection, err := txApp.FindCollectionByNameOrId("room_food")
	if err != nil {
		return nil, err
	}
	food := core.NewRecord(collection)
	food.Load(map[string]any{"user": userID, "recipe_id": recipeID, "counter": empty, "portions": 0})
	return food, nil
}

// cancelCooking throws the dish away at any stage, as in the original; the stove becomes dirty.
// The cost paid at the start is not returned, and the dish's XP is lost with it.
func cancelCooking(app core.App, userID, stoveID string, now types.DateTime) error {
	return app.RunInTransaction(func(txApp core.App) error {
		stove, err := txApp.FindRecordById("player_stoves", stoveID)
		if err != nil || stove.GetString("user") != userID {
			return errStoveNotOwned
		}
		job, err := txApp.FindFirstRecordByData("stove_cooking", "stove", stoveID)
		if errors.Is(err, sql.ErrNoRows) {
			return errCookingCannotCancel
		}
		if err != nil {
			return err
		}
		if job.GetString("user") != userID {
			return errCookingCannotCancel
		}
		stove.Set("dirty", true)
		if err := txApp.Save(stove); err != nil {
			return err
		}
		return txApp.Delete(job)
	})
}

func cleanStove(app core.App, userID, stoveID string) error {
	return app.RunInTransaction(func(txApp core.App) error {
		stove, err := txApp.FindRecordById("player_stoves", stoveID)
		if err != nil || stove.GetString("user") != userID {
			return errStoveNotOwned
		}
		if !stove.GetBool("dirty") {
			return errStoveClean
		}
		stove.Set("dirty", false)
		return txApp.Save(stove)
	})
}

func registerCookingRoutes(e *core.ServeEvent) {
	registerSpicePurchaseRoutes(e)
	g := e.Router.Group("/api/coffe/cooking")
	g.BindFunc(func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		return r.Next()
	})
	g.GET("", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		if err := ensureStarterStove(r.App, user.Id); err != nil {
			return r.InternalServerError("Não foi possível carregar os fogões.", err)
		}
		owner := r.Request.URL.Query().Get("room")
		if owner == "" {
			owner = user.Id
		}
		if _, err := r.App.FindRecordById("users", owner); err != nil {
			return r.NotFoundError("Quarto não encontrado.", nil)
		}
		snapshot, err := snapshotCooking(r.App, owner, types.NowDateTime())
		if err != nil {
			return r.InternalServerError("Não foi possível carregar o preparo.", err)
		}
		return r.JSON(http.StatusOK, snapshot)
	})
	g.POST("/start", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
			return r.BadRequestError("Envie JSON.", nil)
		}
		var body struct {
			StoveID  string `json:"stoveId"`
			RecipeID string `json:"recipeId"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			return r.BadRequestError("Pedido inválido.", nil)
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			return r.BadRequestError("Pedido inválido.", nil)
		}
		if _, ok := recipecatalog.Cookable(body.RecipeID); body.StoveID == "" || !ok {
			return r.BadRequestError("Fogão ou receita inválidos.", nil)
		}
		if roomService(r.App) != nil {
			return proxyRoomOperation(r, user.Id, "cook_start", body)
		}
		if err := startCooking(r.App, user.Id, body.StoveID, body.RecipeID, types.NowDateTime()); err != nil {
			switch {
			case errors.Is(err, errStoveNotOwned):
				return r.NotFoundError("Fogão indisponível.", nil)
			case errors.Is(err, errStoveOccupied):
				return apis.NewApiError(http.StatusConflict, "Fogão ocupado.", nil)
			case errors.Is(err, errRoomGold), errors.Is(err, errStoveDirty):
				return apis.NewApiError(http.StatusConflict, err.Error(), nil)
			default:
				return r.InternalServerError("Não foi possível iniciar o preparo.", err)
			}
		}
		snapshot, err := snapshotCooking(r.App, user.Id, types.NowDateTime())
		if err != nil {
			return r.InternalServerError("Preparo iniciado, mas não foi possível atualizar os dados.", err)
		}
		return r.JSON(http.StatusCreated, snapshot)
	}).Bind(apis.BodyLimit(1024)).BindFunc(func(r *core.RequestEvent) error {
		// Cookie auth + mutation: require a browser same-origin Origin header.
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
	g.POST("/serve", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
			return r.BadRequestError("Envie JSON.", nil)
		}
		var body struct {
			StoveID string `json:"stoveId"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			return r.BadRequestError("Pedido inválido.", nil)
		}
		if err := decoder.Decode(new(any)); err != io.EOF || body.StoveID == "" {
			return r.BadRequestError("Fogão inválido.", nil)
		}
		if roomService(r.App) != nil {
			return proxyRoomOperation(r, user.Id, "cook_serve", body)
		}
		if err := serveCooking(r.App, user.Id, body.StoveID, types.NowDateTime()); err != nil {
			switch {
			case errors.Is(err, errStoveNotOwned):
				return r.NotFoundError("Fogão indisponível.", nil)
			case errors.Is(err, errDishNotReady):
				return apis.NewApiError(http.StatusConflict, "O prato ainda não está pronto.", nil)
			case errors.Is(err, errNoCounter), errors.Is(err, errDishSpoiled):
				return apis.NewApiError(http.StatusConflict, err.Error(), nil)
			default:
				return r.InternalServerError("Não foi possível servir o prato.", err)
			}
		}
		snapshot, err := snapshotCooking(r.App, user.Id, types.NowDateTime())
		if err != nil {
			return r.InternalServerError("Prato servido, mas não foi possível atualizar os dados.", err)
		}
		return r.JSON(http.StatusOK, snapshot)
	}).Bind(apis.BodyLimit(1024)).BindFunc(func(r *core.RequestEvent) error {
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
	g.POST("/spice", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
			return r.BadRequestError("Envie JSON.", nil)
		}
		var body struct {
			StoveID string `json:"stoveId"`
			Spice   string `json:"spice"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil || body.StoveID == "" {
			return r.BadRequestError("Pedido inválido.", nil)
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			return r.BadRequestError("Pedido inválido.", nil)
		}
		if _, ok := spiceByID(body.Spice); !ok {
			return r.BadRequestError(errUnknownSpice.Error(), nil)
		}
		if roomService(r.App) != nil {
			return proxyRoomOperation(r, user.Id, "cook_spice", body)
		}
		if err := spiceDish(r.App, user.Id, body.StoveID, body.Spice, types.NowDateTime()); err != nil {
			switch {
			case errors.Is(err, errStoveNotOwned):
				return r.NotFoundError("Fogão indisponível.", nil)
			case errors.Is(err, errCookingCannotCancel), errors.Is(err, errAlreadySpiced), errors.Is(err, errSpiceNotUsable), errors.Is(err, errNoSpice):
				return apis.NewApiError(http.StatusConflict, err.Error(), nil)
			default:
				return r.InternalServerError("Não foi possível usar o tempero.", err)
			}
		}
		snapshot, err := snapshotCooking(r.App, user.Id, types.NowDateTime())
		if err != nil {
			return r.InternalServerError("Tempero usado, mas não foi possível atualizar os dados.", err)
		}
		return r.JSON(http.StatusOK, snapshot)
	}).Bind(apis.BodyLimit(1024)).BindFunc(func(r *core.RequestEvent) error {
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
	// Discarding works at any stage; cleaning needs a dirty stove. Both only take the stove id.
	for _, route := range []struct {
		path, operation, done string
		run                   func(app core.App, userID, stoveID string) error
	}{
		{"/cancel", "cook_cancel", "Prato jogado fora", func(app core.App, userID, stoveID string) error {
			return cancelCooking(app, userID, stoveID, types.NowDateTime())
		}},
		{"/clean", "cook_clean", "Fogão limpo", cleanStove},
	} {
		g.POST(route.path, func(r *core.RequestEvent) error {
			user := sessionRecord(r)
			if user == nil {
				return r.UnauthorizedError("Entre para jogar.", nil)
			}
			if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
				return r.BadRequestError("Envie JSON.", nil)
			}
			var body struct {
				StoveID string `json:"stoveId"`
			}
			decoder := json.NewDecoder(r.Request.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&body); err != nil {
				return r.BadRequestError("Pedido inválido.", nil)
			}
			if err := decoder.Decode(new(any)); err != io.EOF || body.StoveID == "" {
				return r.BadRequestError("Fogão inválido.", nil)
			}
			if roomService(r.App) != nil {
				return proxyRoomOperation(r, user.Id, route.operation, body)
			}
			if err := route.run(r.App, user.Id, body.StoveID); err != nil {
				switch {
				case errors.Is(err, errStoveNotOwned):
					return r.NotFoundError("Fogão indisponível.", nil)
				case errors.Is(err, errCookingCannotCancel):
					return apis.NewApiError(http.StatusConflict, "Não há prato neste fogão.", nil)
				case errors.Is(err, errStoveClean):
					return apis.NewApiError(http.StatusConflict, err.Error(), nil)
				default:
					return r.InternalServerError("Não foi possível concluir a ação no fogão.", err)
				}
			}
			snapshot, err := snapshotCooking(r.App, user.Id, types.NowDateTime())
			if err != nil {
				return r.InternalServerError(route.done+", mas não foi possível atualizar os dados.", err)
			}
			return r.JSON(http.StatusOK, snapshot)
		}).Bind(apis.BodyLimit(1024)).BindFunc(func(r *core.RequestEvent) error {
			if r.Request.Header.Get("Origin") == "" {
				return r.ForbiddenError("Origem inválida.", nil)
			}
			return sameOrigin(r)
		})
	}
}
