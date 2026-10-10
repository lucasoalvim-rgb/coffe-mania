package gameruntime

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"coffe-mania/shared/buildinfo"
	"coffe-mania/shared/gamewire"
	"github.com/coder/websocket"
	"github.com/google/uuid"
)

// HTTPStorage is a low frequency bridge. Movement never calls this adapter.
type HTTPStorage struct {
	URL, Secret string
	Client      *http.Client
}

func (s *HTTPStorage) request(ctx context.Context, method, path string, body, out any) error {
	var data []byte
	var err error
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(s.URL, "/")+"/api/coffe/game-internal/"+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.Secret)
	req.Header.Set("Content-Type", "application/json")
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("persistence %s: HTTP %d", path, res.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(out)
	}
	return nil
}
func (s *HTTPStorage) Load(ctx context.Context, id string) (gamewire.Seed, error) {
	var out gamewire.Seed
	err := s.request(ctx, "GET", id+"/load", nil, &out)
	return out, err
}
func (s *HTTPStorage) Active(ctx context.Context, id string, humans int) error {
	return s.request(ctx, "POST", id+"/active", map[string]any{"active": true, "humans": humans}, nil)
}
func (s *HTTPStorage) Sleep(ctx context.Context, id string, state gamewire.Sleep) error {
	return s.request(ctx, "POST", id+"/sleep", state, nil)
}
func (s *HTTPStorage) Operate(ctx context.Context, op gamewire.Operation) (gamewire.Result, error) {
	var out gamewire.Result
	err := s.request(ctx, "POST", op.Owner+"/operation", op, &out)
	return out, err
}
func (s *HTTPStorage) Consume(ctx context.Context, id, food string) (gamewire.Business, error) {
	var out gamewire.Business
	err := s.request(ctx, "POST", id+"/consume", map[string]string{"foodId": food}, &out)
	return out, err
}
func (s *HTTPStorage) Dissatisfied(ctx context.Context, id string) (gamewire.Business, error) {
	var out gamewire.Business
	err := s.request(ctx, "POST", id+"/dissatisfied", map[string]string{}, &out)
	return out, err
}

type Server struct {
	Manager     *Manager
	Secret      string
	mu          sync.Mutex
	tickets     map[string]int64
	connections atomic.Int64
	Shutdown    func()
}

