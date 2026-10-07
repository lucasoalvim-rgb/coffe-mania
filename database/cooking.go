package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const starterStoveItemID = 3070000
const cookingPlacementDuration = 2 * time.Second
const betaCakeDuration = 30 * time.Second

var errStoveOccupied = errors.New("stove occupied")
var errStoveNotOwned = errors.New("stove not owned")
var errDishNotReady = errors.New("dish not ready")
var errCookingCannotCancel = errors.New("cooking cannot be canceled")

type cookingView struct {
	ID          string `json:"id"`
	RecipeID    string `json:"recipeId"`
	PreparingAt string `json:"preparingAt"`
	StartedAt   string `json:"startedAt"`
	ReadyAt     string `json:"readyAt"`
	Status      string `json:"status"`
}

type stoveView struct {
	ID      string       `json:"id"`
	ItemID  int          `json:"itemId"`
	TX      int          `json:"tx"`
	TY      int          `json:"ty"`
	Cooking *cookingView `json:"cooking"`
}

type cookingSnapshot struct {
	ServerNow string      `json:"serverNow"`
	Stoves    []stoveView `json:"stoves"`
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
	result := cookingSnapshot{ServerNow: now.String(), Stoves: []stoveView{}}
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
		view := stoveView{ID: stove.Id, ItemID: stove.GetInt("item_id"), TX: stove.GetInt("tx"), TY: stove.GetInt("ty")}
		job, err := app.FindFirstRecordByData("stove_cooking", "stove", stove.Id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return result, err
		}
		if err == nil {
			status := "preparing"
			if !now.Before(job.GetDateTime("ready_at")) {
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
				ReadyAt:     job.GetDateTime("ready_at").String(), Status: status,
			}
		}
		result.Stoves = append(result.Stoves, view)
	}
	return result, nil
}

func startCooking(app core.App, userID, stoveID, recipeID string, now types.DateTime) error {
	if recipeID != "cake_1" {
		return errors.New("unknown recipe")
	}
	return app.RunInTransaction(func(txApp core.App) error {
		stove, err := txApp.FindRecordById("player_stoves", stoveID)
		if err != nil || stove.GetString("user") != userID {
			return errStoveNotOwned
		}
		if stove.GetInt("item_id") != starterStoveItemID {
			return errStoveNotOwned
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
		collection, err := txApp.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		job := core.NewRecord(collection)
		job.Load(map[string]any{
			"user": userID, "stove": stoveID, "recipe_id": recipeID,
			"preparing_at": now,
			"started_at":   now.Add(cookingPlacementDuration),
			"ready_at":     now.Add(cookingPlacementDuration + betaCakeDuration),
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
		foods, err := txApp.FindCollectionByNameOrId("room_food")
		if err != nil {
			return err
		}
		food := core.NewRecord(foods)
		food.Load(map[string]any{"user": userID, "recipe_id": job.GetString("recipe_id"), "job_id": job.Id})
		if err = txApp.Save(food); err != nil {
			return err
		}
		return txApp.Delete(job)
	})
}

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
		if job.GetString("user") != userID || !now.Before(job.GetDateTime("ready_at")) {
			return errCookingCannotCancel
		}
		return txApp.Delete(job)
	})
}

func registerCookingRoutes(e *core.ServeEvent) {
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
		if body.StoveID == "" || body.RecipeID != "cake_1" {
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
	g.POST("/cancel", func(r *core.RequestEvent) error {
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
			return proxyRoomOperation(r, user.Id, "cook_cancel", body)
		}
		if err := cancelCooking(r.App, user.Id, body.StoveID, types.NowDateTime()); err != nil {
			switch {
			case errors.Is(err, errStoveNotOwned):
				return r.NotFoundError("Fogão indisponível.", nil)
			case errors.Is(err, errCookingCannotCancel):
				return apis.NewApiError(http.StatusConflict, "Este preparo não pode mais ser cancelado.", nil)
			default:
				return r.InternalServerError("Não foi possível cancelar o preparo.", err)
			}
		}
		snapshot, err := snapshotCooking(r.App, user.Id, types.NowDateTime())
		if err != nil {
			return r.InternalServerError("Preparo cancelado, mas não foi possível atualizar os dados.", err)
		}
		return r.JSON(http.StatusOK, snapshot)
	}).Bind(apis.BodyLimit(1024)).BindFunc(func(r *core.RequestEvent) error {
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
}
