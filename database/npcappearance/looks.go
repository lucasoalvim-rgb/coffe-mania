package npcappearance

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"sort"
	"strings"

	"coffe-mania/database/appearance"
)

//go:embed wardrobe.json
var wardrobeJSON []byte

//go:embed atlas.json
var atlasJSON []byte

type wardrobeItem struct {
	ID        int      `json:"id"`
	Group     string   `json:"group"`
	Objects   []string `json:"objects"`
	Hidden    []string `json:"hideGroups"`
	Texture   string   `json:"texture"`
	Invisible bool     `json:"invisible"`
	NoHat     bool     `json:"noHat"`
}
type wardrobeGroup struct {
	Name   string `json:"name"`
	Parent string `json:"parent"`
	Kind   string `json:"kind"`
}
type wardrobeFile struct {
	Groups []wardrobeGroup `json:"groups"`
	Items  []wardrobeItem  `json:"items"`
}

func GenerateLooks(policy Snapshot, count int) ([]string, error) {
	var w wardrobeFile
	var atlas struct {
		Symbols map[string]json.RawMessage `json:"symbols"`
	}
	if err := json.Unmarshal(wardrobeJSON, &w); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(atlasJSON, &atlas); err != nil {
		return nil, err
	}
	allowed := map[int]bool{}
	for _, id := range policy.ItemIDs {
		allowed[id] = true
	}
	parents := map[string]string{}
	pools := map[string][]wardrobeItem{}
	for _, g := range w.Groups {
		slot := g.Name
		if g.Parent != "" {
			slot = g.Parent
		}
		parents[g.Name] = slot
		if g.Kind == "item" {
			pools[slot] = nil
		}
	}
	has := func(objects []string, prefix string) bool {
		for _, name := range objects {
			if strings.HasPrefix(name, prefix) {
				return true
			}
		}
		return false
	}
	optional := func(slot string) bool { return slot == "Hat" || slot == "Miscellaneous" || slot == "Facial Hair" }
	for _, i := range w.Items {
		slot := parents[i.Group]
		if !allowed[i.ID] || i.Invisible {
			continue
		}
		if _, exists := atlas.Symbols[i.Texture]; i.Texture != "" && !exists {
			continue
		}
		unsafe := false
		for _, hidden := range i.Hidden {
			h := parents[hidden]
			if h == "Pants" || h == "Shirt" || h == "Eyes" || h == "Mouth" {
				unsafe = true
			}
		}
		if unsafe {
			continue
		}
		usable := i.Texture != "" || len(i.Objects) > 0 || optional(slot) || slot == "Eyebrows"
		switch slot {
		case "Hair":
			usable = has(i.Objects, "hair")
		case "Pants":
			usable = i.Texture != "" && has(i.Objects, "pants")
		case "Shirt":
			usable = i.Texture != "" && has(i.Objects, "shirt") && has(i.Objects, "armleft") && has(i.Objects, "armright")
		case "Eyes", "Mouth":
			usable = i.Texture != ""
		}
		if usable {
			pools[slot] = append(pools[slot], i)
		}
	}
	slots := []string{}
	for slot, pool := range pools {
		if len(pool) == 0 {
			return nil, fmt.Errorf("nenhuma peça utilizável para %s", slot)
		}
		slots = append(slots, slot)
	}
	sort.Strings(slots)
	absent := func(i wardrobeItem) bool { return i.Texture == "" && len(i.Objects) == 0 }
	choose := func(slot string, pool []wardrobeItem) wardrobeItem {
		common, rare := []wardrobeItem{}, []wardrobeItem{}
		for _, i := range pool {
			if optional(slot) && !absent(i) {
				rare = append(rare, i)
			} else {
				common = append(common, i)
			}
		}
		selected := common
		if len(selected) == 0 || (len(rare) > 0 && rand.Float64() < .05) {
			selected = rare
		}
		return selected[rand.IntN(len(selected))]
	}
	rareSkin := map[int]bool{0xa4dfe3: true, 0xa4aee3: true, 0xe3a4dd: true, 0x98e3a0: true, 0xb3b3b3: true, 0xcce3e2: true}
	rareHair := map[int]bool{0x332e26: true, 0: true, 0xbd4040: true, 0x852121: true, 0x541152: true, 0x7a69bf: true}
	colour := func(pool []int, rareSet map[int]bool) int {
		common, rare := []int{}, []int{}
		for _, c := range pool {
			if rareSet[c] {
				rare = append(rare, c)
			} else {
				common = append(common, c)
			}
		}
		selected := common
		if len(selected) == 0 || (len(rare) > 0 && rand.Float64() < .05) {
			selected = rare
		}
		return selected[rand.IntN(len(selected))]
	}
	if len(policy.SkinColours) == 0 || len(policy.HairColours) == 0 {
		return nil, fmt.Errorf("paleta vazia")
	}
	seen := map[string]bool{}
	looks := []string{}
	for attempt := 0; attempt < count*256 && len(looks) < count; attempt++ {
		items := map[string]wardrobeItem{}
		for _, slot := range slots {
			items[slot] = choose(slot, pools[slot])
		}
		if items["Hair"].NoHat && !absent(items["Hat"]) {
			compatible := []wardrobeItem{}
			for _, i := range pools["Hair"] {
				if !i.NoHat {
					compatible = append(compatible, i)
				}
			}
			if len(compatible) == 0 {
				continue
			}
			items["Hair"] = choose("Hair", compatible)
		}
		ids := []int{}
		for _, slot := range slots {
			ids = append(ids, items[slot].ID)
		}
		data, _ := json.Marshal(map[string]any{"version": 1, "itemIds": ids, "skinColour": colour(policy.SkinColours, rareSkin), "hairColour": colour(policy.HairColours, rareHair)})
		normalized, err := appearance.Validate(string(data))
		if err != nil {
			return nil, err
		}
		if seen[normalized] {
			continue
		}
		seen[normalized] = true
		looks = append(looks, normalized)
	}
	if len(looks) == 0 {
		return nil, fmt.Errorf("nenhum visual compatível com o catálogo")
	}
	return looks, nil
}
