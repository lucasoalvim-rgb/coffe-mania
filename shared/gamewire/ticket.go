package gamewire

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type Ticket struct {
	Nonce      string `json:"nonce"`
	Room       string `json:"room"`
	User       string `json:"user"`
	Name       string `json:"name"`
	Appearance string `json:"appearance"`
	Expires    int64  `json:"expires"`
}

func SignTicket(secret string, ticket Ticket) string {
	data, _ := json.Marshal(ticket)
	body := base64.RawURLEncoding.EncodeToString(data)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func VerifyTicket(secret, token string, now time.Time) (Ticket, error) {
	var ticket Ticket
	parts := strings.Split(token, ".")
	invalid := errors.New("ticket inválido ou expirado")
	if len(secret) < 32 || len(token) > 8192 || len(parts) != 2 {
		return ticket, invalid
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ticket, invalid
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return ticket, invalid
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return ticket, invalid
	}
	if json.Unmarshal(data, &ticket) != nil || len(ticket.Nonce) < 16 || ticket.User == "" || ticket.Room == "" || ticket.Expires <= now.Unix() || ticket.Expires > now.Add(2*time.Minute).Unix() {
		return ticket, invalid
	}
	return ticket, nil
}
