package main

import (
	"errors"
	"testing"
	"time"

	_ "coffe-mania/database/migrations"
	"coffe-mania/database/playerstate"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func newCookingTestApp(t *testing.T) (core.App, string) {
	t.Helper()
	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("chef@local.mail")
	user.SetPassword("123456")
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	if err := ensureRoom(app, user.Id); err != nil {
		t.Fatal(err)
	}
	return app, user.Id
}

func finishJob(t *testing.T, app core.App, stoveID string) {
	t.Helper()
	job, err := app.FindFirstRecordByData("stove_cooking", "stove", stoveID)
	if err != nil {
		t.Fatal(err)
	}
	job.Set("ready_at", types.NowDateTime().Add(-time.Second))
	if err := app.Save(job); err != nil {
		t.Fatal(err)
	}
}

func TestMousseGoesToCounterAndPaysPerPortion(t *testing.T) {
	app, userID := newCookingTestApp(t)
	stove, err := app.FindFirstRecordByData("player_stoves", "user", userID)
	if err != nil {
		t.Fatal(err)
	}
	gold := func() int64 {
		state, err := app.FindFirstRecordByData(playerstate.Collection, "user", userID)
		if err != nil {
			t.Fatal(err)
		}
		return state.GetInt64("gold")
	}
	startGold := gold()

	if err := startCooking(app, userID, stove.Id, "cake_1", types.NowDateTime()); !errors.Is(err, errUnknownRecipe) {
		t.Fatalf("a receita fora do livro não pode ser iniciada: %v", err)
	}
	if err := startCooking(app, userID, stove.Id, "passion_fruit_mousse", types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	if got := gold(); got != startGold-60 {
		t.Fatalf("custo do mousse: ouro %d, esperado %d", got, startGold-60)
	}
	job, err := app.FindFirstRecordByData("stove_cooking", "stove", stove.Id)
	if err != nil {
		t.Fatal(err)
	}
	if d := job.GetDateTime("ready_at").Time().Sub(job.GetDateTime("started_at").Time()); d != 35*time.Minute {
		t.Fatalf("tempo de preparo %v, esperado 35 min", d)
	}

	finishJob(t, app, stove.Id)
	if err := serveCooking(app, userID, stove.Id, types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	foods, err := app.FindRecordsByFilter("room_food", "user={:user}", "", 0, 0, dbx.Params{"user": userID})
	if err != nil || len(foods) != 1 || foods[0].GetInt("portions") != 22 || foods[0].GetString("counter") == "" {
		t.Fatalf("o prato pronto deve ir ao balcão com 22 porções: %v %v", foods, err)
	}

	// The same recipe accumulates on the same counter.
	state, _ := app.FindFirstRecordByData(playerstate.Collection, "user", userID)
	state.Set("gold", 1000)
	if err := app.Save(state); err != nil {
		t.Fatal(err)
	}
	if err := cleanStove(app, userID, stove.Id); err != nil {
		t.Fatal(err)
	}
	if err := startCooking(app, userID, stove.Id, "passion_fruit_mousse", types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	finishJob(t, app, stove.Id)
	if err := serveCooking(app, userID, stove.Id, types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	food, err := app.FindRecordById("room_food", foods[0].Id)
	if err != nil || food.GetInt("portions") != 44 {
		t.Fatalf("porções acumuladas: %v %v", food, err)
	}

	before := gold()
	if err := app.RunInTransaction(func(tx core.App) error { return consumePortion(tx, userID, food.Id) }); err != nil {
		t.Fatal(err)
	}
	food, _ = app.FindRecordById("room_food", food.Id)
	if food.GetInt("portions") != 43 || gold() != before+12 {
		t.Fatalf("consumo: %d porções, ouro %d (antes %d)", food.GetInt("portions"), gold(), before)
	}

	counter, err := app.FindRecordById("player_inventory", food.GetString("counter"))
	if err != nil {
		t.Fatal(err)
	}
	revision := 0
	room, _ := app.FindFirstRecordByData("player_rooms", "user", userID)
	revision = room.GetInt("revision")
	_, err = mutateRoom(app, userID, "store", roomCommand{UnitID: counter.Id, Revision: &revision, RequestID: "store-counter-with-food-0001"})
	if !errors.Is(err, errCounterBusy) {
		t.Fatalf("balcão com comida não pode ser guardado: %v", err)
	}
}

func TestServeWithoutCounterKeepsDishOnStove(t *testing.T) {
	app, userID := newCookingTestApp(t)
	counter, err := app.FindFirstRecordByFilter("player_inventory", "user={:user} && item_id={:item}", dbx.Params{"user": userID, "item": starterCounterItemID})
	if err != nil {
		t.Fatal(err)
	}
	counter.Set("placed", false)
	if err := app.Save(counter); err != nil {
		t.Fatal(err)
	}
	stove, _ := app.FindFirstRecordByData("player_stoves", "user", userID)
	if err := startCooking(app, userID, stove.Id, "passion_fruit_mousse", types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	finishJob(t, app, stove.Id)
	if err := serveCooking(app, userID, stove.Id, types.NowDateTime()); !errors.Is(err, errNoCounter) {
		t.Fatalf("sem balcão o prato deve ficar no fogão: %v", err)
	}
	if _, err := app.FindFirstRecordByData("stove_cooking", "stove", stove.Id); err != nil {
		t.Fatalf("o preparo deve continuar no fogão: %v", err)
	}
	// A stored counter still counts as owned: no second starter counter appears.
	if err := ensureRoom(app, userID); err != nil {
		t.Fatal(err)
	}
	units, _ := app.FindRecordsByFilter("player_inventory", "user={:user} && item_id={:item}", "", 0, 0, dbx.Params{"user": userID, "item": starterCounterItemID})
	if len(units) != 1 {
		t.Fatalf("balcões iniciais: %d", len(units))
	}
}

func TestExistingRoomReceivesStarterCounterOnce(t *testing.T) {
	app, userID := newCookingTestApp(t)
	counter, err := app.FindFirstRecordByFilter("player_inventory", "user={:user} && item_id={:item}", dbx.Params{"user": userID, "item": starterCounterItemID})
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(counter); err != nil {
		t.Fatal(err)
	}
	room, _ := app.FindFirstRecordByData("player_rooms", "user", userID)
	revision := room.GetInt("revision")
	for i := 0; i < 2; i++ {
		if err := ensureRoom(app, userID); err != nil {
			t.Fatal(err)
		}
	}
	units, _ := app.FindRecordsByFilter("player_inventory", "user={:user} && item_id={:item}", "", 0, 0, dbx.Params{"user": userID, "item": starterCounterItemID})
	if len(units) != 1 || !units[0].GetBool("placed") || units[0].GetInt("tx") != 7 || units[0].GetInt("ty") != 3 {
		t.Fatalf("balcão provisionado: %v", units)
	}
	room, _ = app.FindFirstRecordByData("player_rooms", "user", userID)
	if room.GetInt("revision") != revision+1 {
		t.Fatalf("revisão %d, esperada %d", room.GetInt("revision"), revision+1)
	}
}

func TestStoveCycleDirtySpoiledAndClean(t *testing.T) {
	app, userID := newCookingTestApp(t)
	stove, _ := app.FindFirstRecordByData("player_stoves", "user", userID)
	state, _ := app.FindFirstRecordByData(playerstate.Collection, "user", userID)
	state.Set("gold", 10000)
	if err := app.Save(state); err != nil {
		t.Fatal(err)
	}
	dirty := func() bool {
		s, err := app.FindRecordById("player_stoves", stove.Id)
		if err != nil {
			t.Fatal(err)
		}
		return s.GetBool("dirty")
	}

	// Pronto → levar ao balcão → sujo.
	if err := startCooking(app, userID, stove.Id, "nachos", types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	finishJob(t, app, stove.Id)
	if err := serveCooking(app, userID, stove.Id, types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	if !dirty() {
		t.Fatal("levar o prato ao balcão deve sujar o fogão")
	}
	if err := startCooking(app, userID, stove.Id, "nachos", types.NowDateTime()); !errors.Is(err, errStoveDirty) {
		t.Fatalf("fogão sujo não cozinha: %v", err)
	}
	if err := cleanStove(app, userID, stove.Id); err != nil || dirty() {
		t.Fatalf("limpar: %v", err)
	}
	if err := cleanStove(app, userID, stove.Id); !errors.Is(err, errStoveClean) {
		t.Fatalf("fogão limpo não precisa de limpeza: %v", err)
	}

	// Pronto há mais tempo que a validade → estragado: não vai ao balcão, só pode ser jogado fora.
	if err := startCooking(app, userID, stove.Id, "nachos", types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	job, _ := app.FindFirstRecordByData("stove_cooking", "stove", stove.Id)
	job.Set("ready_at", types.NowDateTime().Add(-31*time.Minute))
	if err := app.Save(job); err != nil {
		t.Fatal(err)
	}
	snapshot, err := snapshotCooking(app, userID, types.NowDateTime())
	if err != nil || snapshot.Stoves[0].Cooking == nil || snapshot.Stoves[0].Cooking.Status != "spoiled" {
		t.Fatalf("nachos (3 min) estragam 30 min depois de prontos: %+v %v", snapshot, err)
	}
	if err := serveCooking(app, userID, stove.Id, types.NowDateTime()); !errors.Is(err, errDishSpoiled) {
		t.Fatalf("prato estragado não vai ao balcão: %v", err)
	}
	if err := cancelCooking(app, userID, stove.Id, types.NowDateTime()); err != nil || !dirty() {
		t.Fatalf("jogar fora suja o fogão: %v", err)
	}
	if _, err := app.FindFirstRecordByData("stove_cooking", "stove", stove.Id); err == nil {
		t.Fatal("o prato jogado fora sai do fogão")
	}
}

func TestBuyingStoveCreatesCookingSlotWithinLevelLimit(t *testing.T) {
	app, userID := newCookingTestApp(t)
	state, _ := app.FindFirstRecordByData(playerstate.Collection, "user", userID)
	state.Set("gold", 100000)
	if err := app.Save(state); err != nil {
		t.Fatal(err)
	}
	buy := func(tx, ty int, key string) (roomSnapshot, error) {
		room, _ := app.FindFirstRecordByData("player_rooms", "user", userID)
		revision, rotation := room.GetInt("revision"), 1
		return mutateRoom(app, userID, "purchase", roomCommand{ItemID: starterStoveItemID, TX: &tx, TY: &ty, Rotation: &rotation, Revision: &revision, RequestID: "buy-stove-" + key + "-000000"})
	}
	snapshot, err := buy(4, 6, "a")
	if err != nil {
		t.Fatal(err)
	}
	var bought *roomUnit
	for i, u := range snapshot.Inventory {
		if u.ItemID == starterStoveItemID && u.TX == 4 && u.TY == 6 {
			bought = &snapshot.Inventory[i]
		}
	}
	if bought == nil || bought.StoveID == "" {
		t.Fatalf("o fogão comprado precisa de um lugar de cozinha: %+v", bought)
	}
	if err := startCooking(app, userID, bought.StoveID, "nachos", types.NowDateTime()); err != nil {
		t.Fatalf("o fogão comprado cozinha: %v", err)
	}
	if _, err := buy(5, 6, "b"); err != nil {
		t.Fatal(err)
	}
	// Nível 1: 3 fogões (o inicial e os dois comprados).
	if _, err := buy(6, 6, "c"); !errors.Is(err, errKitchenLimit) {
		t.Fatalf("o quarto fogão passa do limite do nível 1: %v", err)
	}
}

func TestSpicesSpeedUpAndRecoverDishes(t *testing.T) {
	app, userID := newCookingTestApp(t)
	stove, _ := app.FindFirstRecordByData("player_stoves", "user", userID)
	state, _ := app.FindFirstRecordByData(playerstate.Collection, "user", userID)
	state.Set("gold", 10000)
	state.Set("cash", 10)
	if err := app.Save(state); err != nil {
		t.Fatal(err)
	}
	cash := func() int64 {
		s, _ := app.FindFirstRecordByData(playerstate.Collection, "user", userID)
		return s.GetInt64("cash")
	}
	if err := startCooking(app, userID, stove.Id, "churrasco", types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	job, _ := app.FindFirstRecordByData("stove_cooking", "stove", stove.Id)
	before := job.GetDateTime("ready_at").Time()
	if err := purchaseSpice(app, userID, "thyme", "test-thyme"); err != nil {
		t.Fatal(err)
	}
	if err := spiceDish(app, userID, stove.Id, "thyme", types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	job, _ = app.FindFirstRecordByData("stove_cooking", "stove", stove.Id)
	if d := before.Sub(job.GetDateTime("ready_at").Time()); d != time.Hour || cash() != 9 {
		t.Fatalf("Tomilho Acelerador comprado tira 1 hora sem cobrar no uso: %v, %d", d, cash())
	}
	if err := spiceDish(app, userID, stove.Id, "instant", types.NowDateTime()); !errors.Is(err, errAlreadySpiced) {
		t.Fatalf("cada prato só pode ser temperado uma vez: %v", err)
	}

	// Sálvia Salvadora: só no prato estragado, que volta a ficar pronto.
	if err := cancelCooking(app, userID, stove.Id, types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	if err := cleanStove(app, userID, stove.Id); err != nil {
		t.Fatal(err)
	}
	if err := startCooking(app, userID, stove.Id, "nachos", types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	if err := purchaseSpice(app, userID, "sage", "test-sage"); err != nil {
		t.Fatal(err)
	}
	if err := spiceDish(app, userID, stove.Id, "sage", types.NowDateTime()); !errors.Is(err, errSpiceNotUsable) {
		t.Fatalf("sálvia só serve para prato estragado: %v", err)
	}
	job, _ = app.FindFirstRecordByData("stove_cooking", "stove", stove.Id)
	job.Set("ready_at", types.NowDateTime().Add(-2*time.Hour))
	if err := app.Save(job); err != nil {
		t.Fatal(err)
	}
	if err := spiceDish(app, userID, stove.Id, "sage", types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	if err := serveCooking(app, userID, stove.Id, types.NowDateTime()); err != nil {
		t.Fatalf("depois da sálvia o prato vai ao balcão: %v", err)
	}

	state, _ = app.FindFirstRecordByData(playerstate.Collection, "user", userID)
	state.Set("cash", 0)
	_ = app.Save(state)
	_ = cleanStove(app, userID, stove.Id)
	_ = startCooking(app, userID, stove.Id, "churrasco", types.NowDateTime())
	if err := purchaseSpice(app, userID, "instant", "test-no-cash"); !errors.Is(err, errNoCash) {
		t.Fatalf("sem caféGranas não compra: %v", err)
	}
	if err := spiceDish(app, userID, stove.Id, "instant", types.NowDateTime()); !errors.Is(err, errNoSpice) {
		t.Fatalf("sem unidade no estoque não usa: %v", err)
	}
}