func NewServer(m *Manager, secret string) *Server {
	return &Server{Manager: m, Secret: secret, tickets: map[string]int64{}}
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /game/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok", "version": buildinfo.Version})
	})
	mux.HandleFunc("GET /game/ws", s.socket)
	mux.HandleFunc("POST /internal/operation", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var op gamewire.Operation
		if decode(r, &op) != nil || op.Owner == "" || op.User == "" {
			http.Error(w, "invalid", 400)
			return
		}
		out, err := s.Manager.Operate(r.Context(), op)
		if err != nil {
			log.Printf("room operation failed: room=%s action=%s error=%v", op.Owner, op.Action, err)
			http.Error(w, "room unavailable", 503)
			return
		}
		writeJSON(w, 200, out)
	}))
	mux.HandleFunc("POST /internal/appearance", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var body struct{ User, Appearance string }
		if decode(r, &body) != nil {
			http.Error(w, "invalid", 400)
			return
		}
		s.Manager.Appearance(r.Context(), body.User, body.Appearance)
		writeJSON(w, 200, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("POST /internal/kick", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var body struct{ User string }
		if decode(r, &body) != nil {
			http.Error(w, "invalid", 400)
			return
		}
		s.Manager.Kick(r.Context(), body.User)
		writeJSON(w, 200, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("GET /internal/metrics", s.internal(func(w http.ResponseWriter, r *http.Request) {
		out := s.Manager.Stats()
		out["connections"] = s.connections.Load()
		writeJSON(w, 200, out)
	}))
	mux.HandleFunc("POST /internal/shutdown", s.internal(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := s.Manager.Close(ctx); err != nil {
			http.Error(w, "shutdown failed", 503)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
		if s.Shutdown != nil {
			go s.Shutdown()
		}
	}))
	return mux
}
func decode(r *http.Request, out any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 65537))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("invalid body")
	}
	return nil
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func (s *Server) internal(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if len(s.Secret) < 32 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.Secret)) != 1 {
			http.Error(w, "forbidden", 403)
			return
		}
		next(w, r)
	}
}
func (s *Server) useTicket(token string) (gamewire.Ticket, error) {
	now := time.Now()
	ticket, err := gamewire.VerifyTicket(s.Secret, token, now)
	if err != nil {
		return ticket, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, expires := range s.tickets {
		if expires <= now.Unix() {
			delete(s.tickets, id)
		}
	}
	if _, ok := s.tickets[ticket.Nonce]; ok {
		return ticket, errors.New("ticket utilizado")
	}
	if len(s.tickets) >= 10000 {
		return ticket, ErrBusy
	}
	s.tickets[ticket.Nonce] = ticket.Expires
	return ticket, nil
}
func (s *Server) socket(w http.ResponseWriter, r *http.Request) {
	if s.connections.Add(1) > 4096 {
		s.connections.Add(-1)
		http.Error(w, "capacity", 503)
		return
	}
	defer s.connections.Add(-1)
	// Default Accept verifies Origin against Host; proxies preserve the public Host.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(8192)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	authCtx, authCancel := context.WithTimeout(ctx, 10*time.Second)
	kind, data, err := conn.Read(authCtx)
	authCancel()
	if err != nil || kind != websocket.MessageText {
		return
	}
	var join gamewire.Command
	if json.Unmarshal(data, &join) != nil || join.Type != "join" {
		_ = conn.Close(websocket.StatusPolicyViolation, "Entre novamente.")
		return
	}
	ticket, err := s.useTicket(join.Ticket)
	if err != nil {
		_ = conn.Close(websocket.StatusPolicyViolation, "Entre novamente.")
		return
	}
	p := &Peer{ID: uuid.NewString(), Ticket: ticket, Out: make(chan []byte, 128)}
	p.Kick = func() { p.Closed.Store(true); cancel(); _ = conn.CloseNow() }
	defer p.Kick()
	if err = s.Manager.Join(ctx, p); err != nil {
		_ = conn.Close(websocket.StatusTryAgainLater, "Quarto indisponível.")
		return
	}
	defer func() {
		leaveCtx, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		s.Manager.Leave(leaveCtx, p)
	}()
	// Reuse the existing protocol heartbeat: no room tasks, broadcasts or DB calls.
	measureLatency := func() error {
		pingCtx, done := context.WithTimeout(ctx, 5*time.Second)
		started := time.Now()
		err := conn.Ping(pingCtx)
		rtt := time.Since(started)
		done()
		if err != nil {
			return err
		}
		data, err := json.Marshal(gamewire.Latency{Type: "latency", RTTMs: float64(rtt) / float64(time.Millisecond)})
		if err != nil {
			return err
		}
		writeCtx, writeDone := context.WithTimeout(ctx, 5*time.Second)
		defer writeDone()
		return conn.Write(writeCtx, websocket.MessageText, data)
	}
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		defer p.Kick()
		firstMeasurement := true
		for {
			select {
			case <-ctx.Done():
				return
			case data := <-p.Out:
				writeCtx, done := context.WithTimeout(ctx, 5*time.Second)
				err := conn.Write(writeCtx, websocket.MessageText, data)
				done()
				if err != nil {
					return
				}
				// The first queued packet is welcome; send it before probing the connection.
				if firstMeasurement {
					firstMeasurement = false
					if measureLatency() != nil {
						return
					}
				}
			case <-ticker.C:
				if measureLatency() != nil {
					return
				}
			}
		}
	}()
	tokens := 20.0
	last := time.Now()
	for {
		kind, data, err = conn.Read(ctx)
		if err != nil {
			return
		}
		now := time.Now()
		tokens = min(20, tokens+now.Sub(last).Seconds()*10)
		last = now
		if tokens < 1 {
			_ = conn.Close(websocket.StatusPolicyViolation, "Muitos comandos.")
			return
		}
		tokens--
		var command gamewire.Command
		if kind != websocket.MessageText || json.Unmarshal(data, &command) != nil || len(command.RequestID) > 80 {
			_ = conn.Close(websocket.StatusPolicyViolation, "Comando inválido.")
			return
		}
		callCtx, done := context.WithTimeout(ctx, 10*time.Second)
		err = s.Manager.Command(callCtx, p, command)
		done()
		if err != nil {
			return
		}
	}
}
