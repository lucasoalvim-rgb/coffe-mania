package gameruntime

import (
	"testing"
	"time"

	"coffe-mania/shared/gamewire"
)

func TestCounterChoice(t *testing.T) {
	r := &room{world: gamewire.World{
		Units: []gamewire.Unit{
			{ID: "counter-a", ItemID: 3020069, Placed: true, X: 7, Y: 3},
			{ID: "counter-b", ItemID: 3020069, Placed: true, X: 7, Y: 4},
		},
		Foods: []gamewire.Food{
			{ID: "food-a", Recipe: "passion_fruit_mousse", Counter: "counter-a", Portions: 3},
			{ID: "food-b", Recipe: "cake_1", Counter: "counter-b", Portions: 9},
		},
	}}
	if !r.counterAccepts("passion_fruit_mousse") {
		t.Fatal("o mesmo prato deve acumular no balcão que já o tem")
	}
	if r.counterAccepts("other_recipe") {
		t.Fatal("sem balcão vazio, outro prato não tem onde ficar")
	}
	if got := r.servingFood(); got != 1 {
		t.Fatalf("o cliente deve ser servido do balcão com mais porções; índice %d", got)
	}
	r.world.Units[1].Placed = false
	r.world.Foods = r.world.Foods[:1]
	if r.counterAccepts("other_recipe") {
		t.Fatal("balcão guardado não recebe pratos")
	}
	r.world.Foods = nil
	if !r.counterAccepts("other_recipe") || r.servingFood() != -1 {
		t.Fatal("balcão vazio recebe qualquer prato e não serve ninguém")
	}
}

func TestChefCarriesDishToCounter(t *testing.T) {
	world := gamewire.World{TilesX: 8, TilesY: 8, Units: []gamewire.Unit{
		{ID: "counter", ItemID: 3020069, Placed: true, X: 7, Y: 3, Rotation: 1},
	}, Foods: []gamewire.Food{{ID: "food", Recipe: "passion_fruit_mousse", Counter: "counter", Portions: 22}}}
	m := New(nil, Options{})
	r := &room{manager: m, world: world, grid: newGrid(world), actors: map[string]*entity{}, peers: map[string]*Peer{}, seats: map[string]string{},
		occupancy: map[Tile]map[string]bool{}, actorTiles: map[string][]Tile{}, spawnAt: time.Now().Add(time.Hour)}
	chef := &entity{Actor: gamewire.Actor{ID: "human:chef", Kind: "human", X: 3, Y: 3, State: "idle"}}
	r.actors[chef.ID] = chef
	r.indexActor(chef)

	now := time.Now()
	r.startCarrying(chef, "passion_fruit_mousse", now)
	if chef.State != "carrying" || chef.Food == nil || chef.Food.Portions != 22 || chef.Food.Counter != "counter" {
		t.Fatalf("o chef deve carregar as 22 porções até o balcão: %+v %+v", chef.Actor, chef.Food)
	}
	if len(chef.path) == 0 && chef.Move == nil {
		t.Fatal("longe do balcão, o chef precisa de um caminho até ele")
	}
	for i := 0; i < 40 && chef.State == "carrying"; i++ {
		now = now.Add(m.options.Step)
		r.tick(now)
	}
	if chef.State != "placing" || abs(chef.X-7)+abs(chef.Y-3) != 1 {
		t.Fatalf("ao chegar ao lado do balcão, o chef pousa o prato: estado %s em (%d,%d)", chef.State, chef.X, chef.Y)
	}
	r.tick(now.Add(time.Second))
	if chef.State != "idle" || chef.Food != nil {
		t.Fatalf("depois de pousar, as mãos ficam livres: %s %+v", chef.State, chef.Food)
	}
}
