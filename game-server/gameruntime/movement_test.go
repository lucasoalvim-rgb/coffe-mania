package gameruntime

import (
	"testing"
	"time"
)

func TestDiagonalStepKeepsWalkingSpeed(t *testing.T) {
	step := 2 * time.Second / 3
	if got := stepDuration(step, Tile{X: 2, Y: 2}, Tile{X: 3, Y: 2}); got != step {
		t.Fatalf("passo reto: %v", got)
	}
	got := stepDuration(step, Tile{X: 2, Y: 2}, Tile{X: 3, Y: 3})
	if got < 942*time.Millisecond || got > 944*time.Millisecond {
		t.Fatalf("passo diagonal deve durar √2 × %v: %v", step, got)
	}
}
