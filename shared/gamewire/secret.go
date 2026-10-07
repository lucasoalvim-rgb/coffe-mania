package gamewire

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Both processes share this local key. It is never sent to the browser or printed.
func Secret(create bool) (string, error) {
	if key := os.Getenv("COFFE_GAME_SECRET"); key != "" {
		if len(key) < 32 {
			return "", errors.New("COFFE_GAME_SECRET deve ter pelo menos 32 caracteres")
		}
		return key, nil
	}
	path := os.Getenv("COFFE_GAME_SECRET_FILE")
	if path == "" {
		path = filepath.Join("..", ".runtime", "game-secret")
	}
	data, err := os.ReadFile(path)
	if err == nil {
		key := strings.TrimSpace(string(data))
		if len(key) < 32 {
			return "", errors.New("chave de jogo inválida")
		}
		return key, nil
	}
	if !create || !os.IsNotExist(err) {
		return "", err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "", err
	}
	bytes := make([]byte, 32)
	if _, err = rand.Read(bytes); err != nil {
		return "", err
	}
	key := hex.EncodeToString(bytes)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if os.IsExist(err) {
		return Secret(false)
	}
	if err != nil {
		return "", err
	}
	defer file.Close()
	_, err = file.WriteString(key)
	return key, err
}
