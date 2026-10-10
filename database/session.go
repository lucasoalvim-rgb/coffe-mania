package main

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const sessionCookie = "coffe_session"
const sessionLifetime = 7 * 24 * 60 * 60

type playerSession struct {
	PlayerID    string `json:"playerId"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	DevTools    bool   `json:"devTools"`
}

func sessionRecord(e *core.RequestEvent) *core.Record {
	cookie, err := e.Request.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return nil
	}
	record, err := e.App.FindAuthRecordByToken(cookie.Value, core.TokenTypeAuth)
	if err != nil || record.Collection().Name != "users" {
		return nil
	}
	return record
}

func sessionView(record *core.Record) playerSession {
	name := record.GetString("name")
	if name == "" {
		name = strings.Split(record.Email(), "@")[0]
	}
	return playerSession{PlayerID: record.Id, DisplayName: name, Email: record.Email(), DevTools: devToolsEnabled()}
}

func setSessionCookie(e *core.RequestEvent, token string, maxAge int) {
	cookie := &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true,
		Secure:   requestUsesHTTPS(e.Request),
		SameSite: http.SameSiteLaxMode, MaxAge: maxAge,
	}
	if maxAge < 0 {
		cookie.Expires = time.Unix(1, 0)
	} else {
		cookie.Expires = time.Now().Add(time.Duration(maxAge) * time.Second)
	}
	http.SetCookie(e.Response, cookie)
}

func clearSessionCookie(e *core.RequestEvent) { setSessionCookie(e, "", -1) }

// Only local reverse proxies (Vite/ngrok) may identify the original TLS scheme.
// LAN/direct requests cannot forge this header to bypass origin validation.
func requestUsesHTTPS(request *http.Request) bool {
	if request.TLS != nil || osSecureCookies() {
		return true
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback() && strings.EqualFold(request.Header.Get("X-Forwarded-Proto"), "https")
}

// Cookie authentication needs an origin check for mutations, including login/logout.
func sameOrigin(e *core.RequestEvent) error {
	if origin := e.Request.Header.Get("Origin"); origin != "" {
		parsed, err := url.Parse(origin)
		scheme := "http"
		if requestUsesHTTPS(e.Request) {
			scheme = "https"
		}
		if err != nil || parsed.Scheme != scheme || !strings.EqualFold(parsed.Host, e.Request.Host) {
			return e.ForbiddenError("Origem inválida.", nil)
		}
	}
	return e.Next()
}

func registerSessionRoutes(e *core.ServeEvent) {
	g := e.Router.Group("/api/coffe/session")
	g.BindFunc(func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		return r.Next()
	})
	g.GET("", func(r *core.RequestEvent) error {
		record := sessionRecord(r)
		if record == nil {
			clearSessionCookie(r)
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		return r.JSON(http.StatusOK, sessionView(record))
	})
	g.POST("/login", func(r *core.RequestEvent) error {
		data := struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}{}
		if err := r.BindBody(&data); err != nil || data.Email == "" || data.Password == "" {
			return r.BadRequestError("Informe email e senha.", nil)
		}
		record, err := r.App.FindAuthRecordByEmail("users", strings.ToLower(strings.TrimSpace(data.Email)))
		if err != nil || !record.ValidatePassword(data.Password) {
			return r.UnauthorizedError("Email ou senha inválidos.", nil)
		}
		token, err := record.NewAuthToken()
		if err != nil {
			return r.InternalServerError("Não foi possível iniciar a sessão.", err)
		}
		setSessionCookie(r, token, sessionLifetime)
		return r.JSON(http.StatusOK, sessionView(record))
	}).Bind(apis.BodyLimit(4096)).BindFunc(sameOrigin)
	g.POST("/logout", func(r *core.RequestEvent) error {
		if user := sessionRecord(r); user != nil {
			if client := roomService(r.App); client != nil {
				_ = client.request(r.Request.Context(), "kick", map[string]string{"User": user.Id}, nil)
			}
		}
		clearSessionCookie(r)
		return r.NoContent(http.StatusNoContent)
	}).BindFunc(sameOrigin)
}
