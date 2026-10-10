// Package gamewire is the protocol between the independent room service and persistence.
// It has no database, renderer or PocketBase dependency.
package gamewire

import "encoding/json"

type Tile struct {
	X int `json:"tx"`
	Y int `json:"ty"`
}
type Unit struct {
	ID       string `json:"unitId"`
	ItemID   int    `json:"itemId"`
	Placed   bool   `json:"placed"`
	X        int    `json:"tx"`
	Y        int    `json:"ty"`
	Rotation int    `json:"rotation"`
	StoveID  string `json:"stoveId,omitempty"`
}

// Food is a counter's dish. Counter is empty for dishes saved before counters existed.
type Food struct {
	ID       string `json:"id"`
	Recipe   string `json:"recipeId"`
	Counter  string `json:"counterId,omitempty"`
	Portions int    `json:"portions,omitempty"`
}
type World struct {
	RoomID   string          `json:"roomId"`
	Revision int             `json:"revision"`
	TilesX   int             `json:"tilesX"`
	TilesY   int             `json:"tilesY"`
	Units    []Unit          `json:"units"`
	Foods    []Food          `json:"foods"`
	Cooking  json.RawMessage `json:"cooking,omitempty"`
}
type Movement struct {
	From      Tile  `json:"from"`
	To        Tile  `json:"to"`
	StartedAt int64 `json:"startedAt"`
	Duration  int64 `json:"duration"`
}
type ActorAction struct {
	Kind      string `json:"kind"`
	StoveID   string `json:"stoveId,omitempty"`
	StartedAt int64  `json:"startedAt"`
	Duration  int64  `json:"duration"`
}
type Emotion struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	StartedAt int64  `json:"startedAt"`
	Duration  int64  `json:"duration"`
}
type Actor struct {
	ID              string       `json:"id"`
	Kind            string       `json:"kind,omitempty"`
	Name            string       `json:"name,omitempty"`
	Appearance      string       `json:"appearance,omitempty"`
	X               int          `json:"tx"`
	Y               int          `json:"ty"`
	Direction       int          `json:"direction"`
	Outside         bool         `json:"outside"`
	State           string       `json:"state"`
	Move            *Movement    `json:"move,omitempty"`
	ChairID         string       `json:"chairId,omitempty"`
	TableID         string       `json:"tableId,omitempty"`
	Food            *Food        `json:"food,omitempty"`
	ActionRemaining int64        `json:"actionRemaining,omitempty"`
	Action          *ActorAction `json:"action,omitempty"`
	Emotion         *Emotion     `json:"emotion,omitempty"`
	EmotionShown    bool         `json:"emotionShown,omitempty"`
	// Paths/timers are saved only on dormancy; they are never broadcast in hot updates.
	Path   []Tile `json:"path,omitempty"`
	Visits int    `json:"visits,omitempty"`
	// A customer's verdict is applied once: Ate marks a served meal, Judged a recorded visit.
	Ate    bool `json:"ate,omitempty"`
	Judged bool `json:"judged,omitempty"`
}

// Business is the owner's private progress that drives the room: customer frequency
// follows popularity (in tenths, as persisted) and level.
type Business struct {
	Popularity int64 `json:"popularity"`
	Level      int   `json:"level"`
}
type Seed struct {
	World    World    `json:"world"`
	NPCs     []Actor  `json:"npcs"`
	Looks    []string `json:"looks"`
	Business Business `json:"business"`
}
type Sleep struct {
	NPCs []Actor `json:"npcs"`
}
type Operation struct {
	Owner  string          `json:"owner"`
	User   string          `json:"user"`
	Action string          `json:"action"`
	Body   json.RawMessage `json:"body"`
}
type Result struct {
	Status   int             `json:"status"`
	Body     json.RawMessage `json:"body"`
	World    *World          `json:"world,omitempty"`
	Business *Business       `json:"business,omitempty"`
}
type Event struct {
	Type      string          `json:"type"`
	Epoch     string          `json:"epoch"`
	Seq       uint64          `json:"seq"`
	ServerNow int64           `json:"serverNow"`
	SelfID    string          `json:"selfId,omitempty"`
	World     *World          `json:"world,omitempty"`
	Actors    []Actor         `json:"actors,omitempty"`
	Removed   []string        `json:"removed,omitempty"`
	Units     []Unit          `json:"units,omitempty"`
	Revision  int             `json:"revision,omitempty"`
	Cooking   json.RawMessage `json:"cooking,omitempty"`
	Foods     []Food          `json:"foods,omitempty"`
	RequestID string          `json:"requestId,omitempty"`
	Message   string          `json:"message,omitempty"`
}
type Command struct {
	Type      string `json:"type"`
	Ticket    string `json:"ticket,omitempty"`
	RequestID string `json:"requestId,omitempty"`
	X         *int   `json:"tx,omitempty"`
	Y         *int   `json:"ty,omitempty"`
	ChairID   string `json:"chairId,omitempty"`
	StoveID   string `json:"stoveId,omitempty"`
}

// Latency is private transport telemetry, outside the ordered room event stream.
type Latency struct {
	Type  string  `json:"type"`
	RTTMs float64 `json:"rttMs"`
}
