// Package npcappearance holds the admin-owned NPC wardrobe allowlist.
package npcappearance

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

const Collection = "npc_appearance_catalog"

//go:embed catalog.json
var catalogueJSON []byte

type Entry struct {
	ItemID int    `json:"itemId"`
	Kind   string `json:"kind"`
	Slot   string `json:"slot"`
	Name   string `json:"name"`
	Colour string `json:"colour"`
}

type Snapshot struct {
	Version     int   `json:"version"`
	ItemIDs     []int `json:"itemIds"`
	SkinColours []int `json:"skinColours"`
	HairColours []int `json:"hairColours"`
}

func Entries() ([]Entry, error) {
	var entries []Entry
	err := json.Unmarshal(catalogueJSON, &entries)
	return entries, err
}

// Read enabled options from the DB, never silently reopen a restricted slot.
func Load(app core.App) (Snapshot, error) {
	data := Snapshot{Version: 1, ItemIDs: []int{}, SkinColours: []int{}, HairColours: []int{}}
	entries, err := Entries()
	if err != nil {
		return data, err
	}
	known := make(map[int]Entry)
	slots := make(map[string]bool)
	for _, entry := range entries {
		if entry.Kind == "item" {
			known[entry.ItemID] = entry
			slots[entry.Slot] = false
		}
	}
	rows, err := app.FindRecordsByFilter(Collection, "enabled = true", "item_id", 0, 0)
	if err != nil {
		return data, err
	}
	for _, row := range rows {
		switch row.GetString("kind") {
		case "item":
			entry, exists := known[row.GetInt("item_id")]
			if !exists {
				return data, fmt.Errorf("unknown NPC wardrobe item %d", row.GetInt("item_id"))
			}
			data.ItemIDs = append(data.ItemIDs, entry.ItemID)
			slots[entry.Slot] = true
		case "skin_colour", "hair_colour":
			colour, err := strconv.ParseUint(strings.TrimPrefix(row.GetString("colour"), "#"), 16, 24)
			if err != nil {
				return data, fmt.Errorf("invalid NPC colour: %w", err)
			}
			if row.GetString("kind") == "skin_colour" {
				data.SkinColours = append(data.SkinColours, int(colour))
			} else {
				data.HairColours = append(data.HairColours, int(colour))
			}
		}
	}
	for slot, available := range slots {
		if !available {
			return data, fmt.Errorf("NPC wardrobe slot %q has no enabled item", slot)
		}
	}
	if len(data.SkinColours) == 0 || len(data.HairColours) == 0 {
		return data, fmt.Errorf("NPC skin/hair palettes must not be empty")
	}
	return data, nil
}
