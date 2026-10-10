package playerstate

import (
	_ "embed"
	"encoding/json"
	"sort"

	"github.com/pocketbase/pocketbase/core"
)

// Popularity limits and steps from ripped/game-config.xml.txt (<game minPopularity,
// maxPopularity, satisfiedCustomerPopularity, unsatisfiedCustomerPopularity>), in tenths,
// the unit already persisted in satisfaction_*_tenths. A 2010 comment confirms the cap:
// "a popularidade do atendimento não sai mesmo do 105".
const (
	MinPopularityTenths       int64 = 50
	MaxPopularityTenths       int64 = 1050
	SatisfiedCustomerTenths   int64 = 1
	UnsatisfiedCustomerTenths int64 = 3
	DefaultPopularityTenths   int64 = 800
)

type Level struct {
	Level      int   `json:"level"`
	RequiredXP int64 `json:"requiredXp"`
	RewardGold int64 `json:"rewardGold"`
}

//go:embed levels.json
var levelsJSON []byte

var levels = func() []Level {
	var file struct {
		Levels []Level `json:"levels"`
	}
	if err := json.Unmarshal(levelsJSON, &file); err != nil || len(file.Levels) < 2 {
		panic("playerstate: levels.json inválido")
	}
	for index, level := range file.Levels {
		if level.Level != index+1 || index > 0 && level.RequiredXP <= file.Levels[index-1].RequiredXP {
			panic("playerstate: levels.json fora de ordem")
		}
	}
	return file.Levels
}()

func MaxLevel() int { return len(levels) }

// RequiredXP is the cumulative experience that reaches a level (level 1 starts at 0).
func RequiredXP(level int) int64 {
	return levels[min(max(level, 1), len(levels))-1].RequiredXP
}

// LevelFor returns the highest level whose requirement the total experience meets.
func LevelFor(total int64) int {
	return sort.Search(len(levels), func(index int) bool { return levels[index].RequiredXP > total })
}

// experience_current stores the cumulative XP and experience_max the next level's
// threshold; at the last level both stop at its requirement, as players reported
// for the old level cap ("Estou no nvl 60 e não ganho mais xp").
func setExperience(record *core.Record, level int, total int64) {
	level = min(max(level, 1), len(levels))
	ceiling := RequiredXP(min(level+1, len(levels)))
	record.Set("level", level)
	record.Set("experience_current", min(max(total, RequiredXP(level)), ceiling))
	record.Set("experience_max", ceiling)
}

// GrantExperience adds XP and pays every level reached along the way. It returns how
// many levels were gained so callers can tell the player.
func GrantExperience(record *core.Record, amount int64) int {
	if amount <= 0 {
		return 0
	}
	level := record.GetInt("level")
	total := record.GetInt64("experience_current") + amount
	gained := 0
	for level < len(levels) && total >= RequiredXP(level+1) {
		level++
		gained++
		record.Set("gold", record.GetInt64("gold")+levels[level-1].RewardGold)
	}
	setExperience(record, level, total)
	return gained
}

// SetLevel and SetExperience are trusted adjustments (migrations and developer tools):
// they keep the level and the cumulative XP consistent but never pay level rewards.
func SetLevel(record *core.Record, level int) {
	setExperience(record, level, RequiredXP(level))
}

func SetExperience(record *core.Record, total int64) {
	total = min(max(total, 0), RequiredXP(len(levels)))
	setExperience(record, LevelFor(total), total)
}

// NormalizeProgress converts rows saved before levels were simulated. Their XP becomes
// the cumulative total and the level never decreases; no rewards are paid.
func NormalizeProgress(record *core.Record) {
	level := max(record.GetInt("level"), LevelFor(record.GetInt64("experience_current")))
	setExperience(record, level, record.GetInt64("experience_current"))
	record.Set("satisfaction_max_tenths", MaxPopularityTenths)
	record.Set("satisfaction_current_tenths", clampPopularity(record.GetInt64("satisfaction_current_tenths")))
}

func clampPopularity(tenths int64) int64 {
	return min(max(tenths, MinPopularityTenths), MaxPopularityTenths)
}

// AdjustPopularity applies a customer's verdict, bounded like the original.
func AdjustPopularity(record *core.Record, deltaTenths int64) {
	record.Set("satisfaction_current_tenths", clampPopularity(record.GetInt64("satisfaction_current_tenths")+deltaTenths))
}

func SetPopularity(record *core.Record, tenths int64) {
	record.Set("satisfaction_current_tenths", clampPopularity(tenths))
}
