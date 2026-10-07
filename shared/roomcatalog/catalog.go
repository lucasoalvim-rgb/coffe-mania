package roomcatalog

import (
	"embed"
	"encoding/json"
)

//go:embed catalog.json
var files embed.FS

type Item struct {
	ID              int     `json:"id"`
	Classname       string  `json:"classname"`
	Name            string  `json:"name"`
	Type            int     `json:"type"`
	Kind            string  `json:"kind"`
	PriceGold       int64   `json:"priceGold"`
	Purchasable     bool    `json:"purchasable"`
	SizeX           int     `json:"sizeX"`
	SizeY           int     `json:"sizeY"`
	WallCutterIndex float64 `json:"wall_cutter_index,omitempty"`
}

var Items []Item

func init() {
	data, err := files.ReadFile("catalog.json")
	if err != nil {
		panic(err)
	}
	var catalog struct {
		Items []Item `json:"items"`
	}
	if err := json.Unmarshal(data, &catalog); err != nil {
		panic(err)
	}
	Items = catalog.Items
	seen := map[int]bool{}
	classNames := map[string]bool{}
	for _, item := range Items {
		if seen[item.ID] || classNames[item.Classname] || item.ID <= 0 || item.Classname == "" || item.SizeX < 1 || item.SizeY < 1 ||
			item.PriceGold < 0 || item.Type < 0 || item.Type > 3 ||
			(item.Type == 2 && (item.Kind != "door" || item.WallCutterIndex < 0 || item.WallCutterIndex > 1)) {
			panic("invalid room catalogue")
		}
		seen[item.ID] = true
		classNames[item.Classname] = true
	}
}

func ByID(id int) (Item, bool) {
	for _, item := range Items {
		if item.ID == id {
			return item, true
		}
	}
	return Item{}, false
}

func Layer(item Item) string {
	if item.Type == 0 {
		return "floor"
	}
	if item.Type == 1 {
		return "wallpaper"
	}
	if item.Kind == "wall" {
		return "structure"
	}
	return "object"
}
