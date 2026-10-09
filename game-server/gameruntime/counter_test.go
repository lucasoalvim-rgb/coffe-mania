package gameruntime

import (
	"testing"

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
