package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"

	"coffe-mania/database/npcappearance"
	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/recipecatalog"
	"github.com/google/uuid"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

type roomServiceClient struct {
	URL, Secret string
	HTTP        *http.Client
}

func roomService(app core.App) *roomServiceClient {
	client, _ := app.Store().Get("roomService").(*roomServiceClient)
	return client
}
func (c *roomServiceClient) request(ctx context.Context, path string, body, out any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.URL+"/internal/"+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Secret)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("room service %s: HTTP %d", path, res.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(out)
	}
	return nil
}
func proxyRoomOperation(r *core.RequestEvent, userID, action string, body any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	var result gamewire.Result
	ctx, cancel := context.WithTimeout(r.Request.Context(), 12*time.Second)
	defer cancel()
	err = roomService(r.App).request(ctx, "operation", gamewire.Operation{Owner: userID, User: userID, Action: action, Body: data}, &result)
	if err != nil {
		r.App.Logger().Warn("Falha ao comunicar uma operação do quarto", "action", action, "room", userID, "error", err)
		return apis.NewApiError(503, "O serviço do quarto está indisponível. Tente novamente.", nil)
	}
	return r.JSON(result.Status, json.RawMessage(result.Body))
}
func publicWorld(app core.App, owner string) (gamewire.World, error) {
	snapshot, err := snapshotRoom(app, owner)
	if err != nil {
		return gamewire.World{}, err
	}
	w := gamewire.World{RoomID: owner, Revision: snapshot.Revision, TilesX: snapshot.TilesX, TilesY: snapshot.TilesY, Units: []gamewire.Unit{}, Foods: []gamewire.Food{}}
	for _, u := range snapshot.Inventory {
		if u.Placed {
			w.Units = append(w.Units, gamewire.Unit{ID: u.UnitID, ItemID: u.ItemID, Placed: true, X: u.TX, Y: u.TY, Rotation: u.Rotation, StoveID: u.StoveID})
		}
	}
	cooking, err := snapshotCooking(app, owner, types.NowDateTime())
	if err != nil {
		return w, err
	}
	w.Cooking, _ = json.Marshal(cooking)
	foods, err := app.FindRecordsByFilter("room_food", "user={:owner}", "created", 0, 0, dbx.Params{"owner": owner})
	if err != nil {
		return w, err
	}
	for _, food := range foods {
		w.Foods = append(w.Foods, gamewire.Food{ID: food.Id, Recipe: food.GetString("recipe_id"), Counter: food.GetString("counter"), Portions: foodPortions(food)})
	}
	return w, nil
}
func persistenceOperation(app core.App, op gamewire.Operation) gamewire.Result {
	fail := func(status int, message string) gamewire.Result {
		data, _ := json.Marshal(map[string]string{"message": message})
		return gamewire.Result{Status: status, Body: data}
	}
	if op.Owner == "" || op.Owner != op.User {
		return fail(403, "Somente o dono pode alterar o quarto.")
	}
	var body any
	var err error
	switch op.Action {
	case "purchase", "move", "store":
		var command roomCommand
		if json.Unmarshal(op.Body, &command) != nil || command.Revision == nil || !requestKeyPattern.MatchString(command.RequestID) || (op.Action != "store" && (command.TX == nil || command.TY == nil || command.Rotation == nil)) {
			return fail(400, "Pedido inválido.")
		}
		body, err = mutateRoom(app, op.Owner, op.Action, command)
	case "cook_start", "cook_serve", "cook_cancel", "cook_clean", "cook_spice":
		var command struct {
			StoveID  string `json:"stoveId"`
			RecipeID string `json:"recipeId"`
			Spice    string `json:"spice"`
		}
		if json.Unmarshal(op.Body, &command) != nil || command.StoveID == "" {
			return fail(400, "Pedido inválido.")
		}
		switch op.Action {
		case "cook_start":
			err = startCooking(app, op.Owner, command.StoveID, command.RecipeID, types.NowDateTime())
		case "cook_serve":
			err = serveCooking(app, op.Owner, command.StoveID, types.NowDateTime())
		case "cook_cancel":
			err = cancelCooking(app, op.Owner, command.StoveID, types.NowDateTime())
		case "cook_clean":
			err = cleanStove(app, op.Owner, command.StoveID)
		case "cook_spice":
			err = spiceDish(app, op.Owner, command.StoveID, command.Spice, types.NowDateTime())
		}
		if err == nil {
			body, err = snapshotCooking(app, op.Owner, types.NowDateTime())
		}
	default:
		return fail(400, "Operação desconhecida.")
	}
	if err != nil {
		switch {
		case errors.Is(err, errRoomOwned), errors.Is(err, errStoveNotOwned):
			return fail(404, "Item indisponível.")
		case errors.Is(err, errRoomPosition):
			return fail(400, err.Error())
		case errors.Is(err, errUnknownRecipe):
			return fail(400, "Receita inválida.")
		case errors.Is(err, errUnknownSpice):
			return fail(400, err.Error())
		case errors.Is(err, errAlreadySpiced), errors.Is(err, errSpiceNotUsable), errors.Is(err, errNoSpice):
			return fail(409, err.Error())
		case errors.Is(err, errRoomGold), errors.Is(err, errRoomConflict), errors.Is(err, errRoomOperation), errors.Is(err, errRoomBusy), errors.Is(err, errCounterBusy), errors.Is(err, errKitchenLimit), errors.Is(err, errStoveOccupied), errors.Is(err, errDishNotReady), errors.Is(err, errCookingCannotCancel), errors.Is(err, errNoCounter),
			errors.Is(err, errStoveDirty), errors.Is(err, errStoveClean), errors.Is(err, errDishSpoiled):
			return fail(409, err.Error())
		default:
			return fail(500, "Não foi possível salvar a operação.")
		}
	}
	data, _ := json.Marshal(body)
	w, err := publicWorld(app, op.Owner)
	if err != nil {
		return fail(503, "Operação salva; tente novamente para atualizar o quarto.")
	}
	status := 200
	if op.Action == "cook_start" {
		status = 201
	}
	return gamewire.Result{Status: status, Body: data, World: &w}
}
func saveDormantRoom(app core.App, owner string, state gamewire.Sleep) error {
	if len(state.NPCs) > 32 {
		return errors.New("too many NPCs")
	}
	return app.RunInTransaction(func(tx core.App) error {
		room, err := tx.FindFirstRecordByData("player_rooms", "user", owner)
		if err != nil {
			return err
		}
		existing, err := tx.FindRecordsByFilter("room_npcs", "user={:owner}", "", 0, 0, dbx.Params{"owner": owner})
		if err != nil {
			return err
		}
		byID := map[string]*core.Record{}
		for _, r := range existing {
			byID[r.GetString("npc_id")] = r
		}
		collection, err := tx.FindCollectionByNameOrId("room_npcs")
		if err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, npc := range state.NPCs {
			if !strings.HasPrefix(npc.ID, "npc:") || seen[npc.ID] || len(npc.Path) > 256 {
				return errors.New("invalid NPC")
			}
			seen[npc.ID] = true
			record := byID[npc.ID]
			delete(byID, npc.ID)
			if record == nil {
				record = core.NewRecord(collection)
				record.Set("user", owner)
				record.Set("npc_id", npc.ID)
			}
			record.Set("state", npc)
			if err = tx.Save(record); err != nil {
				return err
			}
		}
		for _, r := range byID {
			if err = tx.Delete(r); err != nil {
				return err
			}
		}
		room.Set("active", false)
		room.Set("human_count", 0)
		return tx.Save(room)
	})
}
func registerGameBridge(e *core.ServeEvent) error {
	secret, err := gamewire.Secret(true)
	if err != nil {
		return err
	}
	target := os.Getenv("COFFE_GAME_URL")
	if target == "" {
		target = "http://127.0.0.1:8091"
	}
	target = strings.TrimRight(target, "/")
	client := &roomServiceClient{target, secret, &http.Client{Timeout: 12 * time.Second}}
	e.App.Store().Set("roomService", client)
	// A persistence restart invalidates old activity markers; the service renews presence.
	if _, err = e.App.DB().NewQuery("UPDATE player_rooms SET active = false, human_count = 0").Execute(); err != nil {
		return err
	}
	upstream, err := url.Parse(target)
	if err != nil {
		return err
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	e.Router.GET("/game/{path...}", func(r *core.RequestEvent) error { proxy.ServeHTTP(r.Response, r.Request); return nil })
	e.Router.POST("/api/coffe/game-ticket", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		var body struct {
			RoomID string `json:"roomId"`
		}
		if r.BindBody(&body) != nil {
			return r.BadRequestError("Quarto inválido.", nil)
		}
		owner := body.RoomID
		if owner == "" {
			owner = user.Id
		}
		if _, err := r.App.FindRecordById("users", owner); err != nil {
			return r.NotFoundError("Quarto não encontrado.", nil)
		}
		if err := ensureRoom(r.App, owner); err != nil {
			return r.InternalServerError("Quarto indisponível.", err)
		}
		state, err := playerstate.GetOrCreate(r.App, user.Id)
		if err != nil {
			return err
		}
		ticket := gamewire.Ticket{Nonce: uuid.NewString(), Room: owner, User: user.Id, Name: sessionView(user).DisplayName, Appearance: state.GetString("appearance"), Expires: time.Now().Add(time.Minute).Unix()}
		return r.JSON(200, map[string]any{"ticket": gamewire.SignTicket(secret, ticket), "roomId": owner, "canEdit": owner == user.Id})
	}).Bind(apis.BodyLimit(1024)).BindFunc(func(r *core.RequestEvent) error {
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
	group := e.Router.Group("/api/coffe/game-internal")
	group.BindFunc(func(r *core.RequestEvent) error {
		if subtle.ConstantTimeCompare([]byte(r.Request.Header.Get("Authorization")), []byte("Bearer "+secret)) != 1 {
			return r.ForbiddenError("Acesso restrito.", nil)
		}
		r.Response.Header().Set("Cache-Control", "no-store")
		return r.Next()
	})
	group.GET("/{owner}/load", func(r *core.RequestEvent) error {
		owner := r.Request.PathValue("owner")
		if err := ensureRoom(r.App, owner); err != nil {
			return err
		}
		world, err := publicWorld(r.App, owner)
		if err != nil {
			return err
		}
		rows, err := r.App.FindRecordsByFilter("room_npcs", "user={:owner}", "id", 32, 0, dbx.Params{"owner": owner})
		if err != nil {
			return err
		}
		npcs := []gamewire.Actor{}
		for _, row := range rows {
			var npc gamewire.Actor
			if err = row.UnmarshalJSONField("state", &npc); err != nil {
				return err
			}
			npcs = append(npcs, npc)
		}
		policy, err := npcappearance.Load(r.App)
		if err != nil {
			return err
		}
		looks, err := npcappearance.GenerateLooks(policy, 16)
		if err != nil {
			return err
		}
		business, err := ownerBusiness(r.App, owner)
		if err != nil {
			return err
		}
		return r.JSON(200, gamewire.Seed{World: world, NPCs: npcs, Looks: looks, Business: business})
	})
	group.POST("/{owner}/active", func(r *core.RequestEvent) error {
		var body struct {
			Active bool `json:"active"`
			Humans int  `json:"humans"`
		}
		if r.BindBody(&body) != nil || body.Humans < 0 || body.Humans > 64 {
			return r.BadRequestError("Inválido.", nil)
		}
		_, err := r.App.DB().NewQuery("UPDATE player_rooms SET active={:active}, human_count={:humans}, last_active={:now} WHERE user={:owner}").Bind(dbx.Params{"active": body.Active, "humans": body.Humans, "now": types.NowDateTime(), "owner": r.Request.PathValue("owner")}).Execute()
		if err != nil {
			return err
		}
		return r.JSON(200, map[string]bool{"ok": true})
	})
	group.POST("/{owner}/sleep", func(r *core.RequestEvent) error {
		var body gamewire.Sleep
		if r.BindBody(&body) != nil {
			return r.BadRequestError("Inválido.", nil)
		}
		if err := saveDormantRoom(r.App, r.Request.PathValue("owner"), body); err != nil {
			return err
		}
		return r.JSON(200, map[string]bool{"ok": true})
	}).Bind(apis.BodyLimit(131072))
	group.POST("/{owner}/operation", func(r *core.RequestEvent) error {
		var op gamewire.Operation
		if r.BindBody(&op) != nil || op.Owner != r.Request.PathValue("owner") {
			return r.BadRequestError("Inválido.", nil)
		}
		return r.JSON(200, persistenceOperation(r.App, op))
	}).Bind(apis.BodyLimit(4096))
	group.POST("/{owner}/consume", func(r *core.RequestEvent) error {
		var body struct {
			FoodID string `json:"foodId"`
		}
		if r.BindBody(&body) != nil {
			return r.BadRequestError("Inválido.", nil)
		}
		owner := r.Request.PathValue("owner")
		err := r.App.RunInTransaction(func(tx core.App) error { return consumePortion(tx, owner, body.FoodID) })
		if errors.Is(err, errFoodUnavailable) {
			return r.NotFoundError("Prato indisponível.", nil)
		}
		if err != nil {
			return err
		}
		business, err := ownerBusiness(r.App, owner)
		if err != nil {
			return err
		}
		return r.JSON(200, business)
	})
	// A customer who leaves without eating (no free chair or no dish on the counters).
	group.POST("/{owner}/dissatisfied", func(r *core.RequestEvent) error {
		owner := r.Request.PathValue("owner")
		err := r.App.RunInTransaction(func(tx core.App) error {
			state, err := tx.FindFirstRecordByData(playerstate.Collection, "user", owner)
			if err != nil {
				return err
			}
			playerstate.AdjustPopularity(state, -playerstate.UnsatisfiedCustomerTenths)
			return tx.Save(state)
		})
		if err != nil {
			return err
		}
		business, err := ownerBusiness(r.App, owner)
		if err != nil {
			return err
		}
		return r.JSON(200, business)
	})
	return nil
}

func ownerBusiness(app core.App, owner string) (gamewire.Business, error) {
	state, err := playerstate.GetOrCreate(app, owner)
	if err != nil {
		return gamewire.Business{}, err
	}
	return gamewire.Business{Popularity: state.GetInt64("satisfaction_current_tenths"), Level: state.GetInt("level")}, nil
}

var errFoodUnavailable = errors.New("food unavailable")

// Rows saved before counters existed have no portion count and hold a single portion.
func foodPortions(food *core.Record) int {
	return max(1, food.GetInt("portions"))
}

// consumePortion serves one portion to a customer: the owner receives its profit, its share
// of the dish's XP and the satisfied customer's popularity.
func consumePortion(tx core.App, owner, foodID string) error {
	food, err := tx.FindRecordById("room_food", foodID)
	if err != nil || food.GetString("user") != owner {
		return errFoodUnavailable
	}
	portions := int64(foodPortions(food))
	// Rounding up pays every portion while XP remains; the total never exceeds the book's.
	pool := max(0, food.GetInt64("experience"))
	experience := (pool + portions - 1) / portions
	if portions > 1 {
		food.Set("portions", portions-1)
		food.Set("experience", pool-experience)
		err = tx.Save(food)
	} else {
		err = tx.Delete(food)
	}
	if err != nil {
		return err
	}
	state, err := tx.FindFirstRecordByData(playerstate.Collection, "user", owner)
	if err != nil {
		return err
	}
	if recipe, ok := recipecatalog.ByID(food.GetString("recipe_id")); ok {
		state.Set("gold", state.GetInt64("gold")+recipe.ProfitGold)
	}
	playerstate.GrantExperience(state, experience)
	playerstate.AdjustPopularity(state, playerstate.SatisfiedCustomerTenths)
	return tx.Save(state)
}

// Activity is a lease, so a crashed room process cannot leave the DB active forever.
func startRoomActivityWatchdog(app core.App) {
	stopped := make(chan struct{})
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error { close(stopped); return e.Next() })
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopped:
				return
			case <-ticker.C:
				before := time.Now().UTC().Add(-45 * time.Second).Format("2006-01-02 15:04:05.000Z")
				if _, err := app.DB().NewQuery("UPDATE player_rooms SET active = false, human_count = 0 WHERE active = true AND last_active < {:before}").Bind(dbx.Params{"before": before}).Execute(); err != nil {
					app.Logger().Warn("Não foi possível atualizar a atividade dos quartos", "error", err)
				}
			}
		}
	}()
}
