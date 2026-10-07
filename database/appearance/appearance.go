// Package appearance validates the small persisted look against the shipped wardrobe catalogue.
package appearance

import (
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

//go:embed catalog.json
var catalogJSON []byte

type catalog struct {
	Slots map[string][]int `json:"slots"`
}

var itemSlots, slotCount = loadCatalog()

func loadCatalog() (map[int]string, int) {
	var data catalog
	if err := json.Unmarshal(catalogJSON, &data); err != nil {
		panic(err)
	}
	slots := make(map[int]string)
	for slot, ids := range data.Slots {
		for _, id := range ids {
			slots[id] = slot
		}
	}
	return slots, len(data.Slots)
}

type look struct {
	Version    int   `json:"version"`
	ItemIDs    []int `json:"itemIds"`
	SkinColour *int  `json:"skinColour"`
	HairColour *int  `json:"hairColour"`
}

// Validate rejects unknown pieces, conflicting slots, absent/out-of-range colours and unsupported versions.
// Returning normalized JSON also strips whitespace without storing client-supplied arbitrary metadata.
func Validate(value string) (string, error) {
	invalid := errors.New("visual inválido")
	if value == "" || len(value) > 4096 {
		return "", invalid
	}
	var data look
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&data); err != nil {
		return "", invalid
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return "", invalid
	}
	if data.Version != 1 || len(data.ItemIDs) != slotCount {
		return "", invalid
	}
	for _, colour := range []*int{data.SkinColour, data.HairColour} {
		if colour == nil || *colour < 0 || *colour > 0xffffff {
			return "", invalid
		}
	}
	seen := make(map[string]bool)
	for _, id := range data.ItemIDs {
		slot, exists := itemSlots[id]
		if !exists || seen[slot] {
			return "", invalid
		}
		seen[slot] = true
	}
	encoded, err := json.Marshal(data)
	return string(encoded), err
}
