package main

import (
	"net/http"

	"coffe-mania/database/npcappearance"
	"github.com/pocketbase/pocketbase/core"
)

func registerNpcAppearanceRoutes(e *core.ServeEvent) {
	e.Router.GET("/api/coffe/npc-appearance", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "private, no-store")
		if sessionRecord(r) == nil {
			clearSessionCookie(r)
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		policy, err := npcappearance.Load(r.App)
		if err != nil {
			return r.InternalServerError("Não foi possível carregar o catálogo dos NPCs.", err)
		}
		return r.JSON(http.StatusOK, policy)
	})
}
