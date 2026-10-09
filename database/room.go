package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/roomcatalog"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

var errRoomConflict = errors.New("O quarto mudou em outra janela. A visão foi atualizada; tente novamente.")
var errRoomGold = errors.New("Ouro insuficiente.")
var errRoomPosition = errors.New("Posição inválida ou ocupada para este item.")
var errRoomOwned = errors.New("Esta unidade não pertence ao seu inventário.")
var errRoomOperation = errors.New("Identificador de operação já utilizado em outro pedido.")
var errRoomBusy = errors.New("Não é possível mover um fogão durante o preparo.")
var errCounterBusy = errors.New("Não é possível guardar um balcão com comida.")

const starterCounterItemID = 3020069

var requestKeyPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{16,80}$`)

type roomUnit struct {
	UnitID   string `json:"unitId"`
	ItemID   int    `json:"itemId"`
	Placed   bool   `json:"placed"`
	TX       int    `json:"tx"`
	TY       int    `json:"ty"`
	Rotation int    `json:"rotation"`
	StoveID  string `json:"stoveId,omitempty"`
}
type roomSnapshot struct {
	RoomID      string               `json:"roomId"`
	CanEdit     bool                 `json:"canEdit"`
	Revision    int                  `json:"revision"`
	TilesX      int                  `json:"tilesX"`
	TilesY      int                  `json:"tilesY"`
	Inventory   []roomUnit           `json:"inventory"`
	Catalog     []roomcatalog.Item   `json:"catalog"`
	PlayerState playerstate.Snapshot `json:"playerState"`
}
type roomCommand struct {
	ItemID    int    `json:"itemId,omitempty"`
	UnitID    string `json:"unitId,omitempty"`
	TX        *int   `json:"tx"`
	TY        *int   `json:"ty"`
	Rotation  *int   `json:"rotation"`
	Revision  *int   `json:"revision"`
	RequestID string `json:"requestId"`
}

// Provision the starter room and its owned inventory units once, without charging gold.
func ensureRoom(app core.App, userID string) error {
	if _, err := app.FindFirstRecordByData("player_rooms", "user", userID); err == nil {
		return ensureStarterCounter(app, userID)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err := playerstate.GetOrCreate(app, userID); err != nil {
		return err
	}
	if err := ensureStarterStove(app, userID); err != nil {
		return err
	}
	return app.RunInTransaction(func(tx core.App) error {
		_, err := tx.FindFirstRecordByData("player_rooms", "user", userID)
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		rooms, err := tx.FindCollectionByNameOrId("player_rooms")
		if err != nil {
			return err
		}
		inventory, err := tx.FindCollectionByNameOrId("player_inventory")
		if err != nil {
			return err
		}
		add := func(id, x, y, rotation int) error {
			item, ok := roomcatalog.ByID(id)
			if !ok {
				return errors.New("starter item missing")
			}
			unit := core.NewRecord(inventory)
			unit.Load(map[string]any{"user": userID, "item_id": id, "tx": x, "ty": y, "rotation": rotation, "placed": true, "layer": roomcatalog.Layer(item)})
			if item.Kind == "stove" {
				stove, err := tx.FindFirstRecordByFilter("player_stoves", "user={:user} && item_id={:item}", dbx.Params{"user": userID, "item": id})
				if err != nil {
					return err
				}
				unit.Set("stove_id", stove.Id)
				unit.Set("tx", stove.GetInt("tx"))
				unit.Set("ty", stove.GetInt("ty"))
			}
			return tx.Save(unit)
		}
		// The stove and the counter face the dining room (rotation 1): the chef stands in front of the knobs.
		starters := [][4]int{{3070000, 6, 2, 1}, {starterCounterItemID, 7, 3, 1}, {3010000, 4, 1, 1}, {3000011, 0, 2, 0}, {3000011, 0, 6, 0},
			{3040001, 2, 3, 0}, {3040001, 2, 5, 0}, {3040001, 5, 5, 0}, {3030010, 3, 3, 0}, {3030010, 3, 5, 0}, {3030010, 6, 5, 0},
			{3200000, 2, 0, 1}, {3300000, 1, 7, 0}, {3100000, 5, 0, 1}, {3020003, 1, 1, 0}, {3020003, 7, 1, 0}, {3020003, 7, 7, 0}}
		for _, starter := range starters {
			if err := add(starter[0], starter[1], starter[2], starter[3]); err != nil {
				return err
			}
		}
		for y := 0; y < 8; y++ {
			for x := 0; x < 8; x++ {
				if x > 0 && y > 0 {
					if err := add(3050000, x, y, 0); err != nil {
						return err
					}
					continue
				}
				id, rotation := 3090000, 0
				if y == 0 && x > 0 {
					rotation = 1
				}
				if x == 0 && y == 0 {
					id = 3090001
				}
				if err := add(id, x, y, rotation); err != nil {
					return err
				}
				if id != 3090001 {
					if err := add(3060016, x, y, rotation); err != nil {
						return err
					}
				}
			}
		}
		room := core.NewRecord(rooms)
		room.Load(map[string]any{"user": userID, "revision": 1, "tiles_x": 8, "tiles_y": 8})
		return tx.Save(room)
	})
}

// Rooms created before counters receive the starter counter once. A stored counter still
// counts as owned, so selling or storing it never makes a new one appear.
func ensureStarterCounter(app core.App, userID string) error {
	if _, err := app.FindFirstRecordByFilter("player_inventory", "user={:user} && item_id={:item}", dbx.Params{"user": userID, "item": starterCounterItemID}); err == nil {
		return nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	item, ok := roomcatalog.ByID(starterCounterItemID)
	if !ok {
		return errors.New("starter counter missing")
	}
	return app.RunInTransaction(func(tx core.App) error {
		if _, err := tx.FindFirstRecordByFilter("player_inventory", "user={:user} && item_id={:item}", dbx.Params{"user": userID, "item": starterCounterItemID}); err == nil {
			return nil
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		room, err := tx.FindFirstRecordByData("player_rooms", "user", userID)
		if err != nil {
			return err
		}
		units, err := tx.FindRecordsByFilter("player_inventory", "user={:user} && placed=true && layer='object'", "", 0, 0, dbx.Params{"user": userID})
		if err != nil {
			return err
		}
		busy := map[[2]int]bool{}
		for _, other := range units {
			otherItem, ok := roomcatalog.ByID(other.GetInt("item_id"))
			if !ok {
				continue
			}
			sx, sy := otherItem.SizeX, otherItem.SizeY
			if other.GetInt("rotation")%2 == 1 {
				sx, sy = sy, sx
			}
			for dy := 0; dy < sy; dy++ {
				for dx := 0; dx < sx; dx++ {
					busy[[2]int{other.GetInt("tx") + dx, other.GetInt("ty") + dy}] = true
				}
			}
		}
		tilesX, tilesY := room.GetInt("tiles_x"), room.GetInt("tiles_y")
		// Prefer the starter layout's tile; otherwise the free tile farthest from the door wall.
		candidates := [][2]int{{7, 3}}
		for y := tilesY - 1; y >= 1; y-- {
			for x := tilesX - 1; x >= 1; x-- {
				candidates = append(candidates, [2]int{x, y})
			}
		}
		inventory, err := tx.FindCollectionByNameOrId("player_inventory")
		if err != nil {
			return err
		}
		unit := core.NewRecord(inventory)
		unit.Load(map[string]any{"user": userID, "item_id": item.ID, "rotation": 1, "layer": roomcatalog.Layer(item)})
		for _, tile := range candidates {
			if !busy[tile] && validRoomPosition(item, tile[0], tile[1], 1, tilesX, tilesY) {
				unit.Set("placed", true)
				unit.Set("tx", tile[0])
				unit.Set("ty", tile[1])
				break
			}
		}
		if err := tx.Save(unit); err != nil {
			return err
		}
		room.Set("revision", room.GetInt("revision")+1)
		return tx.Save(room)
	})
}

func snapshotRoom(app core.App, userID string) (roomSnapshot, error) {
	result := roomSnapshot{RoomID: userID, CanEdit: true, Inventory: []roomUnit{}, Catalog: roomcatalog.Items}
	room, err := app.FindFirstRecordByData("player_rooms", "user", userID)
	if err != nil {
		return result, err
	}
	result.Revision = room.GetInt("revision")
	result.TilesX = room.GetInt("tiles_x")
	result.TilesY = room.GetInt("tiles_y")
	units, err := app.FindRecordsByFilter("player_inventory", "user={:user}", "id", 10000, 0, dbx.Params{"user": userID})
	if err != nil {
		return result, err
	}
	for _, unit := range units {
		result.Inventory = append(result.Inventory, roomUnit{unit.Id, unit.GetInt("item_id"), unit.GetBool("placed"), unit.GetInt("tx"), unit.GetInt("ty"), unit.GetInt("rotation"), unit.GetString("stove_id")})
	}
	state, err := app.FindFirstRecordByData(playerstate.Collection, "user", userID)
	if err != nil {
		return result, err
	}
	result.PlayerState = playerstate.View(state)
	return result, nil
}

func validRoomPosition(item roomcatalog.Item, x, y, rotation, tilesX, tilesY int) bool {
	if rotation < 0 || rotation > 3 || x < 0 || y < 0 || x >= tilesX || y >= tilesY {
		return false
	}
	if item.Type == 1 {
		return (x == 0 && y > 0 && rotation%2 == 0) || (y == 0 && x > 0 && rotation%2 == 1)
	}
	if item.Kind == "wall" {
		return false
	}
	if item.Kind == "window" || item.Kind == "panel" {
		return (x == 0 && y > 0 && rotation%2 == 0) || (y == 0 && x > 0 && rotation%2 == 1)
	}
	if item.Kind == "door" {
		return (x == 1 && y > 0 && rotation%2 == 0) || (y == 1 && x > 0 && rotation%2 == 1)
	}
	sx, sy := item.SizeX, item.SizeY
	if rotation%2 == 1 {
		sx, sy = sy, sx
	}
	return x >= 1 && y >= 1 && x+sx <= tilesX && y+sy <= tilesY
}

func mutateRoom(app core.App, userID, action string, command roomCommand) (roomSnapshot, error) {
	var result roomSnapshot
	payloadBytes, _ := json.Marshal(struct {
		Action  string
		Command roomCommand
	}{action, command})
	payload := string(payloadBytes)
	err := app.RunInTransaction(func(tx core.App) error {
		operation, err := tx.FindFirstRecordByFilter("room_operations", "user={:user} && request_key={:key}", dbx.Params{"user": userID, "key": command.RequestID})
		if err == nil {
			if operation.GetString("payload") != payload {
				return errRoomOperation
			}
			result, err = snapshotRoom(tx, userID)
			return err
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		room, err := tx.FindFirstRecordByData("player_rooms", "user", userID)
		if err != nil {
			return err
		}
		if room.GetInt("revision") != *command.Revision {
			return errRoomConflict
		}
		var unit *core.Record
		var item roomcatalog.Item
		if action == "purchase" {
			var ok bool
			item, ok = roomcatalog.ByID(command.ItemID)
			if !ok || !item.Purchasable {
				return errRoomPosition
			}
			state, err := tx.FindFirstRecordByData(playerstate.Collection, "user", userID)
			if err != nil {
				return err
			}
			if state.GetInt64("gold") < item.PriceGold {
				return errRoomGold
			}
			collection, err := tx.FindCollectionByNameOrId("player_inventory")
			if err != nil {
				return err
			}
			unit = core.NewRecord(collection)
			unit.Load(map[string]any{"user": userID, "item_id": item.ID, "layer": roomcatalog.Layer(item)})
			state.Set("gold", state.GetInt64("gold")-item.PriceGold)
			if err := tx.Save(state); err != nil {
				return err
			}
		} else {
			unit, err = tx.FindRecordById("player_inventory", command.UnitID)
			if err != nil || unit.GetString("user") != userID {
				return errRoomOwned
			}
			var ok bool
			item, ok = roomcatalog.ByID(unit.GetInt("item_id"))
			if !ok || roomcatalog.Layer(item) == "structure" {
				return errRoomPosition
			}
			if stoveID := unit.GetString("stove_id"); stoveID != "" {
				_, err := tx.FindFirstRecordByData("stove_cooking", "stove", stoveID)
				if err == nil {
					return errRoomBusy
				}
				if !errors.Is(err, sql.ErrNoRows) {
					return err
				}
			}
			if item.Kind == "counter" && action == "store" {
				_, err := tx.FindFirstRecordByData("room_food", "counter", unit.Id)
				if err == nil {
					return errCounterBusy
				}
				if !errors.Is(err, sql.ErrNoRows) {
					return err
				}
			}
		}
		if action == "store" {
			unit.Set("placed", false)
		} else {
			x, y, rotation := *command.TX, *command.TY, *command.Rotation
			if !validRoomPosition(item, x, y, rotation, room.GetInt("tiles_x"), room.GetInt("tiles_y")) {
				return errRoomPosition
			}
			units, err := tx.FindRecordsByFilter("player_inventory", "user={:user}", "", 10000, 0, dbx.Params{"user": userID})
			if err != nil {
				return err
			}
			if len(units) >= 4000 && action == "purchase" {
				return errRoomPosition
			}
			sx, sy := item.SizeX, item.SizeY
			if rotation%2 == 1 {
				sx, sy = sy, sx
			}
			for _, other := range units {
				if !other.GetBool("placed") || other.Id == unit.Id || other.GetString("layer") != roomcatalog.Layer(item) {
					continue
				}
				otherItem, ok := roomcatalog.ByID(other.GetInt("item_id"))
				if !ok {
					return errRoomPosition
				}
				osx, osy := otherItem.SizeX, otherItem.SizeY
				if other.GetInt("rotation")%2 == 1 {
					osx, osy = osy, osx
				}
				ox, oy := other.GetInt("tx"), other.GetInt("ty")
				if x < ox+osx && x+sx > ox && y < oy+osy && y+sy > oy {
					if item.Type > 1 {
						return errRoomPosition
					}
					other.Set("placed", false)
					if err := tx.Save(other); err != nil {
						return err
					}
				}
			}
			unit.Set("placed", true)
			unit.Set("tx", x)
			unit.Set("ty", y)
			unit.Set("rotation", rotation)
		}
		if err := tx.Save(unit); err != nil {
			return err
		}
		if stoveID := unit.GetString("stove_id"); stoveID != "" {
			stove, err := tx.FindRecordById("player_stoves", stoveID)
			if err != nil {
				return err
			}
			// Stored stoves keep their position in the cooking table; unplaced units cannot cook.
			if unit.GetBool("placed") {
				stove.Set("tx", unit.GetInt("tx"))
				stove.Set("ty", unit.GetInt("ty"))
				if err := tx.Save(stove); err != nil {
					return err
				}
			}
		}
		room.Set("revision", room.GetInt("revision")+1)
		if err := tx.Save(room); err != nil {
			return err
		}
		operations, err := tx.FindCollectionByNameOrId("room_operations")
		if err != nil {
			return err
		}
		saved := core.NewRecord(operations)
		saved.Load(map[string]any{"user": userID, "request_key": command.RequestID, "payload": payload})
		if err := tx.Save(saved); err != nil {
			return err
		}
		result, err = snapshotRoom(tx, userID)
		return err
	})
	return result, err
}

func registerRoomRoutes(e *core.ServeEvent) {
	group := e.Router.Group("/api/coffe/room")
	group.BindFunc(func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		return r.Next()
	})
	group.GET("", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		owner := r.Request.URL.Query().Get("room")
		if owner == "" {
			owner = user.Id
		}
		if _, err := r.App.FindRecordById("users", owner); err != nil {
			return r.NotFoundError("Quarto não encontrado.", nil)
		}
		if err := ensureRoom(r.App, owner); err != nil {
			return r.InternalServerError("Não foi possível carregar o quarto.", err)
		}
		var snapshot roomSnapshot
		err := r.App.RunInTransaction(func(tx core.App) error { var err error; snapshot, err = snapshotRoom(tx, owner); return err })
		if err != nil {
			return r.InternalServerError("Não foi possível carregar o inventário.", err)
		}
		if owner != user.Id {
			snapshot.CanEdit = false
			placed := []roomUnit{}
			for _, u := range snapshot.Inventory {
				if u.Placed {
					placed = append(placed, u)
				}
			}
			snapshot.Inventory = placed
			state, err := playerstate.GetOrCreate(r.App, user.Id)
			if err != nil {
				return err
			}
			snapshot.PlayerState = playerstate.View(state)
		}
		return r.JSON(http.StatusOK, snapshot)
	})
	for _, operation := range []string{"purchase", "move", "store"} {
		action := operation
		group.POST("/"+action, func(r *core.RequestEvent) error {
			user := sessionRecord(r)
			if user == nil {
				return r.UnauthorizedError("Entre para jogar.", nil)
			}
			if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
				return r.BadRequestError("Envie JSON.", nil)
			}
			var command roomCommand
			decoder := json.NewDecoder(r.Request.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&command); err != nil {
				return r.BadRequestError("Pedido inválido.", nil)
			}
			if err := decoder.Decode(new(any)); err != io.EOF || command.Revision == nil || *command.Revision < 1 || !requestKeyPattern.MatchString(command.RequestID) ||
				(action != "store" && (command.TX == nil || command.TY == nil || command.Rotation == nil)) ||
				(action == "purchase" && (command.ItemID <= 0 || command.UnitID != "")) || (action != "purchase" && (command.UnitID == "" || command.ItemID != 0)) {
				return r.BadRequestError("Pedido inválido.", nil)
			}
			if err := ensureRoom(r.App, user.Id); err != nil {
				return r.InternalServerError("Não foi possível preparar o inventário.", err)
			}
			if roomService(r.App) != nil {
				return proxyRoomOperation(r, user.Id, action, command)
			}
			snapshot, err := mutateRoom(r.App, user.Id, action, command)
			if err != nil {
				switch {
				case errors.Is(err, errRoomOwned):
					return r.NotFoundError(err.Error(), nil)
				case errors.Is(err, errRoomPosition):
					return r.BadRequestError(err.Error(), nil)
				case errors.Is(err, errRoomGold), errors.Is(err, errRoomConflict), errors.Is(err, errRoomOperation), errors.Is(err, errRoomBusy), errors.Is(err, errCounterBusy):
					return apis.NewApiError(http.StatusConflict, err.Error(), nil)
				default:
					return r.InternalServerError("Não foi possível salvar esta operação.", err)
				}
			}
			return r.JSON(http.StatusOK, snapshot)
		}).Bind(apis.BodyLimit(2048)).BindFunc(func(r *core.RequestEvent) error {
			if r.Request.Header.Get("Origin") == "" {
				return r.ForbiddenError("Origem inválida.", nil)
			}
			return sameOrigin(r)
		})
	}
}
