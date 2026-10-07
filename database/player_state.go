package main

import (
	"net/http"

	"coffe-mania/database/playerstate"
	"github.com/pocketbase/pocketbase/core"
)

func registerPlayerStateRoutes(e *core.ServeEvent) {
	// PocketBase normally authenticates subscriptions with an Authorization
	// header. The game keeps its token in an HttpOnly cookie instead. Authenticate
	// BEFORE the native handler compares this request with the client's auth.
	// Header authentication remains untouched for the dashboard and SDK clients.
	e.Router.BindFunc(func(r *core.RequestEvent) error {
		if r.Request.Method != http.MethodPost || r.Request.URL.Path != "/api/realtime" || r.Request.Header.Get("Authorization") != "" {
			return r.Next()
		}
		r.Auth = sessionRecord(r)
		if r.Auth == nil {
			clearSessionCookie(r)
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		return sameOrigin(r)
	})
	e.Router.GET("/api/coffe/player-state", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			clearSessionCookie(r)
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		// Never accept a player id from the browser: the cookie identifies the owner.
		record, err := playerstate.GetOrCreate(r.App, user.Id)
		if err != nil {
			return r.InternalServerError("Não foi possível carregar os dados do jogador.", err)
		}
		return r.JSON(http.StatusOK, playerstate.View(record))
	})
}
